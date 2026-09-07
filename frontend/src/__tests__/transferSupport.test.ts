import { describe, expect, it } from 'vitest'
import { buildTransferRequirements, buildVitalsTransferBrief } from '../lib/transferSupport'

describe('grounded transfer support', () => {
  it('모델 threshold 이상 신호를 비임상 grounded brief로 표현함', () => {
    const brief = buildVitalsTransferBrief({
      risk_probability: 0.73421,
      model_id: 'vitals_gru_challenge2019_v1',
      threshold: 0.5996291004,
      source: 'PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0',
      inference_mode: 'model',
      target: 'official SepsisLabel early-warning target',
      clinical_use: false,
    })

    expect(brief.status).toBe('model_threshold_exceeded')
    expect(brief.clinicalUse).toBe(false)
    expect(brief.summary).toContain('비임상 threshold 이상')
    expect(brief.evidence).toContain('GRU risk 73.4%')
    expect(brief.evidence).toContain('Validation threshold 60.0%')
    expect(brief.evidence).toContain('Model vitals_gru_challenge2019_v1')
    expect(brief.nextAction).toContain('Golden-Time')
  })

  it('모델 threshold 미만을 안정 판정으로 과장하지 않음', () => {
    const brief = buildVitalsTransferBrief({
      risk_probability: 0.42,
      model_id: 'vitals_gru_challenge2019_v1',
      threshold: 0.5996291004,
      source: 'PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0',
      inference_mode: 'model',
      target: 'official SepsisLabel early-warning target',
      clinical_use: false,
    })

    expect(brief.status).toBe('model_below_threshold')
    expect(brief.summary).toContain('안정 또는 전원 불필요를 의미하지 않습니다')
  })

  it('demo scorer를 실제 AI evidence로 표현하지 않음', () => {
    const brief = buildVitalsTransferBrief({
      risk_probability: 0.81,
      model_id: 'deterministic_vitals_demo_v1',
      threshold: null,
      source: 'Medi-Matrix deterministic Vitals demo scorer',
      inference_mode: 'demo',
      target: 'synthetic sepsis-like pattern score',
      clinical_use: false,
    })

    expect(brief.status).toBe('demo_only')
    expect(brief.summary).toContain('학습된 임상 AI 근거로 사용하지 않습니다')
  })

  it('RED Brain Case의 Golden-Time 검색 자원을 구조적으로 도출함', () => {
    const requirements = buildTransferRequirements(
      'RED (초응급 - 패혈증 유사 위험)',
      'Brain',
    )
    const ids = requirements.map((item) => item.id)

    expect(ids).toEqual(expect.arrayContaining([
      'emergency_room',
      'icu',
      'brain_imaging',
      'emergency_medicine',
      'internal_medicine',
      'neurosurgery',
      'neurology',
    ]))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('YELLOW Brain은 뇌 영상/전문과 후보 자원만 사전 확인함', () => {
    const requirements = buildTransferRequirements('YELLOW (응급 - 집중 모니터링)', 'Brain')
    const ids = requirements.map((item) => item.id)

    expect(ids).toEqual(expect.arrayContaining(['icu', 'brain_imaging', 'neurosurgery', 'neurology']))
    expect(ids).not.toContain('emergency_room')
    expect(ids).not.toContain('internal_medicine')
  })
})
