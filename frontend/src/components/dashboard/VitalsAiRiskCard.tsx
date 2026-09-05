export type VitalsAiRisk = {
  risk_probability: number
  model_id: string
  threshold: number | null
  source: string
  inference_mode: 'demo' | 'model'
  target: string
  clinical_use: boolean
}

type VitalsAiRiskCardProps = {
  risk: VitalsAiRisk
}

export function VitalsAiRiskCard({ risk }: VitalsAiRiskCardProps) {
  const probability = Math.max(0, Math.min(Number(risk.risk_probability) || 0, 1))
  const isModel = risk.inference_mode === 'model'
  const threshold = typeof risk.threshold === 'number' && Number.isFinite(risk.threshold)
    ? risk.threshold
    : null

  return (
    <div
      data-testid="ai-risk-panel"
      style={{
        borderTop: '1px solid rgba(255,255,255,0.1)',
        paddingTop: 10,
        marginTop: 9,
        fontSize: '0.8rem',
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <strong style={{ color: '#fff' }}>AI Risk Probability</strong>
        <strong style={{ color: isModel ? '#4ade80' : '#fbbf24', fontSize: '1.12rem' }}>
          {(probability * 100).toFixed(1)}%
        </strong>
      </div>

      <div style={{ color: isModel ? '#86efac' : '#fde68a', marginTop: 4, fontWeight: 700 }}>
        {isModel ? 'Causal GRU · PhysioNet 2019' : 'Deterministic demo scorer'}
      </div>

      {isModel && threshold !== null && (
        <div style={{ color: '#d1d5db', marginTop: 3 }}>
          Validation threshold {(threshold * 100).toFixed(1)}% · 임상 cutoff 아님
        </div>
      )}

      <div style={{ color: '#9ca3af', marginTop: 4, wordBreak: 'break-word' }}>
        Model: <code>{risk.model_id}</code>
      </div>
      <div style={{ color: '#9ca3af', marginTop: 2 }}>{risk.source}</div>
      <div style={{ color: '#9ca3af', marginTop: 2 }}>{risk.target}</div>

      <div style={{ color: '#fbbf24', marginTop: 6, fontSize: '0.7rem' }}>
        {isModel
          ? '공개 ICU 데이터로 학습·held-out 평가한 비임상 조기경보 보조 신호입니다. 진단 또는 자동 전원 결정이 아닙니다.'
          : '데모 점수입니다. 학습된 임상 AI 결과가 아닙니다.'}
      </div>
    </div>
  )
}
