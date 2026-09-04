"""Vitals risk adapter for the Medi-Matrix public prototype.

The production-ready Vitals path is intentionally independent from the Vision
``INFERENCE_MODE``. ``VITALS_INFERENCE_MODE=demo`` keeps the deterministic
competition fallback. ``VITALS_INFERENCE_MODE=model`` loads the reviewed causal
GRU trained on the public PhysioNet/Computing in Cardiology Challenge 2019
training set.

The trained model is an auxiliary early-sepsis warning signal, not a diagnosis
or an automatic transfer decision. It consumes only the six Vitals already in
Medi-Matrix: HR, SBP, DBP, Resp, Temp and O2Sat.
"""

from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
from typing import Any

MODEL_ID = "vitals_gru_challenge2019_v1"
MODEL_SOURCE = "PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0"
MODEL_RUN_SHA = "ddbc7246a3a733ebac747fe9931e62b57a027738"
MODEL_SHA256 = "182cebac9eae5bce456a904f00aee6e1d7650f3432e170783e437eab82eb202f"
MODEL_TEST_UTILITY = 0.34512958980235814
MODEL_TEST_AUROC = 0.7946005008323214
MODEL_TEST_AUPRC = 0.09500058131187976
BASE_FEATURES = ["hr", "bpSys", "bpDia", "resp", "temp", "spo2"]
MODEL_FEATURES = [
    item
    for feature in BASE_FEATURES
    for item in (f"{feature}_value", f"{feature}_observed", f"{feature}_recency")
] + ["hour_scaled"]

DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[1]
    / "models"
    / MODEL_ID
    / "model.pt"
)

MODEL_COMPATIBILITY = {
    "selected_model": MODEL_ID,
    "source_dataset": MODEL_SOURCE,
    "training_run_sha": MODEL_RUN_SHA,
    "base_features": BASE_FEATURES,
    "model_features": MODEL_FEATURES,
    "model_mode_ready": True,
    "clinical_use": False,
    "test_challenge_utility": MODEL_TEST_UTILITY,
    "test_auroc": MODEL_TEST_AUROC,
    "test_auprc": MODEL_TEST_AUPRC,
}


class VitalsModelUnavailableError(RuntimeError):
    """Raised when the reviewed Vitals model cannot be loaded safely."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finite_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


class MambaSystemicPredictor:
    """Backwards-compatible Vitals predictor name used by the WebSocket router.

    In model mode this class runs the selected causal GRU. The historical class
    name is retained only to avoid breaking the existing router import.
    """

    def __init__(self):
        self.mode = os.environ.get("VITALS_INFERENCE_MODE", "demo").strip().lower()
        if self.mode not in {"demo", "model"}:
            raise ValueError("VITALS_INFERENCE_MODE must be either 'demo' or 'model'.")

        self.model_id = "deterministic_vitals_demo_v1"
        self.threshold: float | None = None
        self._history: list[dict[str, Any]] = []
        self._max_history = self._read_max_history()
        self._torch = None
        self._model = None
        self._preprocessor: dict[str, Any] | None = None

        if self.mode == "model":
            self._load_model()

    @staticmethod
    def _read_max_history() -> int:
        raw = os.environ.get("VITALS_MODEL_MAX_HISTORY", "256")
        try:
            value = int(raw)
        except ValueError:
            value = 256
        return min(max(value, 4), 1000)

    @staticmethod
    def _clamp01(value: float) -> float:
        return max(0.0, min(float(value), 1.0))

    def _model_path(self) -> Path:
        configured = os.environ.get("VITALS_MODEL_PATH", "").strip()
        return Path(configured).expanduser().resolve() if configured else DEFAULT_MODEL_PATH

    def _load_model(self) -> None:
        path = self._model_path()
        if not path.is_file():
            raise VitalsModelUnavailableError(f"Vitals model artifact is missing: {path}")
        actual_sha = _sha256(path)
        if actual_sha != MODEL_SHA256:
            raise VitalsModelUnavailableError(
                "Vitals model artifact checksum mismatch; refusing to load unreviewed weights."
            )

        try:
            import torch
            from torch import nn
        except ImportError as exc:
            raise VitalsModelUnavailableError(
                "PyTorch is required when VITALS_INFERENCE_MODE=model."
            ) from exc

        class CausalGRU(nn.Module):
            def __init__(self, input_size: int, hidden_size: int, dropout: float = 0.15):
                super().__init__()
                self.gru = nn.GRU(
                    input_size=input_size,
                    hidden_size=hidden_size,
                    num_layers=1,
                    batch_first=True,
                )
                self.dropout = nn.Dropout(dropout)
                self.head = nn.Linear(hidden_size, 1)

            def forward(self, x):
                out, _ = self.gru(x)
                return self.head(self.dropout(out)).squeeze(-1)

        try:
            checkpoint = torch.load(path, map_location="cpu", weights_only=True)
        except Exception as exc:
            raise VitalsModelUnavailableError("Failed to load reviewed Vitals model artifact.") from exc

        input_size = int(checkpoint.get("input_size", -1))
        hidden_size = int(checkpoint.get("hidden_size", -1))
        features = list(checkpoint.get("features", []))
        preprocessor = checkpoint.get("preprocessor")
        threshold = float(checkpoint.get("threshold", float("nan")))

        if input_size != len(MODEL_FEATURES) or features != MODEL_FEATURES:
            raise VitalsModelUnavailableError("Vitals model feature contract does not match runtime adapter.")
        if hidden_size != 48:
            raise VitalsModelUnavailableError("Vitals model hidden-size contract does not match reviewed artifact.")
        if not isinstance(preprocessor, dict) or list(preprocessor.get("features", [])) != BASE_FEATURES:
            raise VitalsModelUnavailableError("Vitals model preprocessing metadata is invalid.")
        if not math.isfinite(threshold) or not 0.0 < threshold < 1.0:
            raise VitalsModelUnavailableError("Vitals model threshold metadata is invalid.")

        model = CausalGRU(input_size=input_size, hidden_size=hidden_size)
        model.load_state_dict(checkpoint["state_dict"], strict=True)
        model.eval()

        self._torch = torch
        self._model = model
        self._preprocessor = preprocessor
        self.threshold = threshold
        self.model_id = MODEL_ID

    def _demo_scores(self, row: dict[str, Any]) -> dict[str, float | str | bool | None]:
        hr = float(row.get("hr", 80))
        bp_sys = float(row.get("bpSys", 120))
        resp = float(row.get("resp", 16))
        temp = float(row.get("temp", 36.5))
        spo2 = float(row.get("spo2", 98))

        hr_risk = self._clamp01((hr - 85.0) / 35.0)
        hypotension_risk = self._clamp01((105.0 - bp_sys) / 30.0)
        resp_risk = self._clamp01((resp - 18.0) / 12.0)
        fever_risk = self._clamp01((temp - 37.0) / 2.0)
        hypoxia_risk = self._clamp01((96.0 - spo2) / 10.0)

        sepsis = (
            0.08
            + 0.22 * hr_risk
            + 0.25 * hypotension_risk
            + 0.20 * fever_risk
            + 0.15 * resp_risk
            + 0.10 * hypoxia_risk
        )
        ards = 0.05 + 0.45 * hypoxia_risk + 0.35 * resp_risk + 0.10 * hr_risk
        shock = 0.05 + 0.45 * hypotension_risk + 0.30 * hr_risk + 0.10 * hypoxia_risk

        return {
            "sepsis": min(sepsis, 0.95),
            "ards": min(ards, 0.95),
            "shock": min(shock, 0.95),
            "model_id": self.model_id,
            "model_threshold": None,
            "inference_mode": "demo",
            "clinical_use": False,
        }

    def _transform_history(self, rows: list[dict[str, Any]]) -> list[list[float]]:
        if self._preprocessor is None:
            raise VitalsModelUnavailableError("Vitals model preprocessing is not loaded.")

        stats = self._preprocessor
        cap = float(stats.get("recency_cap_hours", 24.0))
        recency_denom = math.log1p(cap)
        hour_scale = max(float(stats.get("hour_scale", 1.0)), 1.0)
        last_values: dict[str, float] = {}
        last_observed_hour: dict[str, int] = {}
        transformed: list[list[float]] = []

        for hour, row in enumerate(rows, start=1):
            features: list[float] = []
            for feature in BASE_FEATURES:
                raw = _finite_number(row.get(feature))
                observed = raw is not None
                if observed:
                    last_values[feature] = raw
                    last_observed_hour[feature] = hour
                filled = last_values.get(feature, float(stats["medians"][feature]))
                standardized = (
                    (filled - float(stats["means"][feature]))
                    / float(stats["stds"][feature])
                )
                if feature in last_observed_hour:
                    recency_hours = min(max(hour - last_observed_hour[feature], 0), cap)
                else:
                    recency_hours = cap
                recency = math.log1p(recency_hours) / recency_denom
                features.extend([float(standardized), 1.0 if observed else 0.0, float(recency)])

            features.append(min(max(hour / hour_scale, 0.0), 5.0))
            transformed.append(features)

        return transformed

    def _model_scores(self, window_data: list[dict[str, Any]]) -> dict[str, float | str | bool | None]:
        if self._torch is None or self._model is None or self.threshold is None:
            raise VitalsModelUnavailableError("Vitals model runtime is not initialized.")
        if not window_data:
            return {
                "sepsis": 0.0,
                "ards": 0.0,
                "shock": 0.0,
                "model_id": self.model_id,
                "model_threshold": self.threshold,
                "inference_mode": "model",
                "clinical_use": False,
            }

        self._history.extend(dict(row) for row in window_data)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history :]

        sequence = self._transform_history(self._history)
        x = self._torch.tensor([sequence], dtype=self._torch.float32)
        with self._torch.inference_mode():
            logits = self._model(x)
            probability = float(self._torch.sigmoid(logits[0, -1]).item())

        # The reviewed GRU predicts only the PhysioNet early-sepsis warning target.
        # ARDS/shock are deliberately not synthesized in model mode.
        return {
            "sepsis": self._clamp01(probability),
            "ards": 0.0,
            "shock": 0.0,
            "model_id": self.model_id,
            "model_threshold": self.threshold,
            "inference_mode": "model",
            "clinical_use": False,
        }

    def predict(self, window_data: list[dict[str, Any]]) -> dict[str, float | str | bool | None]:
        if not window_data:
            if self.mode == "model":
                return self._model_scores([])
            return {
                "sepsis": 0.0,
                "ards": 0.0,
                "shock": 0.0,
                "model_id": self.model_id,
                "model_threshold": None,
                "inference_mode": "demo",
                "clinical_use": False,
            }
        if self.mode == "model":
            return self._model_scores(window_data)
        return self._demo_scores(window_data[-1])
