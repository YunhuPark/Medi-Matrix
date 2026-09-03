# Medi-Matrix — Wanted AI Championship 2026 Hardening Plan

## 목표

Medi-Matrix를 단순 파일 업로드 데모가 아니라 **병원 내에서 이미 생성되는 의료영상과 생체신호를 하나의 Case로 연결하고, 상태 악화가 감지되면 필요한 의료자원과 전원 병원 후보 탐색까지 이어지는 E2E 응급 의사결정 프로토타입**으로 정리한다.

> 이 프로젝트는 임상 진단 시스템이 아니다. 공개 심사용 데모는 합성 입력을 사용하며, 실제 의료기관 적용 전에는 별도의 임상 검증·규제 검토·병원 시스템 연동이 필요하다.

## P0 — 반드시 해결

### 1. 실제 사용 시나리오 재정의

잘못된 설명:

`환자 쓰러짐 → 구급차에서 MRI/CSV 수동 업로드 → 병원 추천`

목표 설명:

`응급실/의료기관 → PACS 영상 + EMR/Patient Monitor Vitals → Medi-Matrix Case → Triage Context → Golden-Time 전원 후보 탐색`

현재 `.nii/.csv` 수동 업로드는 병원 연동 전 단계의 **MVP 입력 어댑터**로 정의한다.

### 2. AI 범위 정직하게 분리

- 공개 `INFERENCE_MODE=demo`
  - MRI: 합성/결정론적 mask 기반 3D Vision 파이프라인
  - Vitals: 결정론적 위험 패턴 엔진
  - 목적: Auth → Storage → 3D → WebSocket → Triage → Golden-Time E2E 검증
- 실제 연구 검증
  - IMST-Mamba: PhysioNet Sepsis Challenge 2019 기반 연구 검증
- 다음 구현 목표
  - 실제 IMST-Mamba checkpoint 및 전처리 파이프라인을 Medi-Matrix SENSE 모듈에 연결

### 3. MRI/Vitals를 같은 Case로 묶기

새 데이터 모델:

```text
Case
├── case_id
├── user_id
├── modality
├── image/mesh context
├── vitals stream
├── triage state
└── transfer context
```

`patient_id`를 임상 환자 식별자로 오해하지 않도록 공개 데모에서는 `case_id` 중심으로 표현한다.

## P1 — 심사 UX

### 원클릭 Demo Case

첫 화면에서 심사위원이 별도 파일을 찾지 않아도 전체 흐름을 확인할 수 있도록 한다.

```text
Demo Case 실행
→ 합성 Brain Case 로드
→ 3D Mesh
→ 합성 Vitals Replay
→ YELLOW
→ RED
→ Golden-Time 버튼 활성화
```

직접 `.nii/.csv` 업로드는 Advanced/Manual Demo로 유지한다.

### 설명 가능한 Decision Engine

화면에 다음을 표시한다.

```text
Vitals risk       xx
Vision context   +xx
--------------------
Triage score      xx
→ YELLOW / RED
```

그리고 항상 다음 문구를 노출한다.

> 현재 임계값은 제품 E2E 흐름을 검증하기 위한 데모 정책이며 임상 기준이 아닙니다.

## P1 — 실제 IMST-Mamba 연결

현재 Medi-Matrix의 6개 Vitals CSV를 실제 IMST-Mamba 입력이라고 주장하지 않는다.

실제 IMST-Mamba 입력 구조는 다음을 포함한다.

- feature values `x`
- observation mask `m`
- staleness `s`
- inter-event gap `delta_t`
- attention mask

목표:

```text
Public ICU sequence
→ IMST-compatible preprocessing
→ trained checkpoint
→ sepsis risk
→ Medi-Matrix SENSE
```

MIMIC-IV는 이번 예선 필수 조건이 아니다. 우선 PhysioNet 2019로 검증된 IMST-Mamba의 실제 inference 연결을 완료하고, MIMIC-IV는 이후 external validation 단계로 둔다.

## P2 — 안정화

- Vercel / Render production E2E 점검
- Render cold-start 최소화 또는 명확한 loading UX
- 시크릿 모드에서 첫 방문부터 테스트
- CI 유지: backend pytest, frontend lint/test/build
- README와 실제 dependency/version/동작 모드 표현 일치

## 제출 시 핵심 설명

> Medi-Matrix는 병원에서 생성되는 의료영상과 시계열 생체신호를 하나의 Case로 연결해 환자 상태 변화를 파악하고, 필요한 의료자원을 정의한 뒤 Golden-Time의 공개 응급의료 자원 정보와 연결해 전원 병원 후보 탐색까지 이어지는 E2E 응급 의사결정 프로토타입입니다. 현재 공개 데모는 개인정보 보호와 재현성을 위해 합성 입력을 사용합니다.
