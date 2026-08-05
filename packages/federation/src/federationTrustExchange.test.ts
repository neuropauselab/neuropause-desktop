import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createFederationPlatform, type FederationPlatform } from './platform';

describe('Modules 1,2,3,7,8,12 — Federation, Orgs, Trust, Tenancy, Exchange, Governance', () => {
  let runtime: EnterpriseRuntime;
  let fed: FederationPlatform;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    fed = createFederationPlatform(runtime, { clock });
    orgA = (await fed.registerOrganization({ name: 'Acme' })).id;
    orgB = (await fed.registerOrganization({ name: 'Globex' })).id;
  });

  it('runs the federation lifecycle: create → join → discover → leave → archive', async () => {
    const f = await fed.createFederation('Alliance', orgA);
    expect(f.members).toEqual([orgA]);
    await fed.joinFederation(f.id, orgB);
    expect(fed.federations().members(f.id)).toContain(orgB);
    expect(fed.discoverOrganizations(f.id).map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
    await fed.leaveFederation(f.id, orgB);
    expect(fed.federations().members(f.id)).not.toContain(orgB);
    await fed.federations().archive(f.id);
    await expect(fed.joinFederation(f.id, orgB)).rejects.toThrow(/archived/);
  });

  it('manages organizations: update + archive', async () => {
    const o = await fed.registerOrganization({ name: 'Initech' });
    await fed.organizations().update(o.id, { name: 'Initech Corp', metadata: { tier: 'gold' } });
    expect(fed.organizations().get(o.id)!.name).toBe('Initech Corp');
    await fed.organizations().archive(o.id);
    expect(fed.organizations().get(o.id)!.status).toBe('archived');
  });

  it('establishes trust and enforces it on cross-org exchange', async () => {
    const f = await fed.createFederation('Partners', orgA);
    await fed.joinFederation(f.id, orgB);
    // no trust → share is refused
    await expect(fed.shareWorkflow({ federationId: f.id, name: 'wf', fromOrg: orgA, toOrg: orgB })).rejects.toThrow(/trust/);
    await fed.trust().establish({ federationId: f.id, fromOrg: orgA, toOrg: orgB, level: 'share' });
    expect(fed.trust().validate(f.id, orgA, orgB, 'share')).toBe(true);
    expect(fed.trust().validate(f.id, orgA, orgB, 'full')).toBe(false);
    const shared = await fed.shareWorkflow({ federationId: f.id, name: 'ci-pipeline', fromOrg: orgA, toOrg: orgB, payload: { steps: 3 } });
    expect(shared.kind).toBe('workflow');
    expect(fed.exchange().received(orgB).some((a) => a.id === shared.id)).toBe(true);
    expect(fed.exchange().sharedBy(orgA).length).toBeGreaterThan(0);
  });

  it('supports federation policies, permissions, and trust-gated tenant access', async () => {
    const f = await fed.createFederation('Regulated', orgA);
    await fed.joinFederation(f.id, orgB);
    await fed.trust().definePolicy(f.id, { name: 'data-residency', rule: { region: 'eu' } });
    expect(fed.tenancy().sharedPolicies(f.id).length).toBe(1);
    await fed.trust().grantPermission(f.id, orgB, 'read:dashboards');
    expect(fed.trust().can(f.id, orgB, 'read:dashboards')).toBe(true);
    expect(fed.trust().can(f.id, orgB, 'admin')).toBe(false);
    // canAccess needs membership + read trust
    expect(fed.tenancy().canAccess(f.id, orgB, orgA)).toBe(false);
    await fed.trust().establish({ federationId: f.id, fromOrg: orgB, toOrg: orgA, level: 'read' });
    expect(fed.tenancy().canAccess(f.id, orgB, orgA)).toBe(true);
    expect(fed.tenancy().isolated(f.id, orgA)).toBe(true);
  });

  it('governs every operation with a replay id + evidence, on the one audit chain', async () => {
    const events: Array<Record<string, unknown>> = [];
    runtime.events().subscribe((e) => e.type === 'federation.operation', (e) => {
      events.push(e.payload as Record<string, unknown>);
    });
    await fed.createFederation('Governed', orgA);
    expect(fed.governance().count()).toBeGreaterThan(0);
    expect(fed.governance().verify()).toBe(true);
    expect(runtime.audit().verify().valid).toBe(true);
    const last = events[events.length - 1];
    expect(last.replayId).toBeTruthy(); // replay id per operation
    expect(last.evidence).toBe('live-verified');
  });
});
