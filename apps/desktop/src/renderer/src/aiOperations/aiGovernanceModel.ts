/**
 * AI Governance — pure presentation lens for the AI Operating Platform (Phase 3).
 *
 * This tab REUSES the platform's already-shipped AI Workforce governance and the
 * enterprise compliance engine. It PRESENTS what those engines already compute —
 * it adds no engine, model, IPC channel, or store. Every stat/row below is
 * derived from a REAL field returned by an EXISTING `ipc.*` read:
 *
 *   - ipc.workforce.policies()    -> PolicyRule[]         declarative governance rules
 *                                                         (effect / priority / enabled / minTrust)
 *   - ipc.workforce.audit()       -> WorkforceAuditPage   recorded verdicts
 *                                                         (allow / deny / require_approval)
 *   - ipc.workforce.workers()     -> WorkerSummary[]      earned `trustScore` (0..1)
 *   - ipc.enterprise.compliance() -> ComplianceFinding[]  evidence-backed findings (status/severity)
 *
 * Capabilities the platform does NOT genuinely have — hallucination detection,
 * per-output safety scoring, semantic evidence validation, and general AI-output
 * verification — are surfaced as honest `OpGap`s ("Requires …"), never as invented
 * numbers. These gaps are architectural absences, so they are always present.
 *
 * Authenticity guard: a worker's `trustScore` is EARNED RELIABILITY that evolves
 * per job. It is deliberately NEVER labeled a "safety score" (per-output safety is
 * a gap, not a shipped capability). The two must not be conflated.
 *
 * Pure module: types + total functions. No React, DOM, IPC, or side effects.
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';
// Type-only (erased at runtime): the REAL shared governance contract. Used by
// `toAiGovernanceInput` to statically bind the ipc.* return types to the
// structural input below — if the shared contract drifts, that binding stops
// compiling under the same tsc gate as the rest of the renderer.
import type {
  PolicyRule,
  WorkforceAuditPage,
  WorkerSummary,
  ComplianceFinding,
} from '@neuropause/shared';

/* ── Structural input (minimal, defensively optional) ──────────────────────────
 * Each shape is a documented, widened mirror of the shared type it maps from.
 * Every field is optional so a partially-loaded, empty, or malformed payload
 * degrades to an honest empty state instead of throwing or fabricating.
 */

/** A declarative governance rule — mirrors `PolicyRule` from ipc.workforce.policies(). */
export interface GovPolicyInput {
  id?: string;
  title?: string;
  /** 'allow' | 'deny' | 'require_approval' */
  effect?: string;
  priority?: number;
  enabled?: boolean;
  /** Trust gate: a worker's trust must be ≥ this for the rule to be satisfied. */
  minTrust?: number;
}

/** One recorded verdict — mirrors a `WorkforceAuditEntry`. */
export interface GovVerdictInput {
  /** 'allow' | 'deny' | 'require_approval' */
  decision?: string;
  risk?: string;
}

/** The verdict audit page — mirrors `WorkforceAuditPage` from ipc.workforce.audit(). */
export interface GovAuditInput {
  entries?: readonly GovVerdictInput[];
  total?: number;
}

/** A worker's compact view — mirrors `WorkerSummary` from ipc.workforce.workers(). */
export interface GovWorkerInput {
  name?: string;
  role?: string;
  lifecycle?: string;
  healthState?: string;
  /** Earned reliability in 0..1. NOT a per-output safety score. */
  trustScore?: number;
}

/** A compliance finding — mirrors `ComplianceFinding` from ipc.enterprise.compliance(). */
export interface GovComplianceInput {
  ruleName?: string;
  category?: string;
  /** 'info' | 'warning' | 'critical' */
  severity?: string;
  /** 'pass' | 'warn' | 'fail' */
  status?: string;
}

/** The complete, defensively-optional input this lens derives from. */
export interface AiGovernanceInput {
  policies?: readonly GovPolicyInput[];
  audit?: GovAuditInput | null;
  workers?: readonly GovWorkerInput[];
  compliance?: readonly GovComplianceInput[];
}

/**
 * Bind the REAL shared governance types to the structural input. A caller feeds
 * `ipc.*` results straight through this seam; it also statically proves the
 * structural mirrors above stay consistent with the shared contract — the
 * assignments stop compiling if `PolicyRule`, `WorkforceAuditPage`,
 * `WorkerSummary`, or `ComplianceFinding` drift out of shape.
 */
export function toAiGovernanceInput(src: {
  policies?: readonly PolicyRule[] | null;
  audit?: WorkforceAuditPage | null;
  workers?: readonly WorkerSummary[] | null;
  compliance?: readonly ComplianceFinding[] | null;
}): AiGovernanceInput {
  return {
    policies: src.policies ?? undefined,
    audit: src.audit ?? undefined,
    workers: src.workers ?? undefined,
    compliance: src.compliance ?? undefined,
  };
}

/* ── Thresholds (presentation only; the counts they gate are all real) ── */

/** Risk floor: workers whose EARNED trust is below this are the genuine
 *  risk-threshold breaches (aligns with the low end of policy `minTrust` gating). */
const TRUST_FLOOR = 0.5;
/** Trust considered well-established. */
const TRUST_TRUSTED = 0.8;

/* ── small, defensive guards ── */
function list<T>(x: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(x) ? x : [];
}
function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
/** Render a 0..1 trust score as a score (e.g. "0.82"), never as a percentage. */
function score(n: number): string {
  return isFiniteNum(n) ? n.toFixed(2) : '—';
}

/**
 * Honest capability gaps. Each is a genuine architectural absence in today's
 * governance, so all four are surfaced regardless of how much real data exists.
 */
const GOVERNANCE_GAPS: readonly OpGap[] = [
  {
    capability: 'Hallucination detection',
    requires:
      'a factuality / grounding model — today governance runs only an evidence-PRESENCE check, not a truth check',
  },
  {
    capability: 'Safety scoring',
    requires:
      'a safety model — worker trust is earned reliability, not a per-output safety score (do not conflate the two)',
  },
  {
    capability: 'Semantic evidence validation',
    requires:
      'an evidence validator — attached evidence is checked for presence, not for correctness or relevance',
  },
  {
    capability: 'General AI-output verification',
    requires:
      'a general verifier — verification today is domain-scoped to the manufacturing digital twin, not universal',
  },
];

/** Deep-links to the canonical existing surfaces (reuse, never duplicate). */
const GOVERNANCE_LINKS: readonly OpLink[] = [
  { label: 'Worker approvals', section: 'workforce', icon: 'checklist' },
  { label: 'Administration · governance', section: 'administration', icon: 'shield' },
];

/**
 * Derive the view-ready AI Governance lens. Only signals that are genuinely
 * present produce stats/rows; an absent or empty signal shows the honest empty
 * state (nothing) rather than a placeholder. Gaps and links are always emitted.
 */
export function summarizeAiGovernance(input: AiGovernanceInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  // ── Policies & enforcement (real) ── ipc.workforce.policies()
  const policies = list(input.policies);
  if (policies.length > 0) {
    const total = policies.length;
    const enabled = policies.filter((p) => p.enabled === true).length;
    const deny = policies.filter((p) => p.effect === 'deny').length;
    const approval = policies.filter((p) => p.effect === 'require_approval').length;
    const allow = policies.filter((p) => p.effect === 'allow').length;
    const gates = policies.map((p) => p.minTrust).filter(isFiniteNum);
    const enabledRatio = enabled / total;

    stats.push({
      icon: 'shield',
      label: 'AI policies',
      value: count(total),
      tone: healthTone(enabledRatio),
      hint: `${count(enabled)} enabled`,
    });

    const rows: OpRow[] = [
      { label: 'Enabled', value: `${count(enabled)} of ${count(total)}`, tone: healthTone(enabledRatio) },
      { label: 'Deny rules', value: count(deny) },
      { label: 'Require approval', value: count(approval) },
      { label: 'Allow rules', value: count(allow) },
    ];
    if (gates.length > 0) {
      const lo = Math.min(...gates);
      const hi = Math.max(...gates);
      rows.push({
        label: 'Trust-gated',
        value: count(gates.length),
        sub: lo === hi ? `min trust ${score(lo)}` : `min trust ${score(lo)}–${score(hi)}`,
      });
    }
    groups.push({
      title: 'Policies & enforcement (real)',
      rows,
      note: 'Declarative rules enforced by the existing Governance Runtime — presented here, not added.',
    });
  }

  // ── Verdicts & approvals (real) ── ipc.workforce.audit()
  const verdicts = list(input.audit?.entries);
  if (verdicts.length > 0) {
    const n = verdicts.length;
    const allowed = verdicts.filter((v) => v.decision === 'allow').length;
    const approvals = verdicts.filter((v) => v.decision === 'require_approval').length;
    const denied = verdicts.filter((v) => v.decision === 'deny').length;
    const total = isFiniteNum(input.audit?.total) ? (input.audit as GovAuditInput).total! : n;
    const deniedRatio = denied / n;

    stats.push({
      icon: 'checklist',
      label: 'Recent verdicts',
      value: count(n),
      tone: riskTone(deniedRatio),
      hint: `${count(denied)} denied · ${count(approvals)} to approve`,
    });

    groups.push({
      title: 'Verdicts & approvals (real)',
      rows: [
        { label: 'Allowed', value: `${count(allowed)} (${pctText(allowed / n)})`, tone: healthTone(allowed / n) },
        {
          label: 'Required approval',
          value: `${count(approvals)} (${pctText(approvals / n)})`,
          tone: approvals > 0 ? 'orange' : 'gray',
        },
        { label: 'Denied', value: `${count(denied)} (${pctText(denied / n)})`, tone: riskTone(deniedRatio) },
      ],
      note: `${count(n)} of ${count(total)} recorded verdicts.`,
    });
  }

  // ── Worker trust & risk thresholds (real) ── ipc.workforce.workers()
  const workers = list(input.workers);
  if (workers.length > 0) {
    const trusts = workers.map((w) => w.trustScore).filter(isFiniteNum);
    const rows: OpRow[] = [{ label: 'Workers', value: count(workers.length) }];

    if (trusts.length > 0) {
      const mean = trusts.reduce((a, b) => a + b, 0) / trusts.length;
      const below = trusts.filter((t) => t < TRUST_FLOOR).length;
      const trusted = trusts.filter((t) => t >= TRUST_TRUSTED).length;

      stats.push({
        icon: 'cpu',
        label: 'Mean worker trust',
        value: score(mean),
        tone: healthTone(mean),
        hint: `${count(below)} below floor`,
      });

      rows.push(
        {
          label: 'Mean trust',
          value: score(mean),
          tone: healthTone(mean),
          sub: 'earned reliability, evolves per job',
        },
        {
          label: `Trusted (≥ ${score(TRUST_TRUSTED)})`,
          value: count(trusted),
          tone: healthTone(trusted / trusts.length),
        },
        {
          label: `Below risk floor (trust < ${score(TRUST_FLOOR)})`,
          value: count(below),
          tone: riskTone(below / trusts.length),
          sub: 'risk threshold',
        },
      );
    }

    groups.push({
      title: 'Worker trust & risk thresholds (real)',
      rows,
      note: 'Trust is earned reliability that evolves per job — not a per-output score.',
    });
  }

  // ── Compliance findings (real) ── ipc.enterprise.compliance()
  const findings = list(input.compliance);
  if (findings.length > 0) {
    const total = findings.length;
    const fail = findings.filter((f) => f.status === 'fail').length;
    const warn = findings.filter((f) => f.status === 'warn').length;
    const critical = findings.filter((f) => f.severity === 'critical').length;
    const complianceTone: OpsTone = fail > 0 ? 'red' : warn > 0 ? 'orange' : 'green';

    stats.push({
      icon: 'verified',
      label: 'Compliance findings',
      value: count(total),
      tone: complianceTone,
      hint: `${count(fail)} failing`,
    });

    groups.push({
      title: 'Compliance findings (real)',
      rows: [
        { label: 'Findings', value: count(total) },
        { label: 'Failing', value: count(fail), tone: fail > 0 ? 'red' : 'gray' },
        { label: 'Warnings', value: count(warn), tone: warn > 0 ? 'orange' : 'gray' },
        { label: 'Critical severity', value: count(critical), tone: critical > 0 ? 'red' : 'gray' },
      ],
      note: 'Evidence-backed findings from the existing enterprise compliance engine.',
    });
  }

  return { stats, groups, gaps: [...GOVERNANCE_GAPS], links: [...GOVERNANCE_LINKS] };
}
