import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VitalsAiRiskCard } from '../components/dashboard/VitalsAiRiskCard'

describe('VitalsAiRiskCard', () => {
  it('실제 GRU provenance와 validation threshold를 비임상 보조 신호로 표시함', () => {
    render(
      <VitalsAiRiskCard
        risk={{
          risk_probability: 0.73421,
          model_id: 'vitals_gru_challenge2019_v1',
          threshold: 0.5996291004,
          source: 'PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0',
          inference_mode: 'model',
          target: 'official SepsisLabel early-warning target',
          clinical_use: false,
        }}
      />,
    )

    expect(screen.getByTestId('ai-risk-panel')).toHaveTextContent('AI Risk Probability')
    expect(screen.getByText('73.4%')).toBeInTheDocument()
    expect(screen.getByText(/Causal GRU · PhysioNet 2019/i)).toBeInTheDocument()
    expect(screen.getByText(/Validation threshold 60.0% · 임상 cutoff 아님/i)).toBeInTheDocument()
    expect(screen.getByText(/vitals_gru_challenge2019_v1/i)).toBeInTheDocument()
    expect(screen.getByText(/진단 또는 자동 전원 결정이 아닙니다/i)).toBeInTheDocument()
  })

  it('demo scorer를 학습된 AI처럼 표시하지 않음', () => {
    render(
      <VitalsAiRiskCard
        risk={{
          risk_probability: 0.31,
          model_id: 'deterministic_vitals_demo_v1',
          threshold: null,
          source: 'Medi-Matrix deterministic Vitals demo scorer',
          inference_mode: 'demo',
          target: 'synthetic sepsis-like pattern score',
          clinical_use: false,
        }}
      />,
    )

    expect(screen.getByText(/Deterministic demo scorer/i)).toBeInTheDocument()
    expect(screen.getByText(/학습된 임상 AI 결과가 아닙니다/i)).toBeInTheDocument()
    expect(screen.queryByText(/Validation threshold/i)).not.toBeInTheDocument()
  })
})
