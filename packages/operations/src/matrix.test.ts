import { describe, it, expect } from 'vitest';
import { OPERATIONS_MATRIX, INFRA_PENDING_IDS, readinessSummary } from './matrix';

describe('Operational Readiness Matrix — anti-fabrication invariants', () => {
  it('keeps real-infrastructure capabilities INFRA-PENDING', () => {
    for (const id of ['coord.cluster', 'dr.cluster', 'perf.scale', 'deploy.live', 'obs.export', 'opsec.stores']) {
      expect(INFRA_PENDING_IDS.has(id)).toBe(true);
      expect(OPERATIONS_MATRIX.find((e) => e.id === id)?.evidence).toBe('infra-pending');
    }
  });

  it('marks the real-Postgres DR drill VERIFIED but cluster DR INFRA-PENDING', () => {
    expect(OPERATIONS_MATRIX.find((e) => e.id === 'dr.realpg')?.evidence).toBe('verified');
    expect(OPERATIONS_MATRIX.find((e) => e.id === 'dr.cluster')?.evidence).toBe('infra-pending');
  });

  it('gives every capability a unique id, an area, and a declared evidence level', () => {
    const ids = new Set<string>();
    for (const e of OPERATIONS_MATRIX) {
      expect(['verified', 'infra-pending']).toContain(e.evidence);
      expect(e.area).toBeTruthy();
      expect(e.capability).toBeTruthy();
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it('reconciles the readiness summary with the matrix', () => {
    const s = readinessSummary();
    expect(s.total).toBe(OPERATIONS_MATRIX.length);
    expect(s.verified + s.infraPending).toBe(s.total);
    expect(s.infraPending).toBe(INFRA_PENDING_IDS.size);
    expect(s.verified).toBeGreaterThan(0);
    expect(s.infraPending).toBeGreaterThan(0);
  });
});
