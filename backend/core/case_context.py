"""Case/encounter identifiers for Medi-Matrix demo workflows.

A Case ID links the image context and Vitals context inside the MVP without
pretending that a generated identifier is a real hospital patient identifier.
Real deployments should map this value to the hospital encounter identifier
through a PACS/EMR integration layer rather than exposing PHI in URLs or logs.
"""

from __future__ import annotations

import re
import secrets

from fastapi import HTTPException

_CASE_ID_RE = re.compile(r"^MM-[A-Z0-9]{8}$")


def new_case_id() -> str:
    """Return a non-PHI, opaque demo case identifier."""
    return f"MM-{secrets.token_hex(4).upper()}"


def validate_case_id(case_id: str) -> str:
    """Validate and normalize a public demo Case ID.

    Case IDs intentionally contain no patient name, MRN, date of birth, or
    other identifying information.
    """
    value = (case_id or "").strip().upper()
    if not _CASE_ID_RE.fullmatch(value):
        raise HTTPException(status_code=422, detail="Invalid case_id")
    return value


def case_storage_prefix(user_id: str, case_id: str) -> str:
    """Return the per-user/per-case storage prefix."""
    return f"{user_id}/{validate_case_id(case_id)}"
