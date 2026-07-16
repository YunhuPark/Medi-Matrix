from fastapi import APIRouter, File, UploadFile, HTTPException, BackgroundTasks, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import numpy as np
import os
import io
import uuid
import httpx
import json
import asyncio
import shutil

# 내부 서비스 모듈 임포트
from services.mesh_processor import create_mesh_from_mask
from services.supabase_client import upload_file_to_supabase
from services.mamba_service import mamba_simulator

router = APIRouter()

from pydantic import BaseModel

class TriageRequest(BaseModel):
    patient_id: str
    modality: str
    volume: float = 0.0

@router.post("/triage/send")
async def trigger_triage_webhook(req: TriageRequest):
    """
    On-Demand로 Triage 외부 서버에 웹훅을 전송합니다. (구버전 - 하위 호환 유지)
    """
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
                raise HTTPException(status_code=400, detail="Triage server error")

            # Triage 서버의 응답(sepsis_probability 등)을 그대로 프론트에 전달
            triage_data = response.json()
            return triage_data
    except HTTPException:
        raise
    except Exception as e:
        # Triage 서버가 꺼져 있을 경우 프론트에서 처리할 수 있도록 에러 반환
        raise HTTPException(status_code=503, detail=f"Failed to contact Triage server: {str(e)}")

@router.post("/upload-vitals")
async def upload_vitals(file: UploadFile = File(...)):
    """
    실제 환자의 생체 신호(Vitals) 시계열 데이터를 CSV 포맷으로 업로드합니다.
    """
    if not file.filename.endswith('.csv'):
        return JSONResponse(status_code=400, content={"error": "Only CSV files are allowed."})

    file_path = os.path.join(os.path.dirname(__file__), "../data/real_vitals.csv")
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"message": "Vitals CSV uploaded successfully", "filename": file.filename}

@router.websocket("/triage/stream")
async def triage_websocket_stream(websocket: WebSocket):
    """
    실제 CSV 데이터를 읽어서 실시간 생체 신호(HR, BP 등)와 패혈증 확률(IMST-Mamba)을 1초마다 스트리밍합니다.
    """
    await websocket.accept()
    try:
        # 클라이언트로부터 초기 1회 트리거 수신 (환자 ID, Volume)
        data = await websocket.receive_text()
        payload = json.loads(data)

        patient_id = payload.get("patient_id", "unknown")
        volume = float(payload.get("volume", 0))

        import csv
        csv_path = os.path.join(os.path.dirname(__file__), "../data/real_vitals.csv")

        if not os.path.exists(csv_path):
            await websocket.send_json({"status": "error", "message": "실제 환자 CSV 데이터가 업로드되지 않았습니다."})
            await websocket.close()
            return

        try:
            from .mamba_inference import MambaSystemicPredictor
            mamba_predictor = MambaSystemicPredictor()
        except FileNotFoundError as e:
            await websocket.send_json({"status": "error", "message": str(e)})
            await websocket.close()
            return
        except Exception as e:
            await websocket.send_json({"status": "error", "message": f"Mamba 모델 초기화 실패: {str(e)}"})
            await websocket.close()
            return

        window_data = []

        with open(csv_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                await asyncio.sleep(1.0)

                hr = float(row.get("hr", 80))
                bp_sys = float(row.get("bpSys", 120))
                bp_dia = float(row.get("bpDia", 80))
                resp = float(row.get("resp", 16))
                temp = float(row.get("temp", 36.5))
                spo2 = float(row.get("spo2", 98))

                window_data.append(row)
                if len(window_data) > 10:
                    window_data.pop(0) # 10초 윈도우 유지

                # Mamba 인퍼런스를 통한 다중 병증 확률 예측
                probs = mamba_predictor.predict(window_data)

                # Volume을 추가 피처로 활용 (Multi-modal 앙상블)
                volume_factor = volume / 20000.0

                # 각 병증별 최종 확률 계산 (Volume factor 보정)
                final_sepsis = min(probs["sepsis"] + volume_factor, 1.0)
                final_ards = min(probs["ards"] + volume_factor, 1.0)
                final_shock = min(probs["shock"] + volume_factor, 1.0)

                max_prob = max(final_sepsis, final_ards, final_shock)

                # 어떤 병증이 가장 높은 위험도를 갖는지 식별
                triggering_condition = "Unknown"
                if max_prob == final_sepsis: triggering_condition = "패혈증 (Sepsis)"
                elif max_prob == final_ards: triggering_condition = "급성 호흡곤란 증후군 (ARDS)"
                elif max_prob == final_shock: triggering_condition = "저혈량성 쇼크 (Hypovolemic Shock)"

                # 확률에 따른 Triage 결정
                if max_prob > 0.8:
                    triage_level = f"RED (초응급 - {triggering_condition} 위험)"
                elif max_prob > 0.5:
                    triage_level = "YELLOW (응급 - 집중 모니터링)"
                else:
                    triage_level = "GREEN (안정 - 일반 병동 관찰)"

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
                    "triggering_condition": triggering_condition if max_prob > 0.8 else None,
                    "triage_level": triage_level
                }

                await websocket.send_json(response_payload)

            # CSV 끝 도달 시
            await websocket.send_json({"status": "completed"})

    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected from streaming.")
    except Exception as e:
        print(f"[WebSocket] Error during streaming: {e}")


import nibabel as nib
import tempfile
from services.inference_service import inference_service

MAX_UPLOAD_SIZE = 50 * 1024 * 1024

@router.post("/process-mri")
async def process_medical_mri(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    modality: str = Form("Brain")
):
    """
    [AI Inference Pipeline]
    업로드된 원본 환자 의료 영상(.nii, .nii.gz)을 받아 PyTorch 3D UNet 모델을 통과시킵니다.
    추론된 분할 마스크(Segmentation Mask)를 바탕으로 GLB 메쉬를 생성하고,
    Supabase에 업로드하여 Public URL을 반환합니다.
    """
    file_ext = file.filename.lower()
    valid_extensions = ('.nii', '.nii.gz', '.npy')
    if not any(file_ext.endswith(ext) for ext in valid_extensions):
        raise HTTPException(status_code=400, detail="Only .nii.gz or .npy files are supported.")

    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="Empty file is not allowed.")

        max_size = int(os.environ.get("MAX_UPLOAD_SIZE", 50 * 1024 * 1024))
        if len(contents) > max_size:
            raise HTTPException(status_code=413, detail="File too large")

        tmp_path = None
        glb_file_path = None
        try:
            # 1. 원본 데이터 파싱 및 AI 모델 추론 (Inference)
            if file_ext.endswith('.nii') or file_ext.endswith('.nii.gz'):
                # nibabel과 Inference 서비스는 파일 경로가 필요하므로 임시 파일로 저장
                with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as tmp:
                    tmp.write(contents)
                    tmp_path = tmp.name

                print(f"[Router] Received Raw MRI: {file.filename}. Sending to AI Inference Service...")

                # --- [핵심] PyTorch 3D UNet 추론 파이프라인 ---
                mask_data, heatmap_data = inference_service.predict(tmp_path)

            else:
                # 호환성을 위해 기존 .npy 지원 유지 (이미 마스크인 경우)
                print("[Router] Received pre-segmented .npy mask. Bypassing inference.")
                mask_data = np.load(io.BytesIO(contents), allow_pickle=False)

                if mask_data.dtype.hasobject:
                    raise ValueError("Invalid .npy file")
                if mask_data.ndim != 3:
                    raise ValueError("Mask must be a 3-dimensional array.")
                if not (np.issubdtype(mask_data.dtype, np.number) or np.issubdtype(mask_data.dtype, np.bool_)):
                    raise ValueError("Mask dtype must be numeric or boolean.")
                if mask_data.size > 256 * 256 * 256:
                    raise ValueError("Mask shape is too large.")
                if not np.isfinite(mask_data).all():
                    raise ValueError("Mask contains NaN or Infinity.")

                heatmap_data = mask_data # Fallback

            # 디버그 로그
            print(f"[Router] Segmentation Mask -> shape: {mask_data.shape}, dtype: {mask_data.dtype}, "
                  f"range: [{mask_data.min():.4f}, {mask_data.max():.4f}]")

            # 2. Marching Cubes를 통한 메쉬 생성 (GLB)
            glb_file_path = create_mesh_from_mask(mask_data, threshold=0.5, heatmap_data=heatmap_data)

            # 2. 병변 부피(Volume) 계산 (단위: 임의의 Voxel 개수, 실제로는 spacing 곱연산 필요)
            lesion_volume = float(np.sum(mask_data >= 0.5))

            # 웹훅 자동 전송(background_task) 로직은 삭제됨 (Triage API로 분리)
            mock_patient_id = f"mock_pt_{uuid.uuid4().hex[:6]}"

            # 4. Supabase Storage 업로드
            # 고유한 파일명 생성 (예: uuid)
            unique_filename = f"{modality.lower()}_mesh_{uuid.uuid4().hex}.glb"

            # 버킷명 (실제 생성한 버킷명으로 변경 필요)
            bucket_name = "medical-meshes"

            # Supabase 업로드 및 URL 획득
            public_url = upload_file_to_supabase(
                bucket_name=bucket_name,
                file_path=glb_file_path,
                destination_path=unique_filename
            )

            print(f"[Router] [OK] Success -> URL: {public_url[:80]}...")

            return {
                "status": "success",
                "message": "Mesh generated and uploaded successfully.",
                "glb_url": public_url,
                "filename": unique_filename,
                "patient_id": mock_patient_id,
                "lesion_volume": lesion_volume
            }
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception as cleanup_err:
                    print(f"[Cleanup Error] Failed to remove tmp_path: {cleanup_err}")
            if glb_file_path and os.path.exists(glb_file_path):
                try:
                    os.remove(glb_file_path)
                except Exception as cleanup_err:
                    print(f"[Cleanup Error] Failed to remove glb_file_path: {cleanup_err}")

    except HTTPException:
        raise
    except ValueError as e:
        print(f"[Router] [ERROR] ValueError: {str(e)}")
        error_msg = str(e)
        if "Object arrays cannot be loaded" in error_msg:
            error_msg = "Invalid .npy file: Object arrays are not allowed."
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error")
