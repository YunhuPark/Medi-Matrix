export interface RedSnapshot {
  patientId: string | null;
  triageLevel: string | null;
  lesionVolume: number;
  triggeringCondition: string | null;
  hasSepsisRisk: boolean;
  modality: 'Brain' | 'Lung';
}

/**
 * RED episode snapshot reducer.
 *
 * - The first RED input creates the snapshot.
 * - Further RED updates keep the original snapshot unchanged.
 * - Leaving RED clears the snapshot so a later RED episode can capture fresh data.
 */
export function reduceRedSnapshot(
  current: RedSnapshot | null,
  next: RedSnapshot,
): RedSnapshot | null {
  const isRed = Boolean(next.triageLevel?.trim().toUpperCase().startsWith('RED'));

  if (!isRed) {
    return null;
  }

  return current ?? { ...next };
}
