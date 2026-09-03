"""Vitals risk adapter used by the Medi-Matrix public prototype.

The deployed competition flow intentionally runs in ``INFERENCE_MODE=demo``.
The real IMST-Mamba research model lives in the ``IMST-Mamba`` submodule and
has a different input/output contract from this demo adapter:

- research input: 34 clinical time-series features plus missingness/time tensors
- research output: step-wise sepsis probability (+ auxiliary mortality/SOFA)
- demo input: 6 synthetic Vitals columns
- demo output: three deterministic, non-clinical pattern scores

Because those contracts are not interchangeable, ``INFERENCE_MODE=model``
fails closed until a verified research checkpoint, normalization statistics,
and the matching preprocessing adapter are connected end-to-end.
"""

from __future__ import annotations

import os


class UnverifiedModelModeError(RuntimeError):
    """Raised when code tries to enable a model path that has not been verified."""


MODEL_COMPATIBILITY = {
    "research_repo": "YunhuPark/IMST-Mamba",
    "research_commit": "d8e5762b72f2b9e812b1ae5d8036c290c024781b",
    "research_features": 34,
    "research_contract": "x + m + delta_t + s + attn_mask -> sepsis probability",
    "demo_features": 6,
    "demo_contract": "hr,bpSys,bpDia,resp,temp,spo2 -> non-clinical pattern scores",
    "model_mode_ready": False,
}


def _model_mode_error() -> UnverifiedModelModeError:
    return UnverifiedModelModeError(
        "INFERENCE_MODE=model is disabled because the Medi-Matrix runtime is not "
        "yet compatible with the verified IMST-Mamba research pipeline. The research "
        "model expects 34 clinical features plus missingness/time tensors and produces "
        "a sepsis probability, while the current demo stream contains only 6 Vitals "
        "and exposes three synthetic pattern scores. Connect the matching research "
        "checkpoint, normalization stats, and preprocessing adapter before enabling "
        "model mode."
    )


class MambaSystemicPredictor:
    """Deterministic synthetic-Vitals scorer for the public product demo.

    This class does *not* represent the real IMST-Mamba architecture. It stays
    lightweight so the public demo can validate the E2E product flow without
    importing PyTorch or implying clinical model inference.
    """

    def __init__(self):
        self.mode = os.environ.get("INFERENCE_MODE", "demo").strip().lower()
        if self.mode not in {"demo", "model"}:
            raise ValueError("INFERENCE_MODE must be either 'demo' or 'model'.")
        if self.mode == "model":
            # Fail before importing torch or touching any checkpoint. The former
            # 6-feature DummyMambaModel was not architecture-compatible with the
            # actual 34-feature IMST-Mamba research implementation.
            raise _model_mode_error()

    @staticmethod
    def _clamp01(value: float) -> float:
        return max(0.0, min(float(value), 1.0))

    def _demo_scores(self, row: dict) -> dict[str, float]:
        """Return deterministic pattern scores for bundled synthetic Vitals.

        These are not calibrated probabilities, diagnoses, or clinical rules.
        They only make Stable/Warning/Critical transitions reproducible in the
        competition demo.
        """
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
        }

    def predict(self, window_data: list[dict]) -> dict[str, float]:
        """Score the latest synthetic Vitals row in demo mode."""
        if self.mode != "demo":
            raise _model_mode_error()
        if not window_data:
            return {"sepsis": 0.0, "ards": 0.0, "shock": 0.0}
        return self._demo_scores(window_data[-1])
