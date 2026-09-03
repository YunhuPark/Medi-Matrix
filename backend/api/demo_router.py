"""Server-side bootstrap for the competition transfer demo.

This endpoint removes manual file selection from the judge path. It loads only
repository-bundled synthetic inputs, creates a non-PHI Case ID, attaches the
Vitals sequence to that Case, and runs the existing image pipeline. It is an
MVP/test adapter; a real deployment would replace this bootstrap with PACS/EMR
and bedside-monitor integrations for a hospital encounter.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from api.case_router import _validate_vitals_csv, process_case_mri
from core.auth import CurrentUser, get_current_user
from core.case_context import new_case_id
from core.rate_limit import check_rate_limit, upload_vitals_limiter
from services.case_storage import upload_case_vitals


demo_router = APIRouter()
_DATASET_DIR = Path(__file__).resolve().parents[1] / "demo_datasets"
_DEMO_MRI = _DATASET_DIR / "brain_tumor_demo.nii.gz"
_DEMO_VITALS = _DATASET_DIR / "synthetic_vitals_progressive.csv"


def _read_demo_asset(path: Path) -> bytes:
    try:
        data = path.read_bytes()
    except OSError:
        raise HTTPException(status_code=503, detail="Demo asset is unavailable.")
    if not data:
        raise HTTPException(status_code=503, detail="Demo asset is empty.")
    return data


@demo_router.post("/demo/transfer-case")
async def create_transfer_demo_case(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Prepare the bundled synthetic ED-to-higher-level-hospital demo case."""
    if os.environ.get("INFERENCE_MODE", "demo") != "demo":
        raise HTTPException(
            status_code=409,
            detail="Bundled one-click demo is available only in INFERENCE_MODE=demo.",
        )

    case_id = new_case_id()

    # Keep the same upload policy budget as a manual Vitals attachment.
    check_rate_limit(request, upload_vitals_limiter, current_user.user_id)
    vitals_bytes = _validate_vitals_csv(_read_demo_asset(_DEMO_VITALS))
    upload_case_vitals(current_user.user_id, case_id, vitals_bytes)

    mri_bytes = _read_demo_asset(_DEMO_MRI)
    upload = UploadFile(filename=_DEMO_MRI.name, file=io.BytesIO(mri_bytes))
    image_response = await process_case_mri(
        case_id=case_id,
        request=request,
        background_tasks=background_tasks,
        file=upload,
        modality="Brain",
        current_user=current_user,
    )

    if not isinstance(image_response, JSONResponse):
        raise HTTPException(status_code=500, detail="Unexpected demo image response.")

    try:
        image_payload = json.loads(image_response.body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid demo image response.")

    return JSONResponse(
        content={
            "status": "success",
            "case_id": case_id,
            "scenario": "ed_interhospital_transfer_support",
            "scenario_label": "지역 응급실 → 상급병원 전원 지원",
            "data_mode": "synthetic_bundled_demo",
            "clinical_identifier": False,
            "vitals_attached": True,
            "image": image_payload,
            "integration_target": {
                "imaging": "PACS/DICOM adapter",
                "vitals": "EMR/FHIR or bedside-monitor adapter",
                "encounter": "hospital encounter mapped to internal Case ID",
            },
        },
        headers={"Cache-Control": "no-store"},
    )
