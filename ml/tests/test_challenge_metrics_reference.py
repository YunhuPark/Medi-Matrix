from __future__ import annotations

from pathlib import Path
import sys

import numpy as np
import pandas as pd
import pytest

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from challenge_metrics import normalized_challenge_utility, prediction_utility


def official_reference_prediction_utility(
    labels: np.ndarray,
    predictions: np.ndarray,
    dt_early: int = -12,
    dt_optimal: int = -6,
    dt_late: int = 3,
    max_u_tp: float = 1.0,
    min_u_fn: float = -2.0,
    u_fp: float = -0.05,
    u_tn: float = 0.0,
) -> float:
    """Independent transcription of the official PhysioNet 2019 evaluator."""
    labels = np.asarray(labels, dtype=int)
    predictions = np.asarray(predictions, dtype=int)

    if np.any(labels):
        is_septic = True
        t_sepsis = int(np.argmax(labels) - dt_optimal)
    else:
        is_septic = False
        t_sepsis = float("inf")

    m_1 = max_u_tp / (dt_optimal - dt_early)
    b_1 = -m_1 * dt_early
    m_2 = -max_u_tp / (dt_late - dt_optimal)
    b_2 = -m_2 * dt_late
    m_3 = min_u_fn / (dt_late - dt_optimal)
    b_3 = -m_3 * dt_optimal

    utility = np.zeros(len(labels), dtype=float)
    for t in range(len(labels)):
        if t <= t_sepsis + dt_late:
            if is_septic and predictions[t]:
                if t <= t_sepsis + dt_optimal:
                    utility[t] = max(m_1 * (t - t_sepsis) + b_1, u_fp)
                else:
                    utility[t] = m_2 * (t - t_sepsis) + b_2
            elif (not is_septic) and predictions[t]:
                utility[t] = u_fp
            elif is_septic and (not predictions[t]):
                if t <= t_sepsis + dt_optimal:
                    utility[t] = 0.0
                else:
                    utility[t] = m_3 * (t - t_sepsis) + b_3
            elif (not is_septic) and (not predictions[t]):
                utility[t] = u_tn
    return float(np.sum(utility))


def official_reference_normalized_utility(
    frame: pd.DataFrame,
    probabilities: np.ndarray,
    threshold: float,
) -> float:
    work = frame[["patient_id", "hour", "label"]].copy()
    work["probability"] = np.asarray(probabilities, dtype=float)
    work = work.sort_values(["patient_id", "hour"])

    observed = 0.0
    best = 0.0
    inaction = 0.0
    for _, patient in work.groupby("patient_id", sort=False):
        labels = patient["label"].to_numpy(dtype=int)
        predictions = (patient["probability"].to_numpy() >= threshold).astype(int)
        observed += official_reference_prediction_utility(labels, predictions)

        best_predictions = np.zeros(len(labels), dtype=int)
        if np.any(labels):
            t_sepsis = int(np.argmax(labels) - (-6))
            best_predictions[
                max(0, t_sepsis - 12) : min(t_sepsis + 3 + 1, len(labels))
            ] = 1
        best += official_reference_prediction_utility(labels, best_predictions)
        inaction += official_reference_prediction_utility(
            labels, np.zeros(len(labels), dtype=int)
        )

    denominator = best - inaction
    return 0.0 if denominator == 0 else float((observed - inaction) / denominator)


@pytest.mark.parametrize(
    ("labels", "predictions"),
    [
        ([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]),
        ([0, 0, 0, 0, 0], [0, 1, 0, 1, 0]),
        ([0, 0, 1, 1, 1, 1], [0, 0, 1, 1, 1, 1]),
        ([0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 0, 0]),
        ([0, 0, 0, 1, 1, 1, 1, 1], [1, 1, 0, 0, 0, 0, 0, 0]),
    ],
)
def test_prediction_utility_matches_official_reference(labels, predictions):
    labels_arr = np.asarray(labels, dtype=int)
    pred_arr = np.asarray(predictions, dtype=int)
    expected = official_reference_prediction_utility(labels_arr, pred_arr)
    actual = prediction_utility(labels_arr, pred_arr)
    assert actual == pytest.approx(expected, abs=1e-12)


def test_normalized_utility_matches_official_reference_for_mixed_cohort():
    rows = []
    probabilities = []

    patient_specs = {
        "septic-a": ([0, 0, 0, 1, 1, 1, 1, 1], [0.05, 0.1, 0.3, 0.85, 0.9, 0.9, 0.8, 0.7]),
        "septic-b": ([0, 0, 0, 0, 0, 1, 1], [0.1, 0.15, 0.55, 0.65, 0.75, 0.8, 0.9]),
        "control-a": ([0, 0, 0, 0, 0, 0], [0.05, 0.1, 0.2, 0.25, 0.3, 0.35]),
        "control-b": ([0, 0, 0, 0], [0.7, 0.6, 0.2, 0.1]),
    }

    for patient_id, (labels, probs) in patient_specs.items():
        for hour, (label, prob) in enumerate(zip(labels, probs), start=1):
            rows.append({"patient_id": patient_id, "hour": hour, "label": label})
            probabilities.append(prob)

    frame = pd.DataFrame(rows)
    probabilities_arr = np.asarray(probabilities, dtype=float)
    threshold = 0.5

    expected = official_reference_normalized_utility(frame, probabilities_arr, threshold)
    actual = normalized_challenge_utility(frame, probabilities_arr, threshold)
    assert actual == pytest.approx(expected, abs=1e-12)


def test_physionet_label_is_not_shifted_again():
    # PhysioNet training labels are already shifted six hours ahead. The model
    # contract must consume them exactly as supplied rather than creating a
    # second future/onset target.
    frame = pd.DataFrame(
        {
            "patient_id": ["p1"] * 5,
            "hour": [1, 2, 3, 4, 5],
            "label": [0, 0, 1, 1, 1],
        }
    )
    assert frame["label"].tolist() == [0, 0, 1, 1, 1]
