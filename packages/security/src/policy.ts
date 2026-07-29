/**
 * Policy Engine (NCEA 14.0, Phase 4). ONE centralized engine every protected
 * action is evaluated against. Policies are typed (access / security / connector /
 * ai / data / approval / tenant / retention / export), versioned, and evaluated
 * with deny-wins precedence over ABAC attribute conditions. It exposes evaluation
 * (as the AbacEvaluator the authorization model consumes), simulation (which
 * policies matched and why), and testing (assert expected effects for a set of
 * cases). Changes are audited; nothing evaluates outside this engine.
 */
import type { SecurityAudit } from './audit';
import type { AccessRequest } from './authz';

export const POLICY_KINDS = ['access', 'security', 'connector', 'ai', 'data', 'approval', 'tenant', 'retention', 'export'] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export type PolicyEffect = 'permit' | 'deny';
export type ConditionOp = 'eq' | 'ne' | 'in' | 'gt' | 'lt' | 'contains' | 'exists';

export interface Condition {
  attribute: string; // dotted path into the request, e.g. 'resource.attributes.classification'
  op: ConditionOp;
  value?: unknown;
}

export interface Policy {
  id: string;
  kind: PolicyKind;
  effect: PolicyEffect;
  version: number;
  target: { resourceType?: string; action?: string };
  conditions: Condition[];
  description?: string;
}

export interface EvalResult {
  effect: 'permit' | 'deny' | 'not-applicable';
  reason?: string;
  policyId?: string;
}

function resolve(req: AccessRequest, path: string): unknown {
  let cur: unknown = req;
  for (const key of path.split('.')) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

function conditionHolds(req: AccessRequest, c: Condition): boolean {
  const actual = resolve(req, c.attribute);
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
  }
}

export class PolicyEngine {
  private readonly policies = new Map<string, Policy>();
  private readonly history = new Map<string, Policy[]>();

  constructor(private readonly audit: SecurityAudit) {}

  async add(policy: Omit<Policy, 'version'>, actor = 'system'): Promise<Policy> {
    const existing = this.policies.get(policy.id);
    const version = existing ? existing.version + 1 : 1;
    const stored: Policy = { ...policy, version };
    if (existing) (this.history.get(policy.id) ?? this.history.set(policy.id, []).get(policy.id)!).push(existing);
    this.policies.set(policy.id, stored);
    await this.audit.record({ category: 'policy', action: existing ? 'update' : 'add', actor, target: policy.id, meta: { kind: policy.kind, effect: policy.effect, version } });
    return stored;
  }

  get(id: string): Policy | undefined {
    return this.policies.get(id);
  }
  list(kind?: PolicyKind): Policy[] {
    const all = [...this.policies.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }
  versionsOf(id: string): Policy[] {
    return [...(this.history.get(id) ?? []), ...(this.policies.get(id) ? [this.policies.get(id)!] : [])];
  }

  private applicable(req: AccessRequest): Policy[] {
    return [...this.policies.values()].filter(
      (p) =>
        (p.target.resourceType === undefined || p.target.resourceType === req.resource.type) &&
        (p.target.action === undefined || p.target.action === req.action) &&
        p.conditions.every((c) => conditionHolds(req, c)),
    );
  }

  /** Evaluate: deny wins, else permit, else not-applicable. This is the AbacEvaluator. */
  evaluate(req: AccessRequest): EvalResult {
    const matched = this.applicable(req);
    const deny = matched.find((p) => p.effect === 'deny');
    if (deny) return { effect: 'deny', reason: deny.description ?? `policy ${deny.id}`, policyId: deny.id };
    const permit = matched.find((p) => p.effect === 'permit');
    if (permit) return { effect: 'permit', reason: permit.description ?? `policy ${permit.id}`, policyId: permit.id };
    return { effect: 'not-applicable' };
  }

  /** Policy simulation — the full trace of which policies matched and the outcome. */
  simulate(req: AccessRequest): { matched: Array<{ id: string; effect: PolicyEffect }>; result: EvalResult } {
    return { matched: this.applicable(req).map((p) => ({ id: p.id, effect: p.effect })), result: this.evaluate(req) };
  }

  /** Policy testing — assert expected effects for a set of cases before rollout. */
  test(cases: Array<{ name: string; request: AccessRequest; expect: EvalResult['effect'] }>): { passed: number; failed: number; results: Array<{ name: string; ok: boolean; got: string }> } {
    const results = cases.map((c) => {
      const got = this.evaluate(c.request).effect;
      return { name: c.name, ok: got === c.expect, got };
    });
    return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
}
