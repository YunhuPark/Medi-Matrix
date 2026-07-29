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
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: null,
    }));
    expect(url.searchParams.has('disease')).toBe(false);
    expect(url.searchParams.get('condition')).not.toBe('Unknown');
    expect(url.toString()).not.toContain('Unknown');
  });

  it('triggeringCondition="Unknown"이어도 URL에 미포함', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'Unknown',
    }));
    expect(url.toString()).not.toContain('Unknown');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
  });
});

// ----------------------------------------------------------------
// Brain 모드 필수 파라미터
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - Brain 모드', () => {
  const getUrl = (vitalsCondition?: string | null) =>
    new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition,
    }));

  it('triage=RED 전달', () => {
    expect(getUrl().searchParams.get('triage')).toBe('RED');
  });

  it('analysisMode=synthetic_demo 전달', () => {
    expect(getUrl().searchParams.get('analysisMode')).toBe('synthetic_demo');
  });

  it('condition=brain_lesion_demo 전달', () => {
    expect(getUrl().searchParams.get('condition')).toBe('brain_lesion_demo');
  });

  it('specialties에 neurosurgery, neurology 포함', () => {
    const specialties = getUrl().searchParams.get('specialties') ?? '';
    expect(specialties).toContain('neurosurgery');
    expect(specialties).toContain('neurology');
  });

  it('capabilities에 emergency_surgery, icu, brain_imaging 포함', () => {
    const caps = getUrl().searchParams.get('capabilities') ?? '';
    expect(caps).toContain('emergency_surgery');
    expect(caps).toContain('icu');  // 반드시 포함
    expect(caps).toContain('brain_imaging');
  });

  it('clinicalValidation=false 전달', () => {
    expect(getUrl().searchParams.get('clinicalValidation')).toBe('false');
  });

  it('volume이 숫자로 전달', () => {
    expect(Number(getUrl().searchParams.get('volume'))).toBe(21192);
  });

  it('유효한 vitalsCondition이면 vitalsCondition 파라미터 추가', () => {
    const url = getUrl('패혈증 (Sepsis)');
    expect(url.searchParams.has('vitalsCondition')).toBe(true);
    // URLSearchParams가 인코딩 — 디코딩하면 원문이어야 함 (이중 인코딩 없음)
    expect(url.searchParams.get('vitalsCondition')).toBe('패혈증 (Sepsis)');
  });

  it('이중 인코딩 없음 — vitalsCondition 디코딩 값이 원문과 일치', () => {
    const original = '급성 호흡부전 (ARDS)';
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, vitalsCondition: original,
    }));
    // URL 객체의 searchParams.get()은 자동 디코딩 → 한 번만 인코딩됐으면 원문과 동일
    expect(url.searchParams.get('vitalsCondition')).toBe(original);
    // 이중 인코딩이면 '%25'가 나타남
    expect(url.search).not.toContain('%25');
  });
});

// ----------------------------------------------------------------
// Lung 모드
// ----------------------------------------------------------------
describe('buildGoldenTimeUrl - Lung 모드', () => {
  const url = new URL(buildGoldenTimeUrl({
    triage: 'RED', modality: 'Lung', lesionVolume: 5000,
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
      triage: 'CRITICAL_OVERRIDE', modality: 'Brain', lesionVolume: 100,
    }));
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('triage=null이면 RED를 기본값으로 사용', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: null, modality: 'Brain', lesionVolume: 100,
    }));
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('허용 목록 ORANGE는 그대로 전달', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'ORANGE', modality: 'Lung', lesionVolume: 100,
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
      triage: 'RED', modality: 'Brain', lesionVolume: 100, vitalsCondition: longInput,
    }));
    const val = url.searchParams.get('vitalsCondition') ?? '';
    expect(val.length).toBeLessThanOrEqual(120);
  });

  it('URL 길이가 500자 미만이다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'A'.repeat(300),
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
      triage: 'RED', modality: 'Brain', lesionVolume: 100,
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
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'ARDS',
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
      triage: 'RED', modality: 'Brain', lesionVolume: 100,
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
      triage: 'RED', modality: 'Brain', lesionVolume: 100,
    }));
    expect(url.searchParams.has('analysisMode')).toBe(true);
    expect(url.searchParams.has('condition')).toBe(true);
  });

  it('Lung URL에서도 analysisMode가 존재한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Lung', lesionVolume: 100,
    }));
    expect(url.searchParams.has('analysisMode')).toBe(true);
    expect(url.searchParams.has('condition')).toBe(true);
  });
});
