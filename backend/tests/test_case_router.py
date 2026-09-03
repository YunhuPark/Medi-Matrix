import pytest
from fastapi import HTTPException

from api.case_router import _validate_vitals_csv
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
