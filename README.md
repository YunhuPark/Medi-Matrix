# Medi-Matrix

> **의료영상과 Vitals를 하나의 Case로 연결해 중증환자의 병원 간 전원 후보 탐색까지 이어주는 의사결정 지원 프로토타입**

⚠️ Medi-Matrix는 의료기기, 임상 진단 시스템 또는 자동 전원 지시 시스템이 아닙니다. 현재 공개 배포는 **합성 입력 기반 공모전 프로토타입**이며 `INFERENCE_MODE=demo`로 동작합니다. 식별 가능한 실제 환자 데이터를 공개 데모에 업로드하지 마십시오.

## 1. 해결하려는 문제

Medi-Matrix의 타깃은 **119 현장에서 처음 병원을 찾는 상황이 아니라**, 환자가 이미 지역 응급실에 도착해 영상과 Vitals가 확보된 뒤 더 높은 수준의 치료를 위해 상급병원 전원을 검토해야 하는 상황입니다.

이때 문제는 단순히 가까운 병원을 찾는 것이 아닙니다.

- 영상에서 확인된 병변 Context가 무엇인지
- 시간에 따라 Vitals가 어떻게 변하고 있는지
- 현재 상태에서 어떤 의료자원을 추가로 확인해야 하는지
- 그 자원을 제공할 수 있는 병원 후보가 어디인지

를 하나의 흐름으로 연결해야 합니다.

Medi-Matrix는 이 과정에서 **환자 상태 Context를 구조화하고 필요한 의료자원 조건을 만드는 역할**을 담당합니다. 이후 별도 프로젝트 Golden-Time이 E-Gen 공개 응급의료 가용자원과 위치 정보를 활용해 병원 후보 탐색을 지원합니다.

## 2. 현실 적용 시나리오

```text
지역 응급실
  │
  ├─ PACS/DICOM ───────────────▶ CT/MRI 영상
  ├─ EMR/FHIR·Bedside Monitor ─▶ Vitals 시계열
  │
  ▼
Hospital Encounter
  │
  └─ Medi-Matrix 내부 비식별 Case ID로 매핑
         │
         ├─ Vision Context: 3D 병변 정보
         ├─ Time-series Context: Vitals 변화
         └─ Demo Decision Policy: GREEN / YELLOW / RED
                   │
                   ▼
         필요한 의료자원 조건 구성
                   │
                   ▼
           Golden-Time + E-Gen
                   │
                   ▼
             전원 병원 후보 탐색
```

현재 공개 MVP에서 `.nii/.nii.gz/.npy` 및 `.csv`를 업로드하는 UI는 **병원 시스템 연동 전 테스트 어댑터**입니다. 실제 적용 단계에서는 의료진이 파일을 직접 찾아 올리는 방식이 아니라 PACS, EMR/FHIR 또는 환자 모니터링 시스템과의 기관별 연동 계층이 필요합니다.

또한 전국 환자 의료데이터가 하나의 중앙 DB에 존재한다고 가정하지 않습니다. 병원 내부 시스템에 분산된 데이터를 해당 기관의 Encounter와 안전하게 연결하는 구조를 목표로 합니다.

## 3. 현재 공개 데모에서 확인할 수 있는 것

### One-click Transfer Demo

공개 심사 환경에서는 **`Demo Case 한 번에 실행`** 버튼으로 번들된 합성 Brain 영상과 Vitals 시계열을 하나의 비식별 Case에 자동 연결합니다.

```text
Synthetic Brain input
        +
Synthetic progressive Vitals
        ↓
MM-XXXXXXXX Case
        ↓
3D Vision Context
        ↓
Vitals WebSocket Replay
        ↓
GREEN → YELLOW → RED
        ↓
Decision Engine 설명
        ↓
Golden-Time 전원 후보 탐색 Context
```

Case ID는 `MM-XXXXXXXX` 형태의 비식별 데모 식별자이며 환자명, MRN, 생년월일 등을 포함하지 않습니다.

### Explainable Demo Decision Engine

공개 데모는 임상 가이드라인이나 검증된 triage 규칙을 주장하지 않습니다. 화면에는 다음 계산 구성요소를 명시적으로 보여줍니다.

```text
Vitals risk
+ limited Vision context
------------------------
Demo Triage score
```

현재 데모 정책:

- `YELLOW >= 0.25`
- `RED >= 0.75`
- `clinical_rule = false`

이 임계값은 **E2E 제품 흐름을 재현하기 위한 데모 정책**이며 의료 판단 기준이 아닙니다.

## 4. AI / 데이터 범위 구분

Medi-Matrix는 연구 모델, 공개 제품 데모, 실제 공개 의료자원 데이터를 구분합니다.

### 공개 Medi-Matrix 데모

- 환자 입력: 합성 Brain/NIfTI + 합성 Vitals
- MRI demo mode: 실제 임상 병변 segmentation이 아니라 합성 3D Context 생성
- Vitals demo mode: 결정론적 Sepsis-like / ARDS-like / Shock-like 위험 패턴 점수
- 목적: `Vision → Vitals → Triage Context → Hospital Search` E2E 제품 흐름 검증

### IMST-Mamba 연구

IMST-Mamba는 ICU 시계열에서 결측과 시간 간격을 함께 다루기 위해 별도 저장소에서 구현·평가한 연구 모델입니다. Medi-Matrix의 `IMST-Mamba` submodule은 현재 연구 저장소의 commit `d8e5762b72f2b9e812b1ae5d8036c290c024781b`를 가리킵니다.

호환성 감사 결과, 실제 연구 모델과 과거 Medi-Matrix `model` 경로는 서로 다른 계약을 사용하고 있었습니다.

| 항목 | 실제 IMST-Mamba 연구 | 과거 Medi-Matrix model 경로 |
|---|---|---|
| 입력 feature | 34개 (8 Vitals + 26 Labs) | 6개 Vitals |
| 추가 입력 | 관측 mask, 시간 간격, missingness recency, attention mask | 없음 |
| 주요 출력 | 시점별 Sepsis probability | Sepsis/ARDS/Shock 3개 출력 |
| 구조 | IMST-Mamba blocks + missingness/time encoding | 2-layer fully-connected dummy network |

따라서 기존 `backend/models/imst_mamba_systemic_model.pth`는 실제 IMST-Mamba 연구 checkpoint로 취급할 수 없으며 hardening branch에서 제거했습니다. `INFERENCE_MODE=model` 역시 현재는 **fail-closed** 하도록 막아 두었습니다. 검증된 연구 checkpoint, 동일 normalization statistics, 34-feature preprocessing adapter가 모두 연결되기 전에는 model mode를 활성화하지 않습니다.

현재 배포 화면에서 **“IMST-Mamba가 실제 환자의 패혈증을 실시간 진단한다”**고 주장하지 않습니다. 연구 모델을 제품 SENSE 모듈에 연결하는 작업은 별도의 검증 단계입니다.

### Golden-Time / E-Gen

Golden-Time 단계는 E-Gen의 공개 응급의료 가용자원 정보를 활용합니다. Medi-Matrix가 자동으로 전원을 확정하거나 병원 수용을 보장하지 않으며, **환자 Context에 맞는 후보 탐색을 지원**하는 범위로 제한합니다.

## 5. 주요 기능

### Case / Encounter Context

- 비식별 `MM-XXXXXXXX` Case 생성
- 영상 + Vitals + Triage Context를 하나의 Case로 연결
- Supabase 저장 경로를 사용자와 Case 단위로 격리
- 향후 병원 Encounter ID와 서버 측 매핑 가능한 구조

### 3D Vision Pipeline

- NIfTI (`.nii`, `.nii.gz`) / NumPy (`.npy`) 입력
- `nibabel`, `numpy`
- `scikit-image` Marching Cubes
- `trimesh` GLB 생성
- Three.js / React Three Fiber 브라우저 렌더링

### Vitals Replay

- CSV 시계열 검증
- Case 단위 Private Storage
- 인증된 WebSocket 연결
- Vitals 변화 및 demo risk pattern 스트리밍

### Transfer Context

- YELLOW: 영상·수술 자원 중심 후보 사전 확인 시나리오
- RED: 응급실·ICU 등 전신악화 대응 자원까지 추가하는 시나리오
- Golden-Time으로 현재 Context 전달
- 최종 의료진 판단과 병원 간 수용 절차를 대체하지 않음

## 6. 보안 설계

공개 프로토타입에서도 다음 경계를 유지합니다.

- Supabase Auth JWT
- 로그인 화면 없는 익명 심사 세션도 정식 JWT 발급
- Private Storage
- 사용자/Case 단위 데이터 경로 분리
- 만료형 Signed URL
- 업로드 크기·확장자·데이터 타입·행 수 검증
- NumPy `allow_pickle=False`
- WebSocket Origin/JWT 검증
- Rate Limit
- 임시 파일 cleanup

실제 병원 적용에는 추가로 기관 인증, 세분화된 RBAC, 감사 로그, 데이터 보존/삭제 정책, 전송·저장 암호화 검토, 기관 보안심사 및 규제 검토가 필요합니다.

## 7. 기술 스택

### Frontend

- React 19
- TypeScript
- Vite
- Three.js
- React Three Fiber / drei
- Zustand
- TanStack Query

### Backend

- Python 3.11
- FastAPI
- Uvicorn
- WebSocket
- nibabel / NumPy
- scikit-image / trimesh

### Auth / Storage / Deployment

- Supabase Auth
- Supabase Private Storage
- Vercel — frontend
- Render — backend

## 8. API 흐름

### Case 기반 신규 흐름

```text
POST /api/v1/cases
POST /api/v1/cases/{case_id}/process-mri
POST /api/v1/cases/{case_id}/vitals
WS   /api/v1/cases/{case_id}/triage/stream
```

### 공모전 One-click Demo

```text
POST /api/v1/demo/transfer-case
```

서버에 포함된 합성 입력만 사용해 Case + 영상 Context + Vitals 연결을 준비하며, 이후 Case 전용 WebSocket으로 Replay를 시작합니다.

## 9. 실행

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

### Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

환경 변수는 `backend/.env.example` 및 frontend 환경 설정을 참고하십시오.

## 10. 배포

- Frontend: https://medi-matrix.vercel.app
- Backend: Render Docker Web Service
- Storage/Auth: Supabase

Production backend에는 최소 다음 설정이 필요합니다.

```text
APP_ENV=production
INFERENCE_MODE=demo
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
SUPABASE_STORAGE_BUCKET=medical-meshes
SUPABASE_VITALS_BUCKET=medical-vitals
ALLOWED_ORIGINS=https://medi-matrix.vercel.app
```

## 11. 다음 검증 단계

1. IMST-Mamba 연구 checkpoint + normalization stats 확보 및 provenance 고정
2. PhysioNet 2019과 동일한 34-feature preprocessing adapter를 Medi-Matrix SENSE 입력 경계에 별도 구현
3. 연구 저장소와 동일 입력에 대해 offline parity test를 통과한 뒤에만 model mode 활성화
4. 실제 공개 MRI/segmentation dataset을 이용한 Vision pipeline 검증
5. IMST-Mamba의 별도 ICU dataset 외부 검증
6. 동일 환자의 영상 + Vitals가 연결된 연구 데이터로 진정한 multimodal validation
7. PACS/DICOM 및 EMR/FHIR adapter PoC
8. 실제 병원 workflow를 가정한 Silent Pilot / prospective validation 설계

## 12. 프로젝트 경계

Medi-Matrix가 목표로 하는 것은 **AI가 환자의 진단과 전원을 대신 결정하는 것**이 아닙니다.

목표는 의료진이 중증환자의 상태와 필요한 자원을 더 빠르게 한 흐름에서 파악할 수 있도록:

> **SEE — 영상 Context를 보고**  
> **SENSE — 시간에 따른 Vitals 변화를 확인하고**  
> **ACT — 필요한 자원을 기준으로 전원 후보 탐색까지 연결하는 것**

입니다.
