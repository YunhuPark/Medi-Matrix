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

// -----------------------------------------------------------------
// 허용 목록 상수 (Golden-Time MediMatrixParams.ts와 일치해야 함)
// -----------------------------------------------------------------
export const ALLOWED_MODALITIES = ['Brain', 'Lung'] as const;
export type ModalityType = (typeof ALLOWED_MODALITIES)[number];

const ALLOWED_TRIAGE = ['RED', 'ORANGE', 'YELLOW', 'GREEN'] as const;
export type TriageLevel = (typeof ALLOWED_TRIAGE)[number];

/** vitalsCondition 최대 길이 */
const MAX_VITALS_CONDITION_LENGTH = 120;

/** URL 최대 허용 길이 */
const MAX_URL_LENGTH = 500;

// -----------------------------------------------------------------
// 컨텍스트 상수 (Golden-Time 매핑용)
// -----------------------------------------------------------------
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

// -----------------------------------------------------------------
// 환경변수 검증
// -----------------------------------------------------------------
/**
 * Golden-Time 기본 URL을 반환합니다.
 * VITE_GOLDEN_TIME_URL 환경변수가 있으면 우선 사용하며 https만 허용합니다.
 * 설정이 없으면 production 기본값을 사용합니다.
 *
 * @throws 허용되지 않은 프로토콜인 경우
 */
export function getGoldenTimeBaseUrl(): string {
  const envUrl = import.meta.env.VITE_GOLDEN_TIME_URL as string | undefined;

  if (envUrl) {
    // 허용된 프로토콜 검사 (https only)
    if (!envUrl.startsWith('https://')) {
      throw new Error(
        `[goldenTimeUrl] VITE_GOLDEN_TIME_URL must start with https://. Got: ${envUrl.slice(0, 20)}...`
      );
    }
    // trailing slash 제거
    return envUrl.replace(/\/+$/, '');
  }

  // production 기본값 (하드코딩이지만 선택지가 없는 경우에만)
  return 'https://golden-time.vercel.app';
}

// -----------------------------------------------------------------
// 파라미터 빌더
// -----------------------------------------------------------------

export interface GoldenTimeUrlOptions {
  /** 응급 중증도 (허용 목록에 없으면 'RED' 사용) */
  triage: string | null;
  /** MRI 분석 모달리티 */
  modality: ModalityType;
  /** 병변 체적 (voxels, 숫자) */
  lesionVolume: number;
  /**
   * WebSocket Vitals 스트리밍에서 전달된 합병증 조건 (화면 표시용, 점수 계산 미사용).
   * null이거나 'Unknown'이면 미전송.
   */
  vitalsCondition?: string | null;
  /**
   * 구조화된 패혈증 위험 상태 (문자열 파싱 의존 제거)
   */
  hasSepsisRisk: boolean;
}

/**
 * Golden-Time 리디렉션 URL을 생성합니다.
 *
 * @returns 완전한 https URL 문자열
 * @throws VITE_GOLDEN_TIME_URL이 잘못된 경우
 */
export function buildGoldenTimeUrl(options: GoldenTimeUrlOptions): string {
  const { triage, modality, lesionVolume, vitalsCondition, hasSepsisRisk } = options;

  const baseUrl = getGoldenTimeBaseUrl();
  const params = new URLSearchParams();

  // triage: 허용 목록 검증
  const validatedTriage = ALLOWED_TRIAGE.includes(triage as TriageLevel) ? triage! : 'RED';
  params.set('triage', validatedTriage);

  // 항상 포함
  params.set('analysisMode', 'synthetic_demo');
  params.set('clinicalValidation', 'false');

  const hasBrain = modality === 'Brain';
  const hasSepsis = hasSepsisRisk;

  const analysisSources: string[] = [];
  let primaryCondition = '';
  let secondaryConditions = '';
  const capabilities = new Set<string>();
  const specialties = new Set<string>();

  if (hasBrain) {
    analysisSources.push('mri');
  }
  if (vitalsCondition && vitalsCondition !== 'Unknown') {
    analysisSources.push('vitals');
  }

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
    // Lung 등 미구현 모달리티
    primaryCondition = 'unsupported_modality';
  }

  if (analysisSources.length > 0) {
    params.set('analysisSources', analysisSources.join(','));
  }
  
  if (primaryCondition) {
    params.set('primaryCondition', primaryCondition);
    params.set('condition', primaryCondition); // 하위 호환성
  }
  if (secondaryConditions) {
    params.set('secondaryConditions', secondaryConditions);
  }
  if (capabilities.size > 0) {
    params.set('capabilities', Array.from(capabilities).join(','));
  }
  if (specialties.size > 0) {
    params.set('specialties', Array.from(specialties).join(','));
  }

  // vitalsCondition: 화면 표시용, 길이 제한
  if (vitalsCondition && vitalsCondition !== 'Unknown') {
    const trimmed = vitalsCondition.slice(0, MAX_VITALS_CONDITION_LENGTH);
    params.set('vitalsCondition', trimmed);
  }

  // 병변 부피 (숫자만, 민감정보 아님)
  params.set('volume', String(Math.round(lesionVolume)));

  const url = `${baseUrl}/?${params.toString()}`;

  // 길이 초과 방지 (최대 500자)
  if (url.length > MAX_URL_LENGTH) {
    params.delete('vitalsCondition');
    return `${baseUrl}/?${params.toString()}`;
  }

  return url;
}

// -----------------------------------------------------------------
// 보안 검증 유틸 (테스트에서도 사용)
// -----------------------------------------------------------------

/** URL에 민감정보 패턴이 없는지 검사 */
export function assertNoSensitiveData(url: string): void {
  const SENSITIVE_PATTERNS = [
    /eyJ[A-Za-z0-9+/]+=*/,        // JWT (Base64)
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
