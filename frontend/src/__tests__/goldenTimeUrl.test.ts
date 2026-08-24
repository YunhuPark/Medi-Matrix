/**
 * goldenTimeUrl.test.ts
 * Medi-Matrix → Golden-Time URL 계약 테스트.
 *
 * 최종 공모전 규약:
 * - RED + Vitals는 Sepsis/ARDS/Shock 어느 패턴이 우세하더라도
 *   특정 질환 확정이 아닌 systemic_deterioration_demo로 전달한다.
 * - Brain 영상이 있으면 brain_lesion_demo를 secondary context로 결합한다.
 * - YELLOW + Brain은 brain_lesion_demo를 primary로 유지한다.
 * - vitalsCondition은 설명용 문자열이며 진단명/primary condition으로 사용하지 않는다.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGoldenTimeUrl,
  assertNoSensitiveData,
  getGoldenTimeBaseUrl,
} from '../lib/goldenTimeUrl';

describe('getGoldenTimeBaseUrl', () => {
  it('production 기본 URL은 https이고 trailing slash가 없다', () => {
    const url = getGoldenTimeBaseUrl();
    expect(url).toMatch(/^https:\/\//);
    expect(url).not.toMatch(/\/$/);
  });
});

describe('RED + Vitals systemic contract', () => {
  it('Sepsis-like RED도 systemic_deterioration_demo로 전달한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED (초응급 - 패혈증 유사 위험)',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: '패혈증 유사 (Sepsis-like)',
      hasSepsisRisk: true,
    }));

    expect(url.searchParams.get('triage')).toBe('RED');
    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('analysisSources')).toBe('mri,vitals');
    expect(url.searchParams.get('vitalsCondition')).toBe('패혈증 유사 (Sepsis-like)');
  });

  it('ARDS-like RED도 동일한 systemic context를 사용한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED (초응급 - ARDS 유사 위험)',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: 'ARDS 유사 (ARDS-like)',
      hasSepsisRisk: false,
    }));

    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('vitalsCondition')).toBe('ARDS 유사 (ARDS-like)');
  });

  it('Shock-like RED도 동일한 systemic context를 사용한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED (초응급 - 쇼크 유사 위험)',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: '쇼크 유사 (Shock-like)',
      hasSepsisRisk: false,
    }));

    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
  });

  it('RED systemic context에는 응급실/ICU와 Brain 영상 자원이 함께 포함된다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: 'ARDS-like',
      hasSepsisRisk: false,
    }));

    const caps = url.searchParams.get('capabilities') ?? '';
    expect(caps).toContain('emergency_room');
    expect(caps).toContain('icu');
    expect(caps).toContain('brain_imaging');

    const specs = url.searchParams.get('specialties') ?? '';
    expect(specs).toContain('emergency_medicine');
    expect(specs).toContain('internal_medicine');
    expect(specs).toContain('neurosurgery');
    expect(specs).toContain('neurology');
  });

  it('Lung + RED + Vitals도 특정 질환 확정 대신 systemic context를 사용한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED',
      modality: 'Lung',
      lesionVolume: 0,
      vitalsCondition: '패혈증 유사 (Sepsis-like)',
      hasSepsisRisk: true,
    }));

    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.has('secondaryConditions')).toBe(false);
    expect(url.searchParams.get('analysisSources')).toBe('vitals');
  });
});

describe('YELLOW / Brain contract', () => {
  it('YELLOW + Brain은 brain_lesion_demo를 primary로 유지한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW (응급 - 집중 관찰)',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: 'Sepsis-like',
      hasSepsisRisk: true,
    }));

    expect(url.searchParams.get('triage')).toBe('YELLOW');
    expect(url.searchParams.get('primaryCondition')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('sepsis_demo');
  });

  it('Brain 단독이면 MRI source와 brain capabilities를 유지한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW',
      modality: 'Brain',
      lesionVolume: 100,
      vitalsCondition: null,
      hasSepsisRisk: false,
    }));

    expect(url.searchParams.get('analysisSources')).toBe('mri');
    expect(url.searchParams.get('primaryCondition')).toBe('brain_lesion_demo');
    const caps = url.searchParams.get('capabilities') ?? '';
    expect(caps).toContain('brain_imaging');
    expect(caps).toContain('icu');
  });
});

describe('input normalization and safety', () => {
  it('Unknown은 URL에 전달하지 않는다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: 'Unknown',
      hasSepsisRisk: false,
    }));
    expect(url.toString()).not.toContain('Unknown');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
  });

  it('허용되지 않은 triage는 RED로 정규화한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'CRITICAL_OVERRIDE',
      modality: 'Brain',
      lesionVolume: 100,
      hasSepsisRisk: false,
    }));
    expect(url.searchParams.get('triage')).toBe('RED');
  });

  it('문장형 RED/YELLOW 값을 정규화한다', () => {
    const red = new URL(buildGoldenTimeUrl({
      triage: 'RED (초응급 - ARDS 유사 위험)', modality: 'Brain', lesionVolume: 100, vitalsCondition: 'ARDS-like', hasSepsisRisk: false,
    }));
    const yellow = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW (응급 - 집중 관찰)', modality: 'Brain', lesionVolume: 100, hasSepsisRisk: false,
    }));
    expect(red.searchParams.get('triage')).toBe('RED');
    expect(yellow.searchParams.get('triage')).toBe('YELLOW');
  });

  it('clinicalValidation은 항상 false다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, vitalsCondition: 'ARDS-like', hasSepsisRisk: false,
    }));
    expect(url.searchParams.get('clinicalValidation')).toBe('false');
  });

  it('vitalsCondition은 최대 120자로 제한한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 100, vitalsCondition: 'A'.repeat(300), hasSepsisRisk: false,
    }));
    expect((url.searchParams.get('vitalsCondition') ?? '').length).toBeLessThanOrEqual(120);
  });

  it('생성 URL은 500자 미만이다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'A'.repeat(300), hasSepsisRisk: false,
    });
    expect(url.length).toBeLessThan(500);
  });

  it('민감정보가 없는 정상 URL은 보안 검증을 통과한다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'RED', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'ARDS-like', hasSepsisRisk: false,
    });
    expect(() => assertNoSensitiveData(url)).not.toThrow();
  });

  it('민감정보 패턴은 차단한다', () => {
    expect(() => assertNoSensitiveData('https://example.com/?access_token=abc123')).toThrow();
    expect(() => assertNoSensitiveData('https://example.com/?patient_id=12345')).toThrow();
    expect(() => assertNoSensitiveData('https://example.com/?mesh_id=xyz')).toThrow();
    expect(() => assertNoSensitiveData('https://example.com/?signed_url=https://storage.example.com/x')).toThrow();
  });
});
