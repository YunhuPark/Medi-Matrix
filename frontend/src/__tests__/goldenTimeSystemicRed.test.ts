import { describe, expect, it } from 'vitest';
import { buildGoldenTimeUrl } from '../lib/goldenTimeUrl';

describe('Golden-Time RED systemic deterioration context', () => {
  it('RED + Brain + Vitals uses systemic context even when sepsisHighRisk is false', () => {
    const url = new URL(buildGoldenTimeUrl({
      triage: 'RED (초응급 - 전신 악화)',
      modality: 'Brain',
      lesionVolume: 21192,
      vitalsCondition: 'Shock-like',
      hasSepsisRisk: false,
    }));

    expect(url.searchParams.get('triage')).toBe('RED');
    expect(url.searchParams.get('primaryCondition')).toBe('systemic_deterioration_demo');
    expect(url.searchParams.get('secondaryConditions')).toBe('brain_lesion_demo');
    expect(url.searchParams.get('analysisSources')).toBe('mri,vitals');

    const capabilities = url.searchParams.get('capabilities') ?? '';
    expect(capabilities).toContain('emergency_room');
    expect(capabilities).toContain('icu');
    expect(capabilities).toContain('brain_imaging');
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
  });
});
