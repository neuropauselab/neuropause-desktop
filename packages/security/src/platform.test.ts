import { describe, it, expect } from 'vitest';
import { createEnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock } from '@neuropause/cloud-core';
import { createSecurityPlatform } from './platform';
import type { AiExecutionInput } from './aiGovernance';

const AI_INPUT: Omit<AiExecutionInput, 'user'> = {
  organization: 'acme',
  workspace: 'ws_1',
  aiIdentity: 'aiid_1',
  model: 'claude-x',
  provider: 'anthropic',
  promptMetadata: { tokens: 64 },
  executionMs: 500,
  ok: true,
};

describe('createSecurityPlatform — the ONE composed security surface', () => {
  it('exposes every runtime security API accessor plus version', () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    for (const api of ['identity', 'authentication', 'authorization', 'policy', 'security', 'compliance', 'audit', 'sessions', 'tenants', 'keys', 'aiGovernance', 'observability'] as const) {
      expect(typeof p[api]).toBe('function');
      expect(p[api]()).toBeTruthy();
    }
    expect(p.version).toBeTruthy();
    expect(p.matrix().length).toBeGreaterThan(0);
    expect(p.threatModel().length).toBeGreaterThan(0);
    expect(p.readiness().total).toBe(p.matrix().length);
    expect(p.keys().providerKind()).toBe('local');
  });

  it('routes identity, authorization, session, and AI events onto ONE verifiable audit chain', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });

    const u = await p.identity().register({ type: 'user', displayName: 'Ada', tenant: 'acme' });
    await p.identity().activate(u.id);
    p.authorization().defineRole({ id: 'admin', name: 'Admin', permissions: ['*'] });
    await p.authorization().enforce({ subject: { id: u.id, roles: ['admin'] }, action: 'read', resource: { type: 'workspace', tenant: 'acme' } });
    const sess = await p.sessions().create({ identityId: u.id, tenant: 'acme' });
    expect(p.sessions().validate(sess.id).valid).toBe(true);
    await p.aiGovernance().record({ ...AI_INPUT, user: u.id });

    // one chain — all four planes landed on it and it verifies
    const categories = new Set(p.audit().events().map((e) => e.category));
    expect(categories.has('identity')).toBe(true);
    expect(categories.has('authorization')).toBe(true);
    expect(categories.has('session')).toBe(true);
    expect(categories.has('ai')).toBe(true);
    expect(p.audit().verify().valid).toBe(true);
  });

  it('enforce() denies-by-default and throws, and observability aggregates security metrics', async () => {
    const clock = new ManualClock(0);
    const p = createSecurityPlatform(createEnterpriseRuntime({ clock }), { clock });
    await expect(
      p.authorization().enforce({ subject: { id: 'nobody', roles: [] }, action: 'read', resource: { type: 'workspace' } }),
    ).rejects.toThrow(/access denied/);

    p.observability().recordAuth(false);
    p.observability().recordAuthz(false);
    p.observability().recordThreat('high');
    const snap = p.observability().snapshot();
    expect(snap.failedLogins).toBe(1);
    expect(snap.authorization.deny).toBe(1);
    expect(snap.threats.high).toBe(1);
    expect(p.observability().dashboards().risk.threats).toBe(1);
  });
});
