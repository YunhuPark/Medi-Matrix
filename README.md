# Medi-Matrix — 중증환자 전원 의사결정 지원 AI

> **Disclaimer**
> Medi-Matrix는 의료 진단 시스템이 아니라 개인 포트폴리오 및 연구용 비임상 프로토타입입니다. 실제 환자 식별정보나 민감한 의료 데이터를 공개 데모에 업로드해서는 안 됩니다. 공개 데모의 영상(Vision) 입력은 합성/결정론적 데모이며, Vitals AI는 별도 provenance를 통해 실제 학습 모델과 demo scorer를 구분합니다. 모든 Triage/전원 자원 매핑은 임상 기준이 아닌 데모 정책입니다.

Medi-Matrix는 중증환자를 다른 병원으로 전원해야 할 때, 의료영상과 Vitals를 하나의 Case Context로 정리하고 현재 환자에게 필요한 의료자원을 도출한 뒤 Golden-Time의 공개 응급의료 자원 정보와 연결해 전원 병원 후보 탐색까지 이어지는 E2E 의사결정 지원 프로토타입입니다.

```text
PACS / 의료영상 ─┐
                 ├─> Medi-Matrix Case -> AI Risk / Triage Context -> 필요한 의료자원
EMR / Vitals ────┘                                         |
                                                           v
                                  Golden-Time -> 공개 응급의료 자원 기반 후보 탐색/랭킹
```

현재 `.nii/.npy/.csv` 업로드는 병원 PACS/EMR 연동 전 단계의 **MVP 입력 어댑터**입니다.

## 현재 공개 배포 상태

- Frontend: https://medi-matrix.vercel.app
- Backend: `medi-matrix-backend-preview` Render Web Service
- Vision inference: `INFERENCE_MODE=demo`
- Vitals inference: `VITALS_INFERENCE_MODE=model`
- Vitals model: `vitals_gru_challenge2019_v1`
- Clinical use: `false`

즉 공개 배포에서 **Vision은 합성/결정론적 데모**, **Vitals는 실제 PyTorch GRU 모델 추론**으로 동작합니다. 두 영역의 검증 수준을 동일하게 표현하지 않습니다.

## Vitals AI

Vitals 모델은 PhysioNet / Computing in Cardiology Challenge 2019 데이터를 사용해 학습한 Causal GRU입니다.

- 입력 기본 Vitals: HR, SBP, DBP, Resp, Temp, SpO2
- 모델 입력: 값 + 관측 여부 + recency + 시간 특성, 총 19 features
- Target: official `SepsisLabel`
- Split: patient-level stratified 70/15/15, seed 42
- Threshold: validation patients에서 normalized Challenge Utility를 최대화하도록 선택
- Test AUROC: **0.7946**
- Test AUPRC: **0.0950**
- Test Challenge Utility: **0.3451**
- Test sensitivity: **0.5602**
- Test specificity: **0.8582**

모델 산출물과 전처리/평가 메타데이터는 `backend/models/vitals_gru_challenge2019_v1/`에 포함되어 있습니다.

중요한 제한:
- 실제 임상 검증 모델이 아닙니다.
- 공개 UI의 threshold는 비임상 연구/데모 기준입니다.
- model mode에서 ARDS/shock 확률을 임의 생성하지 않습니다.

## 주요 기능

### 1. Case 기반 Imaging + Vitals 연결

의료영상과 시계열 생체신호를 하나의 Case Context로 묶고 실시간 상태 변화, Triage, 전원 탐색 조건을 같은 흐름에서 관리합니다.

### 2. 3D 의료영상 데모 파이프라인

- `.nii.gz`, `.npy` 3D 배열 파싱
- `nibabel`, `numpy`
- Marching Cubes 기반 mesh 추출
- `GLB` 변환 및 Three.js 렌더링

현재 공개 Vision 결과는 합성 입력과 deterministic/demo inference를 사용합니다. 실제 임상 segmentation 성능을 주장하지 않습니다.

### 3. 실제 Vitals GRU + WebSocket

- Vitals sequence를 Case WebSocket으로 스트리밍
- 실제 `vitals_gru_challenge2019_v1` 추론
- `ai_risk` payload에 `model_id`, `threshold`, `source`, `target`, `inference_mode`, `clinical_use` 포함
- 프론트엔드가 model/demo provenance를 명확히 구분

### 4. Grounded AI Transfer Brief

GRU provenance와 threshold evidence를 바탕으로 비임상 Transfer Brief를 구성합니다. LLM이 임의로 생성하는 요약이 아니라 현재 모델 근거를 결정론적으로 연결합니다.

### 5. 전원 자원 조건 -> Golden-Time handoff

현재 Case의 데모 Triage와 영상 Context에서 필요한 자원을 구조적으로 도출합니다.

예시 Brain YELLOW:
- ICU
- brain imaging
- neurosurgery
- neurology

RED에서는 여기에 emergency room, emergency medicine, internal medicine 등 전신 악화 대응 자원이 추가됩니다.

Medi-Matrix는 `resourceContract=transfer_resources_v1`과 allowlisted `capabilities` / `specialties`를 Golden-Time으로 전달합니다. Golden-Time은 실제 E-Gen 기반 병원 데이터의 응급실 병상, ICU, CT/MRI, 진료과 등의 가용 정보와 매칭해 후보 랭킹에 반영합니다.

이 결과는 자동 전원 결정이 아니라 **후보 탐색/우선순위 지원**입니다.

## 보안 및 데모 세션

- Supabase Auth JWT
- Private Storage
- 사용자별 파일 격리
- 만료형 Signed URL
- 익명 공모전 demo session도 정식 JWT를 사용하며 인증/격리를 우회하지 않음
- Golden-Time handoff URL에 access token, authorization, patient ID, mesh ID, signed URL 등을 전달하지 않음

## 공모전 데모 데이터

공개 심사 UX는 개인정보 보호와 재현성을 위해 synthetic demo input을 사용합니다.

```bash
cd backend
python scripts/generate_demo_data.py --force --package
```

생성 결과:
- `backend/demo_datasets/generated/`
- `contest_artifacts/Medi-Matrix_Contest_Demo.zip`

생성 산출물은 Git에 추적하지 않습니다.

## Production E2E 검증 범위

브라우저 기반 production smoke에서 다음 경로를 검증했습니다.

```text
Sample Case
-> authenticated demo bootstrap
-> WebSocket
-> real Vitals GRU provenance
-> AI Risk UI
-> Grounded Transfer Brief
-> structured transfer resources
-> Golden-Time popup handoff
-> Golden-Time RED/YELLOW context UI receipt
```

검증 대상 production URL은 `https://medi-matrix.vercel.app`입니다.

라이브 E-Gen 병원 카드 하나가 실제로 특정 자원과 매칭되었다는 것까지 브라우저 E2E에서 고정 assertion한 것은 아닙니다. explicit resource -> ranking 로직은 Golden-Time의 테스트로 별도 검증합니다.

## 기술 스택

### Frontend
- React 18
- TypeScript
- Vite
- Three.js / React Three Fiber / drei

### Backend
- Python 3.11
- FastAPI / Uvicorn / WebSockets
- PyTorch
- nibabel / numpy
- scikit-image / trimesh
- Supabase Auth / Private Storage

### Deployment
- Frontend: Vercel
- Backend: Render Docker Web Service
- Storage/Auth: Supabase

## 로컬 실행

### 1. 환경 변수

`backend/.env.example` 및 프론트엔드 환경 변수 예시를 참고해 로컬 `.env`를 구성합니다. 비밀키는 Git에 커밋하지 않습니다.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Backend — demo 중심 기본 실행

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Vitals model mode

Vitals 실제 모델 추론에는 ML 의존성과 모델 artifact가 필요합니다. 현재 배포 Docker 구성은 Vitals 모델 artifact와 ML requirements를 포함하도록 구성되어 있습니다.

주요 환경 변수:

```text
APP_ENV=production
INFERENCE_MODE=demo
VITALS_INFERENCE_MODE=model
VITALS_MODEL_PATH=backend/models/vitals_gru_challenge2019_v1/model.pt
ALLOWED_ORIGINS=https://medi-matrix.vercel.app
```

Vision과 Vitals inference mode는 서로 독립적입니다. `INFERENCE_MODE=demo`라고 해서 Vitals까지 demo라는 뜻은 아닙니다.

## 프로젝트 경계

현재 안전하게 주장할 수 있는 범위:

- 실제 PhysioNet 기반 GRU Vitals inference가 배포 환경에서 로드되고 추론됨
- 브라우저 production E2E에서 해당 model provenance가 UI까지 전달됨
- Vision은 synthetic/deterministic demo
- Transfer Brief는 model evidence를 기반으로 한 deterministic support summary
- Golden-Time은 공개 응급의료 자원과 구조화된 transfer requirement를 연결하는 후보 탐색 시스템

주장하지 않는 범위:

- 임상 진단/임상 검증 완료
- 실제 환자에서 검증된 same-patient multimodal AI
- Vision의 실제 임상 segmentation 성능
- 자동 최적 병원 결정
- 자동 전원 지시

## 제출 자료

Wanted AI Championship 2026 제출용 최종 문구와 5장 스크린샷 storyboard는 `docs/AI_CHAMPIONSHIP_2026_SUBMISSION.md`를 참고하세요.
