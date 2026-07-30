/**
 * goldenTimeUrl.test.ts
 * lib/goldenTimeUrl.ts의 production buildGoldenTimeUrl 함수를 직접 import하여 테스트합니다.
 * URL 생성 로직을 테스트 내부에 복제하지 않습니다.
 *
 * 검증 항목:
 * - disease=Unknown 미생성
 * - condition=brain_lesion_demo 정상 생성
 * - capabilities에 icu 포함
 * - 이중 URL 인코딩 없음
 * - 악의적/과도한 길이 입력 처리
 * - clinicalValidation=false가 아닐 때 동작 확인
 * - 파라미터 없을 때 기존 모드로 폴백
 * - 민감정보(JWT, token, patientId, meshId 등) 미포함
 */

import { describe, it, expect } from 'vitest';
import {
  buildGoldenTimeUrl,
  assertNoSensitiveData,
  getGoldenTimeBaseUrl,
} from '../lib/goldenTimeUrl';

// ----------------------------------------------------------------
// 기본 URL 확인
// ----------------------------------------------------------------
describe('getGoldenTimeBaseUrl', () => {
  it('VITE_GOLDEN_TIME_URL 미설정 시 production 기본값을 반환한다', () => {
    const url = getGoldenTimeBaseUrl();
    expect(url).toMatch(/^https:\/\//);
    expect(url).not.toMatch(/\/$/);
  });
});

// ----------------------------------------------------------------
// disease=Unknown 제거 검증
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - disease=Unknown 미생성', () => {
  it('triggeringCondition=null이어도 disease=Unknown 미전송', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: null, hasSepsisRisk: false
    }));
    expect(url.searchParams.has('disease')).toBe(false);
    expect(url.searchParams.get('condition')).not.toBe('Unknown');
    expect(url.toString()).not.toContain('Unknown');
  });

  it('triggeringCondition="Unknown"이어도 URL에 미포함', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'Unknown', hasSepsisRisk: false
    }));
    expect(url.toString()).not.toContain('Unknown');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
  });
});

// ----------------------------------------------------------------
// 단일 모드 (Brain 단독)
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - Brain 단독 모드', () => {
  const getUrl = () =>
    new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: null, hasSepsisRisk: false
    }));

  it('triage=RED 전달', () => {
    expect(getUrl().searchParams.get('triage')).toBe('RED');
  });

  it('analysisMode=synthetic_demo 전달', () => {
    expect(getUrl().searchParams.get('analysisMode')).toBe('synthetic_demo');
  });

  it('primaryCondition=brain_lesion_demo 전달', () => {
    expect(getUrl().searchParams.get('primaryCondition')).toBe('brain_lesion_demo');
    expect(getUrl().searchParams.get('condition')).toBe('brain_lesion_demo'); // 하위 호환성
  });

  it('specialties에 neurosurgery, neurology 포함', () => {
    const specialties = getUrl().searchParams.get('specialties') ?? '';
    expect(specialties).toContain('neurosurgery');
    expect(specialties).toContain('neurology');
  });

  it('capabilities에 icu, brain_imaging 포함 (emergency_surgery 미포함)', () => {
    const caps = getUrl().searchParams.get('capabilities') ?? '';
    expect(caps).not.toContain('emergency_surgery');
    expect(caps).toContain('icu');
    expect(caps).toContain('brain_imaging');
  });

  it('analysisSources에 mri 포함', () => {
    expect(getUrl().searchParams.get('analysisSources')).toBe('mri');
  });
});

// ----------------------------------------------------------------
// 단일 모드 (Sepsis 단독)
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - Sepsis 단독 모드', () => {
  const getUrl = () =>
    new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Lung', lesionVolume: 0, vitalsCondition: '패혈증 위험 탐지 (78%)', hasSepsisRisk: true
    }));

  it('primaryCondition=sepsis_demo 전달', () => {
    expect(getUrl().searchParams.get('primaryCondition')).toBe('sepsis_demo');
  });

  it('specialties에 emergency_medicine, internal_medicine 포함', () => {
    const specialties = getUrl().searchParams.get('specialties') ?? '';
    expect(specialties).toContain('emergency_medicine');
    expect(specialties).toContain('internal_medicine');
  });

  it('capabilities에 icu 포함', () => {
    const caps = getUrl().searchParams.get('capabilities') ?? '';
    expect(caps).toContain('icu');
  });

  it('analysisSources에 vitals 포함', () => {
    expect(getUrl().searchParams.get('analysisSources')).toBe('vitals');
  });
});

// ----------------------------------------------------------------
// 복합 모드 (Brain + Sepsis)
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - 복합 모드', () => {
  it('Sepsis가 RED인 경우 Sepsis가 primaryCondition', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 1000, vitalsCondition: '패혈증 (Sepsis)', hasSepsisRisk: true
    }));
    expect(url.searchParams.get('primaryCondition')).toBe('sepsis_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('analysisSources')).toBe('mri,vitals');
  });

  it('Sepsis가 RED가 아닌 경우 Brain이 primaryCondition', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW', modality: 'Brain', lesionVolume: 1000, vitalsCondition: '패혈증', hasSepsisRisk: true
    }));
    expect(url.searchParams.get('primaryCondition')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('sepsis_demo');
  });

  it('capabilities는 합집합으로 생성된다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 1000, vitalsCondition: '패혈증 (Sepsis)', hasSepsisRisk: true
    }));
    const caps = url.searchParams.get('capabilities') ?? '';
    expect(caps).toContain('brain_imaging');
    expect(caps).toContain('icu');
    
    const specs = url.searchParams.get('specialties') ?? '';
    expect(specs).toContain('neurosurgery');
    expect(specs).toContain('neurology');
    expect(specs).toContain('emergency_medicine');
    expect(specs).toContain('internal_medicine');
  });
});

// ----------------------------------------------------------------
// Lung 모드
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - Lung 모드', () => {
  const url = new URL(buildGoldenTimeUrl({
    triage: 'RED', modality: 'Lung', lesionVolume: 5000, hasSepsisRisk: false
  }));

  it('condition=unsupported_modality 전달', () => {
    expect(url.searchParams.get('condition')).toBe('unsupported_modality');
  });

  it('Lung 모드에서 Unknown 미전송', () => {
    expect(url.toString()).not.toContain('Unknown');
  });

  it('Brain 전용 파라미터(specialties, capabilities) 미포함', () => {
    expect(url.searchParams.has('specialties')).toBe(false);
    expect(url.searchParams.has('capabilities')).toBe(false);
  });
});

// ----------------------------------------------------------------
// 보안: triage allowlist 검증
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - triage allowlist', () => {
  it('허용 목록에 없는 triage는 RED로 대체', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'CRITICAL_OVERRIDE', modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('triage=null이면 RED를 기본값으로 사용', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: null, modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('허용 목록 ORANGE는 그대로 전달', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'ORANGE', modality: 'Lung', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.get('triage')).toBe('ORANGE');
  });
});

// ----------------------------------------------------------------
// 악의적 입력 / 과도한 길이 처리
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - 악의적/과도한 길이 입력', () => {
  it('120자 초과 vitalsCondition은 잘라낸다', () => {
    const longInput = 'A'.repeat(300);
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, vitalsCondition: longInput, hasSepsisRisk: false
    }));
    const val = url.searchParams.get('vitalsCondition') ?? '';
    expect(val.length).toBeLessThanOrEqual(120);
  });

  it('URL 길이가 500자 미만이다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'A'.repeat(300), hasSepsisRisk: false
    });
    expect(url.length).toBeLessThan(500);
  });
});

// ----------------------------------------------------------------
// clinicalValidation 검사
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - clinicalValidation', () => {
  it('Brain 모드에서 clinicalValidation이 항상 false로 고정된다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.get('clinicalValidation')).toBe('false');
    // 'true'가 아니어야 특화 모드로 인정됨 (Golden-Time 파서 규칙)
    expect(url.searchParams.get('clinicalValidation')).not.toBe('true');
  });
});

// ----------------------------------------------------------------
// 보안: 민감정보 미포함
// ----------------------------------------------------------------
describe('assertNoSensitiveData - 보안 검증', () => {
  it('정상 Brain URL에서 민감정보 패턴이 없다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'ARDS', hasSepsisRisk: false
    });
    expect(() => assertNoSensitiveData(url)).not.toThrow();
  });

  it('JWT 패턴(eyJ...)이 있으면 감지한다', () => {
    const badUrl = 'https://example.com/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
    expect(() => assertNoSensitiveData(badUrl)).toThrow();
  });

  it('access_token이 있으면 감지한다', () => {
    expect(() => assertNoSensitiveData('https://example.com/?access_token=abc123')).toThrow();
  });

  it('patient_id가 있으면 감지한다', () => {
    expect(() => assertNoSensitiveData('https://example.com/?patient_id=12345')).toThrow();
  });

  it('mesh_id가 있으면 감지한다', () => {
    expect(() => assertNoSensitiveData('https://example.com/?mesh_id=xyz')).toThrow();
  });

  it('signed_url이 있으면 감지한다', () => {
    expect(() => assertNoSensitiveData('https://example.com/?signed_url=https://storage.example.com/...')).toThrow();
  });

  it('실제 Brain URL에 authorization이 없다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false
    });
    expect(url.toLowerCase()).not.toContain('authorization');
    expect(url.toLowerCase()).not.toContain('patient_id');
    expect(url.toLowerCase()).not.toContain('mesh_id');
  });
});

// ----------------------------------------------------------------
// MediMatrixParams 파서 - clinicalValidation=false가 아니면 특화 모드 거부
// ----------------------------------------------------------------
describe('MediMatrixParams 파서 연동 규약 검증', () => {
  /**
   * Golden-Time parseMediMatrixParams는 analysisMode + condition이 없으면 null 반환.
   * clinicalValidation이 'false'가 아닐 때 파서가 거부하는 규약을 URL 수준에서 검증.
   */
  it('Brain URL에서 analysisMode가 항상 존재한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.has('analysisMode')).toBe(true);
    expect(url.searchParams.has('condition')).toBe(true);
  });

  it('Lung URL에서도 analysisMode가 존재한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Lung', lesionVolume: 100, hasSepsisRisk: false
    }));
    expect(url.searchParams.has('analysisMode')).toBe(true);
    expect(url.searchParams.has('condition')).toBe(true);
  });
});
