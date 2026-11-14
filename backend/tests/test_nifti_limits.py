"""Bound untrusted header dimensions before loading/decompressing volume data."""
from unittest.mock import Mock

import nibabel as nib
import numpy as np
import pytest

from services.inference_service import MedicalInferenceService


@pytest.mark.parametrize("shape", [(512, 512, 512), (2, 2, 2, 2), (0, 10, 10)])
def test_rejects_unsafe_header_without_reading_voxels(monkeypatch, shape):
    image = Mock(shape=shape)
    image.get_data_dtype.return_value = np.dtype("float32")
    monkeypatch.setattr(nib, "load", lambda _: image)
    with pytest.raises(ValueError):
        MedicalInferenceService().predict("untrusted.nii.gz")
    image.get_fdata.assert_not_called()


def test_demo_never_decompresses_unused_voxel_data(monkeypatch):
    image = Mock(shape=(24, 24, 24))
    image.get_data_dtype.return_value = np.dtype("float32")
    monkeypatch.setattr(nib, "load", lambda _: image)
    mask, heatmap = MedicalInferenceService().predict("synthetic.nii.gz")
    assert mask.shape == (24, 24, 24)
    assert np.isfinite(mask).all()
    assert mask is heatmap
    image.get_fdata.assert_not_called()


def test_small_real_compressed_header_keeps_demo_behavior(tmp_path):
    path = tmp_path / "small.nii.gz"
    nib.save(nib.Nifti1Image(np.zeros((24, 24, 24), dtype=np.uint8), np.eye(4)), path)
    mask, _ = MedicalInferenceService().predict(str(path))
    assert mask.shape == (24, 24, 24)
    assert mask.sum() > 0
