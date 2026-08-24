/**
 * goldenTimeUrl.ts
 * Medi-Matrix → Golden-Time 리디렉션 URL 생성 모듈
 *
 * 보안 규칙:
 * - HTTPS(s) URL만 허용
 * - 민감정보(JWT, patientId, meshId, Signed URL, access_token) 절대 포함 금지
 * - vitalsCondition: 길이 제한 후 원문 전달 (URLSearchParams이 인코딩, 이중 인코딩 금지)
 * - VITE_GOLDEN_TIME_URL 환경변수를 사용, 없으면 production 기본값
 */

export const ALLOWED_MODALITIES = ['Brain', 'Lung'] as const;
export type ModalityType = (typeof ALLOWED_MODALITIES)[number];

const ALLOWED_TRIAGE = ['RED', 'ORANGE', 'YELLOW', 'GREEN'] as const;
export type TriageLevel = (typeof ALLOWED_TRIAGE)[number];

const MAX_VITALS_CONDITION_LENGTH = 120;
const MAX_URL_LENGTH = 500;

const BRAIN_DEMO_CONTEXT = {
  condition: 'brain_lesion_demo',
  specialties: ['neurosurgery', 'neurology'],
  capabilities: ['brain_imaging', 'icu'],
} as const;

const SEPSIS_DEMO_CONTEXT = {
  condition: 'sepsis_demo',
  specialties: ['emergency_medicine', 'internal_medicine'],
  capabilities: ['emergency_room', 'icu'],
} as const;

const SYSTEMIC_DETERIORATION_CONTEXT = {
  condition: 'systemic_deterioration_demo',
  specialties: ['emergency_medicine', 'internal_medicine'],
  capabilities: ['emergency_room', 'icu'],
} as const;

export function getGoldenTimeBaseUrl(): string {
  const envUrl = import.meta.env.VITE_GOLDEN_TIME_URL as string | undefined;
  if (envUrl) {
    if (!envUrl.startsWith('https://')) {
      throw new Error(
        `[goldenTimeUrl] VITE_GOLDEN_TIME_URL must start with https://. Got: ${envUrl.slice(0, 20)}...`
      );
    }
    return envUrl.replace(/\/+$/, '');
  }
  return 'https://golden-time.vercel.app';
}

export interface GoldenTimeUrlOptions {
  triage: string | null;
  modality: ModalityType;
  lesionVolume: number;
  vitalsCondition?: string | null;
  hasSepsisRisk: boolean;
}

export function normalizeTriageLevel(triage: string | null): TriageLevel {
  if (!triage) return 'RED';
  const upper = triage.trim().toUpperCase();
  for (const level of ALLOWED_TRIAGE) {
    if (upper === level || upper.startsWith(`${level} `) || upper.startsWith(`${level}(`)) {
      return level;
    }
  }
  return 'RED';
}

export function buildGoldenTimeUrl(options: GoldenTimeUrlOptions): string {
  const { triage, modality, lesionVolume, vitalsCondition, hasSepsisRisk } = options;
  const baseUrl = getGoldenTimeBaseUrl();
  const params = new URLSearchParams();

  const validatedTriage = normalizeTriageLevel(triage);
  params.set('triage', validatedTriage);
  params.set('analysisMode', 'synthetic_demo');
  params.set('clinicalValidation', 'false');

  const hasBrain = modality === 'Brain';
  const hasSepsis = hasSepsisRisk;
  const hasVitals = Boolean(vitalsCondition && vitalsCondition !== 'Unknown');

  const analysisSources: string[] = [];
  let primaryCondition = '';
  let secondaryConditions = '';
  const capabilities = new Set<string>();
  const specialties = new Set<string>();

  const addContext = (context: {
    capabilities: readonly string[];
    specialties: readonly string[];
  }) => {
    context.capabilities.forEach(c => capabilities.add(c));
    context.specialties.forEach(s => specialties.add(s));
  };

  if (hasBrain) analysisSources.push('mri');
  if (hasVitals) analysisSources.push('vitals');

  if (validatedTriage === 'RED' && hasVitals) {
    // RED + Vitals는 특정 진단 확정이 아니라 전신 악화 응급상황으로 처리합니다.
    const systemicContext = hasSepsis ? SEPSIS_DEMO_CONTEXT : SYSTEMIC_DETERIORATION_CONTEXT;
    primaryCondition = systemicContext.condition;
    addContext(systemicContext);

    if (hasBrain) {
      secondaryConditions = BRAIN_DEMO_CONTEXT.condition;
      addContext(BRAIN_DEMO_CONTEXT);
    }
  } else if (hasBrain) {
    // YELLOW에서는 실제 랭킹이 primaryCondition(뇌 병변) 중심으로 유지됩니다.
    // 기존 링크 호환성을 위해 Sepsis-high 표시는 secondary로만 보존합니다.
    primaryCondition = BRAIN_DEMO_CONTEXT.condition;
    addContext(BRAIN_DEMO_CONTEXT);
    if (hasSepsis) {
      secondaryConditions = SEPSIS_DEMO_CONTEXT.condition;
      addContext(SEPSIS_DEMO_CONTEXT);
    }
  } else if (hasSepsis) {
    primaryCondition = SEPSIS_DEMO_CONTEXT.condition;
    addContext(SEPSIS_DEMO_CONTEXT);
  } else {
    primaryCondition = 'unsupported_modality';
  }

  if (analysisSources.length > 0) params.set('analysisSources', analysisSources.join(','));
  if (primaryCondition) {
    params.set('primaryCondition', primaryCondition);
    params.set('condition', primaryCondition);
  }
  if (secondaryConditions) params.set('secondaryConditions', secondaryConditions);
  if (capabilities.size > 0) params.set('capabilities', Array.from(capabilities).join(','));
  if (specialties.size > 0) params.set('specialties', Array.from(specialties).join(','));

  if (hasVitals && vitalsCondition) {
    params.set('vitalsCondition', vitalsCondition.slice(0, MAX_VITALS_CONDITION_LENGTH));
  }

  params.set('volume', String(Math.round(lesionVolume)));

  const url = `${baseUrl}/?${params.toString()}`;
  if (url.length > MAX_URL_LENGTH) {
    params.delete('vitalsCondition');
    return `${baseUrl}/?${params.toString()}`;
  }
  return url;
}

export function assertNoSensitiveData(url: string): void {
  const SENSITIVE_PATTERNS = [
    /eyJ[A-Za-z0-9+/]+=*/,
    /access_token/i,
    /authorization/i,
    /patient_?id/i,
    /mesh_?id/i,
    /signed_url/i,
    /X-Amz-Signature/i,
    /token=[A-Za-z0-9_.-]{20,}/i,
  ] as const;

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(url)) {
      throw new Error(`[goldenTimeUrl] Sensitive data pattern detected in URL: ${pattern}`);
    }
  }
}
