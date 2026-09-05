import pytest
from fastapi import HTTPException

from api.case_router import _build_triage_payload, _validate_vitals_csv
from services.case_storage import case_vitals_path


def test_case_vitals_path_scopes_user_and_case():
    user_id = "123e4567-e89b-12d3-a456-426614174000"
    assert (
        case_vitals_path(user_id, "MM-A1B2C3D4")
        == "123e4567-e89b-12d3-a456-426614174000/MM-A1B2C3D4/vitals.csv"
    )


def test_validate_vitals_csv_accepts_required_headers():
    raw = (
        "hr,bpSys,bpDia,resp,temp,spo2\n"
        "88,118,76,18,36.8,98\n"
    ).encode("utf-8")
    normalized = _validate_vitals_csv(raw).decode("utf-8")
    assert "88" in normalized
    assert "spo2" in normalized


def test_validate_vitals_csv_rejects_missing_header():
    raw = (
        "hr,bpSys,bpDia,resp,temp\n"
        "88,118,76,18,36.8\n"
    ).encode("utf-8")
    with pytest.raises(HTTPException) as exc_info:
        _validate_vitals_csv(raw)
    assert exc_info.value.status_code == 400


def test_validate_vitals_csv_rejects_non_finite_values():
    raw = (
        "hr,bpSys,bpDia,resp,temp,spo2\n"
        "88,118,76,18,36.8,nan\n"
    ).encode("utf-8")
    with pytest.raises(HTTPException) as exc_info:
        _validate_vitals_csv(raw)
    assert exc_info.value.status_code == 400


class _Predictor:
    def __init__(
        self,
        sepsis: float,
        ards: float,
        shock: float,
        *,
        inference_mode: str = "demo",
        model_id: str = "deterministic_vitals_demo_v1",
        model_threshold=None,
    ):
        self.mode = inference_mode
        self.model_id = model_id
        self.threshold = model_threshold
        self._scores = {
            "sepsis": sepsis,
            "ards": ards,
            "shock": shock,
            "inference_mode": inference_mode,
            "model_id": model_id,
            "model_threshold": model_threshold,
            "clinical_use": False,
        }

    def predict(self, _rows):
        return self._scores


def _row():
    return {
        "hr": "118",
        "bpSys": "88",
        "bpDia": "58",
        "resp": "28",
        "temp": "38.4",
        "spo2": "91",
    }


def test_build_triage_payload_exposes_demo_policy_breakdown():
    payload = _build_triage_payload(
        _row(),
        volume=16000,
        predictor=_Predictor(sepsis=0.70, ards=0.45, shock=0.40),
    )

    assert payload["decision"]["policy"] == "transfer_demo_policy_v1"
    assert payload["decision"]["clinical_rule"] is False
    assert payload["decision"]["vitals_risk"] == 0.70
    assert payload["decision"]["vision_context"] == 0.08
    assert payload["decision"]["triage_score"] == 0.78
    assert payload["triage_level"].startswith("RED")
    assert payload["triggering_condition"].startswith("패혈증 유사")
    assert payload["ai_risk"] == {
        "risk_probability": 0.7,
        "model_id": "deterministic_vitals_demo_v1",
        "threshold": None,
        "source": "Medi-Matrix deterministic Vitals demo scorer",
        "inference_mode": "demo",
        "target": "synthetic sepsis-like pattern score",
        "clinical_use": False,
    }


def test_build_triage_payload_exposes_reviewed_model_provenance():
    payload = _build_triage_payload(
        _row(),
        volume=0,
        predictor=_Predictor(
            sepsis=0.64,
            ards=0.0,
            shock=0.0,
            inference_mode="model",
            model_id="vitals_gru_challenge2019_v1",
            model_threshold=0.5996291004197073,
        ),
    )

    ai_risk = payload["ai_risk"]
    assert ai_risk["risk_probability"] == 0.64
    assert ai_risk["model_id"] == "vitals_gru_challenge2019_v1"
    assert ai_risk["threshold"] == 0.599629
    assert ai_risk["source"] == "PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0"
    assert ai_risk["inference_mode"] == "model"
    assert ai_risk["target"] == "official SepsisLabel early-warning target"
    assert ai_risk["clinical_use"] is False


def test_build_triage_payload_yellow_is_not_presented_as_diagnosis():
    payload = _build_triage_payload(
        _row(),
        volume=0,
        predictor=_Predictor(sepsis=0.30, ards=0.20, shock=0.10),
    )

    assert payload["triage_level"].startswith("YELLOW")
    assert payload["triggering_condition"] is None
    assert payload["decision"]["clinical_rule"] is False
    assert payload["ai_risk"]["clinical_use"] is False
