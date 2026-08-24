import { describe, expect, it } from 'vitest';
import { buildGoldenTimeUrl, normalizeTriageLevel } from '../lib/goldenTimeUrl';

describe('normalizeTriageLevel', () => {
  it('normalizes UI labels without converting GREEN/YELLOW to RED', () => {
    expect(normalizeTriageLevel('GREEN (안정 - 일반 관찰)')).toBe('GREEN');
    expect(normalizeTriageLevel('YELLOW (응급 - 집중 모니터링)')).toBe('YELLOW');
    expect(normalizeTriageLevel('RED (초응급 - 패혈증 유사 위험)')).toBe('RED');
  });

  it('passes normalized value to Golden-Time URL', () => {
    const green = new URL(buildGoldenTimeUrl({
      triage: 'GREEN (안정 - 일반 관찰)',
      modality: 'Brain',
      lesionVolume: 21192,
      hasSepsisRisk: false,
    }));
    const yellow = new URL(buildGoldenTimeUrl({
      triage: 'YELLOW (응급 - 집중 모니터링)',
      modality: 'Brain',
      lesionVolume: 21192,
      hasSepsisRisk: false,
    }));

    expect(green.searchParams.get('triage')).toBe('GREEN');
    expect(yellow.searchParams.get('triage')).toBe('YELLOW');
  });
});
