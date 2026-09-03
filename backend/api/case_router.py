"""Case/encounter API for the competition hardening branch.

The Case API models one non-PHI emergency-department encounter. The public MVP
still uses uploaded synthetic files, but the identifier is intentionally shaped
for a future PACS/EMR adapter where imaging and Vitals from the same hospital
encounter are attached automatically instead of being selected by a user.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import os
import time
import uuid
from itertools import cycle

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.router import process_medical_mri
from core.auth import CurrentUser, decode_verified_token_exp, get_current_user
from core.case_context import new_case_id, validate_case_id
from core.rate_limit import check_rate_limit, upload_vitals_limiter, websocket_limiter
from services.case_storage import download_case_vitals, upload_case_vitals

case_router = APIRouter()

_REQUIRED_VITAL_HEADERS = {"hr", "bpSys", "bpDia", "resp", "temp", "spo2"}
_MAX_VITALS_UPLOAD_SIZE = 5 * 1024 * 1024
_MAX_VITALS_ROWS = 1000
_YELLOW_THRESHOLD = 0.25
_RED_THRESHOLD = 0.75


class CaseResponse(BaseModel):
    case_id: str
    identifier_type: str = "non_phi_demo_case"
    clinical_identifier: bool = False


@case_router.post("/cases", response_model=CaseResponse)
async def create_case(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create an opaque Case ID for one authenticated demo encounter."""
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


@case_router.post("/cases/{case_id}/process-mri")
async def process_case_mri(
    case_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    modality: str = Form("Brain"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Run the existing image pipeline while binding the result to one Case ID.

    The legacy image pipeline and Signed-URL storage path stay compatible in this
    tranche. The Case ID replaces the generated mock patient identifier at the
    API boundary so the frontend can link image, Vitals, Triage and transfer
    search to one encounter without representing it as a real hospital MRN.
    """
    valid_case_id = validate_case_id(case_id)
    response = await process_medical_mri(
        request=request,
        background_tasks=background_tasks,
        file=file,
        modality=modality,
        current_user=current_user,
    )

    if not isinstance(response, JSONResponse):
        raise HTTPException(status_code=500, detail="Unexpected image pipeline response.")

    try:
        payload = json.loads(response.body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid image pipeline response.")

    payload["case_id"] = valid_case_id
    # Backward-compatible field used by the existing dashboard components.
    payload["patient_id"] = valid_case_id
    payload["identifier_type"] = "non_phi_demo_case"
    payload["clinical_identifier"] = False
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})


async def _authenticate_case_websocket(websocket: WebSocket) -> tuple[str, int, dict]:
    """Authenticate a case-scoped WebSocket using the existing Supabase session."""
    client_ip = websocket.client.host if websocket.client else "unknown"
    trust_proxy = os.environ.get("TRUST_PROXY_HEADERS", "").lower() == "true"
    if trust_proxy:
        forwarded = websocket.headers.get("x-forwarded-for")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

    if not websocket_limiter.is_allowed(f"ip:{client_ip}"):
        await websocket.close(code=4429)
        raise RuntimeError("rate_limited")

    app_env = os.environ.get("APP_ENV", "development")
    allowed_origins_str = os.environ.get("ALLOWED_ORIGINS", "").strip()
    origin = websocket.headers.get("origin")
    origin_normalized = origin.strip().rstrip("/") if origin else ""

    if app_env == "production" and not allowed_origins_str:
        await websocket.close(code=4401)
        raise RuntimeError("origin_rejected")

    if allowed_origins_str:
        allowed_list = [o.strip().rstrip("/") for o in allowed_origins_str.split(",") if o.strip()]
        if origin_normalized not in allowed_list:
            await websocket.close(code=4401)
            raise RuntimeError("origin_rejected")

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        if len(raw.encode("utf-8")) > 8192:
            raise ValueError("auth frame too large")
        payload = json.loads(raw)
    except Exception:
        await websocket.close(code=4401)
        raise RuntimeError("invalid_auth_frame")

    if payload.get("type") != "auth" or not payload.get("access_token"):
        await websocket.close(code=4401)
        raise RuntimeError("invalid_auth_frame")

    token = payload["access_token"]
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase_url or not publishable_key:
        await websocket.close(code=4401)
        raise RuntimeError("auth_not_configured")

    auth_url = f"{supabase_url}/auth/v1/user"
    headers = {"apikey": publishable_key, "Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(auth_url, headers=headers, timeout=3.0)
    except Exception:
        await websocket.close(code=4401)
        raise RuntimeError("auth_unavailable")

    if response.status_code != 200:
        await websocket.close(code=4401)
        raise RuntimeError("invalid_token")

    user_id = response.json().get("id")
    try:
        valid_uuid = str(uuid.UUID(user_id))
    except Exception:
        await websocket.close(code=4401)
        raise RuntimeError("invalid_user")

    if not websocket_limiter.is_allowed(f"user:{valid_uuid}"):
        await websocket.close(code=4429)
        raise RuntimeError("rate_limited")

    exp = decode_verified_token_exp(token)
    if exp is None:
        await websocket.close(code=4401)
        raise RuntimeError("invalid_token_exp")

    return valid_uuid, exp, payload


def _build_triage_payload(row: dict[str, str], volume: float, predictor) -> dict:
    """Build one explainable demo-policy Triage event from a Vitals row."""
    hr = float(row.get("hr", 0))
    bp_sys = float(row.get("bpSys", 0))
    bp_dia = float(row.get("bpDia", 0))
    resp = float(row.get("resp", 0))
    temp = float(row.get("temp", 0))
    spo2 = float(row.get("spo2", 0))

    probs = predictor.predict([row])
    final_sepsis = max(0.0, min(float(probs["sepsis"]), 0.99))
    final_ards = max(0.0, min(float(probs["ards"]), 0.99))
    final_shock = max(0.0, min(float(probs["shock"]), 0.99))

    max_prob = max(final_sepsis, final_ards, final_shock)
    vision_context = min(volume / 200000.0, 0.12)
    triage_score = min(max_prob + vision_context, 0.99)

    if max_prob == final_sepsis:
        triggering_condition = "패혈증 유사 (Sepsis-like)"
    elif max_prob == final_ards:
        triggering_condition = "ARDS 유사 (ARDS-like)"
    else:
        triggering_condition = "쇼크 유사 (Shock-like)"

    if triage_score >= _RED_THRESHOLD:
        triage_level = f"RED (초응급 - {triggering_condition} 위험)"
    elif triage_score >= _YELLOW_THRESHOLD:
        triage_level = "YELLOW (응급 - 집중 모니터링)"
    else:
        triage_level = "GREEN (안정 - 일반 관찰)"

    return {
        "status": "streaming",
        "vitals": {
            "hr": hr,
            "bp_sys": bp_sys,
            "bp_dia": bp_dia,
            "resp": resp,
            "temp": temp,
            "spo2": spo2,
        },
        "disease_risks": {
            "sepsis": f"{(final_sepsis * 100):.1f}%",
            "ards": f"{(final_ards * 100):.1f}%",
            "shock": f"{(final_shock * 100):.1f}%",
        },
        "triggering_condition": triggering_condition if triage_score >= _RED_THRESHOLD else None,
        "triage_level": triage_level,
        "sepsis_high_risk": bool(
            triage_score >= _RED_THRESHOLD
            and final_sepsis == max_prob
            and final_sepsis >= 0.60
        ),
        "decision": {
            "policy": "synthetic_demo_v1",
            "clinical_rule": False,
            "vitals_risk": round(max_prob, 4),
            "vision_context": round(vision_context, 4),
            "triage_score": round(triage_score, 4),
            "yellow_threshold": _YELLOW_THRESHOLD,
            "red_threshold": _RED_THRESHOLD,
        },
    }


@case_router.websocket("/cases/{case_id}/triage/stream")
async def case_triage_websocket_stream(websocket: WebSocket, case_id: str):
    """Replay the Vitals attached to one Case and stream explainable demo Triage."""
    await websocket.accept()
    try:
        try:
            valid_case_id = validate_case_id(case_id)
        except HTTPException:
            await websocket.close(code=4400)
            return

        try:
            valid_uuid, exp, auth_payload = await _authenticate_case_websocket(websocket)
        except RuntimeError:
            return

        try:
            volume = float(auth_payload.get("volume"))
            if volume < 0 or volume > 100000:
                raise ValueError
        except (TypeError, ValueError):
            await websocket.close(code=4400)
            return

        try:
            csv_bytes = download_case_vitals(valid_uuid, valid_case_id)
        except HTTPException:
            await websocket.send_json(
                {
                    "status": "error",
                    "case_id": valid_case_id,
                    "message": "이 Case에 연결된 Vitals CSV가 없습니다.",
                }
            )
            await websocket.close(code=4404)
            return

        try:
            from api.mamba_inference import MambaSystemicPredictor

            predictor = MambaSystemicPredictor()
        except Exception:
            await websocket.close(code=1011)
            return

        try:
            csv_text = csv_bytes.decode("utf-8")
            replay_rows = list(csv.DictReader(io.StringIO(csv_text)))
        except Exception:
            replay_rows = []

        if not replay_rows:
            await websocket.send_json(
                {
                    "status": "error",
                    "case_id": valid_case_id,
                    "message": "이 Case의 Vitals 데이터가 비어 있습니다.",
                }
            )
            await websocket.close(code=1008)
            return

        for row in cycle(replay_rows):
            await asyncio.sleep(1.0)
            if time.time() >= exp:
                await websocket.close(code=4401)
                return

            try:
                response_payload = _build_triage_payload(row, volume, predictor)
            except (TypeError, ValueError, KeyError):
                continue

            response_payload["case_id"] = valid_case_id
            await websocket.send_json(response_payload)

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass
