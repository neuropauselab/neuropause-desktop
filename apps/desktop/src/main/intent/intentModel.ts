/**
 * Intent Experience Program v2.0 — the pure intent-native projection model.
 *
 * All derivation lives here (the house pure-model pattern) so it is unit-tested under Node with no I/O. It
 * takes a composed snapshot of the REAL P14 strategic goals (+ their resolved plan steps and category-linked
 * decisions + the reasoning confidence) and reprojects them as intents: a multi-intent board, a Today's
 * Intent dashboard, per-intent dynamic workspaces, role lenses, and the one next best action. It introduces
 * NO runtime/engine/store and FABRICATES NOTHING — every output field is a real goal value or an honest
 * derivation over real values (band from status, urgency from status, blocked from a dependency's real
 * status). Fields with no real per-intent source (per-goal confidence, worker/connector rosters, a calendar
 * ETA) are OMITTED, never invented. Deterministic (no Date/random) and never-throws-on-empty.
 */
import type {
  IntentApproval,
  IntentBand,
  IntentBoard,
  IntentCounts,
  IntentDashboard,
  IntentDecisionLink,
  IntentDependency,
  IntentGovernance,
  IntentMilestone,
  IntentNextBestAction,
  IntentObjective,
  IntentRisk,
  IntentRole,
  IntentRoleView,
  IntentSummary,
  IntentWorkspace,
  IntentWorkspaces,
} from '@neuropause/shared';
import type { GoalCategory, StrategyHorizon, StrategyStatus } from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the composition root from real signals) ── */

export interface IntentObjectiveInput {
  id: string;
  label: string;
  metric: string;
  current: number;
  target: number;
  unit: string;
  /** 0..1 real attainment. */
  progress: number;
  status: StrategyStatus;
}

export interface IntentMilestoneInput {
  id: string;
  label: string;
  horizon: StrategyHorizon;
  status: StrategyStatus;
}

export interface IntentNextActionInput {
  label: string;
  action: string;
  approval: IntentApproval | null;
  evidence: string[];
}

/** A real StrategicGoal, lean-projected with its resolved plan step + category-linked decisions. */
export interface IntentGoalInput {
  id: string;
  category: GoalCategory;
  name: string;
  description: string;
  horizon: StrategyHorizon;
  successMetric: string;
  target: number;
  current: number;
  unit: string;
  /** 0..1 real attainment. */
  progress: number;
  status: StrategyStatus;
  objectives: IntentObjectiveInput[];
  /** ids of real goals this depends on. */
  dependencies: string[];
  milestones: IntentMilestoneInput[];
  evidence: string[];
  /** The real Planning-Engine plan step for a not-on-track goal, or null when on-track. */
  nextAction: IntentNextActionInput | null;
  /** Real strategic decisions that share this goal's category. */
  relatedDecisions: IntentDecisionLink[];
}

export interface IntentState {
  generatedAt: string;
  /** Real P14 Reasoning Engine confidence (0..1) — board-level, not per-intent. */
  reasoningConfidence: number;
  intents: IntentGoalInput[];
}

/* ── helpers ── */

export const HORIZON_LABEL: Record<StrategyHorizon, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '180d': '180 days',
  '365d': '365 days',
  multi_year: 'Multi-year',
};

const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);
const pct = (progress: number): number => Math.round(clamp01(progress) * 100);

/** Real goal status → display band. off-track is worst; on-track is healthy. Never false-reds an on-track goal. */
export function bandForStatus(status: StrategyStatus): IntentBand {
  return status === 'off_track' ? 'critical' : status === 'at_risk' ? 'at-risk' : 'healthy';
}

/** Human status label. */
export function statusLabel(status: StrategyStatus): string {
  return status === 'off_track' ? 'off track' : status === 'at_risk' ? 'at risk' : 'on track';
}

/** Status severity weight — the primary ranking key (progress breaks ties). Not a fabricated priority. */
export function intentUrgency(status: StrategyStatus): number {
  return status === 'off_track' ? 100 : status === 'at_risk' ? 60 : 20;
}

const STATUS_RANK: Record<StrategyStatus, number> = { off_track: 0, at_risk: 1, on_track: 2 };

/** Rank intents most-urgent-first: worst status first, then lowest progress, then id for determinism. */
function byUrgency(a: IntentGoalInput, b: IntentGoalInput): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.progress - b.progress || a.id.localeCompare(b.id);
}

/* ── Intent summary (one card in the multi-intent board) ── */

export function buildIntentSummary(g: IntentGoalInput, byId: Map<string, IntentGoalInput>): IntentSummary {
  const blockedBy = g.dependencies
    .map((id) => byId.get(id))
    .filter((d): d is IntentGoalInput => Boolean(d) && d!.status !== 'on_track')
    .map((d) => d.name);
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    category: g.category,
    successMetric: g.successMetric,
    progress: clamp01(g.progress),
    progressPct: pct(g.progress),
    status: g.status,
    band: bandForStatus(g.status),
    current: g.current,
    target: g.target,
    unit: g.unit,
    horizon: g.horizon,
    horizonLabel: HORIZON_LABEL[g.horizon] ?? g.horizon,
    dependencies: [...g.dependencies],
    blockedBy,
    blocked: blockedBy.length > 0,
    objectiveCount: g.objectives.length,
    milestoneCount: g.milestones.length,
    evidenceCount: g.evidence.length,
    nextAction: g.nextAction?.label ?? null,
    urgency: intentUrgency(g.status),
  };
}

export function buildIntentSummaries(s: IntentState): IntentSummary[] {
  const byId = new Map(s.intents.map((g) => [g.id, g]));
  return [...s.intents].sort(byUrgency).map((g) => buildIntentSummary(g, byId));
}

/* ── Next best action ── */

function toNextBestAction(g: IntentGoalInput): IntentNextBestAction | null {
  if (!g.nextAction) return null;
  return {
    intentId: g.id,
    label: g.nextAction.label,
    action: g.nextAction.action,
    approval: g.nextAction.approval,
    evidence: [...g.nextAction.evidence],
  };
}

/* ── Today's Intent dashboard (the Decision Center's evolution into an outcome view) ── */

export function buildIntentDashboard(g: IntentGoalInput, byId: Map<string, IntentGoalInput>): IntentDashboard {
  const intent = buildIntentSummary(g, byId);
  const risks: IntentRisk[] = [];
  if (g.status !== 'on_track') {
    risks.push({
      id: `risk:${g.id}`,
      label: `This outcome is ${statusLabel(g.status)}`,
      detail: `${g.successMetric} — currently ${g.current}${g.unit === '%' ? '%' : ` ${g.unit}`} of ${g.target}.`,
      band: bandForStatus(g.status),
    });
  }
  for (const depId of g.dependencies) {
    const dep = byId.get(depId);
    if (dep && dep.status !== 'on_track') {
      risks.push({
        id: `risk:dep:${dep.id}`,
        label: `Blocked by "${dep.name}"`,
        detail: `A dependency is ${statusLabel(dep.status)}.`,
        band: bandForStatus(dep.status),
      });
    }
  }
  return {
    intent,
    currentOutcome: g.successMetric,
    risks,
    approval: g.nextAction?.approval ?? null,
    recommendations: g.relatedDecisions,
    nextBestAction: toNextBestAction(g),
  };
}

/* ── Dynamic workspace (assembled ONLY from real per-intent facets) ── */

/** Panels withheld because the platform has no real per-intent source for them — authenticity, not laziness. */
export const OMITTED_WORKSPACE_PANELS: string[] = [
  'AI workers — no real per-intent worker assignment exists in the workforce runtime',
  'Connectors — no real per-intent connector binding exists in the connector layer',
  'Analytics — no real per-intent metric time-series exists',
];

export function buildIntentWorkspace(g: IntentGoalInput, byId: Map<string, IntentGoalInput>): IntentWorkspace {
  const objectives: IntentObjective[] = g.objectives.map((o) => ({
    id: o.id,
    label: o.label,
    metric: o.metric,
    current: o.current,
    target: o.target,
    unit: o.unit,
    progressPct: pct(o.progress),
    status: o.status,
    band: bandForStatus(o.status),
  }));
  const timeline: IntentMilestone[] = g.milestones.map((m) => ({
    id: m.id,
    label: m.label,
    horizon: m.horizon,
    horizonLabel: HORIZON_LABEL[m.horizon] ?? m.horizon,
    status: m.status,
    band: bandForStatus(m.status),
  }));
  const dependencies: IntentDependency[] = g.dependencies
    .map((id) => byId.get(id))
    .filter((d): d is IntentGoalInput => Boolean(d))
    .map((d) => ({ id: d.id, name: d.name, status: d.status, band: bandForStatus(d.status), blocking: d.status !== 'on_track' }));
  const nextBestAction = toNextBestAction(g);

  const panels: string[] = [];
  if (objectives.length) panels.push('Objectives');
  if (timeline.length) panels.push('Timeline');
  if (g.evidence.length) panels.push('Evidence');
  if (dependencies.length) panels.push('Dependencies');
  if (g.relatedDecisions.length) panels.push('Related decisions');
  if (nextBestAction) panels.push('Next best action');

  return {
    intentId: g.id,
    intent: buildIntentSummary(g, byId),
    objectives,
    timeline,
    evidence: [...g.evidence],
    dependencies,
    relatedDecisions: g.relatedDecisions,
    nextBestAction,
    panels,
    omitted: OMITTED_WORKSPACE_PANELS,
  };
}

export function buildIntentWorkspaces(s: IntentState): IntentWorkspaces {
  const byId = new Map(s.intents.map((g) => [g.id, g]));
  return {
    workspaces: [...s.intents].sort(byUrgency).map((g) => buildIntentWorkspace(g, byId)),
    note: 'Each workspace is assembled only from the intent\'s real facets — its objectives, timeline (milestones), evidence, dependencies, and the strategy decisions and plan step that link to it. Panels with no real per-intent source (worker/connector rosters, analytics) are withheld, never fabricated.',
  };
}

/* ── Role lenses (a role selects which real intents to emphasize; it never creates one) ── */

const ROLE_LABEL: Record<IntentRole, string> = {
  founder: 'Founder', ceo: 'CEO', cto: 'CTO', cfo: 'CFO', coo: 'COO',
  sales: 'Sales', marketing: 'Marketing', hr: 'HR', legal: 'Legal', operations: 'Operations',
};
const ROLE_FOCUS: Record<IntentRole, string> = {
  founder: 'Every outcome — the whole business, and the decisions only you can make.',
  ceo: 'Business health, growth, financial, and security outcomes.',
  cto: 'Infrastructure, security, and operational reliability outcomes.',
  cfo: 'Financial and compliance outcomes.',
  coo: 'Operational, workforce, and infrastructure outcomes.',
  sales: 'Growth and financial outcomes.',
  marketing: 'Growth outcomes.',
  hr: 'Workforce outcomes.',
  legal: 'Compliance outcomes.',
  operations: 'Operational, infrastructure, and workforce outcomes.',
};
/** The real goal categories each role emphasizes. Founder = all (empty set ⇒ everything). */
const ROLE_CATEGORIES: Record<IntentRole, GoalCategory[]> = {
  founder: [],
  ceo: ['operational', 'financial', 'growth', 'security'],
  cto: ['infrastructure', 'security', 'operational'],
  cfo: ['financial', 'compliance'],
  coo: ['operational', 'workforce', 'infrastructure'],
  sales: ['growth', 'financial'],
  marketing: ['growth'],
  hr: ['workforce'],
  legal: ['compliance'],
  operations: ['operational', 'infrastructure', 'workforce'],
};
export const INTENT_ROLES: IntentRole[] = ['founder', 'ceo', 'cto', 'cfo', 'coo', 'sales', 'marketing', 'hr', 'legal', 'operations'];

export function buildIntentRoleViews(summaries: IntentSummary[]): IntentRoleView[] {
  return INTENT_ROLES.map((role) => {
    const categories = ROLE_CATEGORIES[role];
    const intentIds = summaries
      .filter((s) => categories.length === 0 || categories.includes(s.category))
      .map((s) => s.id);
    return { role, label: ROLE_LABEL[role], focus: ROLE_FOCUS[role], categories: [...categories], intentIds };
  });
}

/* ── The board ── */

/** The single highest-priority next action across all intents (most urgent intent that has a real step). */
export function pickNextBestAction(s: IntentState): IntentNextBestAction | null {
  for (const g of [...s.intents].sort(byUrgency)) {
    const nba = toNextBestAction(g);
    if (nba) return nba;
  }
  return null;
}

export function buildIntentBoard(s: IntentState): IntentBoard {
  const byId = new Map(s.intents.map((g) => [g.id, g]));
  const summaries = buildIntentSummaries(s);
  const top = summaries[0] ? byId.get(summaries[0].id) ?? null : null;
  const counts: IntentCounts = {
    total: summaries.length,
    onTrack: summaries.filter((x) => x.status === 'on_track').length,
    atRisk: summaries.filter((x) => x.status === 'at_risk').length,
    offTrack: summaries.filter((x) => x.status === 'off_track').length,
    blocked: summaries.filter((x) => x.blocked).length,
  };
  const overallProgress = summaries.length
    ? clamp01(summaries.reduce((n, x) => n + x.progress, 0) / summaries.length)
    : 0;
  return {
    generatedAt: s.generatedAt,
    todaysIntent: top ? buildIntentDashboard(top, byId) : null,
    intents: summaries,
    counts,
    overallProgress,
    overallProgressPct: Math.round(overallProgress * 100),
    reasoningConfidence: clamp01(s.reasoningConfidence),
    roleViews: buildIntentRoleViews(summaries),
    nextBestAction: pickNextBestAction(s),
    note: 'NeuroPause organizes around your outcomes, not modules. Each intent is a real strategic goal measured from live production signals; Today\'s Intent is the single outcome that most needs you now, and every card answers "what next?".',
  };
}

/* ── Governance / authenticity ledger ── */

export function buildIntentGovernance(): IntentGovernance {
  return {
    intentScope: 'intent:read',
    law: 'The app organizes around the user\'s current outcome. It never asks "What module?" — it asks "What outcome are you trying to achieve?" — and every value it shows to answer that traces to a real production source.',
    reusedSystems: [
      { system: 'Strategic goals / objectives / milestones (P14)', permission: 'strategy:read' },
      { system: 'Planning-Engine plan steps + approvals (P14)', permission: 'strategy:read' },
      { system: 'Strategic decisions, category-linked (P14)', permission: 'strategy:read' },
      { system: 'Reasoning-Engine confidence (P14)', permission: 'strategy:read' },
    ].sort((a, b) => a.system.localeCompare(b.system)),
    principles: [
      'Intent-native: the user picks an outcome; the platform assembles the context — never the reverse.',
      'Every number comes from a real production data source; every intent is a real, measured strategic goal.',
      'Dynamic workspaces assemble only real per-intent facets; unbacked panels are hidden, not faked.',
      'Every screen answers "what next?" with the real Planning-Engine next best action.',
      'This layer reads and compresses; it never executes, approves, or mutates. No runtime, engine, or store is added.',
    ],
    provenance: [
      { field: 'intent (name/description/category/successMetric/target/current/unit)', source: 'StrategicGoal — P14 GoalManager (strategyOverview().goals.goals)' },
      { field: 'progress / status', source: 'StrategicGoal.progress (attainment vs target) / .status (derived from progress)' },
      { field: 'band', source: 'Derived from real StrategyStatus (off_track⇒critical, at_risk⇒at-risk, on_track⇒healthy)' },
      { field: 'dependencies / blocked / blockedBy', source: 'StrategicGoal.dependencies resolved to sibling goals\' real status' },
      { field: 'objectives', source: 'StrategicGoal.objectives — real sub-metrics with current/target/status' },
      { field: 'timeline (milestones + horizon)', source: 'StrategicGoal.milestones + StrategicGoal.horizon (real planning horizon)' },
      { field: 'evidence', source: 'StrategicGoal.evidence — real platform signal ids' },
      { field: 'nextBestAction (+ approval)', source: 'PlanningEngine plan step + StrategyApprovalRequirement (real governance chain)' },
      { field: 'recommendations', source: 'StrategicDecision set, linked by shared GoalCategory' },
      { field: 'reasoningConfidence (board-level)', source: 'ReasoningReport.confidence — real P14 reasoning confidence' },
      { field: 'counts / overallProgress', source: 'Real GoalManager statuses and mean goal progress' },
    ],
    omissions: [
      { item: 'Per-intent AI confidence', reason: 'Strategic goals carry no confidence field; none is invented. Board-level strategic reasoning confidence is surfaced instead, honestly labelled.' },
      { item: 'Calendar ETA / completion date', reason: 'No real per-goal completion date exists; the goal\'s real planning horizon (30/90/180/365d) is shown as the honest "target horizon" instead.' },
      { item: 'Per-intent AI-worker and connector rosters', reason: 'The workforce/connector runtimes hold no per-goal assignment; those workspace panels are withheld rather than fabricated.' },
      { item: 'Per-intent analytics charts', reason: 'No real per-intent metric time-series exists; no placeholder chart is drawn.' },
    ],
    note: 'The Intent layer is a read-only reprojection of the existing P14 strategy goals as user outcomes. It adds no runtime, engine, store, or mutation, and every field above traces to a real production source or is omitted.',
  };
}
