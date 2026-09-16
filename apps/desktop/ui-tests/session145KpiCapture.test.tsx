/**
 * S145 — on-demand governed KPI capture goes live at the renderer.
 *
 * `kpi:capture` (IpcChannel.KpiCapture) was a fully governed action in main since the executive-center
 * subsystem shipped — RBAC `intelligence:read`, tenant resolved server-side via `activeTenantScope`,
 * reads the active tenant's inventory and writes tenant-scoped kpi-snapshots + kpi-exceptions
 * (idempotent + immutable per period) — but had NO renderer path: an operator could see the executive
 * snapshot yet never trigger a fresh capture. S145 adds the `ipc.intelligence.kpiCapture` helper and the
 * "Capture KPIs" action on the ExecutiveCenterPanel.
 *
 * These tests prove the renderer→secure-preload→IPC wiring the new helper creates: the correct channel is
 * dispatched with an EMPTY payload (the renderer supplies no tenant/org — the store uses the active tenant
 * scope), and the governed response flows back. The main-side governance (authorization, tenant-from-scope,
 * idempotency/immutability) is certified in the executive-center subsystem suite.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, route, unroutedChannels } from './setup';
import { IpcChannel } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';

beforeEach(() => {
  clearRoutes();
});

describe('S145 · KPI capture renderer wiring', () => {
  it('dispatches kpi:capture with an EMPTY payload (no renderer-supplied tenant/org)', async () => {
    let sawPayload: Record<string, unknown> | undefined;
    route(IpcChannel.KpiCapture, (p) => {
      sawPayload = p as Record<string, unknown>;
      return { ok: true, captured: true };
    });
    const r = (await ipc.intelligence.kpiCapture()) as { ok: boolean; captured: boolean };
    expect(r.ok).toBe(true);
    expect(r.captured).toBe(true);
    expect(sawPayload).toEqual({}); // capture takes no arguments — tenant is server-resolved
    expect('tenantId' in (sawPayload ?? {})).toBe(false);
    expect('orgId' in (sawPayload ?? {})).toBe(false);
    expect('org' in (sawPayload ?? {})).toBe(false);
    expect(unroutedChannels()).toEqual([]);
  });

  it('returns captured:false honestly (already captured for this period — immutable, not an error)', async () => {
    route(IpcChannel.KpiCapture, () => ({ ok: true, captured: false }));
    const r = (await ipc.intelligence.kpiCapture()) as { ok: boolean; captured: boolean };
    expect(r.ok).toBe(true);
    expect(r.captured).toBe(false);
  });

  it('returns a governed refusal (ok:false) honestly, not thrown', async () => {
    route(IpcChannel.KpiCapture, () => ({ ok: false, captured: false }));
    const r = (await ipc.intelligence.kpiCapture()) as { ok: boolean; captured: boolean };
    expect(r.ok).toBe(false);
  });
});
