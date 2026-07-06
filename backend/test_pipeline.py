import numpy as np
import os
import sys
from fastapi.testclient import TestClient
from main import app

def run_test():
    # 1. 테스트용 3D 가짜 마스크 생성 (중앙에 위치한 구체 형태)
    print("Generating a dummy 3D mask (sphere)...")
    size = 64
    x, y, z = np.mgrid[-1:1:size*1j, -1:1:size*1j, -1:1:size*1j]
    radius = np.sqrt(x**2 + y**2 + z**2)
    # 구체 내부를 1, 외부를 0으로
    mask = (radius <= 0.5).astype(np.float32)
    
    npy_path = "mock_brain_mask.npy"
    np.save(npy_path, mask)
    print(f"Created dummy mask at {npy_path}")

    # 2. FastAPI TestClient를 사용해 API 엔드포인트 테스트
    client = TestClient(app)

    print("Sending POST request to /api/v1/process-mask ...")
    with open(npy_path, "rb") as f:
        # FastAPI UploadFile을 위해 파일 객체 형태로 전송
        response = client.post(
            "/api/v1/process-mask", 
            files={"file": ("mock_brain_mask.npy", f, "application/octet-stream")}
        )

    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print("Success! Response JSON:")
        import json
        print(json.dumps(data, indent=2))
    else:
        print("Failed. Response:")
        print(response.text)

    # 3. 정리
    if os.path.exists(npy_path):
        os.remove(npy_path)

if __name__ == "__main__":
    run_test()
