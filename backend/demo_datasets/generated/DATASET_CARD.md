# '나는 Solo AI' 공모전 심사용 공식 데모 데이터

## 경고 (WARNING)
> **이 폴더(`backend/demo_datasets/generated/`)의 모든 파일은 100% 코드로 생성된 합성 데이터(Synthetic Data)입니다.**
> 실제 환자의 임상 데이터가 아니며, 개인식별정보(PII)가 포함되어 있지 않습니다.
> 이 데이터는 시스템의 파일 업로드, 보안 검증, 시각화 기능이 정상 작동하는지 시연하기 위한 용도일 뿐이며, 임상 진단 목적으로 사용할 수 없습니다.

## 1. 생성 방법 및 재현성
- **생성 스크립트**: `backend/scripts/generate_demo_data.py`
- **시드(Seed)**: `42` (고정)
- **생성 명령**:
  ```bash
  cd backend
  python scripts/generate_demo_data.py --force
  ```
- 재현성 보장을 위해 고정된 시드로 생성되며, `manifest.json`에 각 파일의 SHA-256 해시와 크기가 기록되어 있습니다.

## 2. 생체 신호 (Vitals) 합성 데이터
`upload-vitals` 라우터와 Triage Mock Server가 요구하는 `hr`, `bpSys`, `bpDia`, `resp`, `temp`, `spo2` 6가지 필드를 포함하는 100행 규모의 Float/Int 데이터입니다.
- **synthetic_vitals_stable.csv**: 정상 범주의 기저값에 노이즈를 추가한 데이터 (안정 상태).
- **synthetic_vitals_warning.csv**: 주의 수준으로 편향된 값이 포함된 데이터.
- **synthetic_vitals_critical.csv**: 심각한 패혈증 혹은 위급 상황과 유사하게 극단값으로 편향된 데이터.

## 3. 3D 영상 합성 팬텀 데이터
실제 뇌 MRI 종양 영상이 아닙니다. 수학적인 구형(Sphere) 모델에 노이즈를 입혀 만들어진 인공 팬텀입니다.
- **synthetic_brain_volume.nii.gz**: 배경 노이즈와 구형 형태의 신호 증강을 포함한 64x64x64 3D NIfTI 파일. 
- **synthetic_lesion_mask.npy**: NIfTI 파일 내의 구형 영역을 표시한 부울(Bool)/정수 배열 (0과 1).

## 4. 기존 출처 불명 데이터에 대하여
> **기존 `backend/demo_datasets`에 존재하던 `brain_tumor_demo.nii.gz`, `lung_nodule_demo.nii.gz` 등의 파일은 출처와 비식별 여부가 공식적으로 입증되지 않았습니다.**
> 따라서 이 프로젝트의 심사 및 공식 시연(Official Demo)에서는 **제외**되며 사용되지 않습니다.
