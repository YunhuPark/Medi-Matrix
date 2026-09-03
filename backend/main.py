from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import uvicorn
from dotenv import load_dotenv
from api.router import router as medical_router
from api.case_router import case_router
from api.demo_router import demo_router

load_dotenv()

app = FastAPI(title="Medi-Matrix Transfer Decision Support API")


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


DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
# Vercel creates a new hostname for each Preview deployment. Keep this scoped to
# this project/team instead of opening CORS with a wildcard.
DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX = (
    r"^https://medi-matrix-[a-z0-9]+-park-yun-hus-projects\.vercel\.app$"
)


def _build_cors_origins():
    explicit = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if explicit:
        return [
            origin.strip().rstrip("/")
            for origin in explicit.split(",")
            if origin.strip()
        ]

    if os.environ.get("APP_ENV", "development").lower() == "production":
        return []

    return DEFAULT_DEV_ORIGINS.copy()


def _build_cors_origin_regex():
    explicit = os.environ.get("ALLOWED_ORIGIN_REGEX", "").strip()
    if explicit:
        return explicit

    if os.environ.get("APP_ENV", "development").lower() == "production":
        return DEFAULT_VERCEL_PREVIEW_ORIGIN_REGEX

    return None


# Configure CORS. Production keeps exact origins from ALLOWED_ORIGINS while also
# allowing only this project's ephemeral Vercel Preview hostnames.
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

app.include_router(medical_router, prefix="/api/v1")
app.include_router(case_router, prefix="/api/v1")
app.include_router(demo_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {
        "message": "Medi-Matrix transfer decision-support prototype API",
        "target_scenario": "local ED to higher-level hospital transfer support",
        "clinical_use": False,
    }


@app.get("/health/live")
def health_live():
    return JSONResponse(content={"status": "alive"})


@app.get("/health/ready")
def health_ready():
    app_env = os.environ.get("APP_ENV", "development")
    inference_mode = os.environ.get("INFERENCE_MODE", "demo")

    if inference_mode not in ["demo", "model"]:
        raise HTTPException(status_code=503, detail="Invalid INFERENCE_MODE")

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

    return JSONResponse(content={"status": "ready", "inference_mode": inference_mode})


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
