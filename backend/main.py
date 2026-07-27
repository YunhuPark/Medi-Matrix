from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv
from api.router import router as medical_router

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

# Configure CORS
import os
allowed_origins_str = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
origins = [origin.strip() for origin in allowed_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "Authorization"],
)

app.include_router(medical_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to Medical Image 3D Viewer API"}

from fastapi import HTTPException
from fastapi.responses import JSONResponse

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
        origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
        if not origins or "*" in origins:
            raise HTTPException(status_code=503, detail="Invalid CORS config")
        
        required_vars = [
            "SUPABASE_URL", 
            "SUPABASE_PUBLISHABLE_KEY", 
            "SUPABASE_SECRET_KEY", 
            "SUPABASE_STORAGE_BUCKET", 
            "SUPABASE_VITALS_BUCKET"
        ]
        for var in required_vars:
            if not os.environ.get(var):
                raise HTTPException(status_code=503, detail=f"Missing env var")
                
    if inference_mode == "model":
        try:
            import torch
        except ImportError:
            raise HTTPException(status_code=503, detail="ML dependencies missing for model mode")
            
        model_paths = [
            os.path.join(os.path.dirname(__file__), "models/imst_mamba_systemic_model.pth"),
            os.path.join(os.path.dirname(__file__), "models/unet3d_brats_model.pth")
        ]
        for path in model_paths:
            if not os.path.exists(path):
                raise HTTPException(status_code=503, detail="Model weights missing")
                
    return JSONResponse(content={"status": "ready", "inference_mode": inference_mode})

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
