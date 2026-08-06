/**
 * CRM → Opportunities — qualified-deal domain types + pure deterministic logic.
 *
 * An Opportunity is the qualified deal being worked between a Lead and a Quote:
 * a typed *projection* of the framework's flat `EnterpriseEntity` — the
 * Enterprise Module Framework owns persistence, CRUD, RBAC, audit, timeline,
 * and UI. This file adds the opportunity-specific typing and the DETERMINISTIC
 * pipeline rules: the stage machine, the stage-baselined probability clamp, the
 * exact weighted value, and the health/next-action logic mirrored from Leads.
 *
 * KERNEL PARITY: the stage set mirrors the ErpCore business kernel's
 * `OPPORTUNITY_STAGES` (packages/business/src/constants.ts) VERBATIM —
 * `prospecting → qualification → proposal → negotiation → closed-won/closed-lost`.
 * The kernel is never imported (wave-package isolation, the same rule the W1
 * General Ledger followed for the accounting kernel); parity is locked by test.
 *
 * Opportunities are PRE-REVENUE: they never touch the General Ledger. Revenue
 * enters the books only through the existing Quote → Order → Invoice → Payment
 * chain (W1). Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The pipeline stage of an opportunity (kernel-parity values — see header). */
export type OpportunityStage =
  | 'prospecting'
  | 'qualification'
  | 'proposal'
  | 'negotiation'
  | 'closed-won'
  | 'closed-lost';

export const OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
  'closed-won',
  'closed-lost',
];

/** Open (in-pipeline) stages — not yet closed won/lost. */
export const OPEN_OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
];

/** The Opportunities module id + record kind (the framework store key). */
export const OPPORTUNITIES_MODULE_ID = 'crm-opportunities';
export const OPPORTUNITY_KIND = 'opportunity';

/**
 * The deterministic stage-baseline probability (%, integers). `Advance Stage`
 * re-baselines to these; manual edits may override within 0..100 while open;
 * the closed stages are pinned and cannot be overridden.
 */
export const OPPORTUNITY_STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  'closed-won': 100,
  'closed-lost': 0,
};

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  'closed-won': 'Closed Won',
  'closed-lost': 'Closed Lost',
};

export function opportunityStageLabel(stage: OpportunityStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function isOpenOpportunityStage(stage: OpportunityStage): boolean {
  return (OPEN_OPPORTUNITY_STAGES as readonly string[]).includes(stage);
}

/**
 * The stage machine: the next open stage, or `null` from negotiation — the last
 * open stage only exits through Mark Won / Mark Lost (never by advancing).
 */
export function nextOpportunityStage(stage: OpportunityStage): OpportunityStage | null {
  const idx = OPEN_OPPORTUNITY_STAGES.indexOf(stage);
  if (idx === -1) return null; // closed (or unknown) — nothing to advance
  return idx + 1 < OPEN_OPPORTUNITY_STAGES.length ? OPEN_OPPORTUNITY_STAGES[idx + 1] : null;
}

/** A typed view over an opportunity record's flat fields (+ envelope timestamps). */
export interface CrmOpportunity {
  id: string;
  name: string;
  account: string;
  sourceLeadRef: string;
  quoteRef: string;
  stage: OpportunityStage;
  amount: number;
  probability: number;
  weightedValue: number;
  expectedCloseDate: string | null;
  assignedTo: string;
  closedAt: string | null;
  outcome: 'won' | 'lost' | null;
  lostReason: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStage(v: unknown): OpportunityStage {
  const s = str(v);
  return (OPPORTUNITY_STAGES as readonly string[]).includes(s) ? (s as OpportunityStage) : 'prospecting';
}

/** Project a framework record into a typed opportunity. */
export function opportunityFromRecord(record: EnterpriseEntity): CrmOpportunity {
  const f = record.fields;
  const outcome = str(f.outcome);
  return {
    id: record.id,
    name: str(f.name) || record.title,
    account: str(f.account),
    sourceLeadRef: str(f.sourceLeadRef),
    quoteRef: str(f.quoteRef),
    stage: asStage(f.stage),
    amount: num(f.amount),
    probability: num(f.probability),
    weightedValue: num(f.weightedValue),
    expectedCloseDate: str(f.expectedCloseDate) || null,
    assignedTo: str(f.assignedTo),
    closedAt: str(f.closedAt) || null,
    outcome: outcome === 'won' || outcome === 'lost' ? outcome : null,
    lostReason: str(f.lostReason),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Deterministic probability, 0..100 integer. Closed stages are PINNED
 * (won=100, lost=0). Open stages take the user's judgment clamped to 0..100;
 * a missing/invalid value falls back to the stage baseline.
 */
export function clampOpportunityProbability(stage: OpportunityStage, raw: unknown): number {
  if (stage === 'closed-won') return 100;
  if (stage === 'closed-lost') return 0;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;
  if (Number.isNaN(n)) return OPPORTUNITY_STAGE_PROBABILITY[stage];
  return clamp(Math.round(n), 0, 100);
}

/** Exact weighted (expected) value: amount × probability%, rounded to cents. */
export function opportunityWeightedValue(amount: number, probability: number): number {
  return Math.round(amount * probability) / 100;
}

export interface OpportunityHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic deal health — the Leads thresholds (7/21 days), same semantics. */
export function assessOpportunityHealth(opp: CrmOpportunity, nowMs: number): OpportunityHealth {
  if (opp.stage === 'closed-won') return { level: 'low', reason: 'Closed won.' };
  if (opp.stage === 'closed-lost') return { level: 'low', reason: 'Closed lost.' };

  const dueMs = opp.expectedCloseDate ? Date.parse(opp.expectedCloseDate) : NaN;
  if (Number.isFinite(dueMs) && dueMs < nowMs) {
    return { level: 'high', reason: 'Past its expected close date and still open.' };
  }
  const updatedMs = Date.parse(opp.updatedAt);
  const staleDays = Number.isFinite(updatedMs)
    ? Math.max(0, Math.round((nowMs - updatedMs) / DAY_MS))
    : 0;
  if (staleDays > 21) {
    return { level: 'high', reason: `No activity in ${staleDays} days on an open deal.` };
  }
  if (staleDays > 7) {
    return { level: 'medium', reason: `Cooling — ${staleDays} days since last activity.` };
  }
  return { level: 'low', reason: 'Active and progressing.' };
}

/** The next best action for an opportunity, given its stage + health. Deterministic. */
export function opportunityNextAction(opp: CrmOpportunity, health: OpportunityHealth): string {
  if (opp.stage === 'closed-won') return 'Hand off to delivery and invoicing.';
  if (opp.stage === 'closed-lost') return 'No action — closed.';
  if (health.level === 'high') return 'Re-engage immediately to keep the deal alive.';
  switch (opp.stage) {
    case 'prospecting':
      return 'Qualify the deal — confirm budget, authority, need, and timeline.';
    case 'qualification':
      return 'Develop and send the proposal.';
    case 'proposal':
      return 'Follow up on the proposal.';
    case 'negotiation':
      return 'Push to close — Mark Won or Mark Lost.';
    default:
      return 'Follow up.';
  }
}

function formatMoney(value: number): string {
  // Locale pinned: unpinned formatting is machine-dependent (en-IN lakh grouping
  // renders 120000 as "1,20,000"), which breaks deterministic summaries + tests.
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Deterministic summary + weighted-pipeline explanation — the no-model fallback. */
export function opportunitySummaryFallback(
  opp: CrmOpportunity,
  health: OpportunityHealth,
): { summary: string; executiveExplanation: string } {
  const where = opp.account ? ` (${opp.account})` : '';
  const summary =
    `${opp.name}${where} is a ${opportunityStageLabel(opp.stage).toLowerCase()} opportunity worth ` +
    `${formatMoney(opp.amount)} at ${opp.probability}% — ${formatMoney(opp.weightedValue)} weighted. ` +
    `${health.reason} Next: ${opportunityNextAction(opp, health).toLowerCase()}`;
  const executiveExplanation =
    opp.stage === 'closed-won'
      ? `Won — ${formatMoney(opp.amount)} moving to the quote → order → invoice chain.`
      : opp.stage === 'closed-lost'
        ? 'Lost — no pipeline value retained.'
        : `${formatMoney(opp.weightedValue)} weighted pipeline (${formatMoney(opp.amount)} at ${opp.probability}%); risk is ${health.level}.`;
  return { summary, executiveExplanation };
}
