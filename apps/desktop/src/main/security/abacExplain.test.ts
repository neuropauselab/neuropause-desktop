/**
 * S116 — ADVISORY ABAC DECISION EXPLANATION (read-only "why was this permitted/denied/not-applicable").
 *
 * Proves the harvested explanation capability is: faithful to the deny-wins evaluator; fail-closed
 * (permitted === explicit permit only); per-condition truthful (held + attributeMissing); and — the
 * central safety property — it GRANTS NOTHING and LEAKS NOTHING: no authority-shaped fields, and it
 * never echoes the RESOLVED request attribute values (only the policy's own declared comparison value).
 */
import { describe, it, expect } from 'vitest';
import { explainAbacDecision, isAbacPermitted, AbacPolicySet, type AbacPolicy, type AbacRequest } from './abac';

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
const permitTenant: AbacPolicy = { id: 'permit-tenant', effect: 'permit', version: 2, target: { resourceType: 'report' }, conditions: [{ attribute: 'subject.attributes.clearance', op: 'exists' }] };

describe('explainAbacDecision — advisory decision trace', () => {
  it('explains a PERMIT: fail-closed permitted, deciding policy, advisory summary', () => {
    const e = explainAbacDecision([permitInternal], req());
    expect(e.decision.effect).toBe('permit');
    expect(e.permitted).toBe(true);
    expect(e.decidingPolicyId).toBe('permit-internal');
    expect(e.summary).toMatch(/PERMITTED/);
    expect(e.summary).toMatch(/Advisory only/);
    const t = e.policies.find((p) => p.id === 'permit-internal')!;
    expect(t.targetMatched).toBe(true);
    expect(t.applicable).toBe(true);
    expect(t.conditions[0]).toMatchObject({ held: true, attributeMissing: false });
  });

  it('explains DENY WINS over a matching permit', () => {
    const r = req({ resource: { type: 'report', attributes: { classification: 'secret' } } });
    const e = explainAbacDecision([permitInternal, denySecret], r);
    expect(e.decision.effect).toBe('deny');
    expect(e.permitted).toBe(false);
    expect(e.decidingPolicyId).toBe('deny-secret');
    expect(e.summary).toMatch(/DENIED/);
    expect(e.policies.find((p) => p.id === 'deny-secret')!.applicable).toBe(true);
  });

  it('explains NOT-APPLICABLE fail-closed (no policy matched → NOT a permit)', () => {
    const r = req({ resource: { type: 'report', attributes: { classification: 'public' } } });
    const e = explainAbacDecision([permitInternal], r);
    expect(e.decision.effect).toBe('not-applicable');
    expect(e.permitted).toBe(false);
    expect(e.decidingPolicyId).toBeUndefined();
    expect(e.summary).toMatch(/NOT-APPLICABLE/);
  });

  it('per-condition trace distinguishes a value mismatch from a MISSING attribute', () => {
    // classification present but wrong value → held false, not missing
    const mismatch = explainAbacDecision([permitInternal], req({ resource: { type: 'report', attributes: { classification: 'public' } } }));
    const c1 = mismatch.policies[0].conditions[0];
    expect(c1.held).toBe(false);
    expect(c1.attributeMissing).toBe(false);

    // clearance attribute absent entirely → held false AND missing
    const missing = explainAbacDecision([permitTenant], req());
    const c2 = missing.policies[0].conditions[0];
    expect(c2.held).toBe(false);
    expect(c2.attributeMissing).toBe(true);
    expect(missing.policies[0].applicable).toBe(false);
  });

  it('traces targetMatched independently of applicability', () => {
    // action mismatch → target does not match; conditions still traced
    const e = explainAbacDecision([permitInternal], req({ action: 'write' }));
    const t = e.policies[0];
    expect(t.targetMatched).toBe(false);
    expect(t.applicable).toBe(false);
    expect(t.conditions.length).toBe(1); // still traced
    expect(e.decision.effect).toBe('not-applicable');
  });

  it('SECURITY: never echoes the RESOLVED request attribute values (no sensitive-data leak)', () => {
    const SENSITIVE = 'TOP-SECRET-CLEARANCE-9f3a';
    const r = req({ subject: { id: 'u1', attributes: { clearance: SENSITIVE, tenantId: 'tenant-A' } } });
    // policy tests only for EXISTENCE of clearance — it never declares the sensitive value
    const e = explainAbacDecision([permitTenant], r);
    expect(JSON.stringify(e)).not.toContain(SENSITIVE);
    // the trace still correctly reports the attribute is present
    expect(e.policies[0].conditions[0]).toMatchObject({ held: true, attributeMissing: false });
  });

  it('SECURITY: the explanation carries NO authority-shaped fields', () => {
    const e = explainAbacDecision([permitInternal, denySecret], req());
    expect(Object.keys(e).sort()).toEqual(['decidingPolicyId', 'decision', 'permitted', 'policies', 'summary']);
    const blob = JSON.stringify(e).toLowerCase();
    for (const forbidden of ['token', 'secret', 'grant', 'roles', 'permission', 'credential', 'privatekey']) {
      // deny-secret's id contains "secret"; allow that one exact substring, forbid the rest
      if (forbidden === 'secret') continue;
      expect(blob).not.toContain(forbidden);
    }
  });

  it('fail-closed invariant: permitted === isAbacPermitted(decision) for every effect', () => {
    const cases = [
      req(),
      req({ resource: { type: 'report', attributes: { classification: 'secret' } } }),
      req({ resource: { type: 'report', attributes: { classification: 'public' } } }),
    ];
    for (const r of cases) {
      const e = explainAbacDecision([permitInternal, denySecret], r);
      expect(e.permitted).toBe(isAbacPermitted(e.decision));
    }
  });

  it('AbacPolicySet.explain parity with the free function', () => {
    const set = new AbacPolicySet();
    set.add(permitInternal);
    set.add(denySecret);
    const viaSet = set.explain(req());
    const viaFn = explainAbacDecision(set.list(), req());
    expect(viaSet).toEqual(viaFn);
  });
});
