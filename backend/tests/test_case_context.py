import pytest
from fastapi import HTTPException

from core.case_context import case_storage_prefix, new_case_id, validate_case_id


def test_new_case_id_uses_non_phi_format():
    case_id = new_case_id()
    assert case_id.startswith("MM-")
    assert len(case_id) == 11
    assert validate_case_id(case_id) == case_id


def test_validate_case_id_normalizes_case():
    assert validate_case_id("mm-a1b2c3d4") == "MM-A1B2C3D4"


@pytest.mark.parametrize(
    "value",
    [
        "",
        "patient-1234",
        "MM-123",
        "MM-123456789",
        "MM-1234_678",
        "홍길동",
    ],
)
def test_validate_case_id_rejects_invalid_or_identifying_shapes(value):
    with pytest.raises(HTTPException) as exc_info:
        validate_case_id(value)
    assert exc_info.value.status_code == 422


def test_case_storage_prefix_scopes_case_under_user():
    assert (
        case_storage_prefix("user-uuid", "MM-A1B2C3D4")
        == "user-uuid/MM-A1B2C3D4"
    )
