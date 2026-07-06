from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from dotenv import load_dotenv
from api.router import router as medical_router

load_dotenv()

app = FastAPI(title="Medical Image 3D Viewer API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(medical_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to Medical Image 3D Viewer API"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
