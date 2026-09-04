from __future__ import annotations

import numpy as np
import pandas as pd


def add_future_sepsis_target(
    frame: pd.DataFrame,
    horizon_hours: int = 6,
    source_label: str = "label",
    target_name: str = "target_6h",
) -> pd.DataFrame:
    """Create a leakage-safe early-prediction target from hourly SepsisLabel rows.

    For a patient whose first positive SepsisLabel occurs at hour t:
      - rows [t-horizon, t) are positive prediction targets
      - rows before that are negative
      - rows at/after onset are excluded from prediction evaluation (NaN target)

    Patients who never become septic remain negative for all observed hours.
    """
    if horizon_hours <= 0:
        raise ValueError("horizon_hours must be positive")
    required = {"patient_id", "hour", source_label}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"frame missing required columns: {sorted(missing)}")

    out = frame.sort_values(["patient_id", "hour"]).copy()
    target = pd.Series(np.zeros(len(out), dtype=float), index=out.index, name=target_name)

    for _, group in out.groupby("patient_id", sort=False):
        positives = group.index[group[source_label].astype(int) == 1]
        if len(positives) == 0:
            continue

        onset_index = positives[0]
        onset_hour = int(out.at[onset_index, "hour"])
        patient_idx = group.index
        hours = out.loc[patient_idx, "hour"].astype(int)

        target.loc[patient_idx[(hours >= onset_hour - horizon_hours) & (hours < onset_hour)]] = 1.0
        target.loc[patient_idx[hours >= onset_hour]] = np.nan

    out[target_name] = target
    return out


def prediction_rows(frame: pd.DataFrame, target_name: str = "target_6h") -> pd.DataFrame:
    """Return only rows where an early-prediction target is defined."""
    if target_name not in frame.columns:
        raise ValueError(f"missing target column: {target_name}")
    return frame[frame[target_name].notna()].copy()
