/**
 * Phase 6 Stage 9 — continuity composition: honest zeros for unconfigured
 * mechanisms, observed RPO ONLY from the last recorded validation (never the
 * target), integrity failures surfaced verbatim, and evidence attached only
 * when something real exists.
 */
import { describe, expect, it } from 'vitest';
import { buildContinuityView, type ContinuityInput } from './continuityPlanner';

const NOW_ISO = '2026-07-31T09:00:00.000Z';

function input(over: Partial<ContinuityInput> = {}): ContinuityInput {
  return {
    nowIso: NOW_ISO,
    posture: { haEnabled: false, multiRegion: false, rpoTargetSeconds: 300, rtoTargetSeconds: 3600, lastDrillAt: null, score: 40 },
    replicas: [],
    validations: [],
    localBackups: [],
    supervisor: { recoveryCount: 2, recentFailures: 0 },
    failures: {},
    ...over,
  };
}

describe('buildContinuityView — honest zero', () => {
  it('zero replicas / validations / backups produce explicit honest-zero statements with NO evidence', () => {
    const v = buildContinuityView(input());
    expect(v.replication).toEqual({ replicas: 0, inSync: 0, lagging: 0 });
    expect(v.validations).toEqual({ total: 0, lastAt: null, lastStatus: null, rpoObservedSeconds: null });
    expect(v.localBackups).toEqual({ count: 0, lastAt: null, lastValid: null });
    const backups = v.mechanisms.find((m) => m.name === 'Local sha256-manifest backups')!;
    expect(backups.detail).toContain('ZERO local backups');
    expect(backups.evidence).toEqual([]);
    const repl = v.mechanisms.find((m) => m.name === 'Cross-region replication')!;
    expect(repl.detail).toContain('ZERO replicas configured');
    const val = v.mechanisms.find((m) => m.name === 'Sandbox-validated recovery')!;
    expect(val.detail).toContain('never assumed from targets');
  });

  it('observed RPO comes ONLY from the newest recorded validation', () => {
    const v = buildContinuityView(
      input({
        validations: [
          { status: 'pass', rpoSeconds: 180, validatedAt: '2026-07-01T00:00:00.000Z' },
          { status: 'fail', rpoSeconds: 240, validatedAt: '2026-07-20T00:00:00.000Z' }, // newest
        ],
      }),
    );
    expect(v.validations).toEqual({ total: 2, lastAt: '2026-07-20T00:00:00.000Z', lastStatus: 'fail', rpoObservedSeconds: 240 });
    const val = v.mechanisms.find((m) => m.name === 'Sandbox-validated recovery')!;
    expect(val.evidence).toEqual(['dr-validations']);
  });

  it('replication counts in_sync vs lagging; backups surface integrity failure verbatim', () => {
    const v = buildContinuityView(
      input({
        replicas: [{ status: 'in_sync' }, { status: 'lagging' }, { status: 'failed' }],
        localBackups: [
          { createdAt: '2026-07-01T00:00:00.000Z', valid: true },
          { createdAt: '2026-07-25T00:00:00.000Z', valid: false }, // newest, integrity failed
        ],
      }),
    );
    expect(v.replication).toEqual({ replicas: 3, inSync: 1, lagging: 2 });
    expect(v.localBackups).toEqual({ count: 2, lastAt: '2026-07-25T00:00:00.000Z', lastValid: false });
    expect(v.mechanisms.find((m) => m.name === 'Local sha256-manifest backups')!.detail).toContain('INTEGRITY FAILED');
  });

  it('null reads (store unavailable) stay null with the mechanism saying so', () => {
    const v = buildContinuityView(input({ posture: null, replicas: null, validations: null, localBackups: null, supervisor: null, failures: { 'dr-store': 'offline' } }));
    expect(v.posture).toBeNull();
    expect(v.replication).toBeNull();
    expect(v.validations).toBeNull();
    expect(v.localBackups).toBeNull();
    expect(v.mechanisms.find((m) => m.name === 'Runtime supervisor recovery')!.detail).toContain('unavailable');
    expect(v.unavailable).toContainEqual({ system: 'dr-store', reason: 'offline' });
  });

  it('the always-real recovery mechanisms cite their existing surfaces', () => {
    const v = buildContinuityView(input());
    expect(v.mechanisms.find((m) => m.name === 'Execution interruption recovery')!.evidence).toEqual(['execute-engine']);
    expect(v.mechanisms.find((m) => m.name === 'Workflow replay')!.detail).toContain('recover()');
    expect(v.mechanisms.find((m) => m.name === 'Runtime supervisor recovery')!.detail).toContain('2 recovery record(s)');
  });
});
