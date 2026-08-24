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
  capabilities: ['icu'],
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

/**
 * UI에서 사용하는 `RED (초응급 - ...)` 같은 전체 라벨을
 * Golden-Time이 이해하는 정규화된 상태값으로 변환합니다.
 * 허용되지 않은 값은 기존 보수적 동작을 유지해 RED로 처리합니다.
 */
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

  const analysisSources: string[] = [];
  let primaryCondition = '';
  let secondaryConditions = '';
  const capabilities = new Set<string>();
  const specialties = new Set<string>();

  if (hasBrain) analysisSources.push('mri');
  if (vitalsCondition && vitalsCondition !== 'Unknown') analysisSources.push('vitals');

  if (hasBrain && hasSepsis) {
    if (validatedTriage === 'RED') {
      primaryCondition = SEPSIS_DEMO_CONTEXT.condition;
      secondaryConditions = BRAIN_DEMO_CONTEXT.condition;
    } else {
      primaryCondition = BRAIN_DEMO_CONTEXT.condition;
      secondaryConditions = SEPSIS_DEMO_CONTEXT.condition;
    }
    BRAIN_DEMO_CONTEXT.capabilities.forEach(c => capabilities.add(c));
    BRAIN_DEMO_CONTEXT.specialties.forEach(s => specialties.add(s));
    SEPSIS_DEMO_CONTEXT.capabilities.forEach(c => capabilities.add(c));
    SEPSIS_DEMO_CONTEXT.specialties.forEach(s => specialties.add(s));
  } else if (hasBrain) {
    primaryCondition = BRAIN_DEMO_CONTEXT.condition;
    BRAIN_DEMO_CONTEXT.capabilities.forEach(c => capabilities.add(c));
    BRAIN_DEMO_CONTEXT.specialties.forEach(s => specialties.add(s));
  } else if (hasSepsis) {
    primaryCondition = SEPSIS_DEMO_CONTEXT.condition;
    SEPSIS_DEMO_CONTEXT.capabilities.forEach(c => capabilities.add(c));
    SEPSIS_DEMO_CONTEXT.specialties.forEach(s => specialties.add(s));
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

  if (vitalsCondition && vitalsCondition !== 'Unknown') {
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
