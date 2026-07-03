/**
 * The Governance Runtime's decision core. `evaluateAction` runs four checks over
 * a proposed action and returns the **most restrictive** outcome — governance
 * fails safe (deny > require_approval > allow):
 *
 *   1. permission — every scope the action touches must be granted to the worker;
 *   2. trust      — side-effecting / higher-risk actions need sufficient trust;
 *   3. evidence   — side-effecting actions must be grounded (non-empty evidence);
 *   4. policy     — declarative rules can allow / deny / require approval.
 *
 * Pure: the worker, the policy set, and `now` are injected, so it unit-tests
 * from synthetic input with no Electron and no I/O.
 */
import type {
  ActionRequest,
  GovernanceCheck,
  GovernanceVerdict,
  PolicyEvaluation,
  PolicyRule,
  RiskLevel,
  VerdictDecision,
  Worker,
  WorkerPermissionScope,
} from '@neuropause/shared';
import { RISK_ORDER } from '@neuropause/shared';

const DECISION_RANK: Record<VerdictDecision, number> = { allow: 0, require_approval: 1, deny: 2 };

/** Trust required to auto-allow a side-effecting action at a given risk. */
const TRUST_FLOOR: Record<RiskLevel, number> = { low: 0, medium: 0.4, high: 0.7, critical: 0.9 };

function mostRestrictive(a: VerdictDecision, b: VerdictDecision): VerdictDecision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

function grantedScopes(worker: Worker): Set<WorkerPermissionScope> {
  return new Set(worker.permissions.filter((p) => p.granted).map((p) => p.scope));
}

function checkPermission(req: ActionRequest, worker: Worker): GovernanceCheck {
  const granted = grantedScopes(worker);
  const missing = req.permissions.filter((s) => !granted.has(s));
  if (missing.length === 0) {
    return { kind: 'permission', outcome: 'allow', pass: true, detail: 'All required permissions are granted.' };
  }
  return {
    kind: 'permission',
    outcome: 'deny',
    pass: false,
    detail: `Missing permission(s): ${missing.join(', ')}.`,
  };
}

function checkTrust(req: ActionRequest, worker: Worker): GovernanceCheck {
  if (!req.sideEffects && RISK_ORDER[req.risk] <= RISK_ORDER.low) {
    return { kind: 'trust', outcome: 'allow', pass: true, detail: 'Read-only, low-risk action.' };
  }
  const floor = TRUST_FLOOR[req.risk];
  if (worker.trustScore >= floor) {
    return { kind: 'trust', outcome: 'allow', pass: true, detail: `Trust ${worker.trustScore.toFixed(2)} ≥ floor ${floor.toFixed(2)}.` };
  }
  return {
    kind: 'trust',
    outcome: 'require_approval',
    pass: false,
    detail: `Trust ${worker.trustScore.toFixed(2)} below floor ${floor.toFixed(2)} for ${req.risk} risk.`,
  };
}

function checkEvidence(req: ActionRequest): GovernanceCheck {
  if (!req.sideEffects) {
    return { kind: 'evidence', outcome: 'allow', pass: true, detail: 'No side effects; evidence not required.' };
  }
  if (req.evidence.length > 0) {
    return { kind: 'evidence', outcome: 'allow', pass: true, detail: `Grounded in ${req.evidence.length} evidence item(s).` };
  }
  return {
    kind: 'evidence',
    outcome: 'require_approval',
    pass: false,
    detail: 'Side-effecting action has no supporting evidence.',
  };
}

function ruleMatches(rule: PolicyRule, req: ActionRequest, worker: Worker): { matched: boolean; reason: string } {
  const m = rule.match;
  if (m.roles && !m.roles.includes(req.workerRole)) return { matched: false, reason: 'role does not match' };
  if (m.skills && !m.skills.includes(req.skillId)) return { matched: false, reason: 'skill does not match' };
  if (m.sideEffects !== undefined && m.sideEffects !== req.sideEffects) return { matched: false, reason: 'side-effect flag does not match' };
  if (m.minRisk && RISK_ORDER[req.risk] < RISK_ORDER[m.minRisk]) return { matched: false, reason: `risk below ${m.minRisk}` };
  if (m.permissions && !m.permissions.some((p) => req.permissions.includes(p))) {
    return { matched: false, reason: 'no overlapping permission' };
  }
  if (rule.minTrust !== undefined && worker.trustScore < rule.minTrust) {
    // Rule applies, but the trust condition turns an allow into approval.
    return { matched: true, reason: `applies; trust ${worker.trustScore.toFixed(2)} < required ${rule.minTrust}` };
  }
  return { matched: true, reason: 'all conditions hold' };
}

function checkPolicies(
  req: ActionRequest,
  worker: Worker,
  policies: PolicyRule[],
): { check: GovernanceCheck; evaluations: PolicyEvaluation[] } {
  const enabled = policies.filter((p) => p.enabled).sort((a, b) => b.priority - a.priority);
  const evaluations: PolicyEvaluation[] = [];
  let decided: { effect: PolicyEffect; title: string } | null = null;

  for (const rule of enabled) {
    const { matched, reason } = ruleMatches(rule, req, worker);
    evaluations.push({ ruleId: rule.id, title: rule.title, effect: rule.effect, matched, reason });
    if (matched && !decided) {
      // First (highest-priority) matching rule decides; a failed minTrust downgrades allow→require_approval.
      const effect =
        rule.effect === 'allow' && rule.minTrust !== undefined && worker.trustScore < rule.minTrust
          ? 'require_approval'
          : rule.effect;
      decided = { effect, title: rule.title };
    }
  }

  if (!decided) {
    // No explicit rule: baseline — side-effecting actions need approval, reads allow.
    const outcome: VerdictDecision = req.sideEffects ? 'require_approval' : 'allow';
    return {
      check: {
        kind: 'policy',
        outcome,
        pass: outcome === 'allow',
        detail: req.sideEffects ? 'No matching policy; side effects default to approval.' : 'No matching policy; read action allowed.',
      },
      evaluations,
    };
  }

  const outcome = decided.effect as VerdictDecision;
  return {
    check: {
      kind: 'policy',
      outcome,
      pass: outcome === 'allow',
      detail: `Policy "${decided.title}" → ${decided.effect}.`,
    },
    evaluations,
  };
}

type PolicyEffect = 'allow' | 'deny' | 'require_approval';

export interface EvaluateInput {
  worker: Worker;
  policies: PolicyRule[];
  now: string;
}

export function evaluateAction(req: ActionRequest, input: EvaluateInput): GovernanceVerdict {
  const permission = checkPermission(req, input.worker);
  const trust = checkTrust(req, input.worker);
  const evidence = checkEvidence(req);
  const { check: policy, evaluations } = checkPolicies(req, input.worker, input.policies);

  const checks: GovernanceCheck[] = [permission, trust, evidence, policy];
  const decision = checks.reduce<VerdictDecision>((acc, c) => mostRestrictive(acc, c.outcome), 'allow');

  const reasons = checks.filter((c) => c.outcome === decision || !c.pass).map((c) => `${c.kind}: ${c.detail}`);

  return {
    requestId: req.id,
    workerId: req.workerId,
    skillId: req.skillId,
    decision,
    reasons,
    checks,
    evaluations,
    trustScore: input.worker.trustScore,
    risk: req.risk,
    decidedAt: input.now,
  };
}

/**
 * The default governance policy set. Conservative by design: high-risk and
 * external-proposing actions require human approval regardless of trust, while
 * read-only analysis is allowed. Operators can extend or override these.
 */
export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    id: 'pol:read-allow',
    title: 'Allow read-only analysis',
    description: 'Read-only skills that only inspect connected data are always allowed.',
    effect: 'allow',
    match: { sideEffects: false },
    priority: 10,
    enabled: true,
  },
  {
    id: 'pol:external-approval',
    title: 'Require approval for outbound proposals',
    description: 'Anything that would draft or send something externally needs a human.',
    effect: 'require_approval',
    match: { permissions: ['propose:message', 'propose:draft'] },
    priority: 80,
    enabled: true,
  },
  {
    id: 'pol:high-risk-approval',
    title: 'Require approval for high-risk actions',
    description: 'High and critical risk actions always require human approval.',
    effect: 'require_approval',
    match: { minRisk: 'high' },
    priority: 90,
    enabled: true,
  },
  {
    id: 'pol:write-trust',
    title: 'Trust-gate memory/reminder writes',
    description: 'Writes to memory or reminders are allowed only for sufficiently trusted workers.',
    effect: 'allow',
    match: { permissions: ['write:memory', 'write:reminder'] },
    priority: 50,
    enabled: true,
    minTrust: 0.6,
  },
];
