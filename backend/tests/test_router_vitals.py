import pytest
from fastapi.testclient import TestClient
from main import app
from unittest.mock import patch, MagicMock
from services.supabase_client import upload_user_vitals, download_user_vitals
from fastapi import HTTPException
import uuid

client = TestClient(app)

from core.auth import get_current_user

@patch('services.supabase_client.get_supabase_client')
def test_upload_vitals_to_supabase(mock_get_client):
    valid_uuid = str(uuid.uuid4())
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    class MockUser:
        user_id = valid_uuid
    
    app.dependency_overrides[get_current_user] = lambda: MockUser()

    try:
        csv_content = "hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98"
        files = {'file': ('test.csv', csv_content, 'text/csv')}
        
        response = client.post("/api/v1/upload-vitals", files=files)
        
        assert response.status_code == 200
        assert response.json()["message"] == "Vitals CSV uploaded successfully"
        mock_client.storage.from_().upload.assert_called_once()
        args, kwargs = mock_client.storage.from_().upload.call_args
        assert kwargs["path"] == f"{valid_uuid}/latest.csv"
    finally:
        app.dependency_overrides.clear()

@patch('services.supabase_client.get_supabase_client')
def test_upload_vitals_different_users(mock_get_client):
    uuid1 = str(uuid.uuid4())
    uuid2 = str(uuid.uuid4())
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    upload_user_vitals(uuid1, b"test1")
    upload_user_vitals(uuid2, b"test2")

    calls = mock_client.storage.from_().upload.call_args_list
    assert len(calls) == 2
    assert calls[0].kwargs["path"] == f"{uuid1}/latest.csv"
    assert calls[1].kwargs["path"] == f"{uuid2}/latest.csv"

def test_upload_vitals_invalid_uuid():
    with pytest.raises(HTTPException) as exc:
        upload_user_vitals("test-uuid", b"data")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        upload_user_vitals("../test", b"data")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        upload_user_vitals("a/b/c", b"data")
    assert exc.value.status_code == 400

def test_download_vitals_invalid_uuid():
    with pytest.raises(HTTPException) as exc:
        download_user_vitals("test-uuid")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        download_user_vitals("../../../etc/passwd")
    assert exc.value.status_code == 400

def test_supabase_sdk_signatures():
    import inspect
    try:
        from storage3 import StorageClient
        # Assuming storage3 is the underlying storage library used by supabase-py
        bucket = StorageClient("url", {"Authorization": "Bearer key"}, False).from_("test")

        upload_sig = inspect.signature(bucket.upload)
        assert "path" in upload_sig.parameters
        assert "file" in upload_sig.parameters

        download_sig = inspect.signature(bucket.download)
        assert "path" in download_sig.parameters

        signed_url_sig = inspect.signature(bucket.create_signed_url)
        assert "path" in signed_url_sig.parameters
        assert "expires_in" in signed_url_sig.parameters
    except ImportError:
        pass # Skip if we can't import the internal storage library directly
