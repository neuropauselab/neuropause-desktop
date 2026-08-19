import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reason, type BrainReasoning } from './brainReasoning';
import { composeLiveBrainState, type LiveBrainInputs } from './liveBrainState';
import { assembleBrainContext } from './brainContext';
import type { ActionRecord } from '../connectors/actionRecord';
import { composeWorkspaceDomain } from '../enterprise/workspaceFoundation/domainAggregate';
import { composeCapabilityGraph } from '../capabilityGraph/capabilityGraph';
import { capabilityGraphSources } from '../capabilityGraph/liveSources';
import { composeEnvironmentModel } from '../environmentModel/environmentModel';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const realWorkspace = () =>
  composeWorkspaceDomain([{ domain: 'people', moduleId: 'hr-employees', label: 'People' }], {
    scope: () => TEST_TENANT_SCOPE, now: () => '2026-08-19T00:00:00.000Z', moduleCount: () => 3,
  });
const realCaps = () =>
  composeCapabilityGraph(capabilityGraphSources({
    mutations: () => [
      { capabilityId: 'mail.send', connectorId: 'microsoft-entra' }, // routes
      { capabilityId: 'chat.post', connectorId: 'slack' }, // not-governed gap
    ],
    scope: () => true,
  }));
const realEnv = (probe: 'present' | 'absent' | 'unknown') =>
  composeEnvironmentModel('send-email', [{ id: 'mail.send', kind: 'capability', label: 'mail.send' }], { probe: () => probe });
const action = (o: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'act_9', at: 't', requestId: 'r', transitionId: 'tr', actor: 'local:x', tenantId: 'ten',
  connectorId: 'microsoft-entra', accountId: 'acc', actionId: 'mail.send',
  recipients: { to: [], cc: [], bcc: [] }, subjectFingerprint: '', bodyFingerprint: '',
  verdict: 'admit', executed: true, outcome: 'ACKNOWLEDGED', admissionRef: 'tr', verification: null, ...o,
});
const base: LiveBrainInputs = { workspace: null, capabilities: null, environment: null, purpose: null, discovery: null, actions: [] };

const reasonOver = (inputs: LiveBrainInputs, previousInputs?: LiveBrainInputs): BrainReasoning => {
  const state = composeLiveBrainState(inputs);
  const context = assembleBrainContext(inputs);
  const previous = previousInputs ? assembleBrainContext(previousInputs) : undefined;
  return reason(state, context, previous);
};

describe('L6-S3 · reasoning — the eight answers, traced to evidence', () => {
  it('produces all eight answers; every statement cites at least one non-empty reference', () => {
    const r = reasonOver({ ...base, workspace: realWorkspace(), capabilities: realCaps(), environment: realEnv('present') });
    const groups = [r.whatIsHappening, r.why, r.whatIsMissing, r.known, r.unknown, r.could, r.shouldNot, r.whatChanged.changes];
    for (const g of groups) for (const s of g) {
      expect(s.cites.length).toBeGreaterThan(0);
      for (const c of s.cites) expect(c.length).toBeGreaterThan(0);
    }
    expect(r.known.length).toBeGreaterThan(0);
  });

  it('known/missing cite REAL context fact fields (reasoning traces to S2 provenance)', () => {
    const inputs = { ...base, workspace: realWorkspace(), capabilities: realCaps() };
    const fields = new Set(assembleBrainContext(inputs).facts.map((f) => f.field));
    const r = reasonOver(inputs);
    for (const s of [...r.known, ...r.whatIsMissing]) for (const c of s.cites) expect(fields.has(c)).toBe(true);
    expect(r.known.some((s) => s.cites.includes('capability.mail.send'))).toBe(true);
  });
});

describe('L6-S3 · reasoning — what changed is UNKNOWN without a prior (never assumed stable)', () => {
  it('no prior context → determinable false, honest UNKNOWN note', () => {
    const r = reasonOver({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    expect(r.whatChanged.determinable).toBe(false);
    expect(r.whatChanged.note).toMatch(/UNKNOWN|not assumed stable/i);
    expect(r.whatChanged.changes).toEqual([]);
  });

  it('with a prior context → determinable true, the delta computed + cited', () => {
    const prev = { ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [] };
    const now = { ...base, workspace: realWorkspace(), capabilities: realCaps(), actions: [action({ verification: { terminal: 'VERIFIED_SUCCESS', internetMessageId: '<x>', at: 't' } })] };
    const r = reasonOver(now, prev);
    expect(r.whatChanged.determinable).toBe(true);
    expect(r.whatChanged.changes.some((c) => c.statement.includes('action.act_9'))).toBe(true);
  });
});

describe('L6-S3 · reasoning — the boundary before S4 (analysis, not proposals)', () => {
  it('"could" POINTS at routable capabilities as analysis, gated to non-conflicted ones — never a proposal', () => {
    const clean = reasonOver({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    const couldMail = clean.could.find((s) => s.cites.includes('capability.mail.send'));
    expect(couldMail).toBeDefined();
    expect(couldMail?.statement).toMatch(/COULD be proposed at S4.*not a proposal/i);
    expect(clean.could.some((s) => s.cites.includes('capability.chat.post'))).toBe(false); // not-governed → never "could"

    // A capability in conflict is EXCLUDED from "could".
    const conflicted = reasonOver({
      ...base, workspace: realWorkspace(), capabilities: realCaps(),
      actions: [action({ verification: { terminal: 'VERIFIED_FAILURE', internetMessageId: null, at: 't' } })],
    });
    expect(conflicted.could.some((s) => s.cites.includes('capability.mail.send'))).toBe(false);
  });

  it('"should-not" enforces governance-boundary honesty, conflicts, and UNKNOWN-not-okay', () => {
    const r = reasonOver({
      ...base, workspace: realWorkspace(), capabilities: realCaps(), environment: realEnv('unknown'),
      actions: [action({ verification: { terminal: 'VERIFIED_FAILURE', internetMessageId: null, at: 't' } })],
    });
    expect(r.shouldNot.some((s) => s.statement.includes('not governed'))).toBe(true); // chat.post
    expect(r.shouldNot.some((s) => /must NOT be treated as settled/i.test(s.statement))).toBe(true); // conflict
    expect(r.shouldNot.some((s) => /UNKNOWN is never/i.test(s.statement))).toBe(true); // undetermined env
  });

  it('NO-PROPOSAL INVARIANT — the reasoning object is the eight analytical answers, with no action/authority/proposal field', () => {
    const r = reasonOver({ ...base, workspace: realWorkspace(), capabilities: realCaps() });
    expect(Object.keys(r).sort()).toEqual(
      ['could', 'known', 'shouldNot', 'unknown', 'whatChanged', 'whatIsHappening', 'whatIsMissing', 'why'].sort(),
    );
    // No structural proposal/action/authority key anywhere.
    expect(JSON.stringify(r)).not.toMatch(/"proposedAction"|"requiredAuthority"|"execute"|"grant"/);
  });
});

describe('L6-S3 · reasoning — invariant', () => {
  it('ZERO-RUNTIME-IMPORT — reasons over injected state/context; imports only TYPES (no path into governance/execution)', () => {
    const src = readFileSync(join(__dirname, 'brainReasoning.ts'), 'utf8');
    const valueImports = src.match(/^import\s+(?!type\b)[^;]*from\s+'[^']*'/gm) ?? [];
    expect(valueImports).toEqual([]);
  });
});
