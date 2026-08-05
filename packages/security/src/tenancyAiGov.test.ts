import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform, type SecurityPlatform } from './platform';
import type { AiExecutionInput } from './aiGovernance';

function platform(clock: ManualClock): SecurityPlatform {
  return createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
}

describe('Tenant Isolation — cross-tenant denied unless delegated + audited (VERIFIED)', () => {
  it('allows same-tenant, denies cross-tenant, allows only an active delegation', async () => {
    const clock = new ManualClock(0);
    const p = platform(clock);
    const t = p.tenants();
    expect(t.check('acme', 'acme', 'workspace')).toEqual({ allowed: true, reason: 'same-tenant' });
    expect(t.check('acme', 'globex', 'workspace').reason).toBe('cross-tenant-denied');

    // delegate globex → acme for the workspace domain, time-bounded
    await t.delegate('globex', 'acme', 'workspace', clock.now() + 10_000, 'admin');
    expect(t.check('acme', 'globex', 'workspace').reason).toBe('delegated');

    // the delegation expires
    clock.advance(10_001);
    expect(t.check('acme', 'globex', 'workspace').reason).toBe('cross-tenant-denied');
  });

  it('assertAccess throws AND audits a denied cross-tenant access', async () => {
    const clock = new ManualClock(0);
    const p = platform(clock);
    await expect(p.tenants().assertAccess('acme', 'initech', 'secret', 'usr_1')).rejects.toThrow(/cross-tenant access denied/);
    const denies = p.audit().events({ category: 'security' }).filter((e) => e.action === 'tenant.isolation.deny');
    expect(denies).toHaveLength(1);
    expect(denies[0]!.actor).toBe('usr_1');
    // a permitted same-tenant assert does not throw and records nothing extra
    await expect(p.tenants().assertAccess('acme', 'acme', 'secret', 'usr_1')).resolves.toBeUndefined();
    expect(p.audit().events({ category: 'security' }).filter((e) => e.action === 'tenant.isolation.deny')).toHaveLength(1);
  });
});

describe('AI Governance — full attribution through the ONE audit chain (VERIFIED)', () => {
  const base: AiExecutionInput = {
    user: 'usr_1',
    organization: 'acme',
    workspace: 'ws_1',
    aiIdentity: 'aiid_1',
    model: 'claude-x',
    provider: 'anthropic',
    promptMetadata: { tokens: 128, hash: 'p-hash' },
    toolCalls: ['search', 'write'],
    connectorAccess: ['slack', 'gdrive'],
    evidenceRefs: ['ev_1'],
    decisionRefs: ['dec_1'],
    approval: 'approved',
    riskLevel: 'medium',
    costUsd: 0.021,
    executionMs: 1234,
    ok: true,
  };

  it('records a governed execution with an audit id + replay id, retrievable by replay id', async () => {
    const clock = new ManualClock(0);
    const p = platform(clock);
    const rec = await p.aiGovernance().record(base);
    expect(rec.auditId).toBeTruthy();
    expect(rec.replayId).toMatch(/^replay/);
    expect(rec.user).toBe('usr_1');
    expect(rec.connectorAccess).toEqual(['slack', 'gdrive']);
    expect(rec.toolCalls).toEqual(['search', 'write']);
    expect(p.aiGovernance().byReplayId(rec.replayId)).toEqual(rec);
    expect(p.aiGovernance().byReplayId('nope')).toBeUndefined();
  });

  it('every AI execution appears on the one security audit chain, attributed and verifiable', async () => {
    const clock = new ManualClock(0);
    const p = platform(clock);
    await p.aiGovernance().record(base);
    await p.aiGovernance().record({ ...base, ok: false });
    const aiEvents = p.audit().events({ category: 'ai' });
    expect(aiEvents).toHaveLength(2);
    expect(aiEvents[0]!.actor).toBe('aiid_1');
    expect(aiEvents[0]!.tenant).toBe('acme');
    expect(aiEvents.map((e) => e.action)).toEqual(['execute', 'execute.error']);
    // the chain stays valid after governed AI records
    expect(p.audit().verify().valid).toBe(true);
  });

  it('filters history by organization / ai identity / user', async () => {
    const clock = new ManualClock(0);
    const p = platform(clock);
    await p.aiGovernance().record(base);
    await p.aiGovernance().record({ ...base, organization: 'globex', aiIdentity: 'aiid_2' });
    expect(p.aiGovernance().history({ organization: 'acme' })).toHaveLength(1);
    expect(p.aiGovernance().history({ aiIdentity: 'aiid_2' })).toHaveLength(1);
    expect(p.aiGovernance().history({ user: 'usr_1' })).toHaveLength(2);
    expect(p.aiGovernance().history({ organization: 'nobody' })).toHaveLength(0);
  });
});
