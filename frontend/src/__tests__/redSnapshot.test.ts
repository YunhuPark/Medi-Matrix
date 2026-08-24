import { describe, expect, it } from 'vitest';
import { reduceRedSnapshot, type RedSnapshot } from '../lib/redSnapshot';

const makeSnapshot = (overrides: Partial<RedSnapshot> = {}): RedSnapshot => ({
  patientId: 'mock_pt_1',
  triageLevel: 'RED (초응급 - ARDS 유사 위험)',
  lesionVolume: 21192,
  triggeringCondition: 'ARDS 유사 (ARDS-like)',
  hasSepsisRisk: false,
  modality: 'Brain',
  ...overrides,
});

describe('RED episode snapshot', () => {
  it('최초 RED에서 ARDS-like를 고정하고 이후 Sepsis-like live update를 무시한다', () => {
    const first = reduceRedSnapshot(null, makeSnapshot());

    const afterLiveUpdate = reduceRedSnapshot(
      first,
      makeSnapshot({
        triageLevel: 'RED (초응급 - 패혈증 유사 위험)',
        triggeringCondition: '패혈증 유사 (Sepsis-like)',
        hasSepsisRisk: true,
      }),
    );

    expect(afterLiveUpdate).toEqual(first);
    expect(afterLiveUpdate?.triggeringCondition).toBe('ARDS 유사 (ARDS-like)');
  });

  it('같은 RED episode에서 대시보드 재오픈을 가정해도 최초 snapshot 값이 유지된다', () => {
    const first = reduceRedSnapshot(null, makeSnapshot());
    const second = reduceRedSnapshot(
      first,
      makeSnapshot({ triggeringCondition: '쇼크 유사 (Shock-like)' }),
    );

    expect(second).toBe(first);
  });

  it('RED를 벗어나면 snapshot을 초기화하고 다음 RED에서 새로운 snapshot을 만든다', () => {
    const first = reduceRedSnapshot(null, makeSnapshot());
    const cleared = reduceRedSnapshot(
      first,
      makeSnapshot({ triageLevel: 'YELLOW (응급 - 집중 관찰)' }),
    );
    const nextEpisode = reduceRedSnapshot(
      cleared,
      makeSnapshot({
        triageLevel: 'RED (초응급 - 패혈증 유사 위험)',
        triggeringCondition: '패혈증 유사 (Sepsis-like)',
        hasSepsisRisk: true,
      }),
    );

    expect(cleared).toBeNull();
    expect(nextEpisode?.triggeringCondition).toBe('패혈증 유사 (Sepsis-like)');
    expect(nextEpisode?.hasSepsisRisk).toBe(true);
  });
});
