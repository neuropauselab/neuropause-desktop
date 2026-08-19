import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBrainContext } from './brainContext';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrainState';
import type { ActionRecord } from '../connectors/actionRecord';
// REAL upstream read-models:
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { composeEnvironmentModel } from '../environmentModel/environmentModel';
import { evaluatePurpose } from '../purposeEngine/purposeEngine';
import { runDiscovery } from '../environmentDiscovery/environmentDiscovery';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const realWorkspace = (scoped = true) =>
  composeWorkspaceDomain(
    [
      { domain: 'people', moduleId: 'hr-employees', label: 'People' },
      { domain: 'customers', moduleId: 'crm-customers', label: 'Customers' },
    ],
    {
      scope: () => (scoped ? TEST_TENANT_SCOPE : null),
      now: () => '2026-08-19T00:00:00.000Z',
      moduleCount: (id) => (id === 'hr-employees' ? 3 : null), // customers absent → UNAVAILABLE slice
    },
  );

const realCaps = (scoped = true) =>
  composeCapabilityGraph(
    capabilityGraphSources({
      mutations: () => [
        { capabilityId: 'mail.send', connectorId: 'microsoft-entra' }, // routes
        { capabilityId: 'chat.post', connectorId: 'slack' }, // not-governed gap
      ],
      scope: () => scoped,
    }),
  );

const realEnv = (probe: 'present' | 'absent' | 'unknown') =>
  composeEnvironmentModel('send-email', [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }], { probe: () => probe });

const action = (o: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'act_9', at: 't', requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'ten',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: ['a@b.com'], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr', verification: null, ...o,
});

const base: LiveBrainInputs = { workspace: null, capabilities: null, environment: null, purpose: null, discovery: null, actions: [] };

const full = (): LiveBrainInputs => ({
  workspace: realWorkspace(),
  capabilities: realCaps(),
  environment: realEnv('present'),
  purpose: evaluatePurpose({ text: 'send-email' }, {
    recognize: () => true,
    route: () => ({ capability: 'mail.send', connector: 'microsoft-entra', workflow: 'wf' }),
    authority: () => 'permit',
    propose: () => ({ capability: 'mail.send', summary: 'send' }),
  }),
  discovery: runDiscovery({ purpose: 'send-email', minimumRequired: [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }] }, {
    authorize: () => 'granted',
    collect: (e) => ({ elementId: e.id, present: true }),
  }),
  actions: [action({ verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<x>', at: 't' } })],
});

describe('L6-S2 · BrainContext — PROVENANCE PER FIELD over real read-models', () => {
  it('every fact carries a layer + a non-empty evidence object — nothing unattributable', () => {
    const ctx = assembleBrainContext(full());
    expect(ctx.facts.length).toBeGreaterThan(0);
    for (const f of ctx.facts) {
      expect(['L1', 'L2', 'L3', 'L4', 'L5', 'S34a']).toContain(f.provenance.layer);
      expect(f.provenance.evidence.length).toBeGreaterThan(0);
      expect(f.field.length).toBeGreaterThan(0);
    }
  });

  it('TRACEABILITY — each evidence ref names a REAL object present in the inputs', () => {
    const inputs = full();
    const ctx = assembleBrainContext(inputs);
    const byField = (f: string) => ctx.facts.find((x) => x.field === f);

    // L4 route fact → the capability really is in the graph's routes.
    const cap = byField('capability.mail.send');
    expect(cap?.provenance.evidence).toContain('CapabilityRoute(mail.send)');
    expect(inputs.capabilities?.routes.some((r) => r.capability === 'mail.send')).toBe(true);

    // L1 slice fact → the moduleId really is a slice in the snapshot.
    const ppl = byField('workspace.people');
    expect(ppl?.provenance.evidence).toContain('DomainSlice(hr-employees)');
    expect(inputs.workspace?.slices.some((s) => s.moduleId === 'hr-employees')).toBe(true);

    // S34a fact → the evidence names the real ActionRecord id.
    const act = byField('action.act_9');
    expect(act?.provenance.evidence).toBe('ActionRecord(act_9)');
    expect(inputs.actions.some((a) => a.id === 'act_9')).toBe(true);
  });

  it('atomic certainty is faithful — routed→KNOWN, not-governed→KNOWN, verified success→VERIFIED, NEED→KNOWN, unknown→UNKNOWN', () => {
    const ctx = assembleBrainContext({ ...full(), environment: realEnv('unknown') });
    const c = (f: string) => ctx.facts.find((x) => x.field === f)?.certainty;
    expect(c('capability.mail.send')).toBe('KNOWN'); // route
    expect(c('capability.chat.post')).toBe('KNOWN'); // not-governed is a KNOWN fact
    expect(c('action.act_9')).toBe('VERIFIED');
    expect(c('environment.mail.send')).toBe('UNKNOWN'); // probed 'unknown'
  });

  it('verification terminals classified against the REAL vocabulary — HOLD→UNKNOWN, VERIFY_FAILED→KNOWN, VERIFIED_SUCCESS→VERIFIED', () => {
    const at = (terminal: string | null) => {
      const rec = terminal === null ? action() : action({ verification: { terminal, internetMessageId: null, at: 't' } });
      const ctx = assembleBrainContext({ ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [rec] });
      return ctx.facts.find((f) => f.field === `action.${rec.id}`)?.certainty;
    };
    expect(at('VERIFIED_SUCCESS')).toBe('VERIFIED');
    expect(at('VERIFY_FAILED')).toBe('KNOWN'); // a known failure — not a success
    expect(at('HOLD')).toBe('UNKNOWN'); // unresolved — NOT laundered to KNOWN
    expect(at('SOMETHING_UNRECOGNISED')).toBe('UNKNOWN'); // deny-by-default
    expect(at(null)).toBe('UNKNOWN'); // unverified
  });
});

describe('L6-S2 · BrainContext — failure / fail-closed', () => {
  it('purpose-bound substrates absent → an explicit UNAVAILABLE fact each (never fabricated, never silent)', () => {
    const ctx = assembleBrainContext({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    const c = (f: string) => ctx.facts.find((x) => x.field === f);
    expect(c('environment')?.certainty).toBe('UNAVAILABLE');
    expect(c('purpose')?.certainty).toBe('UNAVAILABLE');
    expect(c('discovery')?.certainty).toBe('UNAVAILABLE');
    expect(c('evidence')?.certainty).toBe('UNAVAILABLE'); // no actions
  });

  it('FAIL-CLOSED — no tenant scope emits an unresolved fact, never fabricated data facts', () => {
    const ctx = assembleBrainContext({ ...base, workspace: realWorkspace(false), capabilities: realCaps(false) });
    expect(ctx.scopeResolved).toBe(false);
    expect(ctx.facts.find((f) => f.field === 'workspace.scope')?.certainty).toBe('UNAVAILABLE');
    expect(ctx.facts.find((f) => f.field === 'capabilities.scope')?.certainty).toBe('UNAVAILABLE');
    // No per-domain / per-capability data facts fabricated when scope is unresolved.
    expect(ctx.facts.some((f) => f.field.startsWith('workspace.') && f.field !== 'workspace.scope')).toBe(false);
  });
});

describe('L6-S2 · BrainContext — coherence with S1 + invariant', () => {
  it('atomic facts and synthesized sections are coherent — a routed cap is KNOWN atomically even when S1 flags the section CONFLICTING', () => {
    // A verified-failed action on a routed capability makes S1 mark capabilities CONFLICTING (cross-substrate)…
    const inputs: LiveBrainInputs = {
      ...base,
      workspace: realWorkspace(),
      capabilities: realCaps(),
      actions: [action({ verification: { terminal: 'VERIFY_FAILED', internetMessageId: null, at: 't' } })],
    };
    expect(composeLiveBrainState(inputs).sections.capabilities.certainty).toBe('CONFLICTING');
    // …while the ATOMIC L4 fact "mail.send routable" stays KNOWN (L4 alone says so). Different granularities, both honest.
    const ctx = assembleBrainContext(inputs);
    expect(ctx.facts.find((f) => f.field === 'capability.mail.send')?.certainty).toBe('KNOWN');
  });

  it('ZERO-RUNTIME-IMPORT (hardened) — types only + the ONE pure D-16 classifier; no value/bare/dynamic reach', () => {
    const src = readFileSync(join(__dirname, 'brainContext.ts'), 'utf8');
    const valueImports = src.match(/^import(?!\s+type\b)[^\n]*/gm) ?? [];
    for (const line of valueImports) {
      expect(line).toMatch(/from '\.\.\/verification\/verificationTerminals'/);
      expect(line).not.toMatch(/cst\/|governedSend|governedAction|connectors\/index|executor|\{ actionRecord \}/);
    }
    expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });
});
