from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from train_baseline import FEATURES, TARGET

RECENCY_CAP_HOURS = 24.0


def input_columns() -> list[str]:
    cols: list[str] = []
    for feature in FEATURES:
        cols.extend([
            f"{feature}_value",
            f"{feature}_observed",
            f"{feature}_recency",
        ])
    cols.append("hour_scaled")
    return cols


def _validate_frame(frame: pd.DataFrame) -> None:
    required = {"patient_id", "hour", *FEATURES, TARGET}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"frame missing required columns: {sorted(missing)}")


def _causal_filled_values(frame: pd.DataFrame, medians: dict[str, float]) -> pd.DataFrame:
    work = frame.sort_values(["patient_id", "hour"]).copy()
    for feature in FEATURES:
        numeric = pd.to_numeric(work[feature], errors="coerce")
        work[feature] = numeric.groupby(work["patient_id"], sort=False).ffill().fillna(medians[feature])
    return work


def fit_preprocessor(train: pd.DataFrame) -> dict[str, Any]:
    """Fit preprocessing statistics using training patients only.

    Forward filling is always performed within each patient and only from past to
    future. Initial missing values fall back to a median computed from the raw
    training observations. Means/stds are then fit on the causally filled training
    values, never on validation/test rows.
    """
    _validate_frame(train)
    sorted_train = train.sort_values(["patient_id", "hour"]).copy()

    medians: dict[str, float] = {}
    for feature in FEATURES:
        value = pd.to_numeric(sorted_train[feature], errors="coerce").median()
        medians[feature] = float(value) if pd.notna(value) else 0.0

    filled = _causal_filled_values(sorted_train, medians)
    means: dict[str, float] = {}
    stds: dict[str, float] = {}
    for feature in FEATURES:
        values = filled[feature].to_numpy(dtype=np.float64)
        means[feature] = float(np.mean(values))
        std = float(np.std(values))
        stds[feature] = std if std > 1e-8 else 1.0

    hour_values = pd.to_numeric(sorted_train["hour"], errors="coerce").dropna()
    hour_scale = float(hour_values.quantile(0.95)) if len(hour_values) else 1.0
    hour_scale = max(hour_scale, 1.0)

    return {
        "features": FEATURES,
        "medians": medians,
        "means": means,
        "stds": stds,
        "hour_scale": hour_scale,
        "recency_cap_hours": RECENCY_CAP_HOURS,
        "input_columns": input_columns(),
    }


def transform_frame(frame: pd.DataFrame, stats: dict[str, Any]) -> pd.DataFrame:
    """Apply a causal six-Vitals sequence transform.

    For every feature the model receives:
      1. a standardized causally-forward-filled value,
      2. whether the value was observed at the current hour,
      3. log-scaled hours since the last observation, capped at 24h.

    No future row is used to transform an earlier timestep.
    """
    _validate_frame(frame)
    work = frame.sort_values(["patient_id", "hour"]).copy()
    result = work[["patient_id", "hour", TARGET]].copy()

    cap = float(stats.get("recency_cap_hours", RECENCY_CAP_HOURS))
    denom = math.log1p(cap)

    for feature in FEATURES:
        raw = pd.to_numeric(work[feature], errors="coerce")
        observed = raw.notna()
        filled = raw.groupby(work["patient_id"], sort=False).ffill().fillna(float(stats["medians"][feature]))

        mean = float(stats["means"][feature])
        std = float(stats["stds"][feature])
        result[f"{feature}_value"] = ((filled - mean) / std).astype(np.float32)
        result[f"{feature}_observed"] = observed.astype(np.float32)

        last_observed_hour = work["hour"].where(observed).groupby(work["patient_id"], sort=False).ffill()
        recency = (work["hour"] - last_observed_hour).where(last_observed_hour.notna(), cap)
        recency = pd.to_numeric(recency, errors="coerce").fillna(cap).clip(lower=0.0, upper=cap)
        result[f"{feature}_recency"] = (np.log1p(recency) / denom).astype(np.float32)

    hour_scale = max(float(stats["hour_scale"]), 1.0)
    result["hour_scaled"] = (
        pd.to_numeric(work["hour"], errors="coerce").fillna(0.0) / hour_scale
    ).clip(lower=0.0, upper=5.0).astype(np.float32)

    return result
