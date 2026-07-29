import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { createAiRuntime } from '@neuropause/ai-runtime';
import { createConnectorPlatform, mockConnector, catalogDescriptor } from '@neuropause/connectors';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { createWorkspacePlatform } from './index';

describe('createWorkspacePlatform (integration)', () => {
  it('runs the enterprise operating model end-to-end on ONE governed runtime', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const ai = createAiRuntime(runtime, { clock });
    const connectors = createConnectorPlatform(runtime, { clock });
    const platform = createWorkspacePlatform(runtime, { clock, aiRuntime: ai, connectorPlatform: connectors });

    const activity: string[] = [];
    runtime.events().subscribe('workspace.activity', (e: CloudEvent) => void activity.push(e.type));

    // organization → workspace → project
    const org = await platform.organizations().create({ type: 'organization', name: 'Acme' });
    const dept = await platform.organizations().create({ type: 'department', name: 'Eng', parentId: org.id });
    const team = await platform.teams().create('Core', dept.id);
    const ws = await platform.workspace().create({ name: 'Core WS', ownerOrgId: org.id });
    const project = await platform.projects().create({ name: 'Launch', workspaceId: ws.id, orgId: org.id });

    // a human and an AI employee — SAME identity model, SAME workspace
    const human = await platform.identity().registerPrincipal({ type: 'human', displayName: 'Sam' });
    await platform.teams().addMember(team.id, human.id);
    ai.agents().register({ name: 'analyst', kind: 'analysis', run: async () => ({ ok: true }) });
    const emp = await platform.workforce().hire({
      role: 'analyst',
      displayName: 'Ada',
      agentName: 'analyst',
      ownerPrincipalId: human.id,
      workspaceId: ws.id,
      costPerRunUsd: 0.1,
    });

    // a task assigned to the human → inbox item derived from the bus
    const task = await platform.tasks().create({ title: 'Plan', workspaceId: ws.id, projectId: project.id });
    await platform.tasks().assign(task.id, human.id);
    // AI employee does work through the AI runtime
    await platform.workforce().dispatch(emp.id, { topic: 'scan' });

    // governance: everything on the ONE audit chain + timeline + bus
    expect(runtime.audit().verify().valid).toBe(true);
    expect(activity).toContain('workspace.activity');
    expect(runtime.timeline().all().some((e) => e.type === 'workspace.activity')).toBe(true);

    // universal inbox derived from the shared bus
    const assignments = platform.inbox().itemsFor(human.id, { kind: 'assignment' });
    expect(assignments).toHaveLength(1);

    // dashboard: read-only projection reflects the operating model
    const kpis = platform.dashboard().kpis();
    expect(kpis.organizations).toBe(1);
    expect(kpis.workspaces).toBe(1);
    expect(kpis.aiEmployees).toBe(1);
    expect(kpis.openTasks).toBe(1);
    expect(kpis.workforceCostUsd).toBeCloseTo(0.1);
    expect(platform.dashboard().auditOverview().valid).toBe(true);
  });

  it('surfaces connector events from the shared bus into the universal inbox', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const connectors = createConnectorPlatform(runtime, { clock });
    const platform = createWorkspacePlatform(runtime, { clock, connectorPlatform: connectors });

    connectors.connectorRegistry().install(mockConnector(catalogDescriptor('webhook') as never));
    await connectors
      .connectors()
      .invoke('webhook', 'invoke', { op: 'emit' }, { actor: 'usr_1', grants: ['webhook:use', 'webhook:invoke'] });

    // connector.execution flowed through the SAME runtime bus into the inbox
    expect(platform.inbox().system({ kind: 'connector-event' }).length).toBeGreaterThan(0);
    // and the dashboard sees connector health through the wired platform
    expect(platform.dashboard().connectorHealth().some((h) => h.id === 'webhook')).toBe(true);
  });

  it('exposes the full workspace platform API', () => {
    const runtime = createEnterpriseRuntime({ clock: new ManualClock(0) });
    const platform = createWorkspacePlatform(runtime, { clock: new ManualClock(0) });
    expect(platform.version).toContain('preview');
    for (const fn of [
      platform.workspace,
      platform.organizations,
      platform.teams,
      platform.projects,
      platform.tasks,
      platform.inbox,
      platform.knowledge,
      platform.workforce,
      platform.dashboard,
      platform.collaboration,
      platform.identity,
      platform.governance,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });
});
