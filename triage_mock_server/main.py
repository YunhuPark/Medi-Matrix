from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn
from datetime import datetime
import json

app = FastAPI(title="Triage Mock Server")

class WebhookPayload(BaseModel):
    patient_id: str
    lesion_volume: float
    modality: str

def print_alert(message: str, color_code: str):
    """
    터미널 출력용 색상 로깅 함수
    """
    print(f"\033[{color_code}m{message}\033[0m")

import random
import hashlib

def simulate_mamba_inference(patient_id: str) -> float:
    """
    환자 ID를 기반으로 가상의 EMR 생체 신호를 조회하고
    IMST-Mamba (Sepsis Prediction Model) 추론을 시뮬레이션합니다.
    """
    # 데모를 위해 ID 기반으로 결정론적(Deterministic) 높은 확률 반환 (70~95%)
    hash_val = int(hashlib.md5(patient_id.encode()).hexdigest(), 16)
    base_prob = 70.0 + (hash_val % 250) / 10.0  # 70.0 ~ 95.0
    return round(base_prob, 1)

def determine_multimodal_triage(volume: float, sepsis_prob: float) -> tuple[str, str]:
    """
    3D 병변 부피(Volume)와 IMST-Mamba 패혈증 확률(Sepsis Prob)을 융합하여 응급도를 산출합니다.
    """
    if volume > 15000 and sepsis_prob > 80.0:
        return "CODE RED (초응급)", "91;1" # 볼드 빨강
    elif volume > 10000 or sepsis_prob > 85.0:
        return "RED", "91" # 빨강
    elif volume > 5000 or sepsis_prob > 75.0:
        return "YELLOW", "93" # 노랑
    else:
        return "GREEN", "92" # 초록

@app.post("/api/triage/webhook")
async def receive_triage_data(payload: WebhookPayload):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 구분선
    print("\n" + "="*60)
    print(f"[{now}] [NEW WEBHOOK RECEIVED]")
    print("="*60)
    
    print(f"> 환자 ID: \033[96m{payload.patient_id}\033[0m")
    print(f"> 촬영 부위(Modality): {payload.modality}")
    print(f"> 병변 부피(Volume): {payload.lesion_volume:,.2f} voxels")
    
    # [Multi-modal] 1. IMST-Mamba 시계열 패혈증 확률 추론
    print("...")
    print_alert("> [IMST-Mamba] 환자 Vitals EMR 데이터 조회 및 상태 공간 모델(SSM) 추론 중...", "90")
    sepsis_prob = simulate_mamba_inference(payload.patient_id)
    print(f"> 패혈증 발병 확률(Sepsis): \033[95m{sepsis_prob}%\033[0m")
    
    # [Multi-modal] 2. 융합 응급도 산출
    level, color = determine_multimodal_triage(payload.lesion_volume, sepsis_prob)
    
    # 3. 결과 로깅
    print("-" * 60)
    print_alert(f">>> [멀티모달 통합 결과] 산출 응급도: {level} <<<", color)
    if "RED" in level:
        print_alert("  [경고] 즉각적인 처치가 필요합니다. 최우선 병상 배정을 실시합니다.", "91")
    elif level == "YELLOW":
        print_alert("  [주의] 주의 깊은 모니터링이 필요합니다. 정밀 검사를 준비하세요.", "93")
    else:
        print_alert("  [안내] 정상 범위 또는 경미한 수준입니다. 일반 대기열로 안내합니다.", "92")
    print("="*60 + "\n")
    
    return {
        "status": "success",
        "triage_level": level,
        "sepsis_probability": f"{sepsis_prob}%",
        "message": "Multi-modal Webhook processed successfully."
    }

if __name__ == "__main__":
    print_alert("[Starting] Triage Mock Server on port 8001...", "96")
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
