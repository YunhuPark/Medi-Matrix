import sys
from unittest.mock import mock_open, patch

import pytest


@pytest.fixture(autouse=True)
def cleanup_torch():
    """Keep demo-mode import checks independent of other tests."""
    if "torch" in sys.modules:
        del sys.modules["torch"]
    yield
    if "torch" in sys.modules:
        del sys.modules["torch"]


def test_demo_mode_no_torch_import(monkeypatch):
    """Demo Vitals and Vision inference must stay lightweight."""
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")

    saved_modules = {}
    for mod in ["api.mamba_inference", "services.inference_service", "api.router", "main"]:
        if mod in sys.modules:
            saved_modules[mod] = sys.modules[mod]
            del sys.modules[mod]

    try:
        with patch("builtins.open", mock_open()) as mocked_open:
            import main  # noqa: F401
            from api.mamba_inference import MambaSystemicPredictor
            from services.inference_service import inference_service

            vitals = MambaSystemicPredictor()
            scores = vitals.predict([
                {"hr": 80, "bpSys": 120, "bpDia": 62, "resp": 16, "temp": 36.5, "spo2": 98}
            ])
            assert {"sepsis", "ards", "shock"}.issubset(scores)
            assert scores["inference_mode"] == "demo"
            assert scores["clinical_use"] is False

            with patch("nibabel.load") as mock_nib_load:
                import numpy as np

                class MockImg:
                    def get_fdata(self):
                        return np.zeros((10, 10, 10))

                mock_nib_load.return_value = MockImg()
                inference_service.predict("fake.nii.gz")

            assert "torch" not in sys.modules, "torch should NOT be loaded in demo mode"
            for call in mocked_open.call_args_list:
                filename = call.args[0]
                assert ".pt" not in str(filename) and ".pth" not in str(filename)
    finally:
        for mod in ["api.mamba_inference", "services.inference_service", "api.router", "main"]:
            if mod in sys.modules:
                del sys.modules[mod]
            if mod in saved_modules:
                sys.modules[mod] = saved_modules[mod]


def test_vitals_model_mode_is_independent_from_vision_mode(monkeypatch, tmp_path):
    """Vitals can be enabled without enabling the unverified Vision model path."""
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "model")
    monkeypatch.setenv("VITALS_MODEL_PATH", str(tmp_path / "missing.pt"))

    if "api.mamba_inference" in sys.modules:
        del sys.modules["api.mamba_inference"]

    from api.mamba_inference import MambaSystemicPredictor, VitalsModelUnavailableError

    with pytest.raises(VitalsModelUnavailableError, match="artifact is missing"):
        MambaSystemicPredictor()

    assert "torch" not in sys.modules, "missing artifact should fail before importing torch"


def test_vitals_model_compatibility_contract_is_explicit(monkeypatch):
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    from api.mamba_inference import MODEL_COMPATIBILITY

    assert MODEL_COMPATIBILITY["selected_model"] == "vitals_gru_challenge2019_v1"
    assert MODEL_COMPATIBILITY["model_mode_ready"] is True
    assert MODEL_COMPATIBILITY["clinical_use"] is False
    assert MODEL_COMPATIBILITY["base_features"] == ["hr", "bpSys", "bpDia", "resp", "temp", "spo2"]
    assert MODEL_COMPATIBILITY["test_challenge_utility"] == pytest.approx(0.34512958980235814)


def test_vision_model_mode_still_fails_closed_before_torch_or_checkpoint_load(monkeypatch):
    """The separate unverified Vision model remains disabled."""
    monkeypatch.setenv("INFERENCE_MODE", "model")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    if "services.inference_service" in sys.modules:
        del sys.modules["services.inference_service"]

    with patch("builtins.open", mock_open()) as mocked_open:
        with pytest.raises(RuntimeError, match="disabled for Vision"):
            import services.inference_service  # noqa: F401

    assert "torch" not in sys.modules
    assert not mocked_open.called


def test_vision_model_compatibility_contract_is_explicit(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    if "services.inference_service" in sys.modules:
        del sys.modules["services.inference_service"]

    from services.inference_service import VISION_MODEL_COMPATIBILITY

    assert VISION_MODEL_COMPATIBILITY["model_mode_ready"] is False
    assert VISION_MODEL_COMPATIBILITY["checkpoint_provenance_verified"] is False
    assert VISION_MODEL_COMPATIBILITY["held_out_metrics_verified"] is False
    assert VISION_MODEL_COMPATIBILITY["claimed_dataset"] is None
