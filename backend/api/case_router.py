"""Case/encounter API for the competition hardening branch.

This API introduces an explicit non-PHI Case ID before the existing image and
Vitals routes are migrated. It gives the frontend one stable identifier for a
single demo encounter and provides case-scoped Vitals storage.
"""

from __future__ import annotations

import csv
import io
import math

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from core.auth import CurrentUser, get_current_user
from core.case_context import new_case_id, validate_case_id
from core.rate_limit import check_rate_limit, upload_vitals_limiter
from services.case_storage import upload_case_vitals

case_router = APIRouter()

_REQUIRED_VITAL_HEADERS = {"hr", "bpSys", "bpDia", "resp", "temp", "spo2"}
_MAX_VITALS_UPLOAD_SIZE = 5 * 1024 * 1024
_MAX_VITALS_ROWS = 1000


class CaseResponse(BaseModel):
    case_id: str
    identifier_type: str = "non_phi_demo_case"
    clinical_identifier: bool = False


@case_router.post("/cases", response_model=CaseResponse)
async def create_case(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create an opaque case identifier for one authenticated demo session."""
    _ = current_user
    return CaseResponse(case_id=new_case_id())


async def _read_limited_csv(file: UploadFile) -> bytes:
    filename = (file.filename or "").strip()
    if not filename or not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")

    contents = await file.read(_MAX_VITALS_UPLOAD_SIZE + 1)
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file is not allowed.")
    if len(contents) > _MAX_VITALS_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")
    return contents


def _validate_vitals_csv(contents: bytes) -> bytes:
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV file must be UTF-8 encoded.")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or missing headers.")
    if not _REQUIRED_VITAL_HEADERS.issubset(set(reader.fieldnames)):
        raise HTTPException(status_code=400, detail="Missing required CSV headers.")

    rows: list[dict[str, str]] = []
    for index, row in enumerate(reader, start=1):
        if index > _MAX_VITALS_ROWS:
            raise HTTPException(status_code=400, detail="CSV contains too many rows.")
        for header in _REQUIRED_VITAL_HEADERS:
            raw = (row.get(header) or "").strip()
            if not raw:
                raise HTTPException(status_code=400, detail=f"Empty value found for {header}.")
            try:
                value = float(raw)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid numeric data for {header}.")
            if not math.isfinite(value):
                raise HTTPException(status_code=400, detail=f"Invalid numeric data for {header}.")
        rows.append(row)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV file has no data rows.")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


@case_router.post("/cases/{case_id}/vitals")
async def upload_case_vitals_csv(
    case_id: str,
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Attach one validated Vitals sequence to a specific demo Case ID."""
    check_rate_limit(request, upload_vitals_limiter, current_user.user_id)
    valid_case_id = validate_case_id(case_id)
    contents = await _read_limited_csv(file)
    normalized_csv = _validate_vitals_csv(contents)
    upload_case_vitals(current_user.user_id, valid_case_id, normalized_csv)
    return {
        "status": "success",
        "case_id": valid_case_id,
        "message": "Vitals attached to case successfully",
    }
