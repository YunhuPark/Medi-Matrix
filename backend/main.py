from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv
from api.router import router as medical_router

load_dotenv()

app = FastAPI(title="Medical Image 3D Viewer API")

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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
