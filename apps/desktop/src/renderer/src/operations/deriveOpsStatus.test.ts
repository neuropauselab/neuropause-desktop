/**
 * RC Phase 1 (P3) — the Operations header may show "Live" ONLY when its backing
 * data actually loaded. These tests lock the honest status derivation so a future
 * change can't reintroduce a green "Live" over a failed refresh.
 */
import { describe, expect, it } from 'vitest';
import { deriveOpsStatus, opsStatusMeta } from './lib';

describe('deriveOpsStatus', () => {
  it('is live only when every refresh succeeded', () => {
    expect(deriveOpsStatus([true, true, true, true])).toBe('live');
  });

  it('is offline when every refresh failed', () => {
    expect(deriveOpsStatus([false, false, false, false])).toBe('offline');
  });

  it('is degraded when only some refreshes failed', () => {
    expect(deriveOpsStatus([true, false, true, true])).toBe('degraded');
    expect(deriveOpsStatus([false, true])).toBe('degraded');
  });

  it('treats an empty result set as offline (nothing loaded)', () => {
    expect(deriveOpsStatus([])).toBe('offline');
  });

  it('GUARANTEE: never reports live if any call failed', () => {
    expect(deriveOpsStatus([true, true, true, false])).not.toBe('live');
  });
});

describe('opsStatusMeta', () => {
  it('pulses ONLY when live', () => {
    expect(opsStatusMeta('live').pulse).toBe(true);
    for (const s of ['connecting', 'degraded', 'offline'] as const) {
      expect(opsStatusMeta(s).pulse).toBe(false);
    }
  });

  it('labels each state honestly', () => {
    expect(opsStatusMeta('live').label).toBe('Live');
    expect(opsStatusMeta('degraded').label).toBe('Degraded');
    expect(opsStatusMeta('offline').label).toBe('Offline');
    expect(opsStatusMeta('connecting').label).toBe('Connecting…');
  });

  it('uses only defined system colour tokens (no sysred)', () => {
    for (const s of ['live', 'degraded', 'offline', 'connecting'] as const) {
      expect(opsStatusMeta(s).dot).not.toContain('sysred');
    }
  });
});
