from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"pattern not found in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Keep time-series disease-like scores independent from image volume.
replace_once(
    "backend/api/router.py",
    '''            probs = mamba_predictor.predict([row])\n\n            # Volume을 추가 피처로 활용 (Multi-modal 앙상블)\n            volume_factor = min(volume / 20000.0, 0.5)\n\n            # 각 병증별 최종 확률 계산 (Volume factor 보정)\n            final_sepsis = min(probs["sepsis"] + volume_factor, 1.0)\n            final_ards = min(probs["ards"] + volume_factor, 1.0)\n            final_shock = min(probs["shock"] + volume_factor, 1.0)\n\n            max_prob = max(final_sepsis, final_ards, final_shock)\n\n            # 어떤 병증이 가장 높은 위험도를 갖는지 식별\n            triggering_condition = "Unknown"\n            if max_prob == final_sepsis: triggering_condition = "패혈증 (Sepsis)"\n            elif max_prob == final_ards: triggering_condition = "급성 호흡곤란 증후군 (ARDS)"\n            elif max_prob == final_shock: triggering_condition = "저혈량성 쇼크 (Hypovolemic Shock)"\n\n            # 확률에 따른 Triage 결정\n            if max_prob > 0.8:\n                triage_level = f"RED (초응급 - {triggering_condition} 위험)"\n            elif max_prob > 0.5:\n                triage_level = "YELLOW (응급 - 집중 모니터링)"\n            else:\n                triage_level = "GREEN (안정 - 일반 병동 관찰)"\n''',
    '''            probs = mamba_predictor.predict([row])\n\n            # Time-series 위험 점수는 Vitals만으로 계산합니다.\n            # 영상 병변 volume은 질환 점수에 직접 더하지 않고 최종 Triage의 제한된\n            # context 보정값으로만 사용해 Vision/Time-series 신호를 분리합니다.\n            final_sepsis = max(0.0, min(float(probs["sepsis"]), 0.99))\n            final_ards = max(0.0, min(float(probs["ards"]), 0.99))\n            final_shock = max(0.0, min(float(probs["shock"]), 0.99))\n\n            max_prob = max(final_sepsis, final_ards, final_shock)\n            vision_context = min(volume / 200000.0, 0.12)\n            triage_score = min(max_prob + vision_context, 0.99)\n\n            # 어떤 Vitals 유사 패턴이 가장 높은 위험도를 갖는지 식별\n            triggering_condition = "Unknown"\n            if max_prob == final_sepsis:\n                triggering_condition = "패혈증 유사 (Sepsis-like)"\n            elif max_prob == final_ards:\n                triggering_condition = "ARDS 유사 (ARDS-like)"\n            elif max_prob == final_shock:\n                triggering_condition = "쇼크 유사 (Shock-like)"\n\n            # 합성 데모용 Triage: Stable -> GREEN, Warning -> YELLOW, Critical -> RED\n            if triage_score >= 0.75:\n                triage_level = f"RED (초응급 - {triggering_condition} 위험)"\n            elif triage_score >= 0.25:\n                triage_level = "YELLOW (응급 - 집중 모니터링)"\n            else:\n                triage_level = "GREEN (안정 - 일반 관찰)"\n'''
)

replace_once(
    "backend/api/router.py",
    '''                "triggering_condition": triggering_condition if max_prob > 0.8 else None,\n                "triage_level": triage_level,\n                "sepsis_high_risk": True if (max_prob > 0.8 and max_prob == final_sepsis) else False\n''',
    '''                "triggering_condition": triggering_condition if triage_score >= 0.75 else None,\n                "triage_level": triage_level,\n                "sepsis_high_risk": bool(\n                    triage_score >= 0.75\n                    and final_sepsis == max_prob\n                    and final_sepsis >= 0.60\n                )\n'''
)

# Make public-demo wording reflect what is actually being shown.
replace_once(
    "frontend/src/components/dashboard/EmergencyDashboard.tsx",
    "<strong>Vitals 합병증:</strong>{' '}",
    "<strong>Vitals 위험 패턴:</strong>{' '}",
)
replace_once(
    "frontend/src/components/dashboard/EmergencyDashboard.tsx",
    "{' '}(시뮬레이션)",
    "{' '}(합성 데모)",
)
replace_once(
    "frontend/src/components/dashboard/EmergencyDashboard.tsx",
    "{' '}(위험 수치)",
    "{' '}(3D context)",
)

print("Medi-Matrix demo triage patches applied.")
