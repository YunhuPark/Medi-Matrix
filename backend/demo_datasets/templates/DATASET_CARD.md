# '나는 Solo AI' 공모전 심사용 공식 데모 데이터

## 경고 (WARNING)
> **이 폴더(`backend/demo_datasets/generated/`)의 모든 파일은 100% 코드로 생성된 합성 데이터(Synthetic Data)입니다.**
> 실제 환자의 임상 데이터가 아니며, 개인식별정보(PII)가 포함되어 있지 않습니다.
> 이 데이터는 시스템의 파일 업로드, 보안 검증, 시각화 기능이 정상 작동하는지 시연하기 위한 용도일 뿐이며, 임상 진단 목적으로 사용할 수 없습니다.

## 1. 생성 방법 및 재현성
- **생성 스크립트**: `backend/scripts/generate_demo_data.py`
- **시드(Seed)**: `42` (스크립트 내에 하드코딩된 상수)
- **생성 알고리즘**:
  - 3D 볼륨: numpy 기반의 64x64x64 배열에 백그라운드 가우시안 노이즈를 더하고, 중심에 구(Sphere) 형태의 신호를 증가시켜 가상의 팬텀 병변을 합성합니다.
  - CSV 생체신호: 기본 정상 수치에서 시작해 각 시나리오(warning, critical)에 맞게 특정 확률로 노이즈와 편향값을 부여하여 생성합니다.
- **생성 명령**:
  ```bash
  cd backend
  python scripts/generate_demo_data.py --force --package
  ```
- 재현성 보장을 위해 고정된 시드로 생성되며, `manifest.json`에 각 파일의 속성(크기, dtype, shape 등)이 기록되어 있습니다.

## 2. 생체 신호 (Vitals) 합성 데이터
`upload-vitals` 라우터와 Triage Mock Server가 요구하는 `hr`, `bpSys`, `bpDia`, `resp`, `temp`, `spo2` 6가지 필수 컬럼 스키마를 준수하는 최대 100행 규모의 Float/Int 데이터입니다. NaN과 Infinity는 포함하지 않습니다.
- **synthetic_vitals_stable.csv**: 정상 범주의 기저값에 노이즈를 추가한 데이터 (안정 상태).
- **synthetic_vitals_warning.csv**: 주의 수준으로 편향된 값이 포함된 데이터.
- **synthetic_vitals_critical.csv**: 심각한 패혈증 혹은 위급 상황과 유사하게 극단값으로 편향된 데이터.
- **주의**: stable/warning/critical은 입력 데이터 시나리오의 상대적인 구분일 뿐이며, 표시되는 위험도는 시뮬레이터의 결과이므로 임상적 유효성이 검증된 예측값이 아닙니다.

## 3. 3D 영상 합성 팬텀 데이터
실제 환자 MRI나 뇌종양 영상이 아닙니다. 수학적인 구형(Sphere) 모델에 노이즈를 입혀 만들어진 인공 팬텀입니다.
- **synthetic_brain_like_volume.nii.gz**: 배경 노이즈와 구형 형태의 신호 증강을 포함한 64x64x64 3D NIfTI 파일. 민감 메타데이터가 포함되지 않았습니다.
- **synthetic_lesion_mask.npy**: 64x64x64 크기의 부울(Bool)/정수(uint8) 배열 (0과 1)로, NIfTI 파일 내의 구형 영역을 표시합니다. object dtype은 포함하지 않습니다.

## 4. 기존 출처 불명 데이터에 대하여
> **기존 프로젝트에 존재하던 `brain_tumor_demo.nii.gz` 등의 데이터는 출처 및 비식별 여부가 공식 입증되지 않았으므로 공식 패키지에서 전면 제외되었습니다.**
> 어떠한 공개 라이선스(CC0 등) 주장도 하지 않으며, 본 데모 패키지에는 위에서 설명한 100% 합성 데이터만 사용됩니다.
