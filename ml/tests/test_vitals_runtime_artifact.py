from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_PATH = REPO_ROOT / "backend" / "api" / "mamba_inference.py"
MODEL_PATH = REPO_ROOT / "backend" / "models" / "vitals_gru_challenge2019_v1" / "model.pt"
EXPECTED_MODEL_SHA256 = "182cebac9eae5bce456a904f00aee6e1d7650f3432e170783e437eab82eb202f"


def _load_runtime_module():
    spec = importlib.util.spec_from_file_location("vitals_runtime_under_test", RUNTIME_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load Vitals runtime module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reviewed_gru_artifact_checksum_and_runtime_parity(monkeypatch):
    assert MODEL_PATH.is_file()
    actual_sha = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    assert actual_sha == EXPECTED_MODEL_SHA256

    module = _load_runtime_module()
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "model")
    monkeypatch.setenv("VITALS_MODEL_PATH", str(MODEL_PATH))
    monkeypatch.setenv("VITALS_MODEL_MAX_HISTORY", "256")

    predictor = module.MambaSystemicPredictor()
    rows = [
        {"hr": 80, "bpSys": 120, "bpDia": 62, "resp": 16, "temp": 36.8, "spo2": 98},
        {"hr": 90, "bpSys": 110, "bpDia": 60, "resp": 20, "temp": 37.2, "spo2": 96},
        {"hr": 110, "bpSys": 88, "bpDia": 52, "resp": 28, "temp": 38.5, "spo2": 92},
    ]

    outputs = [predictor.predict([row]) for row in rows]
    final = outputs[-1]

    assert final["model_id"] == "vitals_gru_challenge2019_v1"
    assert final["inference_mode"] == "model"
    assert final["clinical_use"] is False
    assert final["model_threshold"] == pytest.approx(0.5996291004197073, abs=1e-12)
    assert final["sepsis"] == pytest.approx(0.6100368499755859, abs=1e-6)
    assert final["ards"] == 0.0
    assert final["shock"] == 0.0


def test_model_mode_does_not_synthesize_untrained_disease_outputs(monkeypatch):
    module = _load_runtime_module()
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "model")
    monkeypatch.setenv("VITALS_MODEL_PATH", str(MODEL_PATH))

    result = module.MambaSystemicPredictor().predict([
        {"hr": 100, "bpSys": 100, "bpDia": 60, "resp": 22, "temp": 37.8, "spo2": 95}
    ])
    assert result["ards"] == 0.0
    assert result["shock"] == 0.0
