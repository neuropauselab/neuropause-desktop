/**
 * Experience Program v1.0 — the pure decision-first projection model (the AI Summary Engine).
 *
 * All non-trivial compression logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It takes a composed snapshot of the ENTIRE platform (P1–P20) and distills it into the
 * primitives an executive decides on: Business Health, Today's Mission, Revenue, One Decision, One Risk,
 * One Approval, an AI Workforce summary, a Decision Queue (only what needs a human), per-module one-line
 * summaries, a three-level progressive-disclosure map, and an intent catalog. It introduces NO new runtime,
 * engine, or store. THE CORE UX LAW is enforced structurally here: the interface receives ONE sentence and
 * a compression count before any detail — never the raw firehose.
 */
import type {
  ApprovalSummary,
  DecisionQueueItem,
  DecisionSummary,
  DisclosureLevel,
  ExperienceBand,
  ExperienceDecisions,
  ExperienceGovernance,
  ExperienceHome,
  ExperienceIntents,
  ExperienceKpiLite,
  ExperienceRole,
  ExperienceSummaries,
  IntentItem,
  ModuleSummary,
  ExperienceRiskSummary,
  RoleView,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the composition root) ── */

export interface DecisionInput {
  id: string;
  kind: DecisionQueueItem['kind'];
  title: string;
  why: string;
  band: ExperienceBand;
  urgency: number;
  source: string;
  requiredApprovals: number;
  evidenceCount: number;
}

export interface ModuleSummaryInput {
  key: string;
  label: string;
  headline: string;
  band: ExperienceBand;
  compressedFrom: number;
  detail: string;
  expandTo: string;
}

export interface ExperienceState {
  greeting: string;
  generatedAt: string;
  health: { score: number; band: ExperienceBand };
  mission: { title: string; detail: string; why: string };
  revenue: { display: string; label: string; band: ExperienceBand; detail: string };
  workforce: { successPct: number; activeWorkers: number; needApproval: number };
  oneDecision: DecisionSummary | null;
  oneRisk: ExperienceRiskSummary | null;
  oneApproval: ApprovalSummary | null;
  /** Labelled KPI pool the role views draw from (key → lite KPI). */
  kpiPool: Record<string, ExperienceKpiLite>;
  /** Raw actionable decisions/approvals/risks before compression to the queue. */
  decisions: DecisionInput[];
  rawDecisionSignals: number;
  moduleSummaries: ModuleSummaryInput[];
  /** Total raw signals compressed into the whole experience. */
  compressedSignals: number;
}

/* ── helpers ── */

const clampPct = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 100 ? 100 : n);

/** Score (0..100) → band; the universal ≥75/≥50/≥25 cutoff shared across the platform. */
export function bandFor(score: number): ExperienceBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}

/**
 * Workforce band. An idle platform (no jobs run) is NOT a failure — 0% of nothing must not read as critical
 * (a false-red alarm). Only band by success rate once there is real activity.
 */
export function workforceBand(totalJobs: number, successPct: number): ExperienceBand {
  return totalJobs > 0 ? bandFor(successPct) : 'watch';
}

/**
 * Value band for a target-less "monthly value / revenue" figure — positive value reads healthy, zero-or-less
 * reads watch. Never hard-green a $0 or declining figure (the "healthy masking at-risk" the UX law forbids).
 */
export function valueBand(value: number): ExperienceBand {
  return value > 0 ? 'healthy' : 'watch';
}

/* ── Testable compression primitives (the CORE UX LAW made concrete) ── */

/** "127 alerts" → "Three issues need your attention today." — the canonical compression. */
export function attentionHeadline(count: number, noun: string): string {
  if (count <= 0) return `All clear — no ${noun} need your attention.`;
  const word = count === 1 ? `${noun.replace(/s$/, '')}` : noun;
  return `${count} ${word} need${count === 1 ? 's' : ''} your attention today.`;
}

/** Business health → one sentence. */
export function healthHeadline(score: number, band: ExperienceBand): string {
  const s = Math.round(clampPct(score));
  return band === 'healthy'
    ? `Business health is strong at ${s}/100.`
    : band === 'watch'
      ? `Business health is steady at ${s}/100 — a few areas to watch.`
      : band === 'at-risk'
        ? `Business health needs attention at ${s}/100.`
        : `Business health is critical at ${s}/100 — act today.`;
}

/** AI workforce → "completed 97% of today's objectives. Three decisions need approval." */
export function workforceHeadline(successPct: number, needApproval: number): string {
  const p = Math.round(clampPct(successPct));
  const tail = needApproval <= 0 ? 'Nothing needs approval.' : `${needApproval} decision${needApproval === 1 ? '' : 's'} need${needApproval === 1 ? 's' : ''} approval.`;
  return `Your AI workforce completed ${p}% of today's objectives. ${tail}`;
}

/* ── Role-adaptive KPI selection ── */

const ROLE_LABEL: Record<ExperienceRole, string> = {
  founder: 'Founder', ceo: 'CEO', cto: 'CTO', cfo: 'CFO', coo: 'COO', sales: 'Sales', marketing: 'Marketing', hr: 'HR',
};
const ROLE_FOCUS: Record<ExperienceRole, string> = {
  founder: 'Revenue, growth, strategy, and the decisions only you can make.',
  ceo: 'Business health, KPIs, customers, and risk.',
  cto: 'Infrastructure, deployments, reliability, and security.',
  cfo: 'Cash, forecast, budget, and compliance.',
  coo: 'Operations, capacity, execution, and supply chain.',
  sales: 'Pipeline, forecast, and customers.',
  marketing: 'Campaigns, ROI, and growth.',
  hr: 'Hiring, performance, and people.',
};
const ROLE_KPIS: Record<ExperienceRole, string[]> = {
  founder: ['revenue', 'health', 'approvals'],
  ceo: ['health', 'revenue', 'risk'],
  cto: ['reliability', 'security', 'workforce'],
  cfo: ['revenue', 'cloud', 'compliance'],
  coo: ['reliability', 'workforce', 'adoption'],
  sales: ['revenue', 'adoption', 'health'],
  marketing: ['adoption', 'revenue', 'health'],
  hr: ['workforce', 'approvals', 'adoption'],
};
const ALL_ROLES: ExperienceRole[] = ['founder', 'ceo', 'cto', 'cfo', 'coo', 'sales', 'marketing', 'hr'];

export function buildRoleViews(pool: Record<string, ExperienceKpiLite>): RoleView[] {
  return ALL_ROLES.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    focus: ROLE_FOCUS[role],
    kpis: ROLE_KPIS[role].map((k) => pool[k]).filter((k): k is ExperienceKpiLite => Boolean(k)),
  }));
}

/* ── Home / Decision Center ── */

export function buildExperienceHome(s: ExperienceState): ExperienceHome {
  return {
    greeting: s.greeting,
    generatedAt: s.generatedAt,
    businessHealth: { score: Math.round(clampPct(s.health.score)), band: s.health.band, headline: healthHeadline(s.health.score, s.health.band) },
    todaysMission: { title: s.mission.title, detail: s.mission.detail, why: s.mission.why },
    revenue: { display: s.revenue.display, label: s.revenue.label, band: s.revenue.band, detail: s.revenue.detail },
    aiWorkforce: {
      headline: workforceHeadline(s.workforce.successPct, s.workforce.needApproval),
      successPct: Math.round(clampPct(s.workforce.successPct)),
      activeWorkers: s.workforce.activeWorkers,
      needApproval: s.workforce.needApproval,
    },
    oneDecision: s.oneDecision,
    oneRisk: s.oneRisk,
    oneApproval: s.oneApproval,
    roleViews: buildRoleViews(s.kpiPool),
    compressedSignals: s.compressedSignals,
    note: 'The Decision Center compresses the whole platform into one screen: business health, today\'s mission, revenue, and the single most important decision, risk, and approval. Everything else is progressively disclosed — the interface shows only what you need to decide right now.',
  };
}

/* ── Decision Queue (only what needs a human) ── */

export function buildExperienceDecisions(s: ExperienceState): ExperienceDecisions {
  const items: DecisionQueueItem[] = [...s.decisions]
    .sort((a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id))
    .map((d) => ({ id: d.id, kind: d.kind, title: d.title, why: d.why, band: d.band, urgency: Math.round(clampPct(d.urgency)), source: d.source, requiredApprovals: d.requiredApprovals, evidenceCount: d.evidenceCount }));
  return {
    items,
    total: items.length,
    needApproval: items.filter((d) => d.requiredApprovals > 0 || d.kind === 'approval').length,
    compressedFrom: s.rawDecisionSignals,
    note: 'The Decision Queue replaces the notification center — only actionable decisions that need a human appear, ranked by urgency. Everything non-actionable is summarized, not surfaced. No notification fatigue.',
  };
}

/* ── AI Summary Engine: per-module one-liners + progressive disclosure ── */

const RANK: Record<ExperienceBand, number> = { critical: 0, 'at-risk': 1, watch: 2, healthy: 3 };

export const DISCLOSURE_LEVELS: DisclosureLevel[] = [
  { id: 'executive', name: 'Executive', timeToValue: '5 seconds', audience: 'Founders & executives', shows: ['Business health', "Today's mission", 'Revenue', 'One decision', 'One risk', 'Approvals'] },
  { id: 'management', name: 'Management', timeToValue: '60 seconds', audience: 'Managers & leads', shows: ['Departments', 'Sales', 'Marketing', 'Finance', 'Operations', 'Projects', 'AI Workforce'] },
  { id: 'specialist', name: 'Specialist', timeToValue: 'Full detail', audience: 'Specialists & operators', shows: ['Workers', 'Logs', 'Connectors', 'Cloud', 'Timeline', 'Diagnostics', 'Execution', 'Audit'] },
];

export function buildExperienceSummaries(s: ExperienceState): ExperienceSummaries {
  const modules: ModuleSummary[] = [...s.moduleSummaries]
    .map((m) => ({ key: m.key, label: m.label, headline: m.headline, band: m.band, compressedFrom: m.compressedFrom, detail: m.detail, expandTo: m.expandTo }))
    .sort((a, b) => RANK[a.band] - RANK[b.band] || b.compressedFrom - a.compressedFrom || a.label.localeCompare(b.label));
  return {
    modules,
    disclosure: DISCLOSURE_LEVELS,
    totalCompressed: modules.reduce((n, m) => n + m.compressedFrom, 0),
    note: 'Every module produces one executive sentence before any detail. Instead of 1,842 workers or 38 cloud metrics, you see one line and a compression count — expand only the module you need. AI compresses; you decide.',
  };
}

/* ── Intent-first catalog (replaces traditional search + navigation) ── */

export const INTENTS: IntentItem[] = [
  { id: 'increase-revenue', label: 'Increase revenue', prompt: 'I want to grow revenue', targetSection: 'strategy-center', targetLabel: 'Strategy Center', category: 'Growth', keywords: ['revenue', 'grow', 'sales', 'money', 'income', 'more sales', 'growth'], available: true },
  { id: 'reduce-cloud-cost', label: 'Reduce cloud cost', prompt: 'I want to reduce cloud spend', targetSection: 'commercial-center', targetLabel: 'Usage & Metering', category: 'Efficiency', keywords: ['cost', 'cloud', 'spend', 'reduce', 'save', 'cheaper', 'budget', 'optimize cost'], available: true },
  { id: 'reduce-risk', label: 'Reduce risk', prompt: 'I want to reduce risk', targetSection: 'auto-ops-center', targetLabel: 'Operations', category: 'Risk', keywords: ['risk', 'reduce risk', 'safer', 'mitigate', 'exposure'], available: true },
  { id: 'hire', label: 'Hire employees', prompt: 'I want to hire', targetSection: 'organization', targetLabel: 'Organization', category: 'People', keywords: ['hire', 'hiring', 'recruit', 'employees', 'people', 'staff', 'team'], available: true },
  { id: 'analyze-documents', label: 'Analyze documents', prompt: 'I want to analyze documents', targetSection: 'knowledge-center', targetLabel: 'Knowledge Fabric', category: 'Knowledge', keywords: ['analyze', 'documents', 'knowledge', 'search', 'understand', 'insight'], available: true },
  { id: 'acquire-customers', label: 'Acquire customers', prompt: 'I want more customers', targetSection: 'enterprise', targetLabel: 'Enterprise', category: 'Growth', keywords: ['customers', 'acquire', 'leads', 'pipeline', 'sales', 'crm'], available: true },
  { id: 'optimize-manufacturing', label: 'Optimize manufacturing', prompt: 'I want to optimize manufacturing', targetSection: 'industry-center', targetLabel: 'Industry Center', category: 'Operations', keywords: ['manufacturing', 'optimize', 'production', 'factory', 'supply chain', 'operations'], available: true },
  { id: 'improve-reliability', label: 'Improve reliability', prompt: 'I want to improve reliability', targetSection: 'auto-ops-center', targetLabel: 'Operations', category: 'Operations', keywords: ['reliability', 'uptime', 'incidents', 'recovery', 'stable', 'sla'], available: true },
  { id: 'build-erp', label: 'Build an ERP', prompt: 'I want to build an ERP', targetSection: 'enterprise', targetLabel: 'Enterprise', category: 'Build', keywords: ['erp', 'build', 'system', 'enterprise', 'modules', 'finance', 'inventory'], available: true },
  { id: 'launch-product', label: 'Launch a product', prompt: 'I want to launch a product', targetSection: 'strategy-center', targetLabel: 'Strategy Center', category: 'Build', keywords: ['launch', 'product', 'ship', 'release', 'go to market', 'gtm'], available: false },
];

export function buildExperienceIntents(): ExperienceIntents {
  return {
    intents: INTENTS,
    note: 'Intent replaces search. State an outcome — "I want to reduce costs", "I want to hire" — and the platform routes you to the workflow that achieves it, instead of making you navigate. Intents map to the existing sections that already do the work.',
  };
}

/* ── Experience governance / posture ── */

export function buildExperienceGovernance(): ExperienceGovernance {
  return {
    experienceScope: 'experience:read',
    law: 'Never ask a human to process information the AI can process first. AI compresses; humans decide. The interface must never display everything NeuroPause knows — only what the human needs to decide right now.',
    reusedSystems: [
      { system: 'Business health / risk / KPIs (P7)', permission: 'intelligence:read' },
      { system: 'Decisions / mission (P14 Strategy)', permission: 'strategy:read' },
      { system: 'Operations / approvals (P19)', permission: 'autonomousops:read' },
      { system: 'Digital Twin summary (P15)', permission: 'twin:read' },
      { system: 'Knowledge Fabric summary (P16)', permission: 'knowledge:read' },
      { system: 'Revenue / adoption (P20)', permission: 'commercial:read' },
      { system: 'Workforce / connectors / marketplace', permission: 'workforce:read' },
    ].sort((a, b) => a.system.localeCompare(b.system)),
    principles: [
      'Maximum intelligence, minimum interface — the user manages intent, decisions, approvals, and strategy; everything else belongs to AI.',
      'One executive summary before any detail; one primary action per screen.',
      'Progressive disclosure — Executive (5s), Management (60s), Specialist (full detail).',
      'A Decision Queue, not a notification center — only actionable decisions appear.',
      'This layer reads and compresses; it never executes, approves, or mutates. It adds no runtime, engine, or store.',
    ],
    note: 'The Experience layer is a read-only compression over the existing platform. It exposes only summaries and decisions behind experience:read; every underlying source keeps its own production scope, and every action still flows through the existing engines under their own approvals.',
  };
}
