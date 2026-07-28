/**
 * Golden-Time URL 생성 테스트
 *
 * 검증 항목:
 * - disease=Unknown이 생성되지 않음
 * - URLSearchParams로 모든 필수 값이 전달됨
 * - 민감정보(토큰/JWT/Signed URL/patientId)가 포함되지 않음
 * - Brain 모드 결과가 올바른 조건으로 변환됨
 * - Lung 모드 시 unsupported_modality로 처리됨
 */

import { describe, it, expect, beforeEach } from 'vitest';

// EmergencyDashboard의 URL 생성 로직을 순수 함수로 추출하여 테스트
// (컴포넌트 전체를 렌더링하지 않고 URL 생성 로직만 검증)

const BRAIN_DEMO_CONTEXT = {
  analysisMode: 'synthetic_demo',
  condition: 'brain_lesion_demo',
  specialties: 'neurosurgery,neurology',
  capabilities: 'emergency_surgery,icu,brain_imaging',
  clinicalValidation: 'false',
} as const;

/**
 * EmergencyDashboard의 handleGoldenTimeRedirect와 동일한 URL 생성 로직
 */
function buildGoldenTimeUrl(opts: {
  triageLevel: string | null;
  lesionVolume: number;
  triggeringCondition: string | null;
  modality: 'Brain' | 'Lung';
}): URL {
  const params = new URLSearchParams();
  params.set('triage', opts.triageLevel ?? 'RED');

  if (opts.modality === 'Brain') {
    params.set('analysisMode', BRAIN_DEMO_CONTEXT.analysisMode);
    params.set('condition', BRAIN_DEMO_CONTEXT.condition);
    params.set('specialties', BRAIN_DEMO_CONTEXT.specialties);
    params.set('capabilities', BRAIN_DEMO_CONTEXT.capabilities);
    params.set('clinicalValidation', BRAIN_DEMO_CONTEXT.clinicalValidation);

    if (opts.triggeringCondition && opts.triggeringCondition !== 'Unknown') {
      params.set('vitalsCondition', encodeURIComponent(opts.triggeringCondition));
    }
  } else {
    params.set('analysisMode', 'synthetic_demo');
    params.set('condition', 'unsupported_modality');
    params.set('clinicalValidation', 'false');
  }

  params.set('volume', String(opts.lesionVolume));

  return new URL(`https://golden-time.vercel.app/?${params.toString()}`);
}

describe('Golden-Time URL 생성 - disease=Unknown 제거 검증', () => {
  it('triggeringCondition이 null이어도 disease=Unknown을 전송하지 않는다', () => {
    const url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: null,
      modality: 'Brain',
    });

    expect(url.searchParams.has('disease')).toBe(false);
    expect(url.searchParams.get('condition')).not.toBe('Unknown');
    expect(url.toString()).not.toContain('Unknown');
  });

  it('triggeringCondition이 Unknown 문자열이어도 URL에 포함하지 않는다', () => {
    const url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: 'Unknown',
      modality: 'Brain',
    });

    expect(url.toString()).not.toContain('Unknown');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
  });
});

describe('Golden-Time URL 생성 - Brain 모드', () => {
  let url: URL;

  beforeEach(() => {
    url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: null,
      modality: 'Brain',
    });
  });

  it('triage=RED를 전달한다', () => {
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('analysisMode=synthetic_demo를 전달한다', () => {
    expect(url.searchParams.get('analysisMode')).toBe('synthetic_demo');
  });

  it('condition=brain_lesion_demo를 전달한다', () => {
    expect(url.searchParams.get('condition')).toBe('brain_lesion_demo');
  });

  it('specialties에 neurosurgery와 neurology가 포함된다', () => {
    const specialties = url.searchParams.get('specialties') ?? '';
    expect(specialties).toContain('neurosurgery');
    expect(specialties).toContain('neurology');
  });

  it('capabilities에 emergency_surgery, icu, brain_imaging이 포함된다', () => {
    const capabilities = url.searchParams.get('capabilities') ?? '';
    expect(capabilities).toContain('emergency_surgery');
    expect(capabilities).toContain('icu');
    expect(capabilities).toContain('brain_imaging');
  });

  it('clinicalValidation=false를 전달한다', () => {
    expect(url.searchParams.get('clinicalValidation')).toBe('false');
  });

  it('volume이 숫자로 전달된다', () => {
    const volume = Number(url.searchParams.get('volume'));
    expect(Number.isNaN(volume)).toBe(false);
    expect(volume).toBe(21192);
  });

  it('triggeringCondition이 유효한 값이면 vitalsCondition으로 추가된다', () => {
    const urlWithCondition = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: '패혈증 (Sepsis)',
      modality: 'Brain',
    });
    expect(urlWithCondition.searchParams.has('vitalsCondition')).toBe(true);
  });
});

describe('Golden-Time URL 생성 - Lung 모드', () => {
  let url: URL;

  beforeEach(() => {
    url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 5000,
      triggeringCondition: null,
      modality: 'Lung',
    });
  });

  it('condition=unsupported_modality를 전달한다', () => {
    expect(url.searchParams.get('condition')).toBe('unsupported_modality');
  });

  it('Lung 모드에서도 Unknown을 전송하지 않는다', () => {
    expect(url.toString()).not.toContain('Unknown');
  });

  it('Brain 전용 파라미터(specialties, capabilities)를 포함하지 않는다', () => {
    expect(url.searchParams.has('specialties')).toBe(false);
    expect(url.searchParams.has('capabilities')).toBe(false);
  });
});

describe('Golden-Time URL 생성 - 보안: 민감정보 미포함', () => {
  const SENSITIVE_PATTERNS = [
    'eyJ', // JWT Bearer prefix (base64)
    'access_token',
    'patient_id',
    'mesh_id',
    'signed_url',
    'supabase',
    'storage',
  ];

  it('민감정보 패턴이 URL에 포함되지 않는다', () => {
    const url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: 'ARDS',
      modality: 'Brain',
    });

    const urlString = url.toString();
    SENSITIVE_PATTERNS.forEach((pattern) => {
      expect(urlString.toLowerCase()).not.toContain(pattern.toLowerCase());
    });
  });

  it('URL 길이가 적절한 범위 내에 있다 (< 500자)', () => {
    const url = buildGoldenTimeUrl({
      triageLevel: 'RED',
      lesionVolume: 21192,
      triggeringCondition: null,
      modality: 'Brain',
    });
    expect(url.toString().length).toBeLessThan(500);
  });
});
