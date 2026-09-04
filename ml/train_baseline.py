from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from targets import add_future_sepsis_target, prediction_rows

FEATURES = ["hr", "bpSys", "bpDia", "resp", "temp", "spo2"]
SOURCE_LABEL = "label"
TARGET = "target_6h"
HORIZON_HOURS = 6


def read_dataset(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        frame = pd.read_csv(path)
    else:
        frame = pd.read_parquet(path)
    required = {"patient_id", "hour", *FEATURES, SOURCE_LABEL}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"dataset missing required columns: {sorted(missing)}")
    return frame


def patient_split(
    frame: pd.DataFrame,
    seed: int,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    target_col: str = TARGET,
):
    rng = np.random.default_rng(seed)
    if target_col not in frame.columns:
        raise ValueError(f"dataset missing split target column: {target_col}")
    patient_labels = frame.groupby("patient_id")[target_col].max().fillna(0).astype(int)

    train_ids: list[str] = []
    val_ids: list[str] = []
    test_ids: list[str] = []

    # Stratify at the patient level to avoid leakage between hourly rows.
    for label in (0, 1):
        ids = patient_labels[patient_labels == label].index.to_numpy(copy=True)
        rng.shuffle(ids)
        n = len(ids)
        n_train = int(n * train_ratio)
        n_val = int(n * val_ratio)
        train_ids.extend(ids[:n_train].tolist())
        val_ids.extend(ids[n_train:n_train + n_val].tolist())
        test_ids.extend(ids[n_train + n_val:].tolist())

    def subset(ids: list[str]) -> pd.DataFrame:
        return frame[frame["patient_id"].isin(set(ids))].copy()

    return subset(train_ids), subset(val_ids), subset(test_ids), train_ids, val_ids, test_ids


def choose_threshold(y_true: np.ndarray, prob: np.ndarray) -> float:
    # Pick a validation threshold that maximizes Youden's J (sensitivity + specificity - 1).
    candidates = np.unique(np.clip(prob, 0.001, 0.999))
    if len(candidates) > 500:
        candidates = np.quantile(candidates, np.linspace(0.01, 0.99, 200))

    best_threshold = 0.5
    best_score = -np.inf
    for threshold in candidates:
        pred = (prob >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        sensitivity = tp / (tp + fn) if tp + fn else 0.0
        specificity = tn / (tn + fp) if tn + fp else 0.0
        score = sensitivity + specificity - 1.0
        if score > best_score:
            best_score = score
            best_threshold = float(threshold)
    return best_threshold


def metrics(y_true: np.ndarray, prob: np.ndarray, threshold: float) -> dict[str, float | int]:
    pred = (prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    sensitivity = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    return {
        "auroc": float(roc_auc_score(y_true, prob)),
        "auprc": float(average_precision_score(y_true, prob)),
        "threshold": float(threshold),
        "sensitivity": float(sensitivity),
        "specificity": float(specificity),
        "precision": float(precision),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }


def build_model() -> Pipeline:
    numeric = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scaler", StandardScaler()),
        ]
    )
    transformer = ColumnTransformer([("vitals", numeric, FEATURES)], remainder="drop")
    classifier = LogisticRegression(
        max_iter=2000,
        class_weight="balanced",
        solver="liblinear",
        random_state=42,
    )
    return Pipeline([("preprocess", transformer), ("classifier", classifier)])


def main() -> None:
    parser = argparse.ArgumentParser(description="Train an auditable 6-Vitals 6h sepsis early-warning baseline on PhysioNet 2019.")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, default=Path("ml/artifacts/vitals_logreg_6h_v1"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    frame = add_future_sepsis_target(read_dataset(args.data), horizon_hours=HORIZON_HOURS)
    train_all, val_all, test_all, train_ids, val_ids, test_ids = patient_split(frame, args.seed)
    train = prediction_rows(train_all)
    val = prediction_rows(val_all)
    test = prediction_rows(test_all)

    model = build_model()
    model.fit(train[FEATURES], train[TARGET].astype(int))

    val_prob = model.predict_proba(val[FEATURES])[:, 1]
    threshold = choose_threshold(val[TARGET].to_numpy(dtype=int), val_prob)
    test_prob = model.predict_proba(test[FEATURES])[:, 1]

    report = {
        "model_name": "vitals_logreg_6h_v1",
        "task": "predict sepsis onset within the next 6 hours from six vital signs",
        "clinical_use": False,
        "source_dataset": "PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0",
        "features": FEATURES,
        "source_label": "SepsisLabel",
        "target": TARGET,
        "prediction_horizon_hours": HORIZON_HOURS,
        "post_onset_rows_excluded": True,
        "split": {
            "strategy": "patient-level stratified 70/15/15",
            "seed": args.seed,
            "train_patients": len(train_ids),
            "validation_patients": len(val_ids),
            "test_patients": len(test_ids),
        },
        "prediction_rows": {
            "train": len(train),
            "validation": len(val),
            "test": len(test),
        },
        "validation": metrics(val[TARGET].to_numpy(dtype=int), val_prob, threshold),
        "test": metrics(test[TARGET].to_numpy(dtype=int), test_prob, threshold),
    }

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, args.artifact_dir / "model.joblib")
    (args.artifact_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.artifact_dir / "split_manifest.json").write_text(
        json.dumps({"train": train_ids, "validation": val_ids, "test": test_ids}, indent=2),
        encoding="utf-8",
    )

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
