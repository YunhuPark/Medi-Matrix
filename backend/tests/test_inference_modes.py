import os
import sys
import pytest
from unittest.mock import patch, mock_open

@pytest.fixture(autouse=True)
def cleanup_torch():
    """Ensure torch is removed from sys.modules before and after each test."""
    if 'torch' in sys.modules:
        del sys.modules['torch']
    yield
    if 'torch' in sys.modules:
        del sys.modules['torch']

def test_demo_mode_no_torch_import(monkeypatch):
    """
    Test that importing backend.main and running inference in demo mode 
    does not load torch into sys.modules and does not load model files.
    """
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    
    # Start fresh import
    saved_modules = {}
    for mod in ['api.mamba_inference', 'services.inference_service', 'api.router', 'main']:
        if mod in sys.modules:
            saved_modules[mod] = sys.modules[mod]
            del sys.modules[mod]

    try:
        with patch('builtins.open', mock_open()) as mocked_open:
            # Import main
            import main
            from services.inference_service import inference_service
            from api.mamba_inference import MambaSystemicPredictor
            
            # Instantiate
            mamba = MambaSystemicPredictor()
            
            # Predict
            mamba.predict([{"hr": 80, "bpSys": 120}])
            
            # Mock nibabel load to avoid file read error for unet
            with patch('nibabel.load') as mock_nib_load:
                import numpy as np
                class MockImg:
                    def get_fdata(self):
                        return np.zeros((10, 10, 10))
                mock_nib_load.return_value = MockImg()
                
                inference_service.predict("fake.nii.gz")
                
            assert "torch" not in sys.modules, "torch should NOT be loaded in demo mode"
            
            # Verify model files were not opened
            for call in mocked_open.call_args_list:
                args, kwargs = call
                filename = args[0]
                assert ".pth" not in str(filename), "Model weights should not be loaded in demo mode"
    finally:
        for mod in ['api.mamba_inference', 'services.inference_service', 'api.router', 'main']:
            if mod in sys.modules:
                del sys.modules[mod]
            if mod in saved_modules:
                sys.modules[mod] = saved_modules[mod]
