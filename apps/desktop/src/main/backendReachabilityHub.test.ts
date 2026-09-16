/**
 * P13C GATE 2 — the backend-reachability hub is best-effort, like its siblings.
 * It carries the reachable edge from the telemetry sampler to the auth
 * re-restore; a throwing subscriber must never withhold the edge from the rest.
 */
import { describe, expect, it, vi } from 'vitest';
import { onBackendReachable, announceBackendReachable } from './backendReachabilityHub';

describe('P13C Gate 2 — backendReachabilityHub', () => {
  it('delivers the edge to every registered listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    onBackendReachable(a);
    onBackendReachable(b);
    announceBackendReachable();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not stop the others (best-effort)', () => {
    const after = vi.fn();
    onBackendReachable(() => {
      throw new Error('listener boom');
    });
    onBackendReachable(after);
    expect(() => announceBackendReachable()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
