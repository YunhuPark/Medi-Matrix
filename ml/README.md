# Medi-Matrix Real Vitals AI Pipeline

This directory contains the reproducible training path that replaces the public prototype's deterministic synthetic Vitals scorer with a model trained on a public de-identified clinical dataset.

## Data source

Use **PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0** training data.

Official source:
- https://physionet.org/content/challenge-2019/1.0.0/training/

The source is patient-level hourly ICU data. This pipeline intentionally uses only the six Vitals already supported by the Medi-Matrix product input contract:

| PhysioNet | Medi-Matrix |
| --- | --- |
| HR | hr |
| SBP | bpSys |
| DBP | bpDia |
| Resp | resp |
| Temp | temp |
| O2Sat | spo2 |
| SepsisLabel | label |

Do not commit downloaded patient files or generated model artifacts. `.gitignore` blocks `ml/data/raw`, `ml/data/processed`, `ml/artifacts`, and `*.joblib`.

## 1. Download the public training set

Example with the official PhysioNet mirror:

```bash
mkdir -p ml/data/raw
wget -r -N -c -np https://physionet.org/files/challenge-2019/1.0.0/training/ -P ml/data/raw
```

The download should contain `training_setA` and `training_setB` patient `.psv` files.

## 2. Install ML dependencies

```bash
python -m venv .venv-ml
source .venv-ml/bin/activate  # Windows PowerShell: .venv-ml\Scripts\Activate.ps1
pip install -r ml/requirements.txt
```

For Parquet output also install `pyarrow`; otherwise use CSV.

## 3. Convert to the canonical six-Vitals schema

Smoke run on a small number of patients:

```bash
python ml/prepare_physionet2019.py \
  --input ml/data/raw/physionet.org/files/challenge-2019/1.0.0/training \
  --output ml/data/processed/physionet2019_vitals.csv \
  --limit 100
```

Full conversion: remove `--limit`.

The script preserves missing values rather than inventing them. Missing-value imputation is learned on the training split only.

## 4. Train the first auditable baseline

```bash
python ml/train_baseline.py \
  --data ml/data/processed/physionet2019_vitals.csv \
  --artifact-dir ml/artifacts/vitals_logreg_v1
```

The baseline is deliberately simple: median imputation + missingness indicators + scaling + class-balanced Logistic Regression.

It is not the final product model. It establishes a leakage-safe benchmark before GRU/Mamba experiments.

Artifacts:

- `model.joblib` — trained baseline model
- `metrics.json` — AUROC, AUPRC, sensitivity, specificity, precision, confusion-matrix counts
- `split_manifest.json` — exact patient IDs assigned to train/validation/test

## Leakage policy

All hourly rows for a patient stay in exactly one split. The split is stratified at the **patient level**, not the row level. Preprocessing is fitted only on the training partition through the scikit-learn pipeline.

## Model-selection policy

Do not select Mamba because of architecture name alone. The next phase should compare models on the same patient split, at minimum:

1. Logistic Regression baseline
2. Gradient-boosted tree baseline
3. GRU/LSTM sequence model
4. Mamba-family sequence model if reproducibly supported

The deployed model should be chosen by held-out performance, calibration/operating point, inference cost, and reproducibility.

## Product claim boundary

Until a trained artifact and its metrics are reviewed and wired into the backend, production must remain in `INFERENCE_MODE=demo`.

After integration, the model output should be presented as a **risk signal for decision support**, not as a diagnosis, clinical rule, or autonomous transfer decision.
