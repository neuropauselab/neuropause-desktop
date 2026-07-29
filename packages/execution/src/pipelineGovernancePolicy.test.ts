import { describe, it, expect } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { FakeHttpClient, type HttpResponse } from '@neuropause/integrations';
import { createExecutionPlatform } from './platform';
import { EXECUTION_MATRIX } from './evidence';

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, body: JSON.stringify(body) });
const fail = (): HttpResponse => ({ status: 500, ok: false, headers: {}, body: 'err' });

function makePlatform(responder: (req: { url: string }) => HttpResponse) {
  const clock = new ManualClock(1000);
  const runtime = createEnterpriseRuntime({ clock });
  const http = new FakeHttpClient(responder);
  const exec = createExecutionPlatform(runtime, { clock, http, engine: { maxAttempts: 2 } });
  return { clock, runtime, http, exec };
}

describe('Module 17 — Pipeline, Policy, HITL, Governance, DLQ (adapter-verified)', () => {
  it('constructs SaaS connector requests correctly — marked adapter-verified (no live claim)', async () => {
    const { exec, http } = makePlatform(() => ok([{ id: 1, name: 'r' }]));
    const r = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'github', operation: 'list-repos', token: 'gho_x' });
    expect(r.outcome).toBe('success');
    expect(r.evidence).toBe('adapter-verified'); // SaaS — no real GitHub call occurred
    expect(http.lastRequest!.url).toBe('https://api.github.com/user/repos');
    expect(http.lastRequest!.headers?.Authorization).toBe('Bearer gho_x');
  });

  it('enforces a deny policy before execution', async () => {
    const { exec } = makePlatform(() => ok({}));
    exec.policy().define({ id: 'no-drive-delete', effect: 'deny', connector: 'google-drive', operation: 'delete-file' });
    const r = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'google-drive', operation: 'delete-file', params: { id: 'x' }, token: 'y' });
    expect(r.outcome).toBe('denied');
  });

  it('requires approval for a high-risk mutating operation (default guardrail)', async () => {
    const { exec } = makePlatform(() => ok({ sent: true }));
    const noAppr = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'gmail', operation: 'send', token: 'y', body: { to: 'x' } });
    expect(noAppr.outcome).toBe('awaiting-approval');
    const appr = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'gmail', operation: 'send', token: 'y', body: { to: 'x' }, approved: true });
    expect(appr.outcome).toBe('success');
  });

  it('blocks an AI-initiated mutating execution until human-approved (HITL)', async () => {
    const { exec } = makePlatform(() => ok({}));
    const blocked = await exec.engine().execute({ tenantId: 't', actor: 'ai', connectorId: 'slack', operation: 'post-message', token: 'y', body: {}, aiInitiated: true });
    expect(blocked.outcome).toBe('awaiting-approval');
    const allowed = await exec.engine().execute({ tenantId: 't', actor: 'ai', connectorId: 'slack', operation: 'post-message', token: 'y', body: {}, aiInitiated: true, approved: true });
    expect(allowed.outcome).toBe('success');
  });

  it('governs every execution on the one audit chain + event bus', async () => {
    const { exec, runtime } = makePlatform(() => ok({}));
    await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'github', operation: 'list-repos', token: 'y' });
    expect(exec.governance().count()).toBeGreaterThan(0);
    expect(exec.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
  });

  it('dead-letters an exhausted execution and recovers it', async () => {
    const { exec } = makePlatform(() => fail());
    const r = await exec.engine().execute({ tenantId: 't', actor: 'u', connectorId: 'github', operation: 'list-repos', token: 'y' });
    expect(r.outcome).toBe('dead-lettered');
    const dls = exec.recovery().deadLetters('t');
    expect(dls.length).toBe(1);
    expect(exec.recovery().recover(dls[0].id)).toBeTruthy();
    expect(exec.recovery().deadLetters('t').length).toBe(0);
  });

  it('keeps the evidence discipline honest — no SaaS connector is live-verified', () => {
    expect(EXECUTION_MATRIX.filter((m) => m.capability.includes('SaaS') && m.level === 'live-verified').length).toBe(0);
    expect(EXECUTION_MATRIX.find((m) => m.capability.includes('Execution Engine'))!.level).toBe('live-verified');
    const { exec } = makePlatform(() => ok({}));
    expect(exec.connectors().get('github')!.evidence).toBe('adapter-verified');
    expect(exec.connectors().get('rest')!.evidence).toBe('live-verified');
    expect(exec.connectors().count()).toBe(22);
  });
});
