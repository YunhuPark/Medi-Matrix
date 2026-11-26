"""Synthetic route requests with mocked outbound I/O; no external data is sent."""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

with patch.dict(sys.modules, {"services.inference_service": MagicMock()}):
    from api.router import router
    from core.auth import CurrentUser, get_current_user
    from core.rate_limit import triage_send_limiter

LOCAL_URL = "http://127.0.0.1:8001/api/triage/webhook"
PAYLOAD = {"patient_id": "synthetic-only-id", "modality": "synthetic-scan", "volume": 100.0}
RESULT = {"status": "success", "triage_level": "GREEN", "sepsis_probability": "75.0%"}


@pytest.fixture
def api(monkeypatch):
    monkeypatch.delenv("TRIAGE_API_URL", raising=False)
    triage_send_limiter.history.clear()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="00000000-0000-4000-8000-000000000001")
    with patch.object(httpx, "AsyncClient") as constructor:
        outgoing = AsyncMock()
        outgoing.post.return_value = httpx.Response(200, json=RESULT)
        constructor.return_value.__aenter__.return_value = outgoing
        yield TestClient(app), constructor, outgoing, app
    triage_send_limiter.history.clear()


@pytest.mark.parametrize("configured", [
    "http://unreviewed.invalid/api/triage/webhook",
    "https://unreviewed.invalid/api/triage/webhook",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/api/triage/webhook",
    "http://localhost.attacker.invalid:8001/api/triage/webhook",
    "http://localhost@unreviewed.invalid:8001/api/triage/webhook",
    "http://synthetic:credential@127.0.0.1:8001/api/triage/webhook",
    "http://127.0.0.1:9000/api/triage/webhook",
    "http://127.0.0.1:8001/other",
    "http://127.0.0.1:8001/api/triage/webhook?token=synthetic",
    "http://127.0.0.1:8001/api/triage/webhook#fragment",
    "http://127.1:8001/api/triage/webhook",
    "http://2130706433:8001/api/triage/webhook",
    "http://%31%32%37.0.0.1:8001/api/triage/webhook",
    "http://127.0.0.1:8001\\@unreviewed.invalid/api/triage/webhook",
    "file:///tmp/triage",
    "\nhttp://127.0.0.1:8001/api/triage/webhook",
])
def test_unreviewed_destination_rejected_before_network(api, monkeypatch, configured):
    client, constructor, outgoing, _ = api
    monkeypatch.setenv("TRIAGE_API_URL", configured)
    response = client.post("/api/v1/triage/send", json=PAYLOAD)
    assert response.status_code == 503
    assert response.json() == {"detail": "Triage destination is not an approved local simulator."}
    constructor.assert_not_called()
    outgoing.post.assert_not_called()


@pytest.mark.parametrize("configured", [None, "", LOCAL_URL, "http://localhost:8001/api/triage/webhook"])
def test_local_destination_preserves_payload_and_disables_environment_proxy(api, monkeypatch, configured):
    client, constructor, outgoing, _ = api
    if configured is not None:
        monkeypatch.setenv("TRIAGE_API_URL", configured)
    monkeypatch.setenv("HTTP_PROXY", "http://unreviewed.invalid:8080")
    monkeypatch.setenv("ALL_PROXY", "http://unreviewed.invalid:8080")
    response = client.post("/api/v1/triage/send", json=PAYLOAD)
    assert response.status_code == 200
    assert response.json() == RESULT
    constructor.assert_called_once_with(trust_env=False, follow_redirects=False)
    outgoing.post.assert_awaited_once_with(LOCAL_URL, json={"patient_id": PAYLOAD["patient_id"], "lesion_volume": 100.0, "modality": PAYLOAD["modality"]}, timeout=5.0)


@pytest.mark.parametrize("status", [301, 302, 307, 308, 400, 500])
def test_redirect_or_error_not_treated_as_success(api, status):
    client, _, outgoing, _ = api
    outgoing.post.return_value = httpx.Response(status, json=RESULT, headers={"Location": "http://unreviewed.invalid/collect"})
    response = client.post("/api/v1/triage/send", json=PAYLOAD)
    assert response.status_code == 502
    assert outgoing.post.await_count == 1


def test_authentication_is_still_required(api):
    client, constructor, _, app = api
    app.dependency_overrides.clear()
    response = client.post("/api/v1/triage/send", json=PAYLOAD)
    assert response.status_code == 401
    constructor.assert_not_called()
