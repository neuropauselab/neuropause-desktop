import { describe, it, expect, beforeEach } from 'vitest';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { WorkspaceGovernance } from './governance';
import { OrganizationRegistry } from './organization';
import { WorkspaceRegistry } from './workspaceRegistry';

function harness(): { runtime: EnterpriseRuntime; org: OrganizationRegistry; ws: WorkspaceRegistry } {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new WorkspaceGovernance(runtime, clock);
  return {
    runtime,
    org: new OrganizationRegistry(clock, governance),
    ws: new WorkspaceRegistry(clock, governance),
  };
}

describe('OrganizationRegistry — one typed hierarchy', () => {
  let org: OrganizationRegistry;
  let runtime: EnterpriseRuntime;
  beforeEach(() => {
    ({ org, runtime } = harness());
  });

  it('builds an org → department → team tree and rejects invalid nesting', async () => {
    const acme = await org.create({ type: 'organization', name: 'Acme' });
    const eng = await org.create({ type: 'department', name: 'Engineering', parentId: acme.id });
    const core = await org.create({ type: 'team', name: 'Core', parentId: eng.id });
    expect(org.path(core.id).map((n) => n.type)).toEqual(['organization', 'department', 'team']);
    expect(org.subtree(acme.id).map((n) => n.id).sort()).toEqual([eng.id, core.id].sort());
    await expect(org.create({ type: 'business-unit', name: 'BU' })).rejects.toThrow(/requires a parent/);
    await expect(org.create({ type: 'department', name: 'X', parentId: core.id })).rejects.toThrow(/cannot nest/);
  });

  it('records every structural change on the shared audit chain', async () => {
    const acme = await org.create({ type: 'organization', name: 'Acme' });
    await org.create({ type: 'department', name: 'Eng', parentId: acme.id });
    expect(runtime.audit().verify().valid).toBe(true);
    expect(runtime.timeline().all().some((e) => e.type === 'workspace.activity')).toBe(true);
  });

  it('moves a node between valid parents and refuses a cyclic reparent', async () => {
    const acme = await org.create({ type: 'organization', name: 'Acme' });
    const d1 = await org.create({ type: 'department', name: 'D1', parentId: acme.id });
    const d2 = await org.create({ type: 'department', name: 'D2', parentId: acme.id });
    const t1 = await org.create({ type: 'team', name: 'T1', parentId: d1.id });
    const t2 = await org.create({ type: 'team', name: 'T2', parentId: t1.id }); // nested team
    await org.move(t1.id, d2.id); // team: department → department (valid)
    expect(org.get(t1.id)?.parentId).toBe(d2.id);
    // t2 is a descendant of t1; reparenting t1 under t2 is a valid type but a cycle.
    await expect(org.move(t1.id, t2.id)).rejects.toThrow(/descendant/);
  });
});

describe('WorkspaceRegistry — templates, policies, settings', () => {
  it('creates a workspace from a template and merges overrides', async () => {
    const { ws } = harness();
    ws.registerTemplate({
      id: 'eng',
      name: 'Engineering Workspace',
      defaultSettings: { timezone: 'UTC', aiEnabled: true },
      defaultPolicies: [{ name: 'external-share', allow: false }],
    });
    const workspace = await ws.create({ name: 'Core', ownerOrgId: 'org_1', templateId: 'eng', settings: { aiEnabled: false } });
    expect(workspace.settings).toMatchObject({ timezone: 'UTC', aiEnabled: false });
    expect(ws.allows(workspace.id, 'external-share')).toBe(false);
    expect(ws.allows(workspace.id, 'unset-policy')).toBe(true); // default allow
  });

  it('sets policies and settings with governance', async () => {
    const { ws } = harness();
    const workspace = await ws.create({ name: 'W', ownerOrgId: 'org_1' });
    await ws.setPolicy(workspace.id, { name: 'ai-employees', allow: true });
    await ws.setSetting(workspace.id, 'retentionDays', 90);
    expect(ws.allows(workspace.id, 'ai-employees')).toBe(true);
    expect(ws.get(workspace.id)?.settings['retentionDays']).toBe(90);
  });
});
