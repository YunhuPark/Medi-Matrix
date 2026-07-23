import pytest
from fastapi.testclient import TestClient
from main import app
from unittest.mock import patch, MagicMock

client = TestClient(app)

from core.auth import get_current_user

@patch('services.supabase_client.upload_user_vitals')
def test_upload_vitals_to_supabase(mock_upload):
    class MockUser:
        user_id = "test-uuid"
    
    app.dependency_overrides[get_current_user] = lambda: MockUser()

    try:
        csv_content = "hr,bpSys,bpDia,resp,temp,spo2\n80,120,80,16,36.5,98"
        files = {'file': ('test.csv', csv_content, 'text/csv')}
        
        response = client.post("/api/v1/upload-vitals", files=files)
        
        assert response.status_code == 200
        assert response.json()["message"] == "Vitals CSV uploaded successfully"
        mock_upload.assert_called_once()
        args, _ = mock_upload.call_args
        assert args[0] == "test-uuid"
        assert b"80,120,80,16,36.5,98" in args[1]
    finally:
        app.dependency_overrides.clear()
