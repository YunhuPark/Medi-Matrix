# 🧠 Medical 3D Vision & Time-series Multi-modal Triage System (Prototype)

> ⚠️ **주의 (Disclaimer)**
> 본 프로젝트는 의료용 진단 시스템이 아닙니다. **개인 포트폴리오 및 연구용 프로토타입**으로 개발되었습니다.
> 식별 가능한 실제 환자의 민감한 의료 데이터나 생체 신호(EMR/CSV)를 업로드해서는 안 됩니다.

의료 AI 영상 데이터(NIfTI, NumPy)를 파싱하여 브라우저 상에서 실시간 3D 그래픽으로 렌더링하고, 분석된 환자의 병변 체적 데이터와 **IMST-Mamba (시계열 패혈증 예측 모델 - 현재 데모/실험적 수준)** 데이터를 결합하여 최종 응급도(Triage) 라우팅 프로토타입을 구현하는 **멀티모달(Multi-modal) 마이크로서비스(MSA) 시스템**입니다.

단순한 2D 이미지 출력을 넘어, **3D 영상 부피 데이터와 환자의 시계열 생체 신호(ICU Vitals)를 융합하는 워크플로우 아이디어**를 프로토타입으로 시연합니다.

## ✨ 주요 기능 (Key Features)

### 1. 🏥 의료 포맷 파싱 지원 (`NIfTI` & `NumPy`)
일반적인 이미지 파일이 아닌, 3D 텐서 데이터인 **`.nii.gz` (NIfTI)** 포맷과 **`.npy`** 배열을 백엔드에서 파싱합니다.
- `nibabel` 라이브러리를 활용해 백엔드에서 원본 의료 데이터를 NumPy 3D 배열로 실시간 변환.

### 2. 🧊 Marching Cubes 알고리즘 기반 3D 메쉬 생성
3D 배열의 각 복셀(Voxel) 데이터를 폴리곤 메쉬로 추출합니다.
- `scikit-image`의 Marching Cubes 알고리즘을 사용해 병변의 표면 메쉬 계산.
- 추출된 메쉬를 웹 렌더링에 적합한 `GLB` 포맷으로 변환.

### 3. 🔒 보안 스토리지 (Private Storage) & JWT 인증
의료 메쉬 데이터를 안전하게 보호하기 위해 Supabase Auth 및 Private Storage를 사용합니다.
- **Supabase Auth**: 프론트엔드 로그인 및 JWT 기반 API 접근 제어.
- **Private Storage & 사용자 격리**: `{user_id}/{mesh_uuid}.glb` 구조로 사용자별 안전하게 격리 저장.
- **만료형 Signed URL**: 인증된 사용자만 접근할 수 있는 제한 시간(예: 10분) 만료형 Signed URL 발급.

### 4. 🚀 멀티모달(Multi-modal) Triage 프로토타입 (Mamba & WebSocket)
의료 영상과 시계열 생체 신호를 융합하는 데모 파이프라인입니다.
- **WebSocket 리플레이**: 환자의 CSV Vitals 데이터를 실시간 WebSocket으로 스트리밍.
- **Mamba 예측 모델 (Demo)**: IMST-Mamba의 시뮬레이터(또는 실험적 추론 구조)를 통해 실시간 패혈증, ARDS, 쇼크 등 예측 확률을 모의 산출.
- **Triage 평가**: 영상(Volume) + 시계열(Vitals) 데이터를 융합하여 `🔴 RED`, `🟡 YELLOW`, `🟢 GREEN` 응급도 라우팅을 실험적으로 시연.

---

## 📂 공모전 데모 데이터 (Synthetic Demo Datasets)

이 프로젝트는 심사 및 시연을 위해 **100% 코드로 생성된 합성 데이터(Synthetic Data)**를 제공합니다. 
> **주의**: 실제 환자 데이터는 절대로 업로드하지 마십시오. 본 데이터는 임상 진단용이 아닙니다.

### 데이터 생성 및 사용 방법
1. **생성 명령**:
   ```bash
   cd backend
   python scripts/generate_demo_data.py
   ```
2. **제공되는 시나리오**:
   - **생체신호 (Vitals)**: `synthetic_vitals_stable.csv`, `synthetic_vitals_warning.csv`, `synthetic_vitals_critical.csv` 3가지 위험도 단계를 시뮬레이션합니다.
   - **3D 영상**: `synthetic_brain_volume.nii.gz` (수학적 모델로 합성된 3D 팬텀 볼륨)

생성된 파일은 `backend/demo_datasets/generated/` 디렉터리에서 확인할 수 있으며, 이 데이터를 프론트엔드 UI를 통해 업로드하여 Triage 분석 흐름을 안전하게 테스트할 수 있습니다.

---

## 🏗️ 아키텍처 (Architecture)

```text
[ 클라이언트 (React + Vite) ] --- (Supabase Auth JWT 획득)
         │
         │  1. 의료 데이터 업로드 (.nii.gz / .npy) + JWT 인증
         ▼
[ 메인 서버 (FastAPI) ]
  ├─ nibabel: NIfTI 데이터 파싱
  ├─ scikit-image: Marching Cubes 3D 추출
  ├─ trimesh: GLB 파일 변환
  │
  ├─ 2. 메쉬 파일 저장 ──▶ [ Supabase Private Storage ] ({user_id} 격리 보관)
  ├─ 3. 만료형 Signed URL 발급 ──▶ 클라이언트에 반환 (Three.js 시각화)
  │
  └─ 4. Vitals CSV 업로드 및 WebSocket 실시간 스트리밍
         │
         ▼
[ IMST-Mamba (실험적 시뮬레이터) ]
  │
  └─ 5. 멀티모달 융합 평가 (병변 Volume + Mamba 추론 결과 = 응급도 도출)
```

---

## 🛠️ 기술 스택 (Tech Stack)

### Frontend
- **Framework**: Node 24, React 18 (TypeScript), Vite
- **3D Rendering**: Three.js, React Three Fiber, `drei`
- **Auth**: Supabase Auth (JWT)

### Backend
- **Framework**: Python 3.11, FastAPI, Uvicorn, WebSockets
- **Medical/Data**: `nibabel`, `numpy`
- **3D Processing**: `scikit-image` (Marching Cubes), `trimesh`
- **Security**: Supabase Storage (Private)

---

## ⚙️ 배포 및 실행 가이드 (How to run)

> **[안내] 현재 저장소에는 백엔드 배포(Dockerfile, Render/AWS 설정 등) 및 무중단 배포를 위한 설정이 포함되어 있지 않습니다.**
> 온라인에서 서비스하려면 프론트엔드(Vercel 등) 외에 **반드시** FastAPI/WebSocket 서버를 별도 호스팅해야 합니다.

### 1. 환경 변수 설정
`backend/.env.example`을 참고하여 프론트엔드와 백엔드에 각각 `.env` 파일을 생성하고 Supabase 키(URL, Role Key 등)를 입력합니다.

### 2. 프론트엔드 구동 (Port: 5173)
```bash
cd frontend
npm install
npm run dev
```

### 3. 백엔드 구동 (Port: 8000)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
