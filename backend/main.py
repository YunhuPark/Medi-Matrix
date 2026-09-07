from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import math
import os
import uvicorn
from dotenv import load_dotenv
from api.router import router as medical_router
from api.case_router import case_router
from api.demo_router import demo_router
from core.cors_policy import (
    build_cors_origin_regex as _build_cors_origin_regex,
    build_cors_origins as _build_cors_origins,
)

load_dotenv()

app = FastAPI(title="Medical Image 3D Viewer API")


@app.on_event("startup")
async def startup_event():
    import importlib.metadata

    print("Runtime dependency versions:")
    for pkg in ["supabase", "supabase-auth", "storage3", "postgrest", "httpx"]:
        try:
            version = importlib.metadata.version(pkg)
            print(f"{pkg}={version}")
        except importlib.metadata.PackageNotFoundError:
            print(f"{pkg}=<not-installed>")

    vitals_inference_mode = os.environ.get("VITALS_INFERENCE_MODE", "demo").strip().lower()
    if vitals_inference_mode not in {"demo", "model"}:
        raise RuntimeError("Invalid VITALS_INFERENCE_MODE at startup")
    vitals_model_id = _verify_vitals_runtime(vitals_inference_mode)
    print(
        "Vitals runtime ready: "
        f"mode={vitals_inference_mode} model_id={vitals_model_id} clinical_use=false"
    )


# Keep the production origin allow-list while permitting only this project's
# Vercel Preview hostnames through a scoped regex.
origins = _build_cors_origins()
origin_regex = _build_cors_origin_regex()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "Authorization"],
)

# Legacy endpoints remain available for backwards compatibility. Competition
# flows use the Case/Demo routers so imaging, Vitals, Triage and transfer
# context are bound to one non-PHI encounter identifier.
app.include_router(medical_router, prefix="/api/v1")
app.include_router(case_router, prefix="/api/v1")
app.include_router(demo_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {"message": "Welcome to Medical Image 3D Viewer API"}


@app.get("/health/live")
def health_live():
    return JSONResponse(content={"status": "alive"})


def _verify_vitals_runtime(vitals_inference_mode: str) -> str:
    """Load and execute one fixed nonclinical probe when Vitals model mode is enabled."""
    if vitals_inference_mode == "demo":
        return "deterministic_vitals_demo_v1"

    try:
        from api.mamba_inference import MambaSystemicPredictor

        predictor = MambaSystemicPredictor()
        probe = predictor.predict(
            [
                {
                    "hr": 80.0,
                    "bpSys": 120.0,
                    "bpDia": 75.0,
                    "resp": 16.0,
                    "temp": 36.8,
                    "spo2": 98.0,
                }
            ]
        )
        probability = float(probe["sepsis"])
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise RuntimeError("Vitals probe returned an invalid probability.")
        if probe.get("inference_mode") != "model":
            raise RuntimeError("Vitals probe did not execute in model mode.")
        model_id = str(probe.get("model_id") or predictor.model_id).strip()
        if not model_id:
            raise RuntimeError("Vitals probe did not expose a model ID.")
        return model_id
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Vitals model runtime unavailable",
        ) from exc


@app.get("/health/ready")
def health_ready():
    app_env = os.environ.get("APP_ENV", "development")
    inference_mode = os.environ.get("INFERENCE_MODE", "demo").strip().lower()
    vitals_inference_mode = os.environ.get("VITALS_INFERENCE_MODE", "demo").strip().lower()

    if inference_mode not in ["demo", "model"]:
        raise HTTPException(status_code=503, detail="Invalid INFERENCE_MODE")
    if vitals_inference_mode not in ["demo", "model"]:
        raise HTTPException(status_code=503, detail="Invalid VITALS_INFERENCE_MODE")

    if app_env == "production":
        configured_origins = _build_cors_origins()
        configured_origin_regex = _build_cors_origin_regex()
        if "*" in configured_origins or not (
            configured_origins or configured_origin_regex
        ):
            raise HTTPException(status_code=503, detail="Invalid CORS config")

        required_vars = [
            "SUPABASE_URL",
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_SECRET_KEY",
            "SUPABASE_STORAGE_BUCKET",
            "SUPABASE_VITALS_BUCKET",
        ]
        for var in required_vars:
            if not os.environ.get(var):
                raise HTTPException(status_code=503, detail="Missing env var")

    if inference_mode == "model":
        try:
            import torch
        except ImportError:
            raise HTTPException(
                status_code=503,
                detail="ML dependencies missing for model mode",
            )

        model_paths = [
            os.path.join(
                os.path.dirname(__file__),
                "models/imst_mamba_systemic_model.pth",
            ),
            os.path.join(
                os.path.dirname(__file__),
                "models/unet3d_brats_model.pth",
            ),
        ]
        for path in model_paths:
            if not os.path.exists(path):
                raise HTTPException(status_code=503, detail="Model weights missing")

    vitals_model_id = _verify_vitals_runtime(vitals_inference_mode)

    return JSONResponse(
        content={
            "status": "ready",
            "inference_mode": inference_mode,
            "vitals_inference_mode": vitals_inference_mode,
            "vitals_model_id": vitals_model_id,
            "clinical_use": False,
        }
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
