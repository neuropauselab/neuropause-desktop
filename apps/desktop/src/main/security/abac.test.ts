/**
 * S110 (H4) — ABAC contextual policy evaluator (harvested from packages/security/src/policy.ts).
 * Reproduces the source semantics AND proves the S110 §5 adversarial requirements: ABAC is a pure,
 * fail-closed evaluation capability that cannot bypass or generate authority.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePolicies,
  simulatePolicies,
  testPolicies,
  isAbacPermitted,
  conditionHolds,
  AbacPolicySet,
  type AbacPolicy,
  type AbacRequest,
} from './abac';

function req(over: Partial<AbacRequest> = {}): AbacRequest {
  return {
    subject: { id: 'u1', attributes: { tenantId: 'tenant-A', role: 'analyst' } },
    action: 'read',
    resource: { type: 'report', id: 'r1', attributes: { classification: 'internal', tenantId: 'tenant-A' } },
    environment: { ip: '10.0.0.1' },
    ...over,
  };
}

const permitInternal: AbacPolicy = { id: 'permit-internal', effect: 'permit', version: 1, target: { resourceType: 'report', action: 'read' }, conditions: [{ attribute: 'resource.attributes.classification', op: 'eq', value: 'internal' }] };
const denySecret: AbacPolicy = { id: 'deny-secret', effect: 'deny', version: 1, target: { resourceType: 'report' }, conditions: [{ attribute: 'resource.attributes.classification', op: 'eq', value: 'secret' }] };

describe('A. reproduces packages/security PolicyEngine semantics', () => {
  it('permit when a permit policy matches; not-applicable when none match', () => {
    expect(evaluatePolicies([permitInternal], req()).effect).toBe('permit');
    expect(evaluatePolicies([permitInternal], req({ resource: { type: 'report', attributes: { classification: 'public' } } })).effect).toBe('not-applicable');
  });

  it('DENY WINS over a matching permit', () => {
    const r = req({ resource: { type: 'report', attributes: { classification: 'secret' } } });
    const both: AbacPolicy[] = [{ ...permitInternal, conditions: [] }, denySecret];
    expect(evaluatePolicies(both, r).effect).toBe('deny');
    expect(evaluatePolicies(both, r).policyId).toBe('deny-secret');
  });

  it('simulate() traces matched policies; test() runs cases', () => {
    const sim = simulatePolicies([permitInternal, denySecret], req());
    expect(sim.matched.map((m) => m.id)).toContain('permit-internal');
    const t = testPolicies([permitInternal], [
      { name: 'internal→permit', request: req(), expect: 'permit' },
      { name: 'public→n/a', request: req({ resource: { type: 'report', attributes: { classification: 'public' } } }), expect: 'not-applicable' },
    ]);
    expect(t.failed).toBe(0);
  });

  it('all condition operators behave (eq/ne/in/gt/lt/contains/exists)', () => {
    const r = req({ resource: { type: 'x', attributes: { n: 5, tags: ['a', 'b'], name: 'alpha' } } });
    expect(conditionHolds(r, { attribute: 'resource.attributes.n', op: 'gt', value: 3 })).toBe(true);
    expect(conditionHolds(r, { attribute: 'resource.attributes.n', op: 'lt', value: 3 })).toBe(false);
    expect(conditionHolds(r, { attribute: 'resource.attributes.tags', op: 'contains', value: 'a' })).toBe(true);
    expect(conditionHolds(r, { attribute: 'resource.attributes.name', op: 'contains', value: 'lph' })).toBe(true);
    expect(conditionHolds(r, { attribute: 'resource.attributes.name', op: 'exists' })).toBe(true);
    expect(conditionHolds(r, { attribute: 'resource.attributes.missing', op: 'exists' })).toBe(false);
    expect(conditionHolds(r, { attribute: 'resource.attributes.name', op: 'in', value: ['alpha', 'beta'] })).toBe(true);
  });
});

describe('§5 adversarial — ABAC cannot bypass or generate authority', () => {
  it('tenant A cannot use tenant B attributes (tenant-scoped permit only matches its own tenant)', () => {
    const tenantScoped: AbacPolicy = { id: 'permit-tenantA', effect: 'permit', version: 1, target: { resourceType: 'report', action: 'read' }, conditions: [{ attribute: 'subject.attributes.tenantId', op: 'eq', value: 'tenant-A' }] };
    // tenant-A subject → permit
    expect(evaluatePolicies([tenantScoped], req()).effect).toBe('permit');
    // tenant-B subject, same policy → NOT applicable (its condition fails); fail-closed → not permitted
    const bReq = req({ subject: { id: 'u2', attributes: { tenantId: 'tenant-B' } } });
    expect(evaluatePolicies([tenantScoped], bReq).effect).toBe('not-applicable');
    expect(isAbacPermitted(evaluatePolicies([tenantScoped], bReq))).toBe(false);
  });

  it('FORGED attributes cannot elevate: a permit decision is inert data, not authority', () => {
    const attacker = req({ subject: { id: 'evil', attributes: { role: 'admin', isSuperUser: true, permission: '*' } } });
    const d = evaluatePolicies([{ ...permitInternal, conditions: [] }], attacker);
    // even a 'permit' is only {effect, reason, policyId} — no permission/token/authority surface
    expect(Object.keys(d).sort()).toEqual(['effect', 'policyId', 'reason']);
    for (const k of ['permission', 'authorized', 'token', 'grant', 'roles', 'admit']) expect(d).not.toHaveProperty(k);
    for (const v of Object.values(d)) expect(typeof v).not.toBe('function');
  });

  it('MISSING attributes fail safe: a condition on an absent attribute does not permit', () => {
    const needsClearance: AbacPolicy = { id: 'permit-cleared', effect: 'permit', version: 1, target: { resourceType: 'report' }, conditions: [{ attribute: 'subject.attributes.clearance', op: 'eq', value: 'high' }] };
    const noClearance = req(); // subject has no clearance attribute
    expect(evaluatePolicies([needsClearance], noClearance).effect).toBe('not-applicable');
    expect(isAbacPermitted(evaluatePolicies([needsClearance], noClearance))).toBe(false);
  });

  it('isAbacPermitted is FAIL-CLOSED: only explicit permit → true', () => {
    expect(isAbacPermitted({ effect: 'permit' })).toBe(true);
    expect(isAbacPermitted({ effect: 'deny' })).toBe(false);
    expect(isAbacPermitted({ effect: 'not-applicable' })).toBe(false);
  });

  it('STRUCTURAL: abac.ts IMPORTS nothing that could enforce, bypass, or generate authority', () => {
    const src = readFileSync(join(__dirname, 'abac.ts'), 'utf8');
    // Only inspect actual import statements — the doc comment deliberately NAMES these modules to
    // state that the module avoids them, so a substring scan would false-positive on the prose.
    const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(importLines.length).toBe(0); // the harvested evaluator is dependency-free (pure)
    for (const forbidden of [
      'enterprise/authz', 'runtimeAuthz', '/cst', 'executionGate', 'dispatchCommand', 'commandBus',
      'approvalEngine', 'EnterpriseRecordStore', '@neuropause/security', 'postStockMovement', 'applyGlDerivedEntries',
    ]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it('ABAC does not replace RBAC: it emits only a decision; enforcement (if ever) must ALSO satisfy RBAC/CST/approval', () => {
    // The module exposes no enforcement entrypoint — only pure evaluators + an authoring PolicySet.
    const set = new AbacPolicySet();
    set.add(permitInternal);
    const d = set.evaluate(req());
    expect(d.effect).toBe('permit');
    // there is no method that acts on this decision; a consumer would still call the live RBAC
    // (enterprise/authz) independently. Proven structurally by the import test above.
    expect(typeof (set as unknown as Record<string, unknown>).enforce).toBe('undefined');
    expect(typeof (set as unknown as Record<string, unknown>).grant).toBe('undefined');
  });
});

describe('§4 authoring workbench — versioned policy set (simulate/test before rollout)', () => {
  it('versions policies and keeps history; simulate/evaluate are consistent', () => {
    const set = new AbacPolicySet();
    const v1 = set.add(permitInternal);
    expect(v1.version).toBe(1);
    const v2 = set.add({ ...permitInternal, description: 'tightened' });
    expect(v2.version).toBe(2);
    expect(set.versionsOf('permit-internal').length).toBe(2);
    expect(set.simulate(req()).result.effect).toBe(set.evaluate(req()).effect);
  });
});
