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

## 📂 공모전 심사용 합성 데이터 (Synthetic Demo Datasets)

이 프로젝트는 심사 및 시연을 위해 **100% 코드로 생성된 합성 데이터(Synthetic Data)**를 제공합니다. 
> **주의**: 실제 환자 데이터는 절대로 업로드하지 마십시오. 본 데이터는 임상 진단용이 아닙니다.
> 최종 출품작 설명서에서 본 합성 데이터를 포함한 **Google Drive 링크**를 제공할 예정입니다.

### 데이터 생성 및 패키지 생성 방법 (로컬)
1. **생성 명령**:
   ```bash
   cd backend
   python scripts/generate_demo_data.py --force --package
   ```
2. **생성 결과**:
   - `backend/demo_datasets/generated/` 내에 개별 파일들이 생성됩니다.
   - `contest_artifacts/Medi-Matrix_Contest_Demo.zip` 패키지가 생성됩니다.
   - **주의**: 생성 산출물(`.csv`, `.nii.gz`, `.npy`, `.zip` 등)은 Git에 추적(Commit)되지 않습니다.

생성된 파일 또는 출품작 설명서의 ZIP 파일을 해제한 후, 프론트엔드 UI를 통해 직접 업로드하여 Triage 분석 흐름을 테스트할 수 있습니다.

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

### Backend
- **Framework**: Python 3.11, FastAPI, Uvicorn, WebSockets
- **Medical/Data**: `nibabel`, `numpy`
- **3D Processing**: `scikit-image` (Marching Cubes), `trimesh`
- **Security**: Supabase Auth (JWT), Storage (Private)
- **Private Storage**: Supabase를 사용하여 사용자별(`.csv`, `.npy`) 파일 격리 보안 정책 적용 (1:1 격리)

### 공모전 UX: Frictionless Authenticated Demo Session
- 기본 공모전 UX는 로그인(이메일/비밀번호) 화면 없는 익명 인증 데모로 제공됩니다.
- 익명 사용자도 Supabase JWT를 정식으로 발급받아 사용하므로 **백엔드의 인증, Private Storage 사용자 격리, Rate Limit을 절대 우회하지 않습니다.**
- 이 익명 계정은 브라우저 저장소 초기화 시 복구할 수 없는 일회성 데모 세션으로 기능합니다.
- **실제 환자 데이터 사용 금지**: 모든 시연은 합성 데모 데이터를 사용해야 합니다.
- 공개 배포 시에는 CAPTCHA 및 일정 시간 지난 익명 사용자 정리 정책 도입을 권장합니다.

## Deployment Status
- **Frontend (Vercel)**: React 프론트엔드 배포 완료 (`https://[VERCEL_DOMAIN]`)
- **Backend (Render)**: Docker Web Service 기반 배포 준비 완료 (`render.yaml` 포함)
  - *참고*: 모델 로드 과정 등을 고려할 때 Render 인스턴스의 메모리가 최소 1GB~2GB 이상 필요할 수 있습니다.
- **Storage (Supabase)**: Auth 및 Private Storage 적용 완료

## Supabase Dashboard 필수 설정
배포 시 다음 설정이 반드시 필요합니다:
1. **Authentication > Providers**: `Anonymous Sign-Ins` 활성화
2. **Storage**: `medical-vitals` 및 `medical-meshes` 버킷 생성
3. **Storage Policies**: 사용자 식별자 기반 데이터 접근을 허용하는 RLS 및 파일 격리 정책 생성(Private)

---

## ⚙️ 배포 및 실행 가이드 (How to run)

> **[안내] 현재 저장소에는 Dockerfile과 Render 배포용 설정(`render.yaml`)이 포함되어 있습니다.**
> 프론트엔드(Vercel 등) 외에 **반드시** 백엔드를 별도 호스팅해야 합니다.

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


## Render 배포 (백엔드)

본 저장소는 백엔드(FastAPI)와 프론트엔드(React/Vite)가 분리 배포되는 구조입니다. 프론트엔드는 Vercel에, 백엔드는 Render에 배포할 수 있습니다.

### Demo 모드와 Model 모드
- **Demo 모드**: `INFERENCE_MODE=demo` (기본값). 임상 진단 모델을 사용하지 않고 시뮬레이터를 통해 결정론적 결과를 보여줍니다. PyTorch를 포함하지 않으며, Render Free 등 메모리가 제한된 환경에서도 실행될 수 있습니다 (실제 메모리 사용량은 Docker 런타임 결과 참조).
- **Model 모드**: `INFERENCE_MODE=model`. 실제 PyTorch 모델(UNet3D, Mamba)을 로드합니다. 별도 ML 의존성이 필요하며 Out of Memory (OOM)를 피하기 위해 **최소 2GB 이상의 유료 인스턴스(Standard)**를 권장합니다. Docker 빌드 시 `INSTALL_ML=true` 옵션이 필요합니다.

### Supabase 스토리지
- medical-meshes: 3D 모델(GLB) 파일 저장
- medical-vitals: 환자 시계열 데이터(CSV) 임시 저장 (로컬 파일 시스템 의존성 제거를 위해 필수)

### 환경 변수 안내
백엔드 배포 플랫폼(Render) 설정에 다음 환경변수를 등록해야 합니다:
- `APP_ENV=production`
- `INFERENCE_MODE=demo` (실제 운영 시 model 변경 후 재빌드)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET=medical-meshes`
- `SUPABASE_VITALS_BUCKET=medical-vitals`
- `ALLOWED_ORIGINS=https://내프론트엔드도메인.vercel.app`
