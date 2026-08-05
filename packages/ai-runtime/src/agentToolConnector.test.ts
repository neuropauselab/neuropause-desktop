import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { GovernanceRecorder } from './governance';
import { AgentRuntime } from './agents';
import { ToolRuntime } from './tools';
import { ConnectorRuntime } from './connectors';

function harness() {
  const clock = new ManualClock(0);
  const runtime = createEnterpriseRuntime({ clock });
  const governance = new GovernanceRecorder(runtime, clock);
  return { clock, runtime, governance };
}

describe('AgentRuntime', () => {
  it('executes an agent through the governed runtime (audited)', async () => {
    const { runtime, governance } = harness();
    const agents = new AgentRuntime(runtime, governance);
    agents.register({ name: 'summarize', kind: 'analysis', run: async (input: string) => ({ summary: `sum:${input}` }) });
    const out = await agents.execute<string, { summary: string }>('summarize', 'text', 'usr_1');
    expect(out).toEqual({ summary: 'sum:text' });
    expect(governance.history().some((r) => r.kind === 'agent' && r.target === 'summarize' && r.ok)).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });
  it('records a failing agent and rethrows', async () => {
    const { runtime, governance } = harness();
    const agents = new AgentRuntime(runtime, governance);
    agents.register({ name: 'boom', kind: 'task', run: async () => { throw new Error('agent failed'); } });
    await expect(agents.execute('boom', {}, 'usr_1')).rejects.toThrow('agent failed');
    expect(governance.history().some((r) => r.kind === 'agent' && !r.ok)).toBe(true);
  });
});

describe('ToolRuntime', () => {
  const schema = z.object({ path: z.string() });
  function toolHarness() {
    const { runtime, governance } = harness();
    const tools = new ToolRuntime(runtime, governance);
    tools.register({
      name: 'read',
      permissions: ['fs:read'],
      schema,
      execute: async (args) => ({ content: `data@${args.path}` }),
    });
    return { runtime, governance, tools };
  }
  it('runs a tool with permission + valid args (approved, audited)', async () => {
    const { tools, governance } = toolHarness();
    const r = await tools.call('read', { path: '/x' }, { actor: 'usr_1', grants: ['fs:read'] });
    expect(r).toEqual({ content: 'data@/x' });
    expect(governance.history().some((x) => x.kind === 'tool' && x.approval === 'approved' && x.ok)).toBe(true);
  });
  it('denies without permission (recorded as rejected)', async () => {
    const { tools, governance } = toolHarness();
    await expect(tools.call('read', { path: '/x' }, { actor: 'usr_1', grants: [] })).rejects.toThrow(/requires permission/);
    expect(governance.history().some((x) => x.kind === 'tool' && x.approval === 'rejected')).toBe(true);
  });
  it('rejects invalid arguments', async () => {
    const { tools } = toolHarness();
    await expect(tools.call('read', { path: 123 }, { actor: 'usr_1', grants: ['fs:read'] })).rejects.toThrow(/invalid arguments/);
  });
});

describe('ConnectorRuntime', () => {
  it('retries then succeeds (audited)', async () => {
    const { runtime, governance } = harness();
    const connectors = new ConnectorRuntime(runtime, governance, new ManualClock(0));
    let attempts = 0;
    connectors.register({
      name: 'gh',
      permissions: [],
      maxRetries: 2,
      execute: async () => {
        attempts++;
        if (attempts < 2) throw new Error('flaky');
        return { ok: true };
      },
    });
    const r = await connectors.call('gh', {}, { actor: 'usr_1', grants: [] });
    expect(r).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(governance.history().some((x) => x.kind === 'connector' && x.ok)).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });
  it('enforces per-actor rate limits (recorded)', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const governance = new GovernanceRecorder(runtime, clock);
    const connectors = new ConnectorRuntime(runtime, governance, clock);
    connectors.register({ name: 'rl', permissions: [], rateLimit: { capacity: 1, refillPerSec: 0 }, execute: async () => ({}) });
    await connectors.call('rl', {}, { actor: 'usr_1', grants: [] });
    await expect(connectors.call('rl', {}, { actor: 'usr_1', grants: [] })).rejects.toThrow(/rate limit/);
  });
  it('denies without permission', async () => {
    const { runtime, governance } = harness();
    const connectors = new ConnectorRuntime(runtime, governance, new ManualClock(0));
    connectors.register({ name: 'sec', permissions: ['conn:sec'], execute: async () => ({}) });
    await expect(connectors.call('sec', {}, { actor: 'usr_1', grants: [] })).rejects.toThrow(/requires permission/);
  });
});
