import os
import sys
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_live():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_health_ready_demo(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "inference_mode": "demo"}


def test_case_and_demo_routes_are_mounted():
    route_paths = {getattr(route, "path", None) for route in app.routes}
    assert "/api/v1/cases" in route_paths
    assert "/api/v1/cases/{case_id}/vitals" in route_paths
    assert "/api/v1/cases/{case_id}/process-mri" in route_paths
    assert "/api/v1/cases/{case_id}/triage/stream" in route_paths
    assert "/api/v1/demo/transfer-case" in route_paths


def test_health_ready_production_missing_vars(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost")
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    response = client.get("/health/ready")
    assert response.status_code == 503
    assert "Missing env var" in response.json()["detail"]


def test_health_ready_production_invalid_cors(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")

    response = client.get("/health/ready")
    assert response.status_code == 503
    assert "Invalid CORS config" in response.json()["detail"]


def test_health_ready_model_missing_dependencies(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "model")
    monkeypatch.setitem(sys.modules, "torch", None)

    response = client.get("/health/ready")
    assert response.status_code == 503
    detail = response.json().get("detail")
    assert isinstance(detail, str)
    assert "ML dependencies missing" in detail
    assert "model mode" in detail


@patch("os.path.exists")
def test_health_ready_model_missing_weights(mock_exists, monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "model")
    monkeypatch.setitem(sys.modules, "torch", MagicMock())
    mock_exists.return_value = False

    response = client.get("/health/ready")
    assert response.status_code == 503
    detail = response.json().get("detail")
    assert isinstance(detail, str)
    assert "Model weights missing" in detail
