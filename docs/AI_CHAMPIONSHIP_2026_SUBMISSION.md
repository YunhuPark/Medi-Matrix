# Medi-Matrix — Wanted AI Championship 2026 Submission Pack

## 1. 제출 제목

**Medi-Matrix — 중증환자 전원 의사결정 지원 AI**

대중/투표용 대체 제목:

**Medi-Matrix — 응급환자에게 필요한 병원을 더 빠르게 찾는 AI**

---

## 2. 해결하려는 문제

### 짧은 버전

중증환자 전원 과정에서 흩어진 의료영상과 Vitals를 하나의 환자 Context로 정리하고, 현재 환자에게 필요한 의료자원을 기준으로 전원 가능한 병원 후보를 빠르게 탐색하기 어렵다는 문제를 해결합니다.

### 제출용 본문

중증환자를 상급병원으로 전원할 때 의료영상, 생체신호, 병원 수용 자원이 서로 분리되어 있어 환자 상태를 다시 파악하고 적합한 병원을 찾는 데 시간이 소요됩니다. Medi-Matrix는 영상과 Vitals를 하나의 Case Context로 연결하고, 현재 상태에서 필요한 의료자원을 구조화한 뒤 Golden-Time의 공개 응급의료 자원 정보와 연결해 전원 병원 후보 탐색까지 이어지는 의사결정 지원 프로토타입입니다.

---

## 3. AI 활용 및 결과

PhysioNet/Computing in Cardiology Challenge 2019의 실제 ICU 시계열 데이터를 이용해 조기 악화 위험 예측 모델을 구축했습니다. Logistic Regression, Temporal XGBoost, GRU, compact IMST-Mamba를 동일한 환자 단위 분할 및 Challenge Utility 평가 조건으로 비교했고, 최종 서비스 통합 후보로 GRU를 선택했습니다.

현재 저장소의 `vitals_gru_challenge2019_v1` held-out test 결과는 다음과 같습니다.

- AUROC: **0.7946005008**
- AUPRC: **0.0950005813**
- Challenge Utility: **0.3451295898**
- Sensitivity: **0.5601719198**
- Specificity: **0.8581747465**
- Validation-selected threshold: **0.5996291004**

배포 환경에서는 다음 흐름을 실제 Production E2E로 검증했습니다.

`Demo Case → Vitals WebSocket → 실제 GRU model inference provenance → AI Risk UI → Grounded AI Transfer Brief → 구조화된 전원 자원 조건 → Golden-Time handoff → Golden-Time UI 수신`

Production E2E에서 확인된 대표 provenance:

- `inference_mode=model`
- `model_id=vitals_gru_challenge2019_v1`
- `clinical_use=false`
- `resourceContract=transfer_resources_v1`

중요: 이 모델과 threshold는 비임상 연구/프로토타입 용도이며, 실제 임상 진단이나 자동 전원 결정을 위한 검증을 완료한 시스템이 아닙니다.

---

## 4. 서비스 링크

**https://medi-matrix.vercel.app**

Golden-Time 연계 서비스:

**https://golden-time.vercel.app**

---

## 5. 제출용 대표 화면 5장

공모전 제출 화면은 기능 나열보다 하나의 전원 의사결정 흐름이 이어지도록 구성합니다.

### 1장 — 전체 문제와 Case 흐름

목표:

`Imaging + Vitals → AI Context → 필요한 의료자원 → Hospital Candidate Search`

캡처 포인트:

- Medi-Matrix 메인 화면
- 영상 Context와 Vitals가 하나의 Case로 연결되는 구조가 보이는 상태
- `Demo Case` 진입점이 보이도록 캡처

제출 캡션:

**의료영상과 Vitals를 하나의 Case Context로 연결해 전원 판단에 필요한 정보를 한 화면에서 확인합니다.**

### 2장 — 의료영상 Context / 3D

목표:

Vision이 실제 임상 AI라고 과장되지 않으면서 3D 의료영상 처리 파이프라인을 보여줍니다.

캡처 포인트:

- Brain MRI synthetic/deterministic demo Context
- 3D mesh 렌더링
- modality 및 lesion volume Context

제출 캡션:

**공개 심사용 합성 Brain 데이터를 3D Context로 변환해 Vitals와 동일 Case에 연결합니다. Vision 결과는 합성/결정론적 데모이며 임상 진단 결과가 아닙니다.**

### 3장 — 실제 Vitals AI Risk

목표:

이번 출품작의 핵심 AI 증거를 가장 명확하게 보여줍니다.

캡처 포인트:

- `AI Risk Probability`
- `Causal GRU · PhysioNet 2019`
- `vitals_gru_challenge2019_v1`
- Validation threshold
- `clinical_use=false`

제출 캡션:

**PhysioNet Challenge 2019 실제 ICU 시계열로 학습한 Causal GRU의 조기 악화 위험 신호를 실시간 WebSocket 흐름에 연결했습니다.**

### 4장 — Grounded AI Transfer Brief + 필요한 의료자원

목표:

AI score 자체가 끝이 아니라 실제 전원 의사결정 지원 정보로 변환된다는 점을 보여줍니다.

캡처 포인트:

- `AI Transfer Brief · Grounded Vitals evidence`
- GRU risk / validation threshold / model id
- `Case Context & Triage`
- `전원 후보 탐색 자원 조건`
- Brain YELLOW 예시: ICU, CT/MRI, 신경외과, 신경과

제출 캡션:

**AI 위험 신호와 영상 Context를 바탕으로 필요한 의료자원을 구조화합니다. 이 정보는 검색 필터이며 의료진의 임상 판단을 대체하지 않습니다.**

### 5장 — Golden-Time 전원 병원 후보

목표:

Medi-Matrix의 Context가 실제 병원 탐색까지 연결되는 E2E 완성도를 보여줍니다.

캡처 포인트:

- Medi-Matrix에서 Golden-Time 버튼 클릭 후 화면
- RED 또는 YELLOW transfer mode 표시
- 병원 후보 카드의 자원 적합도
- 가능하면 CT/MRI, ICU, 신경외과/신경과 등 요청 자원과 매칭되는 후보가 보이도록 캡처

제출 캡션:

**Medi-Matrix가 전달한 `transfer_resources_v1` 자원 조건을 Golden-Time이 받아 공개 응급의료 자원 정보와 매칭해 전원 후보를 탐색합니다.**

---

## 6. 5장 스토리 순서

```text
[1 문제/전체 흐름]
        ↓
[2 영상 Context]
        ↓
[3 실제 Vitals GRU]
        ↓
[4 Transfer Brief + Required Resources]
        ↓
[5 Golden-Time Hospital Candidates]
```

심사위원이 5장만 보더라도 다음 이야기를 이해해야 합니다.

> 중증환자 전원 시 흩어진 영상과 생체신호를 Case로 묶고 → 실제 공개 ICU 데이터로 학습한 AI가 악화 위험을 제공하고 → 필요한 의료자원을 구조화하고 → 그 자원을 갖춘 병원 후보 탐색까지 연결한다.

---

## 7. 대표 이미지 제안

대표 이미지는 단순 3D 뇌 이미지보다 서비스의 차별점을 한 번에 보여주는 화면이 좋습니다.

우선순위:

1. **AI Risk + Transfer Brief + 전원 자원 조건이 한 화면에 보이는 장면**
2. Imaging + Vitals + Triage를 동시에 보여주는 Case Overview
3. Golden-Time 후보까지 일부 포함된 연결 구조 이미지

대표 이미지에서 피해야 할 것:

- 3D 뇌 모델만 크게 나온 화면
- 실제 의료 AI 진단처럼 오해될 수 있는 문구
- 모델 성능 수치만 나열한 표
- 개발 콘솔/로그 중심 화면

---

## 8. 제출 폼용 초압축 문구

### 문제

중증환자 전원 시 의료영상, 생체신호, 병원 수용 자원이 서로 분리되어 있어 환자 상태를 다시 파악하고 필요한 의료자원을 갖춘 병원을 빠르게 찾기 어렵습니다.

### 해결

Medi-Matrix는 의료영상과 Vitals를 하나의 Case Context로 연결하고, AI 위험 신호와 Triage Context에서 필요한 의료자원을 구조화해 Golden-Time의 공개 응급의료 자원 정보와 연결합니다.

### AI 활용/결과

PhysioNet Challenge 2019 실제 ICU 시계열로 Logistic Regression, Temporal XGBoost, GRU, compact IMST-Mamba를 비교했고, GRU가 held-out test AUROC 0.795, Challenge Utility 0.345로 가장 높은 성능을 보여 서비스 모델로 선택했습니다. Production에서도 Case Vitals → GRU → WebSocket → AI Risk → Transfer Brief → Golden-Time handoff까지 E2E 검증했습니다.

---

## 9. 심사 발표 시 반드시 지킬 표현

사용해도 되는 표현:

- 실제 PhysioNet ICU 시계열로 학습한 GRU
- Production에서 실제 model-mode GRU inference provenance 검증
- 공개 심사용 입력은 개인정보 보호와 재현성을 위해 합성 Demo Case 사용
- Vision은 synthetic/deterministic demo
- Vitals AI는 실제 학습 모델과 demo scorer를 UI에서 구분
- Golden-Time은 자동 병원 결정이 아니라 자원 기반 후보 탐색/재정렬
- Transfer Brief는 grounded deterministic synthesis

사용하면 안 되는 표현:

- 임상적으로 검증된 AI
- 실제 환자 진단 시스템
- MRI로 패혈증을 진단한다
- AI가 최적 병원을 자동 결정한다
- Vision이 실제 병변 segmentation AI로 검증됐다
- BraTS와 PhysioNet이 같은 환자 데이터다
- compact IMST-Mamba가 모든 Mamba 계열보다 열등하다

---

## 10. 제출 전 최종 체크리스트

- [ ] 서비스 링크 비로그인 상태에서 Demo Case 진입 가능
- [ ] AI Risk 카드에서 `Causal GRU`, model id, threshold, `clinical_use=false` 확인
- [ ] Transfer Brief 노출 확인
- [ ] `Case Context & Triage`의 새 제출용 문구 확인
- [ ] `전원 후보 탐색 자원 조건` 확인
- [ ] Golden-Time 새 창 이동 확인
- [ ] Golden-Time RED/YELLOW transfer mode 확인
- [ ] 5개 스크린샷 모두 동일 브라우저 배율/16:9 비율로 촬영
- [ ] 실제 환자 식별정보나 개인 계정 정보가 화면에 노출되지 않음
- [ ] 대표 이미지에서 Vision synthetic / Vitals model boundary가 오해되지 않음
