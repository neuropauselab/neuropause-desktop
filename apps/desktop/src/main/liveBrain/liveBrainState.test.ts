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

const base: LiveBrainInputs = {
  workspace: null, capabilities: null, environment: null, purpose: null, discovery: null, actions: [],
};

describe('L6-S1 · LiveBrainState — the five-valued uncertainty over REAL read-models', () => {
  it('ambient KNOWN + evidence VERIFIED — a resolved workspace/graph with an independently verified action', () => {
    const s = composeLiveBrainState({
      ...base,
      workspace: realWorkspace(),
      capabilities: realCaps(),
      actions: [action({ verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<x>', at: 't' } })],
    });
    expect(s.scopeResolved).toBe(true);
    expect(s.sections.workspace.certainty).toBe('KNOWN');
    expect(s.sections.capabilities.certainty).toBe('KNOWN');
    expect(s.sections.evidence.certainty).toBe('VERIFIED');
    // purpose-bound layers absent → UNAVAILABLE, never fabricated:
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
    expect(s.sections.health.certainty).toBe('UNAVAILABLE'); // partially blind, not "okay"
  });

  it('UNKNOWN NEVER BECOMES "PROBABLY OKAY" — an undetermined environment keeps health UNKNOWN', () => {
    const s = composeLiveBrainState({
      ...base,
      workspace: realWorkspace(),
      capabilities: realCaps(),
      environment: realEnv('unknown'), // one element undetermined
      purpose: consentReadyPurpose(),
      actions: [action()], // no verification → evidence KNOWN, not UNAVAILABLE
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

describe('L6-S1 · LiveBrainState — CONFLICTING is detected and SURFACED, never auto-reconciled', () => {
  it('scope conflict — L1 and L4 disagree on tenant resolution; both claims kept', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(true), capabilities: realCaps(false) });
    const c = s.conflicts.find((x) => x.about === 'tenant scope resolution');
    expect(c).toBeDefined();
    expect(c?.claims.map((cl) => cl.says).sort()).toEqual(['scopeResolved=false', 'scopeResolved=true']);
    expect(s.sections.workspace.certainty).toBe('CONFLICTING');
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
  });

  it('routed-but-verified-failed — L4 says usable, S34a says it failed; conflict surfaced', () => {
    const s = composeLiveBrainState({
      ...base,
      workspace: realWorkspace(),
      capabilities: realCaps(), // routes mail.send
      actions: [action({ verification: { terminal: 'VERIFIED_FAILURE', internetMessageId: null, at: 't' } })],
    });
    const c = s.conflicts.find((x) => x.about.includes('usability'));
    expect(c).toBeDefined();
    expect(c?.claims).toHaveLength(2); // BOTH sides retained — not reconciled to one
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
    expect(s.sections.evidence.certainty).toBe('CONFLICTING');
    expect(s.sections.incidents.certainty).toBe('CONFLICTING');
  });

  it('environment-vs-capability — L2 says NEED (absent), L4 says routed (present); conflict surfaced', () => {
    const s = composeLiveBrainState({
      ...base,
      workspace: realWorkspace(),
      capabilities: realCaps(),
      environment: realEnv('absent'), // mail.send → NEED
    });
    const c = s.conflicts.find((x) => x.about.includes('presence'));
    expect(c).toBeDefined();
    expect(s.sections.environment.certainty).toBe('CONFLICTING');
    expect(s.sections.capabilities.certainty).toBe('CONFLICTING');
  });
});

describe('L6-S1 · LiveBrainState — pins', () => {
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
    expect(out).not.toBeInstanceOf(Promise); // no async store access
    expect(composeLiveBrainState(inputs)).toEqual(out); // deterministic over the same inputs
  });

  it('ACTIONRECORD INJECTION (D-14 finding, pinned) — S1 takes already-queried ActionRecord[], never the async store', () => {
    const src = readFileSync(join(__dirname, 'liveBrainState.ts'), 'utf8');
    // ActionRecord enters as a TYPE ONLY — the module never imports the disk-backed store singleton…
    expect(src).toMatch(/import type \{[^}]*\bActionRecord\b[^}]*\} from '\.\.\/connectors\/actionRecord'/);
    // …never imports the `actionRecord` value, and never calls the async `.query()`:
    expect(src).not.toMatch(/import \{[^}]*\bactionRecord\b/);
    expect(src).not.toMatch(/\.query\s*\(/);
    // Functionally: a pre-built ActionRecord[] flows through as injected data.
    const s = composeLiveBrainState({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<x>', at: 't' } })],
    });
    expect(s.sections.evidence.certainty).toBe('VERIFIED');
    expect((s.sections.evidence.detail as { verifiedSuccess: number }).verifiedSuccess).toBe(1);
  });

  it('UNCERTAINTY CENSUS — the rollup counts every section exactly once', () => {
    const s = composeLiveBrainState({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    const total = Object.values(s.uncertainty).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.keys(s.sections).length);
  });

  it('ZERO-RUNTIME-IMPORT — the state model imports only TYPES (no path into governance/execution)', () => {
    const src = readFileSync(join(__dirname, 'liveBrainState.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
