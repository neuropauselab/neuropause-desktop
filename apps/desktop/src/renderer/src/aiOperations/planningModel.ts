/**
 * AI Operating Platform — Planning lens (Phase 3). PURE derivation, no runtime.
 *
 * A READ-ONLY overview that COMPOSES the platform's already-shipped planning
 * surfaces into one honest picture of "what is being planned, how it is approved,
 * and how it executes". It calls NOTHING and adds NO ipc channel — it derives over
 * data the caller already fetched from EXISTING `ipc.*` methods:
 *
 *   - ipc.strategyPlatform.planning()  → PlanningEngine  (long-horizon plans:
 *       horizon buckets, milestones, steps; steps carry a real governance-approval
 *       requirement referencing the enterprise approval chains).
 *   - ipc.autoOps.plans()              → AutoOpsPlans     (operational plans with a
 *       CATEGORICAL risk band, approval status, auto-executable/approval counts).
 *   - ipc.enterprise.governanceConfig()→ GovernanceConfig (the approval-chain
 *       backbone every planned side-effect is gated on).
 *   - ipc.execute.sessions()           → { sessions, stats } (real run records).
 *
 * Every stat/row below reads a REAL field on one of those returns. Capabilities the
 * platform genuinely lacks (a cost estimator, a numeric risk model, wall-clock
 * scheduling) are surfaced as honest, labeled `OpGap`s — never fabricated numbers.
 * When a source is unpopulated the honest empty state shows through: no placeholder.
 *
 * NB: this lens is an OVERVIEW only. It never invokes the interactive planners
 * (workforce.delegate / strategy / auto-ops) — those are reached via `links`.
 */
import {
  type OpLens,
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';

/**
 * MINIMAL STRUCTURAL projection of the real ipc returns this lens reads. Only the
 * fields actually consumed are declared, and every field is optional so an
 * unpopulated (or entirely absent) source degrades to an honest empty state rather
 * than throwing or fabricating a value. Field provenance is noted per member.
 */
export interface PlanningInput {
  /** ipc.strategyPlatform.planning() → PlanningEngine */
  planning?: {
    /** PlanHorizon[] — one bucket per StrategyHorizon (30d/90d/…); relative, not calendar. */
    horizons?: Array<{
      horizon?: string;
      /** StrategyMilestone.status ∈ on_track | at_risk | off_track */
      milestones?: Array<{ status?: 'on_track' | 'at_risk' | 'off_track' }>;
      /** PlanStep.requiredApproval.governed — whether an enabled chain governs the step. */
      steps?: Array<{ requiredApproval?: { governed?: boolean } }>;
    }>;
    totalMilestones?: number;
    totalSteps?: number;
  };
  /** ipc.autoOps.plans() → AutoOpsPlans */
  autoOps?: {
    /** OperationalPlan[] — risk is the CATEGORICAL OpsRisk band (no numeric score exists). */
    plans?: Array<{
      risk?: 'low' | 'medium' | 'high' | 'critical';
      approvalStatus?: 'candidate' | 'awaiting_approval' | 'approved' | 'rejected';
    }>;
    approvalRequiredCount?: number;
    autoExecutableCount?: number;
  };
  /** ipc.enterprise.governanceConfig() → GovernanceConfig */
  governance?: {
    /** ApprovalChain[] — the approval-planning backbone. */
    approvalChains?: Array<{ enabled?: boolean }>;
  };
  /** ipc.execute.sessions() → { sessions, stats } */
  execution?: {
    sessions?: Array<{ state?: string }>;
    stats?: {
      active?: number;
      completed?: number;
      failed?: number;
      /** 0..1 or null when no terminal runs exist yet. */
      successRate?: number | null;
    };
  };
}

/**
 * Honest capability gaps — always present. Each names the REAL architecture the
 * capability would require; none hides a value that is actually available today.
 */
const GAPS: OpGap[] = [
  {
    capability: 'Cost planning',
    requires: 'a plan-cost estimator — only current spend actuals exist (commercial.metering)',
  },
  {
    capability: 'Predictive risk scoring',
    requires: 'a risk model — only categorical severity/priority exists today',
  },
  {
    capability: 'Wall-clock timeline',
    requires:
      'historical-duration wiring — plans order in relative effort units, not calendar time',
  },
];

/** Deep-links to the canonical interactive surfaces (reuse, never duplicate). */
const LINKS: OpLink[] = [
  { label: 'Delegation & Workforce', section: 'workforce-center' },
  { label: 'Strategy Planning', section: 'strategy-center' },
  { label: 'Operational plans', section: 'auto-ops-center' },
];

const len = (a: { length: number } | undefined | null): number => (a ? a.length : 0);

/**
 * Derive the Planning lens from whatever real sources the caller supplied. Every
 * emitted stat/row is gated on its source being genuinely populated, so a fully
 * empty (or undefined) input yields empty stats/groups while the gaps + links —
 * which are architectural facts, not data — always remain.
 */
export function summarizePlanning(input: PlanningInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  // ── Strategy long-horizon planning (real: PlanningEngine) ──────────────────
  const planning = input?.planning;
  const horizons = planning?.horizons ?? [];
  const milestones = horizons.flatMap((h) => h?.milestones ?? []);
  const planSteps = horizons.flatMap((h) => h?.steps ?? []);
  const stepTotal = planning?.totalSteps ?? planSteps.length;
  const milestoneTotal = milestones.length;
  const onTrack = milestones.filter((m) => m?.status === 'on_track').length;
  const atRisk = milestones.filter((m) => m?.status === 'at_risk').length;
  const offTrack = milestones.filter((m) => m?.status === 'off_track').length;
  const governedSteps = planSteps.filter((s) => s?.requiredApproval?.governed === true).length;
  const planningPopulated =
    !!planning && (horizons.length > 0 || stepTotal > 0 || (planning.totalMilestones ?? 0) > 0);

  if (planningPopulated) {
    stats.push({
      icon: 'sparkles',
      label: 'Strategy plan steps',
      value: count(stepTotal),
      hint: `${count(horizons.length)} horizons · ${count(planning?.totalMilestones ?? milestoneTotal)} milestones`,
    });
  }

  // ── Autonomous operational plans (real: AutoOpsPlans) ──────────────────────
  const autoOps = input?.autoOps;
  const plans = autoOps?.plans ?? [];
  const byRisk = (r: string): number => plans.filter((p) => p?.risk === r).length;
  const highRisk = byRisk('high') + byRisk('critical');
  const awaiting =
    autoOps?.approvalRequiredCount ??
    plans.filter((p) => p?.approvalStatus === 'awaiting_approval').length;
  const autoOpsPopulated =
    !!autoOps &&
    (plans.length > 0 ||
      (autoOps.approvalRequiredCount ?? 0) > 0 ||
      (autoOps.autoExecutableCount ?? 0) > 0);

  if (autoOpsPopulated) {
    stats.push({
      icon: 'checklist',
      label: 'Operational plans',
      value: count(plans.length),
      tone: plans.length > 0 ? riskTone(highRisk / plans.length) : undefined,
      hint: highRisk > 0 ? `${count(highRisk)} high/critical risk` : undefined,
    });
  }

  // Group 1 — 'Plans in flight' (strategy + autoOps).
  if (planningPopulated || autoOpsPopulated) {
    const rows: OpRow[] = [];
    if (planningPopulated) {
      rows.push({
        label: 'Strategy horizons',
        value: count(horizons.length),
        sub: `${count(stepTotal)} steps · ${count(milestoneTotal)} milestones`,
      });
      if (milestoneTotal > 0) {
        rows.push({
          label: 'Milestones on track',
          value: `${count(onTrack)}/${count(milestoneTotal)}`,
          tone: healthTone(onTrack / milestoneTotal),
          sub:
            atRisk > 0 || offTrack > 0
              ? `${count(atRisk)} at risk · ${count(offTrack)} off track`
              : undefined,
        });
      }
      if (offTrack > 0) {
        rows.push({ label: 'Milestones off track', value: count(offTrack), tone: 'red' });
      }
    }
    if (autoOpsPopulated) {
      rows.push({ label: 'Operational plans', value: count(plans.length) });
      if (plans.length > 0) {
        rows.push({
          label: 'By risk',
          value: `${count(byRisk('critical'))} critical · ${count(byRisk('high'))} high`,
          sub: `${count(byRisk('medium'))} medium · ${count(byRisk('low'))} low`,
          tone: riskTone(highRisk / plans.length),
        });
      }
    }
    groups.push({ title: 'Plans in flight', rows });
  }

  // ── Approval backbone (real: GovernanceConfig + plan approval references) ───
  const chains = input?.governance?.approvalChains;
  const chainTotal = len(chains);
  const enabledChains = (chains ?? []).filter((c) => c?.enabled === true).length;
  const govPopulated = chainTotal > 0;

  if (govPopulated) {
    stats.push({
      icon: 'shield',
      label: 'Approval chains',
      value: `${count(enabledChains)}/${count(chainTotal)}`,
      tone: healthTone(enabledChains / chainTotal),
      hint: 'enabled',
    });
  }

  // Group 2 — 'Approval plans' (chains + how the two planners map onto them).
  {
    const rows: OpRow[] = [];
    if (govPopulated) {
      rows.push({
        label: 'Approval chains',
        value: `${count(enabledChains)}/${count(chainTotal)}`,
        tone: healthTone(enabledChains / chainTotal),
        sub: 'enabled',
      });
    }
    if (planningPopulated && stepTotal > 0) {
      rows.push({
        label: 'Steps under governed approval',
        value: `${count(governedSteps)}/${count(stepTotal)}`,
        tone: healthTone(governedSteps / stepTotal),
      });
    }
    if (autoOpsPopulated) {
      rows.push({
        label: 'Plans awaiting approval',
        value: count(awaiting),
        tone: awaiting > 0 ? 'orange' : undefined,
        sub:
          autoOps?.autoExecutableCount !== undefined
            ? `${count(autoOps.autoExecutableCount)} policy auto-exec`
            : undefined,
      });
    }
    if (rows.length > 0) groups.push({ title: 'Approval plans', rows });
  }

  // ── Execution records (real: ExecutionStats / ExecutionSession[]) ──────────
  const execution = input?.execution;
  const execStats = execution?.stats;
  const sessions = execution?.sessions ?? [];
  const successRate = execStats?.successRate ?? null;
  const execPopulated = !!execution && (!!execStats || sessions.length > 0);

  if (execPopulated) {
    stats.push({
      icon: 'gauge',
      label: 'Execution success',
      value: pctText(successRate),
      tone: healthTone(successRate ?? Number.NaN),
      hint: `${count(sessions.length)} sessions`,
    });

    const rows: OpRow[] = [];
    if (execStats) {
      rows.push({ label: 'Active', value: count(execStats.active) });
      rows.push({ label: 'Completed', value: count(execStats.completed) });
      rows.push({
        label: 'Failed',
        value: count(execStats.failed),
        tone: (execStats.failed ?? 0) > 0 ? 'red' : undefined,
      });
      rows.push({
        label: 'Success rate',
        value: pctText(successRate),
        tone: healthTone(successRate ?? Number.NaN),
      });
    } else {
      rows.push({ label: 'Recorded sessions', value: count(sessions.length) });
    }
    groups.push({
      title: 'Execution',
      rows,
      note: sessions.length > 0 ? `${count(sessions.length)} recorded sessions` : undefined,
    });
  }

  return { stats, groups, gaps: GAPS, links: LINKS };
}
