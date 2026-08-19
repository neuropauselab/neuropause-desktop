import { describe, it, expect } from 'vitest';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrainState';
import { proposalAdmissible } from './proposalAdmission';
import type { ActionRecord } from '../connectors/actionRecord';
import type { TenantStamp } from '../tenancy/tenantStamp';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { composeEnvironmentModel } from '../environmentModel/environmentModel';
import { evaluatePurpose } from '../purposeEngine/purposeEngine';
import { runDiscovery } from '../environmentDiscovery/environmentDiscovery';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T = '2026-08-19T00:00:00.000Z';
const A: TenantStamp = { tenantId: 'tenant-A', scope: 'ws-A', authoritySource: 'activeTenantScope', timestamp: T };
const B: TenantStamp = { tenantId: 'tenant-B', scope: 'ws-B', authoritySource: 'session-catalog', timestamp: T };

// Fully-populated snapshots (real composers) + a tenant stamp applied by the assembler.
const ws = (t?: TenantStamp) => ({
  ...composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], {
    scope: () => TEST_TENANT_SCOPE, now: () => T, moduleCount: () => 3,
  }),
  ...(t ? { tenant: t } : {}),
});
const caps = (t?: TenantStamp) => ({
  ...composeCapabilityGraph(capabilityGraphSources({ mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }], scope: () => true })),
  ...(t ? { tenant: t } : {}),
});
const env = (t: TenantStamp) => ({
  ...composeEnvironmentModel('send-email', [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }], { probe: () => 'present' }),
  tenant: t,
});
const purp = (t: TenantStamp) => ({
  ...evaluatePurpose({ text: 'send-email' }, {
    recognize: () => true, route: () => ({ capability: 'mail.send', connector: 'microsoft-entra', workflow: 'wf' }),
    authority: () => 'permit', propose: () => ({ capability: 'mail.send', summary: 'send' }),
  }),
  tenant: t,
});
const disc = (t: TenantStamp) => ({
  ...runDiscovery({ purpose: 'send-email', minimumRequired: [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }] }, {
    authorize: () => 'granted', collect: (e) => ({ elementId: e.id, present: true }),
  }),
  tenant: t,
});
const action = (tenantId: string): ActionRecord => ({
  id: 'act_1', at: T, requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId,
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr',
  verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: null, at: T },
});
const inputs = (wsT: TenantStamp, capT: TenantStamp, actionTenant: string): LiveBrainInputs => ({
  workspace: ws(wsT), capabilities: caps(capT), environment: env(A), purpose: purp(A), discovery: disc(A), actions: [action(actionTenant)],
});

describe('S4.0 · Tenant Authority Unification — the BINDING two-tenant fixture', () => {
  it('SINGLE TENANT A (all substrates + evidence tenant A) → provable, admissible', () => {
    const s = composeLiveBrainState(inputs(A, A, 'tenant-A'));
    expect(s.tenantProvable).toBe(true);
    expect(s.tenantId).toBe('tenant-A');
    expect(s.conflicts.some((c) => c.about.startsWith('tenant identity'))).toBe(false);
    expect(proposalAdmissible(s).admissible).toBe(true);
  });

  it('CROSS-TENANT (evidence from A, capability target in B) → STATE=CONFLICTING, PROPOSAL=REFUSED, ACTION=NONE', () => {
    const s = composeLiveBrainState(inputs(A, B, 'tenant-A')); // capabilities substrate stamped tenant B
    // STATE = CONFLICTING
    expect(s.conflicts.some((c) => c.about === 'tenant identity')).toBe(true);
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
    expect(s.sections.workspace.certainty).toBe('CONFLICTING');
    expect(s.tenantProvable).toBe(false);
    // PROPOSAL = REFUSED, ACTION = NONE (no proposal object is created)
    const verdict = proposalAdmissible(s);
    expect(verdict.admissible).toBe(false);
    expect(verdict.reason).toMatch(/REFUSED/);
  });

  it('CROSS-TENANT EVIDENCE (snapshots A, an ActionRecord in B) → tenant-evidence CONFLICTING, REFUSED', () => {
    const s = composeLiveBrainState(inputs(A, A, 'tenant-B')); // the action belongs to tenant B
    expect(s.conflicts.some((c) => c.about === 'tenant identity (evidence)')).toBe(true);
    expect(s.tenantProvable).toBe(false);
    expect(proposalAdmissible(s).admissible).toBe(false);
  });

  it('DENY-BY-DEFAULT — an unstamped state is NOT provably single-tenant → REFUSED', () => {
    const s = composeLiveBrainState({
      workspace: ws(), capabilities: caps(), environment: null, purpose: null, discovery: null, actions: [],
    });
    expect(s.tenantProvable).toBe(false); // no stamp → cannot prove single tenant
    expect(proposalAdmissible(s).admissible).toBe(false);
  });
});
