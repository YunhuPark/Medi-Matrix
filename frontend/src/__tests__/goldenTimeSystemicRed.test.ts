import { describe, expect, it } from 'vitest';
import { buildGoldenTimeUrl } from '../lib/goldenTimeUrl';

describe('Golden-Time RED systemic deterioration context', () => {
  const makeRedUrl = (triage: string, vitalsCondition: string, hasSepsisRisk: boolean) =>
    buildGoldenTimeUrl({
      triage,
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition,
      hasSepsisRisk,
    });

  it('RED + Brain uses one systemic context', () => {
    const url = new URL(makeRedUrl(
      'RED (초응급 - 전신 악화)',
      'Shock-like',
      false,
    ));

    expect(url.searchParams.get('triage')).toBe('RED');
    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('analysisSources')).toBe('mri,vitals');
    expect(url.searchParams.has('vitalsCondition')).toBe(false);

    const capabilities = url.searchParams.get('capabilities') ?? '';
    expect(capabilities).toContain('emergency_room');
    expect(capabilities).toContain('icu');
    expect(capabilities).toContain('brain_imaging');
  });

  it('ARDS-like / Sepsis-like / Shock-like RED generate the same Golden-Time URL', () => {
    const ards = makeRedUrl(
      'RED (초응급 - ARDS 유사 위험)',
      'ARDS 유사 (ARDS-like)',
      false,
    );
    const sepsis = makeRedUrl(
      'RED (초응급 - 패혈증 유사 위험)',
      '패혈증 유사 (Sepsis-like)',
      true,
    );
    const shock = makeRedUrl(
      'RED (초응급 - 쇼크 유사 위험)',
      '쇼크 유사 (Shock-like)',
      false,
    );

    expect(sepsis).toBe(ards);
    expect(shock).toBe(ards);
  });

  it('YELLOW + Brain keeps brain as the primary ranking condition', () => {
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
});
