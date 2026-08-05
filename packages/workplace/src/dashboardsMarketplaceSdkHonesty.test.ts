import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createExecutionPlatform } from '@neuropause/execution';
import { createWorkplacePlatform } from './platform';
import { WORKSPACE_MATRIX } from './evidence';

describe('Modules 17,18,19,21-23 — Dashboards, Marketplace, SDK, Experience + honesty & reuse', () => {
  it('dashboards show real data or "No business data available"', async () => {
    const clock = new ManualClock(1);
    const rt = createEnterpriseRuntime({ clock });
    const wp = createWorkplacePlatform(rt, { clock });
    expect(wp.dashboard().build('employee').panels['tasks']).toBe('No business data available');
    await wp.notes().create({ ownerId: 'u1', kind: 'personal', title: 'n', body: 'x' });
    expect(wp.dashboard().build('employee').panels['notes']).toBe(1);
  });

  it('marketplace install, SDK register, providers adapter-verified, experience capabilities', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const wp = createWorkplacePlatform(rt, { clock });
    await wp.marketplace().install({ kind: 'widget', name: 'Clock Widget' });
    expect(wp.marketplace().count()).toBe(1);
    await wp.sdk().register({ kind: 'page', name: 'HomePage' });
    expect(wp.sdk().artifacts('page').length).toBe(1);
    await wp.providers().seed();
    expect(wp.providers().systems()).toEqual(expect.arrayContaining(['Gmail', 'Zoom', 'Google Drive', 'Slack']));
    expect(wp.providers().list()[0]!.evidence).toBe('adapter-verified');
    expect(wp.experience().desktopCapabilities().every((c) => c.evidence === 'adapter-verified')).toBe(true);
    expect(wp.experience().themes()).toContain('high-contrast');
  });

  it('reuses the Wave 5 execution connector count', async () => {
    const clock = new ManualClock(1000);
    const rt = createEnterpriseRuntime({ clock });
    const exec = createExecutionPlatform(rt, { clock });
    const wp = createWorkplacePlatform(rt, { clock, execution: exec });
    expect(wp.reusedConnectorCount()).toBe(22);
  });

  it('governs operations and keeps the four-level honesty boundary', async () => {
    const clock = new ManualClock(1000);
    const runtime = createEnterpriseRuntime({ clock });
    const wp = createWorkplacePlatform(runtime, { clock });
    await wp.workspaces().create({ name: 'X', scope: 'team' });
    await wp.providers().seed();
    expect(wp.governance().count()).toBeGreaterThan(0);
    expect(wp.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    const fabricated = WORKSPACE_MATRIX.filter(
      (m) => m.level === 'live-verified' && /retention|archiving|compliance export|real email|real video|public cloud|public messaging/i.test(m.capability),
    );
    expect(fabricated.length).toBe(0);
    const r = wp.readiness();
    expect(r.liveVerified).toBeGreaterThan(0);
    expect(r.adapterVerified).toBeGreaterThan(0);
    expect(r.businessDataPending).toBeGreaterThan(0);
    expect(r.regulatedExternal).toBeGreaterThan(0);
  });
});
