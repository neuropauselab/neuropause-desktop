/**
 * S110 harvest (H4) — ABAC contextual policy evaluator (EVALUATION-ONLY, deny-wins).
 *
 * HARVESTED (adapted, not imported) from packages/security/src/policy.ts's PolicyEngine. The source
 * package is unwired and sits on the parallel @neuropause/* spine, so importing it would stand up a
 * second authorization system (S110 Rule 2). Only the PURE evaluation core is harvested here —
 * typed conditions, deny-wins precedence, applicability, simulate, test — re-implemented with zero
 * dependencies (no audit, no store).
 *
 * THIS IS NOT AUTHORITY. This module DOES NOT replace RBAC, does not change any live authorization
 * decision, and has NO import path to enterprise/authz, runtimeAuthz, cst/, the command bus, or any
 * ERP store. It evaluates attribute policies and returns an inert decision object. Nothing in the
 * live app consumes that decision to grant or deny access yet — enforcement is a separate, gated
 * step (an FG gate + operator ruling, because wiring ABAC into live authorization CHANGES
 * authorization semantics; see the S110 certification and DECISION-MEMO-S116-ABAC). Until then this
 * is a policy AUTHORING + SIMULATION + TESTING + EXPLANATION capability (the source's `simulate`/`test`
 * plus the S116 advisory `explainAbacDecision`), fail-closed by construction: a consumer must treat
 * anything other than an explicit `permit` as NOT permitted.
 *
 * The target architecture is RBAC + (future, gated) contextual ABAC inside the SAME canonical
 * authorization path — never a second auth system, never an AI-usable permission generator.
 */

export type AbacConditionOp = 'eq' | 'ne' | 'in' | 'gt' | 'lt' | 'contains' | 'exists';
export type AbacPolicyEffect = 'permit' | 'deny';
export type AbacEffect = 'permit' | 'deny' | 'not-applicable';

export interface AbacCondition {
  /** dotted path into the request, e.g. 'resource.attributes.classification' or 'subject.attributes.tenantId'. */
  attribute: string;
  op: AbacConditionOp;
  value?: unknown;
}

export interface AbacPolicy {
  id: string;
  effect: AbacPolicyEffect;
  version: number;
  target: { resourceType?: string; action?: string };
  conditions: AbacCondition[];
  description?: string;
}

export interface AbacSubject {
  id: string;
  attributes?: Record<string, unknown>;
}
export interface AbacResource {
  type: string;
  id?: string;
  attributes?: Record<string, unknown>;
}
export interface AbacRequest {
  subject: AbacSubject;
  action: string;
  resource: AbacResource;
  environment?: Record<string, unknown>;
}

export interface AbacDecision {
  effect: AbacEffect;
  reason?: string;
  policyId?: string;
}

/** Read a dotted attribute path from the request; missing → undefined (never throws). */
function resolveAttribute(req: AbacRequest, path: string): unknown {
  let cur: unknown = req;
  for (const key of path.split('.')) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

/** Whether one condition holds for a request. A missing attribute makes the condition FALSE
 *  (except 'ne', where absence ≠ a concrete value is honestly true) — the fail-safe default. */
export function conditionHolds(req: AbacRequest, c: AbacCondition): boolean {
  const actual = resolveAttribute(req, c.attribute);
  switch (c.op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === c.value;
    case 'ne':
      return actual !== c.value;
    case 'in':
      return Array.isArray(c.value) && c.value.includes(actual);
    case 'gt':
      return typeof actual === 'number' && typeof c.value === 'number' && actual > c.value;
    case 'lt':
      return typeof actual === 'number' && typeof c.value === 'number' && actual < c.value;
    case 'contains':
      return (typeof actual === 'string' && typeof c.value === 'string' && actual.includes(c.value)) || (Array.isArray(actual) && actual.includes(c.value));
    default:
      return false;
  }
}

/** The policies applicable to a request: matching target (resourceType/action) AND all conditions. */
export function applicablePolicies(policies: readonly AbacPolicy[], req: AbacRequest): AbacPolicy[] {
  return policies.filter(
    (p) =>
      (p.target.resourceType === undefined || p.target.resourceType === req.resource.type) &&
      (p.target.action === undefined || p.target.action === req.action) &&
      p.conditions.every((c) => conditionHolds(req, c)),
  );
}

/** Evaluate: DENY WINS, else permit, else not-applicable. Pure — the harvested AbacEvaluator. */
export function evaluatePolicies(policies: readonly AbacPolicy[], req: AbacRequest): AbacDecision {
  const matched = applicablePolicies(policies, req);
  const deny = matched.find((p) => p.effect === 'deny');
  if (deny) return { effect: 'deny', reason: deny.description ?? `policy ${deny.id}`, policyId: deny.id };
  const permit = matched.find((p) => p.effect === 'permit');
  if (permit) return { effect: 'permit', reason: permit.description ?? `policy ${permit.id}`, policyId: permit.id };
  return { effect: 'not-applicable' };
}

/**
 * FAIL-CLOSED consumer helper: an ABAC decision authorizes ONLY on an explicit `permit`.
 * `deny` and `not-applicable` (no policy matched, or a required attribute was missing) both → false.
 * This module never returns authority; a caller that ever enforces ABAC must go through this helper
 * AND still satisfy RBAC/CST/approval independently (ABAC augments, never replaces or bypasses).
 */
export function isAbacPermitted(decision: AbacDecision): boolean {
  return decision.effect === 'permit';
}

/** Full trace: which policies matched and the outcome (the source's `simulate`). */
export function simulatePolicies(policies: readonly AbacPolicy[], req: AbacRequest): { matched: Array<{ id: string; effect: AbacPolicyEffect }>; result: AbacDecision } {
  return { matched: applicablePolicies(policies, req).map((p) => ({ id: p.id, effect: p.effect })), result: evaluatePolicies(policies, req) };
}

/**
 * S116 — ADVISORY ABAC DECISION EXPLANATION ("why was this permitted / denied / not-applicable").
 *
 * A pure, read-only capability that annotates evaluatePolicies() with a per-policy, per-condition
 * trace so an operator can UNDERSTAND a contextual decision before any enforcement slice exists.
 * THIS GRANTS NOTHING: the explanation carries no roles, no token, no permission set — only booleans,
 * ids, the inert AbacDecision, and a human summary. It NEVER echoes the RESOLVED attribute values
 * from the request (which could be sensitive subject/resource data); it reports only whether each
 * condition HELD and whether its attribute was MISSING. The `value` it shows is the POLICY's own
 * declared comparison value (policy configuration, supplied by the caller), never request data.
 * Same fail-closed rule as isAbacPermitted: anything other than an explicit `permit` is NOT permitted.
 */
export interface AbacConditionTrace {
  attribute: string;
  op: AbacConditionOp;
  /** the POLICY's declared comparison value (not request data). */
  value?: unknown;
  held: boolean;
  /** true when the request attribute was absent (undefined) — a fail-safe non-match, not a mismatch. */
  attributeMissing: boolean;
}
export interface AbacPolicyTrace {
  id: string;
  effect: AbacPolicyEffect;
  version: number;
  /** target (resourceType/action) matched the request. */
  targetMatched: boolean;
  /** targetMatched AND every condition held. */
  applicable: boolean;
  conditions: AbacConditionTrace[];
}
export interface AbacExplanation {
  decision: AbacDecision;
  /** isAbacPermitted(decision) — fail-closed; deny AND not-applicable both → false. */
  permitted: boolean;
  decidingPolicyId?: string;
  /** per-policy trace, in evaluation order. */
  policies: AbacPolicyTrace[];
  summary: string;
}

function targetMatches(p: AbacPolicy, req: AbacRequest): boolean {
  return (
    (p.target.resourceType === undefined || p.target.resourceType === req.resource.type) &&
    (p.target.action === undefined || p.target.action === req.action)
  );
}

/**
 * Explain the deny-wins decision for a request: for every policy, whether its target matched, whether
 * each condition held (and if it failed only because the attribute was missing), and whether the policy
 * was therefore applicable — then the deciding policy under deny-wins. Pure; grants nothing.
 */
export function explainAbacDecision(policies: readonly AbacPolicy[], req: AbacRequest): AbacExplanation {
  const traces: AbacPolicyTrace[] = policies.map((p) => {
    const targetMatched = targetMatches(p, req);
    const conditions: AbacConditionTrace[] = p.conditions.map((c) => ({
      attribute: c.attribute,
      op: c.op,
      value: c.value,
      held: conditionHolds(req, c),
      attributeMissing: resolveAttribute(req, c.attribute) === undefined,
    }));
    const applicable = targetMatched && conditions.every((c) => c.held);
    return { id: p.id, effect: p.effect, version: p.version, targetMatched, applicable, conditions };
  });

  const decision = evaluatePolicies(policies, req);
  const permitted = isAbacPermitted(decision);
  const summary =
    decision.effect === 'deny'
      ? `DENIED by policy ${decision.policyId} (deny wins over any permit).`
      : decision.effect === 'permit'
        ? `PERMITTED by policy ${decision.policyId}. Advisory only — RBAC/CST/approval still apply.`
        : 'NOT-APPLICABLE — no policy matched; fail-closed, this is NOT a permit.';

  return { decision, permitted, decidingPolicyId: decision.policyId, policies: traces, summary };
}

/** Case-runner: assert expected effects before rollout (the source's `test`). */
export function testPolicies(
  policies: readonly AbacPolicy[],
  cases: Array<{ name: string; request: AbacRequest; expect: AbacEffect }>,
): { passed: number; failed: number; results: Array<{ name: string; ok: boolean; got: AbacEffect }> } {
  const results = cases.map((c) => {
    const got = evaluatePolicies(policies, c.request).effect;
    return { name: c.name, ok: got === c.expect, got };
  });
  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

/**
 * In-memory, versioned policy set for AUTHORING + SIMULATION + TESTING. No audit coupling, no store,
 * no enforcement — a workbench for defining and validating contextual policies before any gated
 * enforcement slice. Adding a policy with an existing id bumps its version and keeps history.
 */
export class AbacPolicySet {
  private readonly policies = new Map<string, AbacPolicy>();
  private readonly history = new Map<string, AbacPolicy[]>();

  add(policy: Omit<AbacPolicy, 'version'>): AbacPolicy {
    const existing = this.policies.get(policy.id);
    const version = existing ? existing.version + 1 : 1;
    if (existing) {
      const hist = this.history.get(policy.id) ?? [];
      hist.push(existing);
      this.history.set(policy.id, hist);
    }
    const stored: AbacPolicy = { ...policy, version };
    this.policies.set(policy.id, stored);
    return stored;
  }

  get(id: string): AbacPolicy | undefined {
    return this.policies.get(id);
  }
  list(): AbacPolicy[] {
    return [...this.policies.values()];
  }
  versionsOf(id: string): AbacPolicy[] {
    return [...(this.history.get(id) ?? []), ...(this.policies.get(id) ? [this.policies.get(id)!] : [])];
  }

  evaluate(req: AbacRequest): AbacDecision {
    return evaluatePolicies(this.list(), req);
  }
  simulate(req: AbacRequest): { matched: Array<{ id: string; effect: AbacPolicyEffect }>; result: AbacDecision } {
    return simulatePolicies(this.list(), req);
  }
  /** S116 — advisory decision explanation over the current policy set. Grants nothing. */
  explain(req: AbacRequest): AbacExplanation {
    return explainAbacDecision(this.list(), req);
  }
}
