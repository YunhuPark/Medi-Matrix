export type TransferRiskInput = {
  risk_probability: number
  model_id: string
  threshold: number | null
  source: string
  inference_mode: 'demo' | 'model'
  target: string
  clinical_use: boolean
}

export type TransferRequirement = {
  id: string
  label: string
  kind: 'capability' | 'specialty'
}

export type VitalsTransferBrief = {
  status: 'model_threshold_exceeded' | 'model_below_threshold' | 'model_no_threshold' | 'demo_only'
  headline: string
  summary: string
  evidence: string[]
  nextAction: string
  clinicalUse: false
}

const CAPABILITY_LABELS: Record<string, string> = {
  emergency_room: '응급실 수용 가능 여부',
  icu: '중환자실(ICU) 수용 가능 여부',
  brain_imaging: '뇌 CT/MRI 등 영상 대응 자원',
}

const SPECIALTY_LABELS: Record<string, string> = {
  neurosurgery: '신경외과 대응 가능 여부',
  neurology: '신경과 대응 가능 여부',
  emergency_medicine: '응급의학과 대응 가능 여부',
  internal_medicine: '내과 대응 가능 여부',
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, 1))
}

function normalizeThreshold(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0 || value >= 1) return null
  return value
}

export function buildVitalsTransferBrief(risk: TransferRiskInput): VitalsTransferBrief {
  const probability = clampProbability(risk.risk_probability)
  const threshold = normalizeThreshold(risk.threshold)
  const probabilityText = `${(probability * 100).toFixed(1)}%`

  if (risk.inference_mode !== 'model') {
    return {
      status: 'demo_only',
      headline: 'AI Transfer Brief · Vitals demo evidence',
      summary: '현재 Vitals 신호는 deterministic demo scorer 결과이므로 학습된 임상 AI 근거로 사용하지 않습니다.',
      evidence: [
        `Demo score ${probabilityText}`,
        `Scorer ${risk.model_id}`,
      ],
      nextAction: '영상 Context와 데모 Triage 흐름을 확인하되, 이 점수를 실제 임상 판단 또는 자동 전원 결정에 사용하지 않습니다.',
      clinicalUse: false,
    }
  }

  const evidence = [
    `GRU risk ${probabilityText}`,
    `Model ${risk.model_id}`,
    `Target ${risk.target}`,
  ]

  if (threshold === null) {
    return {
      status: 'model_no_threshold',
      headline: 'AI Transfer Brief · Grounded Vitals evidence',
      summary: '공개 ICU 시계열로 학습한 Causal GRU의 비임상 조기경보 신호를 Case Context에 연결합니다. 현재 응답에는 검증 threshold가 없어 위험 여부를 임의로 단정하지 않습니다.',
      evidence,
      nextAction: '현재 Vitals 추세와 영상 Context, 데모 Triage 결과를 함께 검토해 전원 후보 탐색 여부를 결정합니다.',
      clinicalUse: false,
    }
  }

  evidence.splice(1, 0, `Validation threshold ${(threshold * 100).toFixed(1)}%`)

  if (probability >= threshold) {
    return {
      status: 'model_threshold_exceeded',
      headline: 'AI Transfer Brief · Grounded Vitals evidence',
      summary: 'Causal GRU 위험 신호가 held-out validation에서 선택한 비임상 threshold 이상입니다. 이 신호는 영상 Context와 데모 Triage를 보완하는 전원 의사결정 지원 근거로만 사용합니다.',
      evidence,
      nextAction: 'Case가 YELLOW 또는 RED로 분류되면 필요한 의료자원을 기준으로 Golden-Time 전원 후보를 확인합니다.',
      clinicalUse: false,
    }
  }

  return {
    status: 'model_below_threshold',
    headline: 'AI Transfer Brief · Grounded Vitals evidence',
    summary: 'Causal GRU 위험 신호가 held-out validation에서 선택한 비임상 threshold 미만입니다. 단일 시점 점수만으로 안정 또는 전원 불필요를 의미하지 않습니다.',
    evidence,
    nextAction: 'Vitals 추세를 계속 모니터링하고 영상 Context 및 데모 Triage 변화가 있으면 전원 후보 탐색 조건을 다시 평가합니다.',
    clinicalUse: false,
  }
}

export function buildTransferRequirements(
  triage: string | null,
  modality: 'Brain' | 'Lung',
): TransferRequirement[] {
  const normalized = (triage ?? '').trim().toUpperCase()
  const isRed = normalized.startsWith('RED')
  const isYellow = normalized.startsWith('YELLOW')

  const capabilities = new Set<string>()
  const specialties = new Set<string>()

  if (isRed) {
    capabilities.add('emergency_room')
    capabilities.add('icu')
    specialties.add('emergency_medicine')
    specialties.add('internal_medicine')
  }

  if (modality === 'Brain' && (isRed || isYellow)) {
    capabilities.add('brain_imaging')
    capabilities.add('icu')
    specialties.add('neurosurgery')
    specialties.add('neurology')
  }

  return [
    ...Array.from(capabilities).map((id) => ({
      id,
      label: CAPABILITY_LABELS[id] ?? id,
      kind: 'capability' as const,
    })),
    ...Array.from(specialties).map((id) => ({
      id,
      label: SPECIALTY_LABELS[id] ?? id,
      kind: 'specialty' as const,
    })),
  ]
}
