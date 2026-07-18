import pytest
from fastapi.testclient import TestClient
import numpy as np
import io
import os
import httpx
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
    assert "Invalid NumPy medical data" in response.text
    assert "/" not in response.json()["detail"] and "\\" not in response.json()["detail"]

def test_reject_non_3d_array(mock_supabase):
    data = np.zeros((10, 10), dtype=np.float32)
    file_bytes = create_npy_file(data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "three-dimensional" in response.text
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
    assert "non-finite values" in response.text

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
        assert response.status_code == 502
        assert "password incorrect" not in response.text # Don't leak external server error details

def test_reject_empty_filename():
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("", b"fake-data", "application/octet-stream")},
        data={"modality": "Brain"}
    )
    assert response.status_code in [400, 422]

@patch.dict(os.environ, {"MAX_VITALS_UPLOAD_SIZE": "1024"})
def test_vitals_reject_large_file():
    large_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n" + (b"80,120,80,16,36.5,98\n" * 100)
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", large_csv, "text/csv")},
    )
    assert response.status_code == 413
    assert "File too large" in response.text

def test_vitals_reject_invalid_headers():
    bad_csv = b"wrong_header1,wrong_header2\n10,20"
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", bad_csv, "text/csv")},
    )
    assert response.status_code == 400
    assert "Missing required CSV headers" in response.text

def test_vitals_reject_nan():
    bad_csv = b"hr,bpSys,bpDia,resp,temp,spo2\nNaN,120,80,16,36.5,98\n"
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", bad_csv, "text/csv")},
    )
    assert response.status_code == 400
    assert "Invalid numeric data" in response.text

def test_nii_temp_file_suffix(mock_inference, mock_mesh_processor, mock_supabase):
    mock_inference.return_value = (np.ones((10, 10, 10)), np.ones((10, 10, 10)))
    with patch("tempfile.NamedTemporaryFile") as mock_temp:
        mock_temp_instance = MagicMock()
        mock_temp_instance.name = "/tmp/mock.nii.gz"
        mock_temp.return_value.__enter__.return_value = mock_temp_instance

        client.post(
            "/api/v1/process-mri",
            files={"file": ("test.nii", b"fake", "application/octet-stream")},
            data={"modality": "Brain"}
        )
        # Should use .nii suffix since input was .nii
        mock_temp.assert_called_with(suffix=".nii", delete=False)

def test_triage_connection_failure():
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.side_effect = httpx.ConnectError("Connection refused")
        
        response = client.post(
            "/api/v1/triage/send",
            json={"patient_id": "123", "modality": "Brain", "volume": 100.0}
        )
        assert response.status_code == 503
        assert "Triage service is currently unavailable" in response.text
        assert "Connection refused" not in response.text

@patch.dict(os.environ, {"MAX_VITALS_ROWS": "invalid", "MAX_VITALS_UPLOAD_SIZE": "-100"})
def test_invalid_env_vars_fallback():
    # If MAX_VITALS_ROWS is 'invalid' and size is '-100', they should fallback to 1000 and 5242880
    valid_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98\n"
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", valid_csv, "text/csv")},
    )
    assert response.status_code == 200

def test_vitals_reject_too_many_rows():
    # Max rows is 1000 by default
    large_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n" + (b"80,120,80,16,36.5,98\n" * 1001)
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", large_csv, "text/csv")},
    )
    assert response.status_code == 400
    assert "too many rows" in response.text

def test_vitals_atomic_replace_and_cleanup():
    valid_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98\n"
    with patch("os.replace") as mock_replace:
        response = client.post(
            "/api/v1/upload-vitals",
            files={"file": ("test.csv", valid_csv, "text/csv")},
        )
        assert response.status_code == 200
        mock_replace.assert_called_once()
        args = mock_replace.call_args[0]
        # temp_name, target_path
        assert "real_vitals.csv" in args[1]
        assert "filename" not in response.json()  # Filename should not be returned

def test_vitals_save_failure_cleanup():
    valid_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98\n"
    with patch("os.replace", side_effect=Exception("Disk full")):
        with patch("os.remove") as mock_remove:
            response = client.post(
                "/api/v1/upload-vitals",
                files={"file": ("test.csv", valid_csv, "text/csv")},
            )
            assert response.status_code == 500
            assert "Failed to save vitals data" in response.text
            assert "Disk full" not in response.text
            mock_remove.assert_called_once()

@pytest.mark.asyncio
async def test_websocket_model_unavailable():
    # Attempt to connect to websocket with bad model
    with patch("api.router.os.path.exists", return_value=True):
        with patch("api.router.open", return_value=io.StringIO("hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98")):
            with patch("api.mamba_inference.MambaSystemicPredictor", side_effect=Exception("Model weights missing")):
                with client.websocket_connect("/api/v1/triage/stream") as websocket:
                    websocket.send_text('{"patient_id": "123", "volume": 100}')
                    data = websocket.receive_json()
                    assert data["status"] == "error"
                    assert data["code"] == "MODEL_UNAVAILABLE"
                    assert "Model weights missing" not in data["message"]
