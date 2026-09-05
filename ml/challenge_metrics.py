from __future__ import annotations

import numpy as np
import pandas as pd

DT_EARLY = -12
DT_OPTIMAL = -6
DT_LATE = 3
MAX_U_TP = 1.0
MIN_U_FN = -2.0
U_FP = -0.05
U_TN = 0.0


def prediction_utility(labels: np.ndarray, predictions: np.ndarray) -> float:
    labels = np.asarray(labels, dtype=int)
    predictions = np.asarray(predictions, dtype=int)
    if len(labels) != len(predictions):
        raise ValueError("labels and predictions must have equal length")
    if not set(np.unique(labels)).issubset({0, 1}):
        raise ValueError("labels must be binary")
    if not set(np.unique(predictions)).issubset({0, 1}):
        raise ValueError("predictions must be binary")

    if np.any(labels):
        is_septic = True
        # PhysioNet SepsisLabel begins DT_OPTIMAL=-6h before clinical onset.
        t_sepsis = int(np.argmax(labels) - DT_OPTIMAL)
    else:
        is_septic = False
        t_sepsis = float("inf")

    m1 = MAX_U_TP / (DT_OPTIMAL - DT_EARLY)
    b1 = -m1 * DT_EARLY
    m2 = -MAX_U_TP / (DT_LATE - DT_OPTIMAL)
    b2 = -m2 * DT_LATE
    m3 = MIN_U_FN / (DT_LATE - DT_OPTIMAL)
    b3 = -m3 * DT_OPTIMAL

    utility = 0.0
    for t, prediction in enumerate(predictions):
        if t > t_sepsis + DT_LATE:
            continue
        if is_septic and prediction:
            if t <= t_sepsis + DT_OPTIMAL:
                utility += max(m1 * (t - t_sepsis) + b1, U_FP)
            else:
                utility += m2 * (t - t_sepsis) + b2
        elif (not is_septic) and prediction:
            utility += U_FP
        elif is_septic and (not prediction):
            if t <= t_sepsis + DT_OPTIMAL:
                utility += 0.0
            else:
                utility += m3 * (t - t_sepsis) + b3
        else:
            utility += U_TN
    return float(utility)


def normalized_challenge_utility(frame: pd.DataFrame, probabilities: np.ndarray, threshold: float) -> float:
    if len(frame) != len(probabilities):
        raise ValueError("frame and probabilities must have equal length")
    work = frame[["patient_id", "hour", "label"]].copy()
    work["probability"] = np.asarray(probabilities, dtype=float)
    work = work.sort_values(["patient_id", "hour"])

    observed_total = 0.0
    best_total = 0.0
    inaction_total = 0.0

    for _, patient in work.groupby("patient_id", sort=False):
        labels = patient["label"].to_numpy(dtype=int)
        predictions = (patient["probability"].to_numpy() >= threshold).astype(int)
        observed_total += prediction_utility(labels, predictions)

        best = np.zeros(len(labels), dtype=int)
        if np.any(labels):
            t_sepsis = int(np.argmax(labels) - DT_OPTIMAL)
            start = max(0, t_sepsis + DT_EARLY)
            end = min(t_sepsis + DT_LATE + 1, len(labels))
            best[start:end] = 1
        best_total += prediction_utility(labels, best)
        inaction_total += prediction_utility(labels, np.zeros(len(labels), dtype=int))

    denominator = best_total - inaction_total
    if denominator == 0:
        return 0.0
    return float((observed_total - inaction_total) / denominator)


def choose_utility_threshold(frame: pd.DataFrame, probabilities: np.ndarray) -> float:
    probabilities = np.asarray(probabilities, dtype=float)
    candidates = np.unique(np.clip(probabilities, 0.001, 0.999))
    if len(candidates) > 80:
        candidates = np.quantile(candidates, np.linspace(0.02, 0.98, 60))

    best_threshold = 0.5
    best_utility = -np.inf
    for threshold in candidates:
        utility = normalized_challenge_utility(frame, probabilities, float(threshold))
        if utility > best_utility:
            best_utility = utility
            best_threshold = float(threshold)
    return best_threshold
