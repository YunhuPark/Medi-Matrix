from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence, pad_packed_sequence, pad_sequence
from torch.utils.data import DataLoader, Dataset

from challenge_metrics import choose_utility_threshold
from gru_data import fit_preprocessor, input_columns, transform_frame
from train_baseline import TARGET, metrics, patient_split, read_dataset


class PatientSequenceDataset(Dataset):
    def __init__(self, frame: pd.DataFrame, feature_names: list[str]):
        self.samples: list[dict[str, Any]] = []
        ordered = frame.sort_values(["patient_id", "hour"])
        for patient_id, patient in ordered.groupby("patient_id", sort=False):
            x = torch.tensor(patient[feature_names].to_numpy(dtype=np.float32), dtype=torch.float32)
            y = torch.tensor(patient[TARGET].to_numpy(dtype=np.float32), dtype=torch.float32)
            hours = patient["hour"].to_numpy(dtype=np.int64)
            self.samples.append({
                "patient_id": str(patient_id),
                "x": x,
                "y": y,
                "hours": hours,
            })

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> dict[str, Any]:
        return self.samples[index]


def collate_sequences(batch: list[dict[str, Any]]) -> dict[str, Any]:
    lengths = torch.tensor([len(item["y"]) for item in batch], dtype=torch.long)
    x = pad_sequence([item["x"] for item in batch], batch_first=True)
    y = pad_sequence([item["y"] for item in batch], batch_first=True, padding_value=-1.0)
    mask = y >= 0.0
    return {
        "x": x,
        "y": y,
        "mask": mask,
        "lengths": lengths,
        "patient_ids": [item["patient_id"] for item in batch],
        "hours": [item["hours"] for item in batch],
    }


class CausalGRU(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 48, dropout: float = 0.15):
        super().__init__()
        self.gru = nn.GRU(input_size=input_size, hidden_size=hidden_size, num_layers=1, batch_first=True)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        packed = pack_padded_sequence(x, lengths.cpu(), batch_first=True, enforce_sorted=False)
        packed_out, _ = self.gru(packed)
        out, _ = pad_packed_sequence(packed_out, batch_first=True, total_length=x.shape[1])
        return self.head(self.dropout(out)).squeeze(-1)


@dataclass
class EvalOutput:
    frame: pd.DataFrame
    probabilities: np.ndarray
    loss: float


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def make_loader(frame: pd.DataFrame, feature_names: list[str], batch_size: int, shuffle: bool) -> DataLoader:
    return DataLoader(
        PatientSequenceDataset(frame, feature_names),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=0,
        collate_fn=collate_sequences,
    )


def masked_loss(logits: torch.Tensor, targets: torch.Tensor, mask: torch.Tensor, criterion: nn.Module) -> torch.Tensor:
    return criterion(logits[mask], targets[mask])


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    criterion: nn.Module,
) -> EvalOutput:
    model.eval()
    rows: list[dict[str, Any]] = []
    probabilities: list[float] = []
    losses: list[float] = []

    with torch.no_grad():
        for batch in loader:
            x = batch["x"].to(device)
            y = batch["y"].to(device)
            mask = batch["mask"].to(device)
            lengths = batch["lengths"]
            logits = model(x, lengths)
            loss = masked_loss(logits, y, mask, criterion)
            losses.append(float(loss.item()))
            prob = torch.sigmoid(logits).cpu().numpy()

            for i, patient_id in enumerate(batch["patient_ids"]):
                length = int(lengths[i])
                patient_y = batch["y"][i, :length].numpy().astype(int)
                patient_prob = prob[i, :length]
                patient_hours = batch["hours"][i]
                for hour, label, p in zip(patient_hours, patient_y, patient_prob):
                    rows.append({"patient_id": patient_id, "hour": int(hour), TARGET: int(label)})
                    probabilities.append(float(p))

    frame = pd.DataFrame(rows)
    return EvalOutput(frame=frame, probabilities=np.asarray(probabilities, dtype=float), loss=float(np.mean(losses)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a causal GRU on the official PhysioNet 2019 SepsisLabel task.")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, default=Path("ml/artifacts/vitals_gru_challenge2019_v1"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--hidden-size", type=int, default=48)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--patience", type=int, default=2)
    args = parser.parse_args()

    set_seed(args.seed)
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
    device = torch.device("cpu")

    frame = read_dataset(args.data)
    train_raw, val_raw, test_raw, train_ids, val_ids, test_ids = patient_split(frame, args.seed)
    preprocessor = fit_preprocessor(train_raw)
    train = transform_frame(train_raw, preprocessor)
    val = transform_frame(val_raw, preprocessor)
    test = transform_frame(test_raw, preprocessor)
    features = input_columns()

    train_loader = make_loader(train, features, args.batch_size, shuffle=True)
    val_loader = make_loader(val, features, args.batch_size, shuffle=False)
    test_loader = make_loader(test, features, args.batch_size, shuffle=False)

    positive = max(int(train[TARGET].sum()), 1)
    negative = max(int(len(train) - positive), 1)
    pos_weight = torch.tensor([negative / positive], dtype=torch.float32, device=device)

    model = CausalGRU(len(features), hidden_size=args.hidden_size).to(device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)

    best_state = None
    best_val_loss = float("inf")
    stale_epochs = 0
    history: list[dict[str, float | int]] = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        train_losses: list[float] = []
        for batch in train_loader:
            x = batch["x"].to(device)
            y = batch["y"].to(device)
            mask = batch["mask"].to(device)
            lengths = batch["lengths"]

            optimizer.zero_grad(set_to_none=True)
            logits = model(x, lengths)
            loss = masked_loss(logits, y, mask, criterion)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            train_losses.append(float(loss.item()))

        val_eval = evaluate(model, val_loader, device, criterion)
        record = {
            "epoch": epoch,
            "train_loss": float(np.mean(train_losses)),
            "validation_loss": val_eval.loss,
        }
        history.append(record)
        print(json.dumps(record))

        if val_eval.loss < best_val_loss - 1e-5:
            best_val_loss = val_eval.loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                break

    if best_state is None:
        raise RuntimeError("GRU training did not produce a valid checkpoint")

    model.load_state_dict(best_state)
    val_eval = evaluate(model, val_loader, device, criterion)
    threshold = choose_utility_threshold(val_eval.frame, val_eval.probabilities)
    test_eval = evaluate(model, test_loader, device, criterion)

    report = {
        "model_name": "vitals_gru_challenge2019_v1",
        "task": "PhysioNet 2019 early sepsis warning from six vital signs with causal recurrent history",
        "clinical_use": False,
        "source_dataset": "PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0",
        "base_features": preprocessor["features"],
        "model_features": features,
        "target": "official SepsisLabel",
        "target_semantics": "PhysioNet labels septic patients positive from t_sepsis - 6h onward; no additional label shift is applied.",
        "preprocessing": "training-only statistics; patient-local forward fill; observed mask; hours-since-last-observation; no future rows",
        "threshold_selection": "maximize normalized Challenge utility on validation patients only",
        "split": {
            "strategy": "patient-level stratified 70/15/15",
            "seed": args.seed,
            "train_patients": len(train_ids),
            "validation_patients": len(val_ids),
            "test_patients": len(test_ids),
        },
        "class_balance": {
            "positive_rows": positive,
            "negative_rows": negative,
            "pos_weight": float(negative / positive),
        },
        "architecture": {
            "type": "single-layer GRU",
            "input_size": len(features),
            "hidden_size": args.hidden_size,
            "dropout": 0.15,
            "epochs_requested": args.epochs,
            "epochs_completed": len(history),
            "early_stopping_patience": args.patience,
        },
        "validation": metrics(val_eval.frame, val_eval.probabilities, threshold),
        "test": metrics(test_eval.frame, test_eval.probabilities, threshold),
    }

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "input_size": len(features),
            "hidden_size": args.hidden_size,
            "preprocessor": preprocessor,
            "features": features,
            "threshold": threshold,
        },
        args.artifact_dir / "model.pt",
    )
    (args.artifact_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.artifact_dir / "training_history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    (args.artifact_dir / "split_manifest.json").write_text(
        json.dumps({"train": train_ids, "validation": val_ids, "test": test_ids}, indent=2),
        encoding="utf-8",
    )
    (args.artifact_dir / "preprocessor.json").write_text(json.dumps(preprocessor, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
