from fastapi import APIRouter, File, UploadFile, HTTPException, BackgroundTasks, Form, WebSocket, WebSocketDisconnect, Depends, Request
import numpy as np
import os
import io
import uuid
import httpx
import json
import asyncio
import shutil
import csv
import math
import tempfile
import time
from typing import Optional
from fastapi.responses import JSONResponse

# 내부 서비스 모듈 임포트
from services.mesh_processor import create_mesh_from_mask
from services.supabase_client import upload_file_to_supabase, get_supabase_client
from services.mamba_service import mamba_simulator
from core.auth import get_current_user, CurrentUser, decode_verified_token_exp
from core.rate_limit import check_rate_limit, process_mri_limiter, upload_vitals_limiter, triage_send_limiter, signed_url_limiter, websocket_limiter

router = APIRouter()

async def read_file_with_limit(file: UploadFile, max_size: int) -> bytes:
    contents = bytearray()
    chunk_size = 1024 * 1024
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        if len(contents) + len(chunk) > max_size:
            raise HTTPException(status_code=413, detail="File too large")
        contents.extend(chunk)
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file is not allowed.")
    return bytes(contents)

from pydantic import BaseModel, Field

class TriageRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=128)
    modality: str
    volume: float = Field(0.0, ge=0.0, le=1000000000.0)

@router.post("/triage/send")
async def trigger_triage_webhook(
    req: TriageRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    On-Demand로 Triage 외부 서버에 웹훅을 전송합니다. (구버전 - 하위 호환 유지)
    """
    check_rate_limit(request, triage_send_limiter, current_user.user_id)
    triage_api_url = os.environ.get("TRIAGE_API_URL", "http://localhost:8001/api/triage/webhook")

    payload = {
        "patient_id": req.patient_id,
        "lesion_volume": req.volume,
        "modality": req.modality
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(triage_api_url, json=payload, timeout=5.0)
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail="Triage server error")

            # Triage 서버의 응답(sepsis_probability 등)을 그대로 프론트에 전달
            triage_data = response.json()
            return triage_data
    except HTTPException:
        raise
    except Exception:
        # Triage 서버가 꺼져 있을 경우 프론트에서 처리할 수 있도록 에러 반환
        raise HTTPException(status_code=503, detail="Triage service is currently unavailable.")

@router.post("/upload-vitals")
async def upload_vitals(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    실제 환자의 생체 신호(Vitals) 시계열 데이터를 CSV 포맷으로 업로드합니다.
    """
    check_rate_limit(request, upload_vitals_limiter, current_user.user_id)
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Empty filename.")
    if not filename.lower().endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")

    try:
        try:
            max_size_str = os.environ.get("MAX_VITALS_UPLOAD_SIZE", "5242880")
            max_size = int(max_size_str)
            if max_size <= 0: max_size = 5242880
        except ValueError:
            max_size = 5242880

        try:
            max_rows_str = os.environ.get("MAX_VITALS_ROWS", "1000")
            max_rows = int(max_rows_str)
            if max_rows <= 0: max_rows = 1000
        except ValueError:
            max_rows = 1000

        contents = await read_file_with_limit(file, max_size)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Internal server error")

    try:
        content_str = contents.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV file must be UTF-8 encoded.")

    import csv
    import math
    reader = csv.DictReader(io.StringIO(content_str))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty or missing headers.")
    
    required_headers = {'hr', 'bpSys', 'bpDia', 'resp', 'temp', 'spo2'}
    if not required_headers.issubset(set(reader.fieldnames)):
        raise HTTPException(status_code=400, detail="Missing required CSV headers.")

    row_count = 0
    valid_rows = []
    for row in reader:
        row_count += 1
        if row_count > max_rows:
            raise HTTPException(status_code=400, detail="CSV contains too many rows.")
        for header in required_headers:
            val_str = row.get(header, "")
            if not val_str.strip():
                raise HTTPException(status_code=400, detail=f"Empty value found for {header}.")
            try:
                val = float(val_str)
                if not math.isfinite(val):
                    raise ValueError()
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid numeric data for {header}.")
        valid_rows.append(row)

    if not valid_rows:
        raise HTTPException(status_code=400, detail="CSV file has no data rows.")

    try:
        from services.supabase_client import upload_user_vitals
        # csv DictWriter to bytes
        csv_buffer = io.StringIO()
        writer = csv.DictWriter(csv_buffer, fieldnames=reader.fieldnames)
        writer.writeheader()
        writer.writerows(valid_rows)
        csv_bytes = csv_buffer.getvalue().encode('utf-8')
        upload_user_vitals(current_user.user_id, csv_bytes)
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Step: router_upload_vitals_exception | Exception Class: {e.__class__.__name__}")
        raise HTTPException(status_code=500, detail="Failed to save vitals data.")

    return {"message": "Vitals CSV uploaded successfully"}

@router.websocket("/triage/stream")
async def triage_websocket_stream(websocket: WebSocket):
    """
    실제 CSV 데이터를 읽어서 실시간 생체 신호(HR, BP 등)와 패혈증 확률(IMST-Mamba)을 1초마다 스트리밍합니다.
    """
    await websocket.accept()
    try:
        # Rate limit based on IP first
        client_ip = websocket.client.host if websocket.client else "unknown"
        trust_proxy = os.environ.get("TRUST_PROXY_HEADERS", "").lower() == "true"
        if trust_proxy:
            forwarded = websocket.headers.get("x-forwarded-for")
            if forwarded:
                client_ip = forwarded.split(",")[0].strip()

        if not websocket_limiter.is_allowed(f"ip:{client_ip}"):
            await websocket.close(code=4429)
            return
            
        import logging
        logger = logging.getLogger(__name__)
        app_env = os.environ.get("APP_ENV", "development")
        allowed_origins_str = os.environ.get("ALLOWED_ORIGINS", "").strip()
        origin = websocket.headers.get("origin")
        origin_normalized = origin.strip().rstrip("/") if origin else ""
        
        if app_env == "production" and not allowed_origins_str:
            # Fail-closed in production if no origins specified
            logger.warning("rejection_stage: origin | origin_allowed: false | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        if allowed_origins_str:
            allowed_list = [o.strip().rstrip("/") for o in allowed_origins_str.split(",") if o.strip()]
            if origin_normalized not in allowed_list:
                logger.warning("rejection_stage: origin | origin_allowed: false | close_code: 4401")
                await websocket.close(code=4401)
                return
            
        # 클라이언트로부터 초기 1회 트리거 수신 (인증 및 환자 ID)
        try:
            data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            if len(data.encode('utf-8')) > 8192:
                logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
                await websocket.close(code=4401)
                return
            payload = json.loads(data)
        except asyncio.TimeoutError:
            logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
        except Exception:
            logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        if payload.get("type") != "auth" or not payload.get("access_token"):
            logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        token = payload["access_token"]
        
        # Verify Token manually
        supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        if not supabase_url or not publishable_key:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        auth_url = f"{supabase_url}/auth/v1/user"
        headers = {"apikey": publishable_key, "Authorization": f"Bearer {token}"}
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(auth_url, headers=headers, timeout=3.0)
        except Exception:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        if response.status_code != 200:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        user_data = response.json()
        user_id = user_data.get("id")
        if not user_id:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
        try:
            valid_uuid = str(uuid.UUID(user_id))
        except Exception:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return

        # Check user-based rate limit
        if not websocket_limiter.is_allowed(f"user:{valid_uuid}"):
            logger.warning("rejection_stage: rate_limit | origin_allowed: true | close_code: 4429")
            await websocket.close(code=4429)
            return

        # JWT Exp validation (only after verifying the token is valid with Auth service)
        exp = decode_verified_token_exp(token)
        if exp is None:
            logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return

        patient_id = payload.get("patient_id")
        volume = payload.get("volume")
        
        # Validate types and ranges
        if not isinstance(patient_id, str) or not (1 <= len(patient_id) <= 50):
            logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
            
        try:
            volume = float(volume)
            if volume < 0 or volume > 100000:
                raise ValueError
        except (TypeError, ValueError):
            logger.warning("rejection_stage: auth_frame | origin_allowed: true | close_code: 4401")
            await websocket.close(code=4401)
            return
        from services.supabase_client import download_user_vitals
        try:
            csv_bytes = download_user_vitals(valid_uuid)
        except Exception:
            await websocket.send_json({"status": "error", "message": "실제 환자 CSV 데이터가 업로드되지 않았습니다."})
            await websocket.close()
            return
            
        try:
            from .mamba_inference import MambaSystemicPredictor
            mamba_predictor = MambaSystemicPredictor()
        except Exception:
            await websocket.close(code=1011)
            return

        import io
        csv_text = csv_bytes.decode('utf-8')
        reader = csv.DictReader(io.StringIO(csv_text))
        for row in reader:
            await asyncio.sleep(1.0)
            
            # Check JWT Expiration during stream
            if time.time() >= exp:
                logger.warning("rejection_stage: jwt | origin_allowed: true | close_code: 4401")
                await websocket.close(code=4401)
                return

            try:
                hr = float(row.get("hr", 0))
                bp_sys = float(row.get("bpSys", 0))
                bp_dia = float(row.get("bpDia", 0))
                resp = float(row.get("resp", 0))
                temp = float(row.get("temp", 0))
                spo2 = float(row.get("spo2", 0))
            except ValueError:
                continue

                window_data = {
                    "hr": hr, "bp_sys": bp_sys, "bp_dia": bp_dia,
                    "resp": resp, "temp": temp, "spo2": spo2
                }

            probs = mamba_predictor.predict([row])

            # Time-series 위험 점수는 Vitals만으로 계산합니다.
            # 영상 병변 volume은 질환 점수에 직접 더하지 않고 최종 Triage의 제한된
            # context 보정값으로만 사용해 Vision/Time-series 신호를 분리합니다.
            final_sepsis = max(0.0, min(float(probs["sepsis"]), 0.99))
            final_ards = max(0.0, min(float(probs["ards"]), 0.99))
            final_shock = max(0.0, min(float(probs["shock"]), 0.99))

            max_prob = max(final_sepsis, final_ards, final_shock)
            vision_context = min(volume / 200000.0, 0.12)
            triage_score = min(max_prob + vision_context, 0.99)

            # 어떤 Vitals 유사 패턴이 가장 높은 위험도를 갖는지 식별
            triggering_condition = "Unknown"
            if max_prob == final_sepsis:
                triggering_condition = "패혈증 유사 (Sepsis-like)"
            elif max_prob == final_ards:
                triggering_condition = "ARDS 유사 (ARDS-like)"
            elif max_prob == final_shock:
                triggering_condition = "쇼크 유사 (Shock-like)"

            # 합성 데모용 Triage: Stable -> GREEN, Warning -> YELLOW, Critical -> RED
            if triage_score >= 0.75:
                triage_level = f"RED (초응급 - {triggering_condition} 위험)"
            elif triage_score >= 0.25:
                triage_level = "YELLOW (응급 - 집중 모니터링)"
            else:
                triage_level = "GREEN (안정 - 일반 관찰)"

            # 4. 실시간 결과 및 진짜 생체 데이터 스트리밍 전송
            response_payload = {
                "status": "streaming",
                "vitals": {
                    "hr": hr,
                    "bp_sys": bp_sys,
                    "bp_dia": bp_dia,
                    "resp": resp,
                    "temp": temp,
                    "spo2": spo2
                },
                "disease_risks": {
                    "sepsis": f"{(final_sepsis * 100):.1f}%",
                    "ards": f"{(final_ards * 100):.1f}%",
                    "shock": f"{(final_shock * 100):.1f}%"
                },
                "triggering_condition": triggering_condition if triage_score >= 0.75 else None,
                "triage_level": triage_level,
                "sepsis_high_risk": bool(
                    triage_score >= 0.75
                    and final_sepsis == max_prob
                    and final_sepsis >= 0.60
                )
            }

            await websocket.send_json(response_payload)

        # CSV 끝 도달 시
        await websocket.send_json({"status": "completed"})

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass


import tempfile
from services.inference_service import inference_service

@router.post("/process-mri")
async def process_medical_mri(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    modality: str = Form("Brain"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    [AI Inference Pipeline]
    업로드된 원본 환자 의료 영상(.nii, .nii.gz)을 받아 PyTorch 3D UNet 모델을 통과시킵니다.
    추론된 분할 마스크(Segmentation Mask)를 바탕으로 GLB 메쉬를 생성하고,
    Supabase에 업로드하여 Signed URL을 반환합니다.
    """
    check_rate_limit(request, process_mri_limiter, current_user.user_id)
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Empty filename.")
    file_ext = filename.lower()
    valid_extensions = ('.nii', '.nii.gz', '.npy')
    if not any(file_ext.endswith(ext) for ext in valid_extensions):
        raise HTTPException(status_code=400, detail="Only .nii.gz or .npy files are supported.")

    try:
        try:
            max_size_str = os.environ.get("MAX_UPLOAD_SIZE", "52428800")
            max_size = int(max_size_str)
            if max_size <= 0: max_size = 52428800
        except ValueError:
            max_size = 52428800

        contents = await read_file_with_limit(file, max_size)

        tmp_path = None
        glb_file_path = None
        try:
            # 1. 원본 데이터 파싱 및 AI 모델 추론 (Inference)
            if file_ext.endswith('.nii') or file_ext.endswith('.nii.gz'):
                # nibabel과 Inference 서비스는 파일 경로가 필요하므로 임시 파일로 저장
                suffix = ".nii.gz" if file_ext.endswith(".nii.gz") else ".nii"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(contents)
                    tmp_path = tmp.name



                # --- [핵심] PyTorch 3D UNet 추론 파이프라인 ---
                mask_data, heatmap_data = inference_service.predict(tmp_path)

            else:
                # 호환성을 위해 기존 .npy 지원 유지 (이미 마스크인 경우)

                mask_data = np.load(io.BytesIO(contents), allow_pickle=False)

                if mask_data.dtype.hasobject:
                    raise HTTPException(status_code=400, detail="Invalid NumPy medical data.")
                if mask_data.ndim != 3:
                    raise HTTPException(status_code=400, detail="Medical array must be three-dimensional.")
                if not (np.issubdtype(mask_data.dtype, np.number) or np.issubdtype(mask_data.dtype, np.bool_)):
                    raise HTTPException(status_code=400, detail="Medical array dtype is not supported.")
                if mask_data.size > 256 * 256 * 256:
                    raise HTTPException(status_code=400, detail="Medical array dimensions exceed the allowed limit.")
                if not np.isfinite(mask_data).all():
                    raise HTTPException(status_code=400, detail="Medical array contains non-finite values.")

                heatmap_data = mask_data # Fallback



            # 2. Marching Cubes를 통한 메쉬 생성 (GLB)
            glb_file_path = create_mesh_from_mask(mask_data, threshold=0.5, heatmap_data=heatmap_data)

            # 2. 병변 부피(Volume) 계산 (단위: 임의의 Voxel 개수, 실제로는 spacing 곱연산 필요)
            lesion_volume = float(np.sum(mask_data >= 0.5))

            # 웹훅 자동 전송(background_task) 로직은 삭제됨 (Triage API로 분리)
            mock_patient_id = f"mock_pt_{uuid.uuid4().hex[:6]}"

            # 4. Supabase Storage 업로드
            # 고유한 파일명 생성 (예: uuid)
            mesh_uuid = str(uuid.uuid4())
            bucket_name = os.environ.get("SUPABASE_STORAGE_BUCKET", "medical-meshes")
            destination_path = f"{current_user.user_id}/{mesh_uuid}.glb"

            try:
                expires_in = int(os.environ.get("SIGNED_URL_EXPIRES_IN", "600"))
            except ValueError:
                expires_in = 600
            expires_in = max(60, min(expires_in, 900))
            
            import time
            expires_at = int(time.time()) + expires_in

            # Supabase 업로드 및 Signed URL 획득
            signed_url = upload_file_to_supabase(
                bucket_name=bucket_name,
                file_path=glb_file_path,
                destination_path=destination_path,
                expires_in=expires_in
            )


            
            from fastapi.responses import JSONResponse
            return JSONResponse(
                content={
                    "status": "success",
                    "message": "Mesh generated and uploaded successfully.",
                    "mesh_id": mesh_uuid,
                    "glb_url": signed_url,
                    "signed_url": signed_url,
                    "expires_in": expires_in,
                    "expires_at": expires_at,
                    "patient_id": mock_patient_id,
                    "lesion_volume": lesion_volume
                },
                headers={"Cache-Control": "no-store"}
            )
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            if glb_file_path and os.path.exists(glb_file_path):
                try:
                    os.remove(glb_file_path)
                except Exception:
                    pass

    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid NumPy medical data.")
    except Exception:
        raise HTTPException(status_code=500, detail="Internal server error")

from fastapi.responses import JSONResponse

@router.get("/meshes/{mesh_id}/signed-url")
async def get_signed_url(
    mesh_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user)
):
    check_rate_limit(request, signed_url_limiter, current_user.user_id)
    
    try:
        valid_mesh_id = str(uuid.UUID(mesh_id))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid mesh_id")
        
    bucket_name = os.environ.get("SUPABASE_STORAGE_BUCKET", "medical-meshes")
    destination_path = f"{current_user.user_id}/{valid_mesh_id}.glb"
    
    try:
        expires_in = int(os.environ.get("SIGNED_URL_EXPIRES_IN", "600"))
    except ValueError:
        expires_in = 600
    expires_in = max(60, min(expires_in, 900))
    
    import time
    expires_at = int(time.time()) + expires_in
    
    try:
        supabase = get_supabase_client()
        response = supabase.storage.from_(bucket_name).create_signed_url(destination_path, expires_in)
        signed_url = response.get("signedURL") if isinstance(response, dict) else getattr(response, "signedURL", None)
        if not signed_url and isinstance(response, dict) and "signedUrl" in response:
            signed_url = response["signedUrl"]
            
        if not signed_url:
            raise HTTPException(status_code=404, detail="File not found or failed to create signed URL.")
            
        return JSONResponse(
            content={
                "mesh_id": valid_mesh_id,
                "glb_url": signed_url,
                "signed_url": signed_url,
                "expires_in": expires_in,
                "expires_at": expires_at
            },
            headers={"Cache-Control": "no-store"}
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Storage service error.")
