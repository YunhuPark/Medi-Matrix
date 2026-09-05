from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

SOURCE_COLUMNS = {
    "HR": "hr",
    "SBP": "bpSys",
    "DBP": "bpDia",
    "Resp": "resp",
    "Temp": "temp",
    "O2Sat": "spo2",
    "SepsisLabel": "label",
}


def iter_patient_files(root: Path):
    yield from sorted(root.rglob("*.psv"))


def convert_patient_file(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, sep="|")
    missing = [name for name in SOURCE_COLUMNS if name not in frame.columns]
    if missing:
        raise ValueError(f"{path.name}: missing required columns: {missing}")

    patient_id = path.stem
    out = frame[list(SOURCE_COLUMNS)].rename(columns=SOURCE_COLUMNS).copy()
    out.insert(0, "patient_id", patient_id)
    out.insert(1, "hour", range(1, len(out) + 1))

    for name in ["hr", "bpSys", "bpDia", "resp", "temp", "spo2"]:
        out[name] = pd.to_numeric(out[name], errors="coerce")
    out["label"] = pd.to_numeric(out["label"], errors="raise").astype(int)

    if not set(out["label"].unique()).issubset({0, 1}):
        raise ValueError(f"{path.name}: SepsisLabel must contain only 0/1")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert PhysioNet Challenge 2019 patient PSV files to the canonical Medi-Matrix 6-Vitals schema."
    )
    parser.add_argument("--input", type=Path, required=True, help="Directory containing training_setA/training_setB .psv files")
    parser.add_argument("--output", type=Path, default=Path("ml/data/processed/physionet2019_vitals.parquet"))
    parser.add_argument("--limit", type=int, default=None, help="Optional patient limit for a quick smoke run")
    args = parser.parse_args()

    files = list(iter_patient_files(args.input))
    if args.limit is not None:
        files = files[: args.limit]
    if not files:
        raise SystemExit(f"No .psv patient files found under {args.input}")

    frames = [convert_patient_file(path) for path in files]
    dataset = pd.concat(frames, ignore_index=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    # CSV is intentionally used instead of pickle so the artifact is inspectable and language-neutral.
    if args.output.suffix.lower() == ".csv":
        dataset.to_csv(args.output, index=False)
    else:
        try:
            dataset.to_parquet(args.output, index=False)
        except ImportError as exc:
            raise SystemExit("Parquet output requires pyarrow. Use an .csv output path or install pyarrow.") from exc

    patients = dataset["patient_id"].nunique()
    positive_patients = dataset.groupby("patient_id")["label"].max().sum()
    print(f"wrote={args.output}")
    print(f"patients={patients}")
    print(f"positive_patients={int(positive_patients)}")
    print(f"rows={len(dataset)}")


if __name__ == "__main__":
    main()
