/**
 * CRM → Leads — Lead domain types + pure deterministic business logic.
 *
 * A Lead is a typed *projection* of the framework's flat `EnterpriseEntity` —
 * the Enterprise Module Framework owns persistence, CRUD, RBAC, audit, timeline,
 * and UI. This file adds the lead-specific typing and the DETERMINISTIC business
 * rules (`calculateLeadScore`, `estimateConversionProbability`, `assessLeadHealth`,
 * `identifyStaleLeads`) that the AI explains but never replaces, plus the
 * aggregate insights the Executive Center surfaces. Pure (no I/O).
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';
import type { ExecutiveKpi } from './executiveCenter';

/** The pipeline stage of a lead. */
export type LeadStage =
  'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'archived';

export const LEAD_STAGES: readonly LeadStage[] = [
  'new',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'archived',
];

/** Open (in-pipeline) stages — not yet won/lost/archived. */
export const OPEN_LEAD_STAGES: readonly LeadStage[] = [
  'new',
  'qualified',
  'proposal',
  'negotiation',
];

export type LeadPriority = 'low' | 'medium' | 'high';

/** The Leads module id + record kind (the framework store key). */
export const LEADS_MODULE_ID = 'crm-leads';
export const LEAD_KIND = 'lead';

/** A typed view over a lead record's flat fields (+ envelope timestamps). */
export interface CrmLead {
  id: string;
  name: string;
  company: string;
  contactPerson: string;
  email: string;
  stage: LeadStage;
  priority: LeadPriority;
  source: string;
  campaign: string;
  dealValue: number;
  expectedCloseDate: string | null;
  assignedTo: string;
  leadScore: number;
  createdAt: string;
  updatedAt: string;
}

const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
};

export function leadStageLabel(stage: LeadStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function isOpenLead(stage: LeadStage): boolean {
  return (OPEN_LEAD_STAGES as readonly string[]).includes(stage);
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asStage(v: unknown): LeadStage {
  const s = str(v);
  return (LEAD_STAGES as readonly string[]).includes(s) ? (s as LeadStage) : 'new';
}
function asPriority(v: unknown): LeadPriority {
  const s = str(v);
  return s === 'low' || s === 'high' ? s : 'medium';
}

/** Project a framework record into a typed lead. */
export function leadFromRecord(record: EnterpriseEntity): CrmLead {
  const f = record.fields;
  return {
    id: record.id,
    name: str(f.name) || record.title,
    company: str(f.company),
    contactPerson: str(f.contactPerson),
    email: str(f.email),
    stage: asStage(f.stage),
    priority: asPriority(f.priority),
    source: str(f.source),
    campaign: str(f.campaign),
    dealValue: num(f.dealValue),
    expectedCloseDate: str(f.expectedCloseDate) || null,
    assignedTo: str(f.assignedTo),
    leadScore: num(f.leadScore),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── deterministic business logic (AI explains these; it never sets them) ──── */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The subset needed to score a lead (works from raw field values too). */
export interface LeadScoreInput {
  stage: LeadStage;
  dealValue: number;
  priority: LeadPriority;
  source: string;
}

const STAGE_SCORE: Record<LeadStage, number> = {
  new: 10,
  qualified: 45,
  proposal: 65,
  negotiation: 85,
  won: 100,
  lost: 0,
  archived: 0,
};
const PRIORITY_SCORE: Record<LeadPriority, number> = { low: 30, medium: 60, high: 100 };
const SOURCE_SCORE: Record<string, number> = {
  referral: 100,
  partner: 100,
  event: 70,
  website: 60,
  outreach: 50,
  other: 40,
};

function valueScore(dealValue: number): number {
  if (dealValue <= 0) return 0;
  if (dealValue < 1_000) return 20;
  if (dealValue < 10_000) return 40;
  if (dealValue < 50_000) return 60;
  if (dealValue < 250_000) return 80;
  return 100;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Deterministic lead score, 0..100. Terminal stages are pinned (won=100,
 * lost/archived=0); open leads blend stage, deal value, priority, and source.
 */
export function calculateLeadScore(lead: LeadScoreInput): number {
  if (lead.stage === 'won') return 100;
  if (lead.stage === 'lost' || lead.stage === 'archived') return 0;
  const score =
    0.5 * STAGE_SCORE[lead.stage] +
    0.2 * valueScore(lead.dealValue) +
    0.2 * PRIORITY_SCORE[lead.priority] +
    0.1 * (SOURCE_SCORE[lead.source] ?? 40);
  return clamp(Math.round(score), 0, 100);
}

const STAGE_BASE_PROB: Record<LeadStage, number> = {
  new: 0.1,
  qualified: 0.3,
  proposal: 0.5,
  negotiation: 0.7,
  won: 1,
  lost: 0,
  archived: 0,
};

/** Deterministic conversion probability, 0..1. Blends stage base with the score, penalizing stale open leads. */
export function estimateConversionProbability(lead: CrmLead, nowMs: number): number {
  if (lead.stage === 'won') return 1;
  if (lead.stage === 'lost' || lead.stage === 'archived') return 0;
  const score = calculateLeadScore(lead);
  let prob = STAGE_BASE_PROB[lead.stage] * 0.6 + (score / 100) * 0.4;
  const updatedMs = Date.parse(lead.updatedAt);
  if (Number.isFinite(updatedMs)) {
    const staleDays = Math.max(0, Math.round((nowMs - updatedMs) / DAY_MS));
    if (staleDays > 21) prob *= 0.7;
  }
  return clamp(Math.round(prob * 100) / 100, 0, 1);
}

export interface LeadHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic pipeline health / follow-up risk for a lead. */
export function assessLeadHealth(lead: CrmLead, nowMs: number): LeadHealth {
  if (lead.stage === 'won') return { level: 'low', reason: 'Won.' };
  if (lead.stage === 'lost') return { level: 'low', reason: 'Lost.' };
  if (lead.stage === 'archived') return { level: 'low', reason: 'Archived.' };

  const updatedMs = Date.parse(lead.updatedAt);
  const staleDays = Number.isFinite(updatedMs)
    ? Math.max(0, Math.round((nowMs - updatedMs) / DAY_MS))
    : 0;
  const dueMs = lead.expectedCloseDate ? Date.parse(lead.expectedCloseDate) : NaN;
  if (Number.isFinite(dueMs) && dueMs < nowMs) {
    return { level: 'high', reason: 'Past its expected close date and still open.' };
  }
  if (staleDays > 21) {
    return { level: 'high', reason: `No activity in ${staleDays} days on an open lead.` };
  }
  if (staleDays > 7) {
    return { level: 'medium', reason: `Cooling — ${staleDays} days since last activity.` };
  }
  return { level: 'low', reason: 'Active and progressing.' };
}

/** Open leads that have gone quiet (no activity in > 21 days). */
export function identifyStaleLeads(leads: CrmLead[], nowMs: number): CrmLead[] {
  return leads.filter((l) => isOpenLead(l.stage) && assessLeadHealth(l, nowMs).level === 'high');
}

/** The next best action for a lead, given its stage + health. Deterministic. */
export function nextBestAction(lead: CrmLead, health: LeadHealth): string {
  if (lead.stage === 'won') return 'Hand off to onboarding.';
  if (lead.stage === 'lost' || lead.stage === 'archived') return 'No action — closed.';
  if (health.level === 'high') return 'Re-engage immediately to keep it alive.';
  switch (lead.stage) {
    case 'new':
      return 'Qualify the lead.';
    case 'qualified':
      return 'Send a proposal.';
    case 'proposal':
      return 'Follow up on the proposal.';
    case 'negotiation':
      return 'Push to close.';
    default:
      return 'Follow up.';
  }
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Deterministic summary + score explanation + next action — the no-model fallback. */
export function leadSummaryFallback(
  lead: CrmLead,
  score: number,
  probability: number,
  health: LeadHealth,
): { summary: string; executiveExplanation: string } {
  const where = lead.company ? ` at ${lead.company}` : '';
  const pct = Math.round(probability * 100);
  const summary =
    `${lead.name}${where} is a ${leadStageLabel(lead.stage).toLowerCase()} lead worth ${formatMoney(lead.dealValue)}. ` +
    `Score ${score}/100, ~${pct}% to convert. ${health.reason} Next: ${nextBestAction(lead, health).toLowerCase()}`;
  const executiveExplanation = isOpenLead(lead.stage)
    ? `${formatMoney(lead.dealValue)} in open pipeline at ${pct}% probability; risk is ${health.level}.`
    : `Closed as ${leadStageLabel(lead.stage).toLowerCase()} — no open pipeline value.`;
  return { summary, executiveExplanation };
}

/* ── aggregate insights (Executive Center) ─────────────────────────────────── */

export interface LeadModuleInsights {
  totalLeads: number;
  qualifiedLeads: number;
  conversionRate: number;
  pipelineValue: number;
  highRiskLeads: number;
  averageLeadScore: number;
}

/** Roll a set of active leads into the CRM pipeline KPIs. Pure. */
export function deriveLeadInsights(leads: CrmLead[], nowMs: number): LeadModuleInsights {
  let qualified = 0;
  let won = 0;
  let lost = 0;
  let pipelineValue = 0;
  let highRisk = 0;
  let openScoreSum = 0;
  let openCount = 0;
  for (const l of leads) {
    if (l.stage === 'qualified' || l.stage === 'proposal' || l.stage === 'negotiation')
      qualified += 1;
    if (l.stage === 'won') won += 1;
    if (l.stage === 'lost') lost += 1;
    if (isOpenLead(l.stage)) {
      pipelineValue += l.dealValue;
      openScoreSum += calculateLeadScore(l);
      openCount += 1;
    }
    if (assessLeadHealth(l, nowMs).level === 'high') highRisk += 1;
  }
  const closed = won + lost;
  return {
    totalLeads: leads.length,
    qualifiedLeads: qualified,
    conversionRate: closed === 0 ? 0 : Math.round((won / closed) * 100),
    pipelineValue,
    highRiskLeads: highRisk,
    averageLeadScore: openCount === 0 ? 0 : Math.round(openScoreSum / openCount),
  };
}

/** Map lead insights to Executive Center KPI tiles (reuses the existing KPI type). */
export function leadInsightsToKpis(insights: LeadModuleInsights): ExecutiveKpi[] {
  const riskBand: ExecutiveKpi['band'] =
    insights.highRiskLeads === 0 ? 'healthy' : insights.highRiskLeads <= 3 ? 'watch' : 'at-risk';
  const scoreBand: ExecutiveKpi['band'] =
    insights.averageLeadScore >= 60
      ? 'healthy'
      : insights.averageLeadScore >= 35
        ? 'watch'
        : 'at-risk';
  const convBand: ExecutiveKpi['band'] =
    insights.conversionRate >= 40 ? 'healthy' : insights.conversionRate >= 20 ? 'watch' : 'at-risk';
  return [
    {
      key: 'lead-total',
      label: 'Total Leads',
      value: null,
      display: String(insights.totalLeads),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'lead-qualified',
      label: 'Qualified Leads',
      value: null,
      display: String(insights.qualifiedLeads),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'lead-conversion',
      label: 'Conversion Rate',
      value: insights.conversionRate,
      display: `${insights.conversionRate}%`,
      band: convBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'lead-pipeline',
      label: 'Pipeline Value',
      value: null,
      display: formatMoney(insights.pipelineValue),
      deepLink: 'enterprise/modules',
    },
    {
      key: 'lead-high-risk',
      label: 'High-Risk Leads',
      value: null,
      display: `${insights.highRiskLeads} at risk`,
      band: riskBand,
      deepLink: 'enterprise/modules',
    },
    {
      key: 'lead-avg-score',
      label: 'Avg Lead Score',
      value: insights.averageLeadScore,
      display: `${insights.averageLeadScore}/100`,
      band: scoreBand,
      deepLink: 'enterprise/modules',
    },
  ];
}
