from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from prepare_physionet2019 import convert_patient_file
from train_baseline import FEATURES, patient_split


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


def test_patient_split_has_no_patient_leakage():
    rows = []
    for patient_index in range(40):
        patient_id = f"p{patient_index:06d}"
        label = patient_index % 2
        for hour in range(1, 4):
            rows.append(
                {
                    "patient_id": patient_id,
                    "hour": hour,
                    "hr": 80 + patient_index,
                    "bpSys": 120 - label * 15,
                    "bpDia": 75 - label * 8,
                    "resp": 16 + label * 5,
                    "temp": 36.5 + label,
                    "spo2": 98 - label * 5,
                    "label": label,
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

    assert set(train["patient_id"]) == train_set
    assert set(val["patient_id"]) == val_set
    assert set(test["patient_id"]) == test_set
    assert set(train["label"].unique()) == {0, 1}
    assert set(val["label"].unique()) == {0, 1}
    assert set(test["label"].unique()) == {0, 1}
