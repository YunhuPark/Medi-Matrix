from pathlib import Path
import sys

import numpy as np
import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from gru_data import fit_preprocessor, input_columns, transform_frame


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "patient_id": ["p1"] * 4 + ["p2"] * 3,
            "hour": [1, 2, 3, 4, 1, 2, 3],
            "hr": [80.0, np.nan, 100.0, 999.0, 60.0, 65.0, 70.0],
            "bpSys": [120.0, 121.0, np.nan, 125.0, 110.0, np.nan, 115.0],
            "bpDia": [70.0, np.nan, 72.0, 73.0, 65.0, 66.0, 67.0],
            "resp": [16.0, 17.0, 18.0, 19.0, 14.0, np.nan, 15.0],
            "temp": [37.0, np.nan, 37.5, 38.0, 36.5, 36.7, np.nan],
            "spo2": [98.0, 97.0, np.nan, 95.0, 99.0, 99.0, 98.0],
            "label": [0, 0, 1, 1, 0, 0, 0],
        }
    )


def test_transform_has_expected_sequence_contract():
    frame = _frame()
    stats = fit_preprocessor(frame)
    transformed = transform_frame(frame, stats)
    assert list(transformed.columns) == ["patient_id", "hour", "label", *input_columns()]
    assert len(input_columns()) == 19
    assert np.isfinite(transformed[input_columns()].to_numpy()).all()


def test_forward_fill_never_uses_future_value():
    full = _frame()
    prefix = full[(full["patient_id"] != "p1") | (full["hour"] <= 3)].copy()

    # Fit on a separate fixed training cohort so the comparison isolates causal
    # transform behavior rather than changes in fitted normalization statistics.
    training = _frame().copy()
    training.loc[(training["patient_id"] == "p1") & (training["hour"] == 4), "hr"] = 90.0
    stats = fit_preprocessor(training)

    full_transformed = transform_frame(full, stats)
    prefix_transformed = transform_frame(prefix, stats)

    full_prefix = full_transformed[(full_transformed["patient_id"] == "p1") & (full_transformed["hour"] <= 3)]
    short_prefix = prefix_transformed[prefix_transformed["patient_id"] == "p1"]

    np.testing.assert_allclose(
        full_prefix[input_columns()].to_numpy(),
        short_prefix[input_columns()].to_numpy(),
        atol=1e-7,
    )


def test_missing_value_uses_previous_observation_and_recency():
    frame = _frame()
    stats = fit_preprocessor(frame)
    transformed = transform_frame(frame, stats)
    p1_hour2 = transformed[(transformed["patient_id"] == "p1") & (transformed["hour"] == 2)].iloc[0]
    p1_hour1 = transformed[(transformed["patient_id"] == "p1") & (transformed["hour"] == 1)].iloc[0]

    assert p1_hour2["hr_observed"] == 0.0
    assert p1_hour2["hr_recency"] > 0.0
    assert p1_hour2["hr_value"] == p1_hour1["hr_value"]


def test_preprocessor_does_not_depend_on_validation_rows():
    train = _frame()[lambda x: x["patient_id"] == "p1"].copy()
    stats_a = fit_preprocessor(train)

    validation = _frame()[lambda x: x["patient_id"] == "p2"].copy()
    validation["hr"] = 10000.0
    validation["bpSys"] = 10000.0

    # Fitting remains explicitly train-only; unrelated validation changes cannot
    # alter learned medians/means/stds.
    stats_b = fit_preprocessor(train)
    assert stats_a == stats_b
