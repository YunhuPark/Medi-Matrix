import pytest
from fastapi.testclient import TestClient
import numpy as np
import io
import os
import httpx
from unittest.mock import patch, MagicMock
from main import app
import uuid
import time
from fastapi import WebSocketDisconnect

client = TestClient(app)

valid_uuid = str(uuid.uuid4())

@pytest.fixture(autouse=True)
def mock_env_vars():
    with patch.dict(os.environ, {
        "SUPABASE_URL": "http://mock-supabase",
        "SUPABASE_PUBLISHABLE_KEY": "mock_pub_key",
        "SUPABASE_SECRET_KEY": "mock_secret_key",
        "ALLOWED_ORIGINS": "http://localhost:5173",
        "SUPABASE_STORAGE_BUCKET": "medical-meshes"
    }):
        yield

@pytest.fixture
def mock_auth():
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": valid_uuid}
        mock_get.return_value = mock_resp
        yield mock_get

@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer mock_valid_token"}

@pytest.fixture
def mock_supabase():
    with patch("api.router.upload_file_to_supabase", return_value="http://mock-url/signed-url?token=abc") as m:
        yield m

@pytest.fixture
def mock_supabase_client():
    with patch("api.router.get_supabase_client") as m:
        mock_client = MagicMock()
        mock_client.storage.from_().create_signed_url.return_value = {"signedURL": "http://mock-url/signed-url?token=abc"}
        m.return_value = mock_client
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

# ================= AUTHENTICATION & SECURITY =================
def test_missing_auth_header():
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"})
    assert res.status_code == 401
    assert "not provided" in res.json()["detail"]

def test_invalid_bearer_format():
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"}, headers={"Authorization": "InvalidFormatToken"})
    assert res.status_code == 401

@patch("httpx.AsyncClient.get")
def test_auth_server_timeout(mock_get):
    mock_get.side_effect = httpx.TimeoutException("timeout")
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 503
    assert "timeout" in res.json()["detail"]

@patch("httpx.AsyncClient.get")
def test_auth_server_5xx(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_get.return_value = mock_resp
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 503

@patch("httpx.AsyncClient.get")
def test_auth_invalid_token(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_get.return_value = mock_resp
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 401
    assert "expired" in res.json()["detail"]

@patch("httpx.AsyncClient.get")
def test_auth_valid_but_no_uuid(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"id": "invalid_uuid"}
    mock_get.return_value = mock_resp
    res = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain"}, headers={"Authorization": "Bearer x"})
    assert res.status_code == 401

# ================= ROUTER TESTS =================
def create_npy_file(data, allow_pickle=False):
    buf = io.BytesIO()
    np.save(buf, data, allow_pickle=allow_pickle)
    buf.seek(0)
    return buf.read()

def test_cors_rejects_arbitrary_origin():
    response = client.options(
        "/api/v1/process-mri",
        headers={
            "Origin": "http://evil-domain.com",
            "Access-Control-Request-Method": "POST",
        }
    )
    assert "access-control-allow-origin" not in response.headers

def test_upload_valid_npy(mock_auth, mock_supabase, mock_mesh_processor, auth_headers):
    valid_data = np.zeros((10, 10, 10), dtype=np.float32)
    file_bytes = create_npy_file(valid_data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        data={"modality": "Brain"},
        headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_reject_object_dtype(mock_auth, auth_headers):
    obj_data = np.array([{"evil": "code"}], dtype=object)
    file_bytes = create_npy_file(obj_data, allow_pickle=True)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        headers=auth_headers
    )
    assert response.status_code == 400
    assert "Invalid NumPy medical data" in response.text
    assert "/" not in response.json()["detail"] and "\\" not in response.json()["detail"]

def test_reject_non_3d_array(mock_auth, mock_supabase, auth_headers):
    data = np.zeros((10, 10), dtype=np.float32)
    file_bytes = create_npy_file(data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        headers=auth_headers
    )
    assert response.status_code == 400
    assert "three-dimensional" in response.text
    mock_supabase.assert_not_called()

def test_reject_nan_infinity(mock_auth, auth_headers):
    data = np.zeros((10, 10, 10), dtype=np.float32)
    data[0, 0, 0] = np.nan
    file_bytes = create_npy_file(data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        headers=auth_headers
    )
    assert response.status_code == 400

def test_reject_empty_file(mock_auth, auth_headers):
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", b"", "application/octet-stream")},
        headers=auth_headers
    )
    assert response.status_code == 400

def test_reject_invalid_extension(mock_auth, auth_headers):
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.txt", b"hello world", "text/plain")},
        headers=auth_headers
    )
    assert response.status_code == 400

@patch.dict(os.environ, {"MAX_UPLOAD_SIZE": "1024"})
def test_reject_large_file(mock_auth, auth_headers):
    valid_data = np.zeros((20, 20, 20), dtype=np.float32) 
    file_bytes = create_npy_file(valid_data)
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("test.npy", file_bytes, "application/octet-stream")},
        headers=auth_headers
    )
    assert response.status_code == 413

def test_temp_file_cleanup_on_error(mock_auth, mock_inference, mock_mesh_processor, mock_supabase, auth_headers):
    mock_mesh_processor.side_effect = Exception("Mesh generation failed internally")
    with patch("os.remove") as mock_remove:
        response = client.post(
            "/api/v1/process-mri",
            files={"file": ("test.nii.gz", b"fake-nifti-data", "application/octet-stream")},
            headers=auth_headers
        )
        assert response.status_code == 500
        mock_remove.assert_called()

def test_triage_webhook_failure_handling(mock_auth, auth_headers):
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_post.return_value = mock_response
        response = client.post("/api/v1/triage/send", json={"patient_id": "123", "modality": "Brain", "volume": 100.0}, headers=auth_headers)
        assert response.status_code == 502

def test_reject_empty_filename(mock_auth, auth_headers):
    response = client.post(
        "/api/v1/process-mri",
        files={"file": ("", b"fake-data", "application/octet-stream")},
        data={"modality": "Brain"},
        headers=auth_headers
    )
    assert response.status_code in [400, 422]

@patch.dict(os.environ, {"MAX_VITALS_UPLOAD_SIZE": "1024"})
def test_vitals_reject_large_file(mock_auth, auth_headers):
    large_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n" + (b"80,120,80,16,36.5,98\n" * 100)
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", large_csv, "text/csv")},
        headers=auth_headers
    )
    assert response.status_code == 413

def test_vitals_reject_invalid_headers(mock_auth, auth_headers):
    bad_csv = b"wrong_header1,wrong_header2\n10,20"
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", bad_csv, "text/csv")},
        headers=auth_headers
    )
    assert response.status_code == 400

def test_vitals_reject_nan(mock_auth, auth_headers):
    bad_csv = b"hr,bpSys,bpDia,resp,temp,spo2\nNaN,120,80,16,36.5,98\n"
    response = client.post(
        "/api/v1/upload-vitals",
        files={"file": ("test.csv", bad_csv, "text/csv")},
        headers=auth_headers
    )
    assert response.status_code == 400

def test_nii_temp_file_suffix(mock_auth, mock_inference, mock_mesh_processor, mock_supabase, auth_headers):
    mock_inference.return_value = (np.ones((10, 10, 10)), np.ones((10, 10, 10)))
    with patch("api.router.tempfile.NamedTemporaryFile") as mock_temp:
        mock_temp_instance = MagicMock()
        mock_temp_instance.name = "/tmp/mock.nii.gz"
        mock_temp.return_value.__enter__.return_value = mock_temp_instance
        client.post(
            "/api/v1/process-mri",
            files={"file": ("test.nii", b"fake", "application/octet-stream")},
            data={"modality": "Brain"},
            headers=auth_headers
        )
        mock_temp.assert_called_with(suffix=".nii", delete=False)

def test_triage_connection_failure(mock_auth, auth_headers):
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.side_effect = httpx.ConnectError("Connection refused")
        response = client.post(
            "/api/v1/triage/send",
            json={"patient_id": "123", "modality": "Brain", "volume": 100.0},
            headers=auth_headers
        )
        assert response.status_code == 503

def test_vitals_atomic_replace_and_cleanup(mock_auth, auth_headers):
    valid_csv = b"hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98\n"
    with patch("os.replace") as mock_replace:
        response = client.post(
            "/api/v1/upload-vitals",
            files={"file": ("test.csv", valid_csv, "text/csv")},
            headers=auth_headers
        )
        assert response.status_code == 200
        mock_replace.assert_called_once()
        args = mock_replace.call_args[0]
        assert "vitals.csv" in args[1]
        assert valid_uuid in args[1] # check if user id path isolated

def test_signed_url_success(mock_auth, mock_supabase_client, auth_headers):
    mid = str(uuid.uuid4())
    res = client.get(f"/api/v1/meshes/{mid}/signed-url", headers=auth_headers)
    assert res.status_code == 200
    assert "signed_url" in res.json()
    assert "no-store" in res.headers["Cache-Control"]

def test_signed_url_invalid_mesh_id(mock_auth, auth_headers):
    res = client.get(f"/api/v1/meshes/bad_id/signed-url", headers=auth_headers)
    assert res.status_code == 422

# ================= RATE LIMITING =================
def test_rate_limit_exceeded(mock_auth, auth_headers):
    # Process MRI limit is 5 per 600s
    from core.rate_limit import process_mri_limiter
    process_mri_limiter.history.clear()
    
    file_bytes = create_npy_file(np.zeros((2,2,2), dtype=np.float32))
    
    with patch("api.router.upload_file_to_supabase", return_value="http://url"):
        with patch("api.router.create_mesh_from_mask", return_value="/tmp/test"):
            for _ in range(5):
                res = client.post("/api/v1/process-mri", files={"file": ("test.npy", file_bytes, "application/octet-stream")}, headers=auth_headers)
                assert res.status_code == 200
            
            # 6th should fail
            res = client.post("/api/v1/process-mri", files={"file": ("test.npy", file_bytes, "application/octet-stream")}, headers=auth_headers)
            assert res.status_code == 429
            assert "Retry-After" in res.headers

def test_rate_limit_cleanup():
    from core.rate_limit import RateLimiter
    limiter = RateLimiter(5, 1) # 1 sec window
    limiter.max_entries = 2
    limiter.is_allowed("key1")
    limiter.is_allowed("key2")
    limiter.is_allowed("key3") # Triggers cleanup
    assert "key1" in limiter.history
    time.sleep(1.1)
    limiter.is_allowed("key4") # Triggers cleanup, should delete old keys
    assert "key1" not in limiter.history

# ================= WEBSOCKET =================
@pytest.fixture(autouse=True)
def reset_rate_limiters():
    from core.rate_limit import process_mri_limiter, upload_vitals_limiter, triage_send_limiter, signed_url_limiter, websocket_limiter
    process_mri_limiter.history.clear()
    upload_vitals_limiter.history.clear()
    triage_send_limiter.history.clear()
    signed_url_limiter.history.clear()
    websocket_limiter.history.clear()
    yield

@patch("httpx.AsyncClient.get")
def test_ws_valid_auth(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"id": valid_uuid}
    mock_get.return_value = mock_resp
    
    with patch("api.router.os.path.exists", return_value=True):
        with patch.dict(os.environ, {"ALLOWED_ORIGINS": "", "SUPABASE_URL": "http://mock", "SUPABASE_PUBLISHABLE_KEY": "mock"}):
            with patch("builtins.open", return_value=io.StringIO("hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98")):
                with patch("api.mamba_inference.MambaSystemicPredictor") as mock_mamba:
                    mock_mamba.return_value.predict.return_value = {"sepsis": 0.1, "ards": 0.1, "shock": 0.1}
                    with client.websocket_connect("/api/v1/triage/stream") as websocket:
                        websocket.send_json({"type": "auth", "access_token": "valid", "patient_id": "123", "volume": 100})
                        data = websocket.receive_json()
                        assert data["status"] == "streaming"

def test_ws_no_auth_close():
    with client.websocket_connect("/api/v1/triage/stream") as websocket:
        websocket.send_text('{"patient_id": "123", "volume": 100}')
        with pytest.raises(WebSocketDisconnect) as e:
            websocket.receive_text()
        assert e.value.code == 4401

def test_ws_invalid_auth_close():
    with client.websocket_connect("/api/v1/triage/stream") as websocket:
        websocket.send_json({"type": "auth", "access_token": "bad_token"})
        with pytest.raises(WebSocketDisconnect) as e:
            websocket.receive_text()
        assert e.value.code == 4401

def test_ws_bad_origin():
    # origin not matching ALLOWED_ORIGINS
    with client.websocket_connect("/api/v1/triage/stream", headers={"Origin": "http://evil.com"}) as websocket:
        with pytest.raises(WebSocketDisconnect) as e:
            websocket.receive_text()
        assert e.value.code == 4401
