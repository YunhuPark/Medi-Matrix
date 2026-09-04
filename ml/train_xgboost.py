from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, confusion_matrix, roc_auc_score
from xgboost import XGBClassifier

from targets import add_future_sepsis_target, prediction_rows
from train_baseline import FEATURES, HORIZON_HOURS, TARGET, choose_threshold, patient_split, read_dataset


def add_temporal_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Build leakage-safe temporal features using only current/past rows per patient."""
    out = frame.sort_values(["patient_id", "hour"]).copy()
    grouped = out.groupby("patient_id", sort=False)

    for feature in FEATURES:
        # Forward fill is causal; remaining missing values are imputed from train medians later.
        out[f"{feature}_ffill"] = grouped[feature].ffill()
        g = out.groupby("patient_id", sort=False)[f"{feature}_ffill"]
        out[f"{feature}_delta1"] = g.diff(1)
        out[f"{feature}_mean3"] = g.transform(lambda s: s.rolling(window=3, min_periods=1).mean())
        out[f"{feature}_std3"] = g.transform(lambda s: s.rolling(window=3, min_periods=2).std())
        out[f"{feature}_mean6"] = g.transform(lambda s: s.rolling(window=6, min_periods=1).mean())

    return out


def model_features() -> list[str]:
    cols: list[str] = []
    for feature in FEATURES:
        cols.extend(
            [
                feature,
                f"{feature}_ffill",
                f"{feature}_delta1",
                f"{feature}_mean3",
                f"{feature}_std3",
                f"{feature}_mean6",
            ]
        )
    cols.append("hour")
    return cols


def fit_train_medians(train: pd.DataFrame, feature_names: list[str]) -> dict[str, float]:
    medians: dict[str, float] = {}
    for name in feature_names:
        value = pd.to_numeric(train[name], errors="coerce").median()
        medians[name] = float(value) if pd.notna(value) else 0.0
    return medians


def apply_train_medians(frame: pd.DataFrame, feature_names: list[str], medians: dict[str, float]) -> pd.DataFrame:
    result = frame[feature_names].copy()
    for name in feature_names:
        result[name] = pd.to_numeric(result[name], errors="coerce").fillna(medians[name])
    return result


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Train temporal XGBoost for six-hour sepsis early prediction on PhysioNet 2019.")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, default=Path("ml/artifacts/vitals_xgb_6h_v1"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    frame = add_future_sepsis_target(read_dataset(args.data), horizon_hours=HORIZON_HOURS)
    frame = add_temporal_features(frame)
    train_all, val_all, test_all, train_ids, val_ids, test_ids = patient_split(frame, args.seed)
    train = prediction_rows(train_all)
    val = prediction_rows(val_all)
    test = prediction_rows(test_all)
    feature_names = model_features()
    medians = fit_train_medians(train, feature_names)

    x_train = apply_train_medians(train, feature_names, medians)
    x_val = apply_train_medians(val, feature_names, medians)
    x_test = apply_train_medians(test, feature_names, medians)

    positive = max(int(train[TARGET].sum()), 1)
    negative = max(int(len(train) - positive), 1)
    scale_pos_weight = negative / positive

    model = XGBClassifier(
        n_estimators=450,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=5,
        reg_lambda=1.0,
        objective="binary:logistic",
        eval_metric="aucpr",
        tree_method="hist",
        scale_pos_weight=scale_pos_weight,
        random_state=args.seed,
        n_jobs=4,
    )
    model.fit(x_train, train[TARGET].astype(int))

    val_prob = model.predict_proba(x_val)[:, 1]
    threshold = choose_threshold(val[TARGET].to_numpy(dtype=int), val_prob)
    test_prob = model.predict_proba(x_test)[:, 1]

    report = {
        "model_name": "vitals_xgb_temporal_6h_v1",
        "task": "predict sepsis onset within the next 6 hours from six vital signs and causal temporal features",
        "clinical_use": False,
        "source_dataset": "PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0",
        "base_features": FEATURES,
        "model_features": feature_names,
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
        "class_balance": {
            "positive_rows": positive,
            "negative_rows": negative,
            "scale_pos_weight": float(scale_pos_weight),
        },
        "validation": metrics(val[TARGET].to_numpy(dtype=int), val_prob, threshold),
        "test": metrics(test[TARGET].to_numpy(dtype=int), test_prob, threshold),
    }

    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "medians": medians, "features": feature_names}, args.artifact_dir / "model.joblib")
    (args.artifact_dir / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.artifact_dir / "split_manifest.json").write_text(
        json.dumps({"train": train_ids, "validation": val_ids, "test": test_ids}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
