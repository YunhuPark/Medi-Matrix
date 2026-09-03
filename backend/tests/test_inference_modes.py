import sys
from unittest.mock import mock_open, patch

import pytest


@pytest.fixture(autouse=True)
def cleanup_torch():
    """Ensure torch is removed from sys.modules before and after each test."""
    if "torch" in sys.modules:
        del sys.modules["torch"]
    yield
    if "torch" in sys.modules:
        del sys.modules["torch"]


def test_demo_mode_no_torch_import(monkeypatch):
    """Demo inference must stay lightweight and must not read model weights."""
    monkeypatch.setenv("INFERENCE_MODE", "demo")

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

            mamba = MambaSystemicPredictor()
            scores = mamba.predict([{"hr": 80, "bpSys": 120}])
            assert set(scores) == {"sepsis", "ards", "shock"}

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
                assert ".pth" not in str(filename), "Model weights should not be loaded in demo mode"
    finally:
        for mod in ["api.mamba_inference", "services.inference_service", "api.router", "main"]:
            if mod in sys.modules:
                del sys.modules[mod]
            if mod in saved_modules:
                sys.modules[mod] = saved_modules[mod]


def test_mamba_model_mode_fails_closed_before_torch_or_checkpoint_load(monkeypatch):
    """The old 6-feature dummy model must never masquerade as IMST-Mamba."""
    monkeypatch.setenv("INFERENCE_MODE", "model")
    if "api.mamba_inference" in sys.modules:
        del sys.modules["api.mamba_inference"]

    from api.mamba_inference import MambaSystemicPredictor, UnverifiedModelModeError

    with patch("builtins.open", mock_open()) as mocked_open:
        with pytest.raises(UnverifiedModelModeError, match="34 clinical features"):
            MambaSystemicPredictor()

    assert "torch" not in sys.modules
    assert not mocked_open.called


def test_mamba_model_compatibility_contract_is_explicit(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    from api.mamba_inference import MODEL_COMPATIBILITY

    assert MODEL_COMPATIBILITY["research_features"] == 34
    assert MODEL_COMPATIBILITY["demo_features"] == 6
    assert MODEL_COMPATIBILITY["model_mode_ready"] is False
    assert MODEL_COMPATIBILITY["research_repo"] == "YunhuPark/IMST-Mamba"


def test_vision_model_mode_fails_closed_before_torch_or_checkpoint_load(monkeypatch):
    """An unverified UNet checkpoint must not be exposed as BraTS inference."""
    monkeypatch.setenv("INFERENCE_MODE", "model")
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
