"""Medical-image context adapter for the public Medi-Matrix prototype.

The competition deployment uses ``INFERENCE_MODE=demo`` and generates a
reproducible synthetic mask so judges can exercise the 3D product flow. The
repository also contains a lightweight portfolio UNet3D definition, but there
is not yet enough provenance and validation evidence to treat its checkpoint
as a verified BraTS segmentation model.

For that reason ``INFERENCE_MODE=model`` fails closed until the training data,
checkpoint provenance, preprocessing, label mapping and held-out segmentation
metrics are fixed and reproducible. This prevents a random/unverified mask from
being presented as clinical lesion detection.
"""

from __future__ import annotations

import os
from typing import Any, Tuple

import nibabel as nib
import numpy as np
from scipy.ndimage import gaussian_filter


class UnverifiedVisionModelError(RuntimeError):
    """Raised when an unverified medical-image model path is requested."""


VISION_MODEL_COMPATIBILITY = {
    "demo_input": "synthetic NIfTI/NumPy volume",
    "demo_output": "deterministic synthetic 3D context mask",
    "candidate_architecture": "lightweight portfolio UNet3D",
    "claimed_dataset": None,
    "checkpoint_provenance_verified": False,
    "held_out_metrics_verified": False,
    "model_mode_ready": False,
}


def _vision_model_mode_error() -> UnverifiedVisionModelError:
    return UnverifiedVisionModelError(
        "INFERENCE_MODE=model is disabled for Vision because the repository does "
        "not yet contain sufficient evidence to verify the UNet3D checkpoint as a "
        "reproducible BraTS segmentation model. Record dataset/version, label mapping, "
        "preprocessing, training configuration, checkpoint provenance and held-out "
        "segmentation metrics before enabling model inference."
    )


class MedicalInferenceService:
    """Synthetic 3D-context generator used by the public demo."""

    def __init__(self):
        self.mode = os.environ.get("INFERENCE_MODE", "demo").strip().lower()
        self.model = None
        self.device = None

        if self.mode not in {"demo", "model"}:
            raise ValueError("INFERENCE_MODE must be either 'demo' or 'model'.")
        if self.mode == "model":
            # Do not import torch and do not touch a checkpoint until the model
            # contract/provenance audit has been completed.
            raise _vision_model_mode_error()

    def preprocess(self, volume_data: np.ndarray) -> Any:
        """Reserved for a future verified model adapter."""
        _ = volume_data
        raise _vision_model_mode_error()

    def postprocess(self, tensor_output: Any, original_shape: tuple) -> Tuple[np.ndarray, np.ndarray]:
        """Reserved for a future verified model adapter."""
        _ = (tensor_output, original_shape)
        raise _vision_model_mode_error()

    def generate_demo_mask(self, data_shape: tuple) -> np.ndarray:
        """Generate a deterministic synthetic mask for the competition demo.

        This is not lesion detection, a learned segmentation output, or a
        clinically meaningful tumor boundary.
        """
        if len(data_shape) != 3:
            raise ValueError("Demo Vision input must be a 3D volume.")

        mask = np.zeros(data_shape, dtype=np.float32)
        center = [s // 2 for s in data_shape]
        z, y, x = center

        # Keep slices within bounds for small test volumes as well as the bundled
        # competition volume.
        z0, z1 = max(0, z - 10), min(data_shape[0], z + 10)
        y0, y1 = max(0, y - 15), min(data_shape[1], y + 15)
        x0, x1 = max(0, x - 12), min(data_shape[2], x + 12)
        mask[z0:z1, y0:y1, x0:x1] = 1.0

        mask = gaussian_filter(mask, sigma=3.0)
        return (mask > 0.2).astype(np.float32)

    def predict(self, nifti_path: str) -> Tuple[np.ndarray, np.ndarray]:
        if self.mode != "demo":
            raise _vision_model_mode_error()

        img = nib.load(nifti_path)
        data = img.get_fdata()
        if data.ndim != 3:
            raise ValueError("Vision input must resolve to a 3D volume.")

        final_mask = self.generate_demo_mask(data.shape)
        heatmap = final_mask
        return final_mask, heatmap


# Lightweight singleton: demo mode does not import PyTorch or load weights.
inference_service = MedicalInferenceService()
