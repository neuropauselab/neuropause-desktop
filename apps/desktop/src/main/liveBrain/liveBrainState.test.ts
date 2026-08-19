import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrainState';
import type { ActionRecord } from '../connectors/actionRecord';
// REAL upstream read-models — the join composes their genuine outputs, not fixtures:
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { composeEnvironmentModel } from '../environmentModel/environmentModel';
import { evaluatePurpose } from '../purposeEngine/purposeEngine';
import { runDiscovery } from '../environmentDiscovery/environmentDiscovery';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const realWorkspace = (scoped = true) =>
  composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], {
    scope: () => (scoped ? TEST_TENANT_SCOPE : null),
    now: () => '2026-08-19T00:00:00.000Z',
    moduleCount: () => 3,
  });

const realCaps = (scoped = true) =>
  composeCapabilityGraph(
    capabilityGraphSources({
      mutations: () => [{ capabilityId: 'mail.send', connectorId: 'microsoft-entra' }],
      scope: () => scoped,
    }),
  );

const realEnv = (probe: 'present' | 'absent' | 'unknown') =>
  composeEnvironmentModel('send-email', [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }], {
    probe: () => probe,
  });

// A real discovery run where every element resolves to `authority` → the DiscoveredState given.
const realDiscovery = (authority: 'granted' | 'denied' | 'unknown') =>
  runDiscovery(
    { purpose: 'send-email', minimumRequired: [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }] },
    { authorize: () => authority, collect: (e) => ({ elementId: e.id, present: true }) },
  );

const consentReadyPurpose = () =>
  evaluatePurpose(
    { text: 'send-email' },
    {
      recognize: () => true,
      route: () => ({ capability: 'mail.send', connector: 'microsoft-entra', workflow: 'wf' }),
      authority: () => 'permit',
      propose: () => ({ capability: 'mail.send', summary: 'send' }),
    },
  );

const action = (o: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'act_1', at: 't', requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'ten',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: ['a@b.com'], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr', verification: null, ...o,
});
const verified = (terminal: string): ActionRecord['verification'] => ({ terminal, internetMessageId: null, at: 't' });

const base: LiveBrainInputs = {
  workspace: null, capabilities: null, environment: null, purpose: null, discovery: null, actions: [],
};

describe('L6-S1 · LiveBrainState — the five-valued uncertainty over REAL read-models', () => {
  it('ambient KNOWN + evidence VERIFIED — a resolved workspace/graph with an independently verified action', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ verification: verified('VERIFIED_SUCCESS') })],
    });
    expect(s.scopeResolved).toBe(true);
    expect(s.sections.workspace.certainty).toBe('KNOWN');
    expect(s.sections.capabilities.certainty).toBe('KNOWN');
    expect(s.sections.evidence.certainty).toBe('VERIFIED');
    expect(s.sections.environment.certainty).toBe('UNAVAILABLE');
    expect(s.sections.purpose.certainty).toBe('UNAVAILABLE');
    expect(s.conflicts).toEqual([]);
  });

  it('FAIL-CLOSED — no tenant scope makes ambient sections UNAVAILABLE, never "all state"', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(false), capabilities: realCaps(false) });
    expect(s.scopeResolved).toBe(false);
    expect(s.tenantId).toBeNull();
    expect(s.sections.workspace.certainty).toBe('UNAVAILABLE');
    expect(s.sections.capabilities.certainty).toBe('UNAVAILABLE');
    expect(s.sections.health.certainty).toBe('UNAVAILABLE');
  });

  it('UNKNOWN NEVER BECOMES "PROBABLY OKAY" — an undetermined environment keeps health UNKNOWN', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      environment: realEnv('unknown'), purpose: consentReadyPurpose(),
      actions: [action({ verification: verified('VERIFIED_SUCCESS') })], // resolved, so environment is the driver
    });
    expect(s.sections.environment.certainty).toBe('UNKNOWN');
    expect(s.sections.health.certainty).toBe('UNKNOWN');
    expect(s.sections.health.summary).toMatch(/not assumed okay|incomplete/i);
  });

  it('risk is UNAVAILABLE (no model) — never a fabricated score', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    expect(s.sections.risk.certainty).toBe('UNAVAILABLE');
  });
});

describe('L6-S1 · LiveBrainState — verification terminals classified against the REAL vocabulary (fleet-audit fix)', () => {
  it('an UNRESOLVED terminal (HOLD) is NEVER laundered to okay — evidence + pendingWork + health all UNKNOWN', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ verification: verified('HOLD') })],
    });
    expect(s.sections.evidence.certainty).toBe('UNKNOWN'); // not KNOWN/"verified HOLD"
    expect(s.sections.pendingWork.certainty).toBe('UNKNOWN'); // HOLD counts as unresolved, not settled
    expect(s.sections.health.certainty).toBe('UNKNOWN');
  });

  it('a REAL verified FAILURE (VERIFY_FAILED) on a routed capability → CONFLICTING + incident + health CONFLICTING', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(), // routes mail.send
      actions: [action({ actionId: 'mail.send', verification: verified('VERIFY_FAILED') })],
    });
    expect(s.conflicts.some((c) => c.about.includes('usability'))).toBe(true); // the real terminal now fires
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
    expect(s.sections.evidence.certainty).toBe('CONFLICTING');
    expect(s.sections.incidents.certainty).toBe('CONFLICTING');
    expect(s.sections.health.certainty).toBe('CONFLICTING');
  });

  it('a verified FAILURE on a NON-routed capability still pulls health down (incidents folded into health)', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ actionId: 'chat.post', verification: verified('VERIFY_FAILED') })], // not a routed cap
    });
    expect(s.conflicts).toEqual([]); // no cross-substrate conflict (not routed)
    expect(s.sections.incidents.certainty).toBe('CONFLICTING'); // but a verified failure IS an incident
    expect(s.sections.health.certainty).toBe('CONFLICTING'); // and health reflects it (no green pixel over a failure)
  });

  it('an unverified action (null) is unresolved, never settled — evidence + health UNKNOWN', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [action()] });
    expect(s.sections.evidence.certainty).toBe('UNKNOWN');
    expect(s.sections.health.certainty).toBe('UNKNOWN');
  });
});

describe('L6-S1 · LiveBrainState — discovery per-result state (fleet-audit fix)', () => {
  it('an all-UNKNOWN discovery run makes the discovery section UNKNOWN and health UNKNOWN, never KNOWN', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      discovery: realDiscovery('unknown'), // every result → AUTHORITY_UNKNOWN → state UNKNOWN
      actions: [action({ verification: verified('VERIFIED_SUCCESS') })], // evidence resolved, so discovery drives health
    });
    expect(s.sections.discovery.certainty).toBe('UNKNOWN');
    expect(s.sections.health.certainty).toBe('UNKNOWN');
  });
});

describe('L6-S1 · LiveBrainState — CONFLICTING is detected and SURFACED, never auto-reconciled', () => {
  it('scope conflict — L1 and L4 disagree; both claims kept; scopeResolved is NOT "settled"', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(true), capabilities: realCaps(false) });
    const c = s.conflicts.find((x) => x.about === 'tenant scope resolution');
    expect(c).toBeDefined();
    expect(c?.claims.map((cl) => cl.says).sort()).toEqual(['scopeResolved=false', 'scopeResolved=true']);
    expect(s.sections.workspace.certainty).toBe('CONFLICTING');
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
    expect(s.scopeResolved).toBe(false); // a disputed scope is not resolved
  });

  it('environment-vs-capability — L2 says NEED (absent), L4 says routed (present); conflict surfaced', () => {
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(), environment: realEnv('absent'),
    });
    expect(s.conflicts.some((x) => x.about.includes('presence'))).toBe(true);
    expect(s.sections.environment.certainty).toBe('CONFLICTING');
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
  });
});

describe('L6-S1 · LiveBrainState — pins', () => {
  it('governedPaths (renamed from "authority") reflects L4 route existence, not principal permission', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    expect(s.sections.governedPaths.certainty).toBe('KNOWN');
    expect(s.sections.governedPaths.summary).toMatch(/governed PATH/);
    expect(s.sections.governedPaths.summary).not.toMatch(/authorized|permission grant|approved/i);
  });

  it('PROVENANCE — every section names its originating layer', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [action()] });
    expect(s.sections.workspace.source).toContain('L1');
    expect(s.sections.capabilities.source).toContain('L4');
    expect(s.sections.evidence.source).toContain('S34a');
    for (const section of Object.values(s.sections)) expect(section.source.length).toBeGreaterThan(0);
  });

  it('PURE JOIN / NO STORE — synchronous, deterministic, no I/O', () => {
    const inputs: LiveBrainInputs = { ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [action()] };
    const out = composeLiveBrainState(inputs);
    expect(out).not.toBeInstanceOf(Promise);
    expect(composeLiveBrainState(inputs)).toEqual(out);
  });

  it('ACTIONRECORD INJECTION (D-14 finding, pinned) — S1 takes already-queried ActionRecord[], never the async store', () => {
    const src = readFileSync(join(__dirname, 'liveBrainState.ts'), 'utf8');
    expect(src).toMatch(/import type \{[^}]*\bActionRecord\b[^}]*\} from '\.\.\/connectors\/actionRecord'/);
    expect(src).not.toMatch(/import \{[^}]*\bactionRecord\b/);
    expect(src).not.toMatch(/\.query\s*\(/);
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ verification: verified('VERIFIED_SUCCESS') })],
    });
    expect(s.sections.evidence.certainty).toBe('VERIFIED');
    expect((s.sections.evidence.detail as { verifiedSuccess: number }).verifiedSuccess).toBe(1);
  });

  it('UNCERTAINTY CENSUS — the rollup counts every section exactly once', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    const total = Object.values(s.uncertainty).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.keys(s.sections).length);
  });

  it('ZERO-RUNTIME-IMPORT (hardened) — types only + the ONE pure D-16 classifier; no governance/execution/store/bare/dynamic', () => {
    const src = readFileSync(join(__dirname, 'liveBrainState.ts'), 'utf8');
    const valueImports = src.match(/^import(?!\s+type\b)[^\n]*/gm) ?? [];
    // The ONLY permitted value import is the pure canonical terminal classifier (no side effects, no reach).
    for (const line of valueImports) {
      // The ONLY permitted value imports are the two PURE authorities (D-16 terminals + S4.0 tenant reconciliation).
      expect(line).toMatch(/from '\.\.\/(verification\/verificationTerminals|tenancy\/tenantStamp)'/);
      expect(line).not.toMatch(/cst\/|governedSend|governedAction|connectors\/index|executor|\{ actionRecord \}/);
    }
    expect(src).not.toMatch(/\bimport\s*\(|\brequire\s*\(/); // no dynamic import()/require()
  });
});
