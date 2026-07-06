# 🧠 Medical 3D Vision & Time-series Multi-modal Triage System

의료 AI 영상 데이터(NIfTI, NumPy)를 파싱하여 브라우저 상에서 실시간 3D 그래픽으로 렌더링하고, 분석된 환자의 병변 체적 데이터와 **IMST-Mamba (시계열 패혈증 예측 모델)** 데이터를 결합하여 최종 응급도(Triage)를 산출하는 **멀티모달(Multi-modal) 마이크로서비스(MSA) 시스템**입니다.

단순한 2D 이미지 출력을 넘어, **3D 영상 부피 데이터와 환자의 시계열 생체 신호(ICU Vitals)를 융합하여 응급도를 자동 라우팅하는 실제 임상 워크플로우**를 구현했습니다.

## ✨ 주요 기능 (Key Features)

### 1. 🏥 임상 표준 의료 포맷 지원 (`NIfTI` & `NumPy`)
일반적인 이미지 파일이 아닌, MRI/CT 등에서 사용되는 3D 텐서 데이터인 **`.nii.gz` (NIfTI)** 포맷과 **`.npy`** 배열을 직접 파싱합니다.
- `nibabel` 라이브러리를 활용해 백엔드에서 원본 의료 데이터를 NumPy 3D 배열로 실시간 변환.

### 2. 🧊 Marching Cubes 알고리즘 기반 실시간 3D 렌더링
3D 배열의 각 복셀(Voxel) 데이터를 폴리곤 메쉬로 추출합니다.
- `scikit-image`의 Marching Cubes 알고리즘을 사용해 병변의 표면 메쉬 계산.
- 추출된 메쉬를 웹에서 가장 빠르게 렌더링되는 `GLB` 포맷으로 직렬화 및 최적화.

### 3. ☁️ 클라우드 스토리지 (Supabase) 및 React Three Fiber 시각화
용량이 큰 3D 모델을 브라우저 부하 없이 서빙하기 위한 클라우드 아키텍처.
- 생성된 GLB 메쉬를 **Supabase Storage**에 비동기 업로드 후 CDN Public URL 발급.
- 프론트엔드에서는 `Three.js` (React Three Fiber)를 활용해 병변을 시각화하고 줌/회전 인터랙션 제공.

### 4. 🚀 멀티모달(Multi-modal) 마이크로서비스 Triage (IMST-Mamba 융합)
뷰어와 분류 시스템의 결합도를 낮추기 위해 완전 분리된 독립 서버 2대를 구축.
- **Project A (Viewer Server)**: 3D 모델 생성, 체적(Volume) 계산 후 **Project B**로 Webhook 발송.
- **Project B (Triage Mock Server)**: Webhook 수신 시, 환자의 EMR 시계열 데이터를 가상 조회하여 **IMST-Mamba** 딥러닝 모델의 "패혈증 예측 확률(Sepsis Probability)"을 추론.
- **멀티모달 융합**: 영상(Volume) + 시계열(Sepsis) 데이터를 종합 평가하여 `🔴 RED`, `🟡 YELLOW`, `🟢 GREEN`으로 환자를 자동 라우팅.

---

## 🏗️ 아키텍처 (Architecture)

```text
[ 클라이언트 (React + Vite) ]
         │
         │  1. 의료 데이터 업로드 (.nii.gz / .npy)
         ▼
[ 메인 서버 - Project A (FastAPI) ]
  ├─ nibabel: NIfTI 데이터 파싱
  ├─ scikit-image: Marching Cubes 3D 추출
  ├─ trimesh: GLB 파일 포맷 변환 및 바이너리 압축
  │
  ├─ 2. 메쉬 파일 저장 ──▶ [ Supabase Cloud Storage ] ──▶ 3. 모델 URL 프론트 반환 (Three.js 렌더링)
  │
  └─ 4. 병변 체적 데이터 기반 Webhook 발송
         │
         ▼
[ 응급 분류 서버 - Project B (FastAPI) ] --- (독립된 Microservice)
  │
  ├─ [ IMST-Mamba (Sepsis Prediction Model) ] ── 환자 생체신호(Vitals) EMR 데이터 조회 및 추론
  │    └─ "패혈증(Sepsis) 발병 확률 85%" 산출
  │
  └─ 5. 멀티모달(Multi-modal) 융합 평가
       ▶ 3D 병변 체적(Volume) + 패혈증 예측 확률(Sepsis) = 최종 라우팅 결정 (RED/YELLOW/GREEN)
```

---

## 🛠️ 기술 스택 (Tech Stack)

### Frontend
- **Framework**: React 18 (TypeScript), Vite
- **3D Rendering**: Three.js, React Three Fiber, `drei`
- **Styling**: Vanilla CSS (Premium Glassmorphism Dark Theme)

### Backend (MSA)
- **Framework**: FastAPI (Python), Uvicorn
- **Medical/Data**: `nibabel`, `numpy`, `scipy`
- **3D Processing**: `scikit-image` (Marching Cubes), `trimesh`
- **Database/Storage**: Supabase

---

## ⚙️ 시작 가이드 (How to run)

본 프로젝트는 마이크로서비스 구조이므로 **3개의 터미널**에서 각각 다른 서비스를 구동해야 합니다.

### 1. 프론트엔드 구동 (Port: 5173)
```bash
cd frontend
npm install
npm run dev
```

### 2. 메인 뷰어 백엔드 구동 (Project A, Port: 8000)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. 가상 응급 라우팅 서버 구동 (Project B, Port: 8001)
```bash
cd triage_mock_server
pip install fastapi uvicorn pydantic
python -X utf8 main.py
```

> **데모 테스트 방법**:
> 서버를 모두 띄운 후 `http://localhost:5173` 에 접속합니다.
> `backend/demo_datasets` 폴더 내에 미리 생성된 실제 종양 형태의 `brain_tumor_demo.nii.gz` 파일을 업로드하여 3D 렌더링과 Triage 시스템 연동 로그(8001 포트 터미널)를 확인해 보세요!
