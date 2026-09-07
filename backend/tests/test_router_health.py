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
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "inference_mode": "demo",
        "vitals_inference_mode": "demo",
        "vitals_model_id": "deterministic_vitals_demo_v1",
        "clinical_use": False,
    }


def test_health_ready_rejects_invalid_vitals_mode(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "invalid")

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["detail"] == "Invalid VITALS_INFERENCE_MODE"


def test_case_and_demo_routes_are_mounted():
    # Authentication may reject these requests, but a mounted route must never
    # fall through to FastAPI's 404 handler. This checks the actual app surface
    # rather than relying on route object internals that can vary by Starlette.
    case_response = client.post("/api/v1/cases")
    demo_response = client.post("/api/v1/demo/transfer-case")

    assert case_response.status_code != 404
    assert demo_response.status_code != 404


def test_health_ready_production_missing_vars(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost")
    monkeypatch.delenv("SUPABASE_URL", raising=False)

    response = client.get("/health/ready")
    assert response.status_code == 503
    assert "Missing env var" in response.json()["detail"]


def test_health_ready_production_invalid_cors(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "demo")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ALLOWED_ORIGINS", "*")

    response = client.get("/health/ready")
    assert response.status_code == 503
    assert "Invalid CORS config" in response.json()["detail"]


def test_health_ready_model_missing_dependencies(monkeypatch):
    monkeypatch.setenv("INFERENCE_MODE", "model")
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
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
    monkeypatch.setenv("VITALS_INFERENCE_MODE", "demo")
    monkeypatch.setitem(sys.modules, "torch", MagicMock())
    mock_exists.return_value = False

    response = client.get("/health/ready")
    assert response.status_code == 503
    detail = response.json().get("detail")
    assert isinstance(detail, str)
    assert "Model weights missing" in detail
