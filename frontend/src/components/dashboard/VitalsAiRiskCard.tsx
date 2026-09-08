import { buildVitalsTransferBrief } from '../../lib/transferSupport'

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
  const transferBrief = buildVitalsTransferBrief(risk)

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

      <div
        data-testid="ai-transfer-brief"
        style={{
          marginTop: 10,
          padding: '10px 11px',
          borderRadius: 9,
          border: `1px solid ${isModel ? 'rgba(74,222,128,0.22)' : 'rgba(251,191,36,0.20)'}`,
          backgroundColor: isModel ? 'rgba(74,222,128,0.055)' : 'rgba(251,191,36,0.045)',
        }}
      >
        <div style={{ color: isModel ? '#86efac' : '#fde68a', fontWeight: 800, fontSize: '0.77rem' }}>
          {transferBrief.headline}
        </div>
        <div style={{ color: '#d1d5db', marginTop: 5, fontSize: '0.72rem', lineHeight: 1.5 }}>
          {transferBrief.summary}
        </div>
        <ul style={{ margin: '7px 0 0', paddingLeft: 18, color: '#9ca3af', fontSize: '0.68rem', lineHeight: 1.45 }}>
          {transferBrief.evidence.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <div style={{ marginTop: 7, color: '#bfdbfe', fontSize: '0.70rem', lineHeight: 1.45 }}>
          다음 단계 · {transferBrief.nextAction}
        </div>
        <div style={{ marginTop: 5, color: '#fbbf24', fontSize: '0.66rem' }}>
          Grounded summary · 입력된 모델 provenance와 threshold만 사용 · clinical_use=false
        </div>
      </div>
    </div>
  )
}
