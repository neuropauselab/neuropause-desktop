import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createAutonomousOpsPlatform } from './platform';
import { OPERATIONS_MATRIX, operationsReadiness } from './evidence';
import { REGULATED_OPS } from './constants';

describe('M17–M20 — SDK, marketplace, governance, honesty boundary & reuse', () => {
  it('the SDK rejects an extension that reuses nothing (compose, do not fork)', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    await expect(ops.sdk().register({ kind: 'operations-module', name: 'rogue', reuses: [] })).rejects.toThrow(/reuse at least one/);
    const m = await ops.sdk().register({ kind: 'operations-module', name: 'good', reuses: ['M1'] });
    expect(m.reuses).toEqual(['M1']);
  });

  it('marketplace listings are not executed until installed', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const item = await ops.marketplace().publish({ kind: 'mission-pack', name: 'Incident Response', provider: 'acme' });
    expect(item.installed).toBe(false);
    const installed = await ops.marketplace().install(item.id);
    expect(installed.installed).toBe(true);
  });

  it('every operational action is audited on the ONE chain with evidence + a replay id', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    const events: Array<Record<string, unknown>> = [];
    rt.events().subscribe((e) => e.type === 'operations.action', (e) => { events.push(e.payload as Record<string, unknown>); });

    await ops.runtime().createMission({ name: 'Launch', orgId: 'org1' });
    expect(ops.governance().count()).toBeGreaterThan(0);
    expect(ops.governance().verify()).toBe(true);
    expect(rt.audit().verify().valid).toBe(true);
    const last = events[events.length - 1]!;
    expect(last['replayId']).toBeTruthy();
    expect(last).toHaveProperty('evidence');
  });

  it('reuses the Wave 5 execution connector count (does not duplicate connectors)', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const ops = createAutonomousOpsPlatform(rt, { clock, execution: exec });
    expect(ops.reusedConnectorCount()).toBe(22);
  });

  it('reuses the Wave 4 HITL gate — regulated operations are never AI-allowed', () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const ops = createAutonomousOpsPlatform(rt, { clock });
    for (const op of REGULATED_OPS) {
      expect(ops.classifyOperation(op).aiAllowed).toBe(false);
    }
  });

  it('keeps the four-level honesty boundary — no autonomous/regulated capability is live-verified', () => {
    const live = OPERATIONS_MATRIX.filter((m) => m.level === 'live-verified' && /^autonomous /i.test(m.capability));
    expect(live).toHaveLength(0);

    const regulated = OPERATIONS_MATRIX.filter((m) => m.level === 'regulated-external');
    expect(regulated.length).toBe(REGULATED_OPS.length); // all 8 regulated ops are represented only

    const r = operationsReadiness();
    expect(r.total).toBe(OPERATIONS_MATRIX.length);
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBe(5);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBe(8);
  });
});
