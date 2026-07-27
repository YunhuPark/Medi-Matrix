import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from services.supabase_client import upload_user_vitals, get_supabase_client

@pytest.fixture
def mock_env():
    with patch("os.environ.get") as mock_get:
        mock_get.side_effect = lambda k, d="": "dummy_url" if k == "SUPABASE_URL" else "dummy_key" if k == "SUPABASE_SECRET_KEY" else "medical-vitals" if k == "SUPABASE_VITALS_BUCKET" else d
        yield mock_get

@patch("services.supabase_client.create_client")
def test_upload_user_vitals_success(mock_create_client, mock_env):
    mock_supabase = MagicMock()
    mock_create_client.return_value = mock_supabase

    mock_storage = MagicMock()
    mock_supabase.storage.from_.return_value = mock_storage
    mock_storage.upload.return_value = {"signedURL": "mock"} # Doesn't matter as long as it's not raising and not returning error dict

    # Valid UUID
    valid_uuid = "12345678-1234-5678-1234-567812345678"

    # Should not raise any exception
    upload_user_vitals(valid_uuid, b"test,csv,data")

    # Verify the call
    mock_storage.upload.assert_called_once_with(
        path=f"{valid_uuid}/latest.csv",
        file=b"test,csv,data",
        file_options={
            "cache-control": "0",
            "upsert": "true",
            "content-type": "text/csv"
        }
    )

@patch("services.supabase_client.create_client")
def test_upload_user_vitals_error_dict(mock_create_client, mock_env):
    mock_supabase = MagicMock()
    mock_create_client.return_value = mock_supabase

    mock_storage = MagicMock()
    mock_supabase.storage.from_.return_value = mock_storage
    # Simulate older storage3 response
    mock_storage.upload.return_value = {"error": "Unauthorized", "statusCode": 403}

    valid_uuid = "12345678-1234-5678-1234-567812345678"

    with pytest.raises(HTTPException) as excinfo:
        upload_user_vitals(valid_uuid, b"test,csv,data")

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Storage upload failed."

@patch("services.supabase_client.create_client")
def test_upload_user_vitals_exception(mock_create_client, mock_env):
    mock_supabase = MagicMock()
    mock_create_client.return_value = mock_supabase

    mock_storage = MagicMock()
    mock_supabase.storage.from_.return_value = mock_storage
    # Simulate newer storage3 raising exception
    mock_storage.upload.side_effect = Exception("Some SDK error")

    valid_uuid = "12345678-1234-5678-1234-567812345678"

    with pytest.raises(HTTPException) as excinfo:
        upload_user_vitals(valid_uuid, b"test,csv,data")

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Storage upload failed."

@patch("services.supabase_client.create_client")
def test_get_supabase_client_exception(mock_create_client, mock_env):
    # Simulate create_client raising SupabaseException
    mock_create_client.side_effect = Exception("SupabaseException: invalid url")

    with pytest.raises(HTTPException) as excinfo:
        get_supabase_client()

    assert excinfo.value.status_code == 502
    assert excinfo.value.detail == "Storage service unavailable."
