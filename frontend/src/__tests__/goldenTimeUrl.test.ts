/**
 * goldenTimeUrl.test.ts
 * Medi-Matrix → Golden-Time URL 계약 테스트.
 *
 * 최종 공모전 규약:
 * - RED는 Sepsis/ARDS/Shock 어느 패턴이 우세하더라도 정확히 같은
 *   systemic_deterioration_demo 병원 탐색 컨텍스트를 전달한다.
 * - Brain 영상이 있으면 brain_lesion_demo를 secondary context로 결합한다.
 * - RED의 vitalsCondition은 Medi-Matrix 설명 UI에만 남고 URL에는 전달하지 않는다.
 * - YELLOW + Brain은 brain_lesion_demo를 primary로 유지한다.
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

describe('RED systemic contract', () => {
  const makeBrainRed = (condition: string, hasSepsisRisk = false) =>
    buildGoldenTimeUrl({
      triage: `RED (초응급 - ${condition} 위험)`,
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: condition,
      hasSepsisRisk,
    });

  it('Sepsis-like RED도 systemic_deterioration_demo로 전달한다', () => {
    const url = new URL(makeBrainRed('패혈증 유사 (Sepsis-like)', true));

    expect(url.searchParams.get('triage')).toBe('RED');
    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('analysisSources')).toBe('mri,vitals');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
  });

  it('ARDS/Sepsis/Shock RED는 동일한 Golden-Time URL을 만든다', () => {
    const ards = makeBrainRed('ARDS 유사 (ARDS-like)');
    const sepsis = makeBrainRed('패혈증 유사 (Sepsis-like)', true);
    const shock = makeBrainRed('쇼크 유사 (Shock-like)');

    expect(sepsis).toBe(ards);
    expect(shock).toBe(ards);
  });

  it('RED systemic context에는 응급실/ICU와 Brain 영상 자원이 함께 포함된다', () => {
    const url = new URL(makeBrainRed('ARDS-like'));

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

  it('Lung + RED도 특정 질환 확정 대신 systemic context를 사용한다', () => {
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
    expect(url.searchParams.has('vitalsCondition')).toBe(false);
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
    expect(url.searchParams.get('vitalsCondition')).toBe('Sepsis-like');
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

  it('비-RED에서 vitalsCondition은 최대 120자로 제한한다', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW',
      modality: 'Brain',
      lesionVolume: 100,
      vitalsCondition: 'A'.repeat(300),
      hasSepsisRisk: true,
    }));
    expect((url.searchParams.get('vitalsCondition') ?? '').length).toBeLessThanOrEqual(120);
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
    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
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

  it('생성 URL은 최대 500자다', () => {
    const url = buildGoldenTimeUrl({
      triage: 'YELLOW', modality: 'Brain', lesionVolume: 21192, vitalsCondition: 'A'.repeat(300), hasSepsisRisk: true,
    });
    expect(url.length).toBeLessThanOrEqual(500);
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
