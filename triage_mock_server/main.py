from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn
from ipaddress import ip_address
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse

app = FastAPI(title="Triage Mock Server")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"], www_redirect=False)


@app.middleware("http")
async def require_direct_loopback(request: Request, call_next):
    """This unauthenticated simulator is only for direct local backend calls."""
    try:
        local_peer = request.client is not None and ip_address(request.client.host).is_loopback
    except ValueError:
        local_peer = False
    if not local_peer or any(
        name == "forwarded" or name == "x-real-ip" or name.startswith("x-forwarded-")
        for name in request.headers
    ):
        return JSONResponse({"detail": "Direct loopback access only."}, status_code=403)
    origin = request.headers.get("origin")
    if origin is not None and origin != f"{request.url.scheme}://{request.headers.get('host', '')}":
        return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)
    return await call_next(request)

class WebhookPayload(BaseModel):
    patient_id: str
    lesion_volume: float
    modality: str

def print_alert(message: str, color_code: str):
    """
    터미널 출력용 색상 로깅 함수
    """
    print(f"\033[{color_code}m{message}\033[0m")

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
    # Keep the synthetic response contract without logging request medical fields
    # or patient-derived inference values. This does not query real EMR records.
    sepsis_prob = simulate_mamba_inference(payload.patient_id)
    level, _ = determine_multimodal_triage(payload.lesion_volume, sepsis_prob)
    print("[Triage Mock] Synthetic demo request processed.")
    
    return {
        "status": "success",
        "triage_level": level,
        "sepsis_probability": f"{sepsis_prob}%",
        "message": "Multi-modal Webhook processed successfully."
    }

if __name__ == "__main__":
    print_alert("[Starting] Local-only Triage Mock Server on 127.0.0.1:8001...", "96")
    uvicorn.run(app, host="127.0.0.1", port=8001, reload=False, proxy_headers=False)
