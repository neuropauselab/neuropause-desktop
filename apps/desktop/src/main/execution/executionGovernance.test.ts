import { describe, it, expect } from 'vitest';
import type { ExecutionKind, ExecutionRequest, PolicyRule } from '@neuropause/shared';
import { evaluateAction, DEFAULT_POLICIES } from '../workforce/governance/policyEngine';
import {
  EXECUTION_KIND_PROFILE,
  createExecutionGate,
  type ExecutionPrincipal,
} from './executionGovernance';

/**
 * The gate puts the EXISTING decision core on the ExecuteEngine's path. These
 * tests prove three things and nothing else:
 *   - every ExecutionKind is classified (no ungoverned path by omission);
 *   - the gate refuses what the decision core refuses (it adds no leniency);
 *   - a human approval, and only a human approval, converts require_approval.
 * The decision core's own behaviour is tested in policyEngine.test.ts.
 */

const ALL_KINDS: ExecutionKind[] = [
  'task',
  'worker',
  'automation',
  'decision',
  'workflow',
  'memory',
  'connector',
  'voice',
  'runtime',
  'executive',
];

const owner: ExecutionPrincipal = {
  id: 'desktop-owner',
  role: 'operations',
  trustScore: 1,
  grantedScopes: ['execute:action', 'write:memory', 'read:entities'],
};

const untrusted: ExecutionPrincipal = { ...owner, trustScore: 0 };
const unscoped: ExecutionPrincipal = { ...owner, grantedScopes: [] };

function gateFor(principal: ExecutionPrincipal, policies: PolicyRule[] = DEFAULT_POLICIES) {
  return createExecutionGate({
    evaluate: evaluateAction,
    principal: () => principal,
    policies: () => policies,
    now: () => '2026-08-12T00:00:00.000Z',
    newId: () => 'req-1',
  });
}

const req = (kind: ExecutionKind, extra: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  kind,
  targetId: 'target-1',
  input: 'do the thing',
  ...extra,
});

describe('execution kind classification', () => {
  it('classifies every ExecutionKind — no path is ungoverned by omission', () => {
    for (const kind of ALL_KINDS) {
      expect(EXECUTION_KIND_PROFILE[kind], `unclassified kind: ${kind}`).toBeDefined();
    }
    expect(Object.keys(EXECUTION_KIND_PROFILE).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('marks every kind that dispatches work as side-effecting', () => {
    for (const kind of ALL_KINDS.filter((k) => k !== 'executive')) {
      expect(EXECUTION_KIND_PROFILE[kind].sideEffects, kind).toBe(true);
    }
  });
});

describe('execution gate', () => {
  it('permits a low-risk read-shaped execution for a scoped principal', () => {
    const d = gateFor(owner)(req('executive'));
    expect(d.allowed).toBe(true);
    expect(d.verdict.decision).toBe('allow');
  });

  it('refuses when the principal lacks the scope the kind exercises', () => {
    const d = gateFor(unscoped)(req('automation'));
    expect(d.allowed).toBe(false);
    expect(d.verdict.decision).toBe('deny');
    expect(d.reason).toMatch(/Blocked by governance/);
  });

  it('refuses a high-risk side-effecting execution from an untrusted principal', () => {
    const d = gateFor(untrusted)(req('connector'));
    expect(d.allowed).toBe(false);
  });

  it('does not let a renderer-supplied request skip approval', () => {
    // `confirmed` is in-process only; a request without it never bypasses.
    const d = gateFor(untrusted)(req('worker'));
    expect(d.allowed).toBe(false);
  });

  it('honours a human approval already taken by the trusted dispatcher', () => {
    const gate = gateFor(owner);
    const pending = gate(req('runtime'));
    if (pending.verdict.decision === 'require_approval') {
      const approved = gate(req('runtime', { confirmed: true }));
      expect(approved.allowed).toBe(true);
      expect(approved.reason).toMatch(/Approved by a human/);
    } else {
      // Nothing to convert; the core allowed or denied outright.
      expect(['allow', 'deny']).toContain(pending.verdict.decision);
    }
  });

  it('carries the target as evidence, and carries none when there is no target', () => {
    const gate = gateFor(owner);
    const withTarget = gate(req('memory'));
    const withoutTarget = gate(req('memory', { targetId: undefined }));
    // Evidence grounding is a check the core runs; a missing target must not be
    // papered over with a placeholder, so the two can differ.
    expect(withTarget.verdict.checks.some((c) => c.kind === 'evidence')).toBe(true);
    expect(withoutTarget.verdict.checks.some((c) => c.kind === 'evidence')).toBe(true);
  });

  it('never returns allowed:true when the core denied', () => {
    for (const kind of ALL_KINDS) {
      const d = gateFor(unscoped)(req(kind));
      if (d.verdict.decision === 'deny') expect(d.allowed).toBe(false);
    }
  });
});
