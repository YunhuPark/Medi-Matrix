"""Synthetic local-only receiver checks; no sockets or patient records."""
import importlib.util
from pathlib import Path
import runpy
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

MOCK_PATH = Path(__file__).resolve().parents[2] / "triage_mock_server" / "main.py"
spec = importlib.util.spec_from_file_location("triage_mock_security_target", MOCK_PATH)
mock_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mock_server)

PAYLOAD = {"patient_id": "synthetic-private-id-01", "lesion_volume": 12345.67, "modality": "synthetic-private-modality"}


def client_for(peer="127.0.0.1", base_url="http://localhost:8001"):
    return TestClient(mock_server.app, client=None if peer is None else (peer, 55000), base_url=base_url)


@pytest.mark.parametrize("peer", ["203.0.113.1", "192.168.0.12", "::ffff:203.0.113.1", "not-an-ip", None])
def test_remote_or_unknown_peer_rejected_before_inference(peer):
    with patch.object(mock_server, "simulate_mamba_inference") as inference:
        response = client_for(peer).post("/api/triage/webhook", json=PAYLOAD)
    assert response.status_code == 403
    inference.assert_not_called()


@pytest.mark.parametrize("peer", ["127.0.0.1", "::1"])
def test_local_backend_call_retains_deterministic_contract(peer):
    response = client_for(peer).post("/api/triage/webhook", json=PAYLOAD)
    assert response.status_code == 200
    expected = mock_server.simulate_mamba_inference(PAYLOAD["patient_id"])
    assert response.json() == {
        "status": "success",
        "triage_level": mock_server.determine_multimodal_triage(PAYLOAD["lesion_volume"], expected)[0],
        "sepsis_probability": f"{expected}%",
        "message": "Multi-modal Webhook processed successfully.",
    }


def test_dns_rebinding_host_is_rejected():
    response = client_for(base_url="http://attacker.invalid:8001").post("/api/triage/webhook", json=PAYLOAD)
    assert response.status_code == 400


@pytest.mark.parametrize("header", ["Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto"])
def test_forwarded_ingress_is_rejected(header):
    response = client_for().post("/api/triage/webhook", json=PAYLOAD, headers={header: "127.0.0.1"})
    assert response.status_code == 403


@pytest.mark.parametrize("origin", ["https://attacker.invalid", "null", "http://localhost:5173"])
def test_cross_origin_browser_request_is_rejected(origin):
    response = client_for().post("/api/triage/webhook", json=PAYLOAD, headers={"Origin": origin})
    assert response.status_code == 403


def test_same_origin_documentation_request_is_supported():
    response = client_for().post("/api/triage/webhook", json=PAYLOAD, headers={"Origin": "http://localhost:8001"})
    assert response.status_code == 200


def test_request_fields_not_written_to_console(capsys):
    response = client_for().post("/api/triage/webhook", json=PAYLOAD)
    assert response.status_code == 200
    output = capsys.readouterr()
    assert PAYLOAD["patient_id"] not in output.out + output.err
    assert PAYLOAD["modality"] not in output.out + output.err
    assert "12,345.67" not in output.out + output.err


def test_launcher_is_loopback_only_without_reload_or_proxy_trust(monkeypatch):
    monkeypatch.setenv("UVICORN_HOST", "0.0.0.0")
    with patch("uvicorn.run") as run:
        runpy.run_path(str(MOCK_PATH), run_name="__main__")
    assert run.call_count == 1
    assert run.call_args.kwargs["host"] == "127.0.0.1"
    assert run.call_args.kwargs.get("reload", False) is False
    assert run.call_args.kwargs["proxy_headers"] is False
