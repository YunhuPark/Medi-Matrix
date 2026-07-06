# Multi-Modal Triage System: Patient Vitals CSV Schema Guide

본 문서는 사내 병원 데이터베이스(EMR/EHR) 및 중환자실(ICU) 모니터링 시스템에서 추출한 **실제 환자의 생체 신호(Time-Series Vitals) 데이터**를 본 시스템(IMST-Mamba 패혈증 예측 AI)에 연동하기 위한 공식 데이터 규격(Schema)입니다.

데이터 엔지니어 및 연구원분들께서는 아래의 규격에 맞추어 CSV 파일을 추출해 주시기 바랍니다.

## 1. 파일 포맷 및 인코딩
- **확장자**: `.csv` (Comma-Separated Values)
- **인코딩**: `UTF-8`
- **구분자**: 쉼표(`,`)
- **헤더(Header)**: 반드시 첫 번째 줄(Row 1)에 아래 명시된 영문 컬럼명이 포함되어야 합니다.

## 2. 필수 컬럼 정의 (Required Columns)

모든 데이터는 1초(1s) 또는 1분(1m) 단위의 시계열 스냅샷이어야 합니다.

| Column Name | Data Type | Unit | Description | Valid Range (Example) |
| :--- | :--- | :--- | :--- | :--- |
| `timestamp` | String/ISO | N/A | 측정 시간 (YYYY-MM-DD HH:mm:ss) | `2023-10-27 14:32:00` |
| `hr` | Float/Int | bpm | 심박수 (Heart Rate) | `0` ~ `300` |
| `bpSys` | Float/Int | mmHg | 수축기 혈압 (Systolic Blood Pressure) | `0` ~ `300` |
| `bpDia` | Float/Int | mmHg | 이완기 혈압 (Diastolic Blood Pressure) | `0` ~ `200` |
| `resp` | Float/Int | /min | 호흡수 (Respiratory Rate) | `0` ~ `100` |
| `temp` | Float | °C | 체온 (Temperature) | `20.0` ~ `45.0` |
| `spo2` | Float/Int | % | 산소 포화도 (Blood Oxygen Saturation) | `0` ~ `100` |

> [!WARNING]
> 위 7개의 컬럼 중 하나라도 누락(Missing)되거나 철자가 다를 경우, 백엔드 라우터에서 `400 Bad Request` 에러를 반환하며 스트리밍이 거부됩니다.

## 3. 예시 데이터 (Example)

```csv
timestamp,hr,bpSys,bpDia,resp,temp,spo2
2023-10-27 10:00:00,82,120,80,16,36.5,99
2023-10-27 10:00:01,83,119,80,16,36.5,99
2023-10-27 10:00:02,85,115,78,18,36.6,98
2023-10-27 10:00:03,88,110,75,20,36.8,97
```

## 4. IMST-Mamba 데이터 전처리 안내
- 시스템에 업로드된 CSV 데이터는 백엔드 `router.py`를 거쳐 `mamba_inference.py`로 전달됩니다.
- 결측치(NaN/Null)가 포함된 행은 Mamba 모델 설정에 따라 이전 값(Forward Fill)으로 자동 보간되거나 Drop 처리되므로 가급적 정제된 클린 데이터를 업로드해 주십시오.
