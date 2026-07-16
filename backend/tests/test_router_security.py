import pytest
from fastapi.testclient import TestClient
import numpy as np
import io
import os
from unittest.mock import patch, MagicMock
from main import app

client = TestClient(app)

@pytest.fixture
def mock_supabase():
    with patch("api.router.upload_file_to_supabase", return_value="http://mock-url/mesh.glb") as m:
        yield m

@pytest.fixture
def mock_inference():
    with patch("api.router.inference_service.predict") as m:
        m.return_value = (np.ones((10, 10, 10)), np.ones((10, 10, 10)))
        yield m

@pytest.fixture
def mock_mesh_processor():
    with patch("api.router.create_mesh_from_mask", return_value="/tmp/mock.glb") as m:
        yield m

def test_cors_rejects_arbitrary_origin():
    response = client.options(
        "/api/v1/process-mri",
        headers={
            "Origin": "http://evil-domain.com",
            "Access-Control-Request-Method": "POST",
        }
    )
    # The actual framework behavior: if origin isn't allowed, the preflight response won't include Access-Control-Allow-Origin
    assert "access-control-allow-origin" not in response.headers

def test_cors_allows_localhost():
    response = client.options(
        "/api/v1/process-mri",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        }
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

def create_npy_file(data, allow_pickle=False):
    buf = io.BytesIO()
    np.save(buf, data, allow_pickle=allow_pickle)
    buf.seek(0)
    return buf.read()

def test_upload_valid_npy(mock_supabase, mock_mesh_processor):
    valid_data = np.zeros((10, 10, 10), dtype=np.float32)
    file_bytes = create_npy_file(valid_data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        data={"modality": "Brain"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_reject_object_dtype():
    # object array contains arbitrary python objects (Pickle vulnerability)
    obj_data = np.array([{"evil": "code"}], dtype=object)
    file_bytes = create_npy_file(obj_data, allow_pickle=True)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
    )
    assert response.status_code == 400
    # ensure no internal path leakage
    assert "Invalid .npy file" in response.text
    assert "/" not in response.json()["detail"] and "\\" not in response.json()["detail"]

def test_reject_non_3d_array(mock_supabase):
    data = np.zeros((10, 10), dtype=np.float32)
    file_bytes = create_npy_file(data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "3-dimensional" in response.text
    mock_supabase.assert_not_called()

def test_reject_nan_infinity():
    data = np.zeros((10, 10, 10), dtype=np.float32)
    data[0, 0, 0] = np.nan
    file_bytes = create_npy_file(data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "NaN or Infinity" in response.text

def test_reject_empty_file():
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", b"", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Empty file" in response.text

def test_reject_invalid_extension():
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 400
    assert "Only .nii.gz or .npy" in response.text

@patch.dict(os.environ, {"MAX_UPLOAD_SIZE": "1024"})
def test_reject_large_file():
    valid_data = np.zeros((20, 20, 20), dtype=np.float32) # size will be > 1KB
    file_bytes = create_npy_file(valid_data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
    )
    assert response.status_code == 413
    assert "File too large" in response.text

def test_temp_file_cleanup_on_error(mock_inference, mock_mesh_processor, mock_supabase):
    mock_mesh_processor.side_effect = Exception("Mesh generation failed internally")
    
    with patch("os.remove") as mock_remove:
        response = client.post(
            "/api/v1/process-mri",
            files={"file": ("test.nii.gz", b"fake-nifti-data", "application/octet-stream")},
        )
        assert response.status_code == 500
        assert "Internal server error" in response.text
        assert "Mesh generation failed internally" not in response.text
        mock_remove.assert_called()

def test_triage_webhook_failure_handling():
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Supabase Error: password incorrect"
        mock_post.return_value = mock_response
        
        response = client.post(
            "/api/v1/triage/send",
            json={"patient_id": "123", "modality": "Brain", "volume": 100.0}
        )
        assert response.status_code == 400
        assert "password incorrect" not in response.text # Don't leak external server error details
