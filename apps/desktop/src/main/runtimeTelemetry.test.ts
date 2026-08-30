/**
 * P13C GATE 2 — the backend-reachability EDGE.
 *
 * `probeBackend` is the single source of truth for whether the backend is
 * reachable. The auth re-restore must fire on the RECOVERY transition
 * (recovering|disconnected → connected), exactly once per recovery — never on
 * every healthy probe (which would re-invoke the restore repeatedly) and never
 * while the backend is merely staying up. These pin that edge behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getAppPath: () => '/tmp',
    isPackaged: false,
    getVersion: () => '0.0.0-test',
  },
}));

import { RuntimeTelemetrySampler } from './runtimeTelemetry';

/** A fetch stub that walks a fixed ok/not-ok sequence (last value repeats). */
function fetchSequence(seq: boolean[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const ok = seq[Math.min(i, seq.length - 1)]!;
    i += 1;
    return { ok } as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('P13C Gate 2 — backend reachability edge', () => {
  it('fires the recovery callback ONCE on the transition into connected, not on every healthy probe', async () => {
    const onRecovered = vi.fn();
    const sampler = new RuntimeTelemetrySampler(Date.now, onRecovered);
    vi.stubGlobal('fetch', fetchSequence([true, true, false, false, false, true]));

    await sampler.probeBackend(0); // recovering → connected: EDGE
    expect(onRecovered).toHaveBeenCalledTimes(1);

    await sampler.probeBackend(0); // still connected: no re-fire
    expect(onRecovered).toHaveBeenCalledTimes(1);

    await sampler.probeBackend(0); // fail 1 → recovering
    await sampler.probeBackend(0); // fail 2 → recovering
    await sampler.probeBackend(0); // fail 3 → disconnected
    expect(onRecovered).toHaveBeenCalledTimes(1); // failures never fire the edge

    await sampler.probeBackend(0); // disconnected → connected: EDGE again
    expect(onRecovered).toHaveBeenCalledTimes(2);
  });

  it('is inert with no callback injected — a probe never throws', async () => {
    const sampler = new RuntimeTelemetrySampler(Date.now);
    vi.stubGlobal('fetch', fetchSequence([true]));
    await expect(sampler.probeBackend(0)).resolves.toBeUndefined();
  });

  it('an http_error (res.ok=false) is a failure, never a recovery edge', async () => {
    const onRecovered = vi.fn();
    const sampler = new RuntimeTelemetrySampler(Date.now, onRecovered);
    vi.stubGlobal('fetch', fetchSequence([false]));
    await sampler.probeBackend(0);
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
