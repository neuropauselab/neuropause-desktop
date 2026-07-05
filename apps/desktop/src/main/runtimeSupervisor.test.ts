import { describe, expect, it } from 'vitest';
import {
  defaultRecoveryPolicies,
  evaluateSupervisor,
  isFailing,
  type SubsystemHealth,
} from '@neuropause/shared';

function sub(id: string, level: SubsystemHealth['level']): SubsystemHealth {
  return { id: id as SubsystemHealth['id'], label: id, level };
}

describe('isFailing', () => {
  it('is true only for critical/offline', () => {
    expect(isFailing('critical')).toBe(true);
    expect(isFailing('offline')).toBe(true);
    expect(isFailing('degraded')).toBe(false);
    expect(isFailing('healthy')).toBe(false);
  });
});

describe('evaluateSupervisor (V5.3)', () => {
  const now = Date.parse('2026-01-10T00:00:00.000Z');

  it('recovers a failing subsystem under automatic policy', () => {
    const d = evaluateSupervisor({
      subsystems: [sub('backend', 'critical'), sub('platform', 'healthy')],
      policies: defaultRecoveryPolicies(),
      recentAttempts: [],
      nowMs: now,
    });
    expect(d.actions.map((a) => a.subsystem)).toEqual(['backend']);
    expect(d.needsManual).toEqual([]);
    expect(d.escalate).toEqual([]);
  });

  it('does not recover healthy or degraded subsystems', () => {
    const d = evaluateSupervisor({
      subsystems: [sub('voice', 'degraded'), sub('automation', 'healthy')],
      policies: defaultRecoveryPolicies(),
      recentAttempts: [],
      nowMs: now,
    });
    expect(d.actions).toEqual([]);
  });

  it('surfaces manual-policy subsystems instead of auto-recovering', () => {
    const policies = defaultRecoveryPolicies();
    policies.voice = 'manual';
    const d = evaluateSupervisor({
      subsystems: [sub('voice', 'offline')],
      policies,
      recentAttempts: [],
      nowMs: now,
    });
    expect(d.actions).toEqual([]);
    expect(d.needsManual).toEqual(['voice']);
  });

  it('skips disabled subsystems entirely', () => {
    const policies = defaultRecoveryPolicies();
    policies.backend = 'disabled';
    const d = evaluateSupervisor({
      subsystems: [sub('backend', 'critical')],
      policies,
      recentAttempts: [],
      nowMs: now,
    });
    expect(d.actions).toEqual([]);
    expect(d.needsManual).toEqual([]);
  });

  it('backs off within the cooldown window', () => {
    const d = evaluateSupervisor({
      subsystems: [sub('backend', 'critical')],
      policies: defaultRecoveryPolicies(),
      recentAttempts: [{ subsystem: 'backend', at: now - 5_000, ok: false }],
      nowMs: now,
      cooldownMs: 30_000,
    });
    expect(d.actions).toEqual([]);
  });

  it('retries again after the cooldown passes', () => {
    const d = evaluateSupervisor({
      subsystems: [sub('backend', 'critical')],
      policies: defaultRecoveryPolicies(),
      recentAttempts: [{ subsystem: 'backend', at: now - 40_000, ok: false }],
      nowMs: now,
      cooldownMs: 30_000,
    });
    expect(d.actions.map((a) => a.subsystem)).toEqual(['backend']);
  });

  it('escalates instead of retrying after repeated failures', () => {
    const d = evaluateSupervisor({
      subsystems: [sub('backend', 'critical')],
      policies: defaultRecoveryPolicies(),
      recentAttempts: [
        { subsystem: 'backend', at: now - 40_000, ok: false },
        { subsystem: 'backend', at: now - 80_000, ok: false },
        { subsystem: 'backend', at: now - 120_000, ok: false },
      ],
      nowMs: now,
      cooldownMs: 30_000,
      maxFailuresBeforeEscalate: 3,
    });
    expect(d.actions).toEqual([]);
    expect(d.escalate).toEqual(['backend']);
  });
});
