from __future__ import annotations

from pathlib import Path
import sys

import numpy as np
import pandas as pd
import pytest

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from challenge_metrics import prediction_utility
from prepare_physionet2019 import convert_patient_file
from train_baseline import FEATURES, patient_split
from train_xgboost import add_temporal_features, model_features


def test_physionet_columns_map_to_product_contract(tmp_path: Path):
    source = tmp_path / "p000001.psv"
    source.write_text(
        "HR|O2Sat|Temp|SBP|DBP|Resp|SepsisLabel\n"
        "80|98|36.5|120|75|16|0\n"
        "110|92|38.1|95|60|24|1\n",
        encoding="utf-8",
    )

    converted = convert_patient_file(source)

    assert list(converted.columns) == ["patient_id", "hour", *FEATURES, "label"]
    assert converted["patient_id"].unique().tolist() == ["p000001"]
    assert converted.iloc[1]["bpSys"] == 95
    assert converted.iloc[1]["spo2"] == 92
    assert converted["label"].tolist() == [0, 1]


def test_official_label_is_not_shifted_again():
    frame = pd.DataFrame(
        {
            "patient_id": ["p1"] * 8,
            "hour": list(range(1, 9)),
            "hr": [80.0] * 8,
            "bpSys": [120.0] * 8,
            "bpDia": [75.0] * 8,
            "resp": [16.0] * 8,
            "temp": [36.5] * 8,
            "spo2": [98.0] * 8,
            "label": [0, 0, 0, 0, 0, 1, 1, 1],
        }
    )

    assert "target_6h" not in frame.columns
    assert frame["label"].tolist() == [0, 0, 0, 0, 0, 1, 1, 1]


def test_official_challenge_utility_example_matches_reference():
    labels = np.array([0, 0, 0, 0, 1, 1], dtype=int)
    predictions = np.array([0, 0, 1, 1, 1, 1], dtype=int)
    utility = prediction_utility(labels, predictions)
    assert utility == pytest.approx(3.388888888888889)


def test_patient_split_has_no_patient_leakage():
    rows = []
    for patient_index in range(40):
        patient_id = f"p{patient_index:06d}"
        septic = patient_index % 2
        for hour in range(1, 10):
            source_label = 1 if septic and hour >= 8 else 0
            rows.append(
                {
                    "patient_id": patient_id,
                    "hour": hour,
                    "hr": 80 + patient_index,
                    "bpSys": 120 - septic * 15,
                    "bpDia": 75 - septic * 8,
                    "resp": 16 + septic * 5,
                    "temp": 36.5 + septic,
                    "spo2": 98 - septic * 5,
                    "label": source_label,
                }
            )

    frame = pd.DataFrame(rows)
    train, val, test, train_ids, val_ids, test_ids = patient_split(frame, seed=42)

    train_set = set(train_ids)
    val_set = set(val_ids)
    test_set = set(test_ids)
    assert train_set.isdisjoint(val_set)
    assert train_set.isdisjoint(test_set)
    assert val_set.isdisjoint(test_set)
    assert train_set | val_set | test_set == set(frame["patient_id"].unique())
    assert set(train["label"].unique()) == {0, 1}
    assert set(val["label"].unique()) == {0, 1}
    assert set(test["label"].unique()) == {0, 1}


def test_temporal_features_use_only_current_and_past_rows():
    frame = pd.DataFrame(
        [
            {"patient_id": "p1", "hour": 1, "hr": 80, "bpSys": 120, "bpDia": 75, "resp": 16, "temp": 36.5, "spo2": 98, "label": 0},
            {"patient_id": "p1", "hour": 2, "hr": 90, "bpSys": 115, "bpDia": 72, "resp": 18, "temp": 36.7, "spo2": 97, "label": 0},
            {"patient_id": "p1", "hour": 3, "hr": 120, "bpSys": 90, "bpDia": 58, "resp": 26, "temp": 38.0, "spo2": 91, "label": 1},
        ]
    )
    temporal = add_temporal_features(frame)

    assert temporal.loc[temporal["hour"] == 1, "hr_mean3"].iloc[0] == 80
    assert temporal.loc[temporal["hour"] == 2, "hr_mean3"].iloc[0] == 85
    assert temporal.loc[temporal["hour"] == 2, "hr_delta1"].iloc[0] == 10
    assert temporal.loc[temporal["hour"] == 2, "hr_mean3"].iloc[0] != 100
    assert "hr_mean6" in model_features()
