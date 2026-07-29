import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createWorkforcePlatform, type WorkforcePlatform } from './platform';

describe('Modules 1,2,3,4,9 — Registry, Workers, Memory', () => {
  let runtime: EnterpriseRuntime;
  let wf: WorkforcePlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    wf = createWorkforcePlatform(runtime, { clock });
  });

  it('worker catalogs: 7 department + 16 business + 12 industry templates', () => {
    expect(wf.workers().length).toBe(35);
    expect(wf.workers().filter((w) => w.category === 'department').length).toBe(7);
    expect(wf.workers().filter((w) => w.category === 'business').length).toBe(16);
    expect(wf.workers().filter((w) => w.category === 'industry').length).toBe(12);
  });

  it('agent registry: lifecycle, identity, permissions, sessions', async () => {
    const a = await wf.agents().register({ name: 'Sales Bot', role: 'Sales Executive', orgId: 'org1', capabilities: ['plan'] });
    expect(a.state).toBe('provisioned');
    expect(a.identity).toContain('did:nems:');
    await expect(wf.agents().startSession(a.id)).rejects.toThrow(/active/); // must activate first
    await wf.agents().setState(a.id, 'active');
    const s = await wf.agents().startSession(a.id);
    expect(s.active).toBe(true);
    wf.agents().grantPermission(a.id, 'read:crm');
    expect(wf.agents().hasPermission(a.id, 'read:crm')).toBe(true);
    expect(wf.agents().count()).toBe(1);
  });

  it('memory: scopes; organization memory shared by owner', async () => {
    await wf.memory().remember({ ownerId: 'org1', scope: 'organization', key: 'mission', value: 'grow revenue' });
    expect(wf.memory().recall('org1', 'organization', 'mission')).toBe('grow revenue');
    expect(wf.memory().recallAll('org1', 'organization').length).toBe(1);
  });
});
