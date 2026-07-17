/**
 * Intent Experience Program v2.0 — Intent-Native Operating System view-model types.
 *
 * This is a READ-ONLY projection LAYER. It does NOT introduce a new runtime, engine, store, memory, or AI
 * system, and it fabricates NOTHING. An "intent" is not invented — it IS a real P14 strategic goal
 * (`strategyOverview().goals.goals`), whose every value (current/progress/status/evidence/dependencies/
 * objectives/milestones) is resolved from live production signals (enterprise health, risk, workforce
 * success rate, cloud utilization, compliance). This layer reprojects those real goals as the outcomes a
 * human operates around — "What outcome are you trying to achieve?" — and assembles each intent's workspace
 * strictly from the goal's OWN real facets plus real strategy decisions/plan-steps that link to it by
 * category. Anything with no real per-intent source (a fabricated ETA, a per-goal AI-confidence number, a
 * per-intent worker/connector roster) is OMITTED, never faked. It reuses the strategy status/category/
 * horizon/priority types rather than forking them.
 */
import type { GoalCategory, StrategyHorizon, StrategyPriority, StrategyStatus } from './strategyIntelligence';

/** Display band, shared vocabulary with the rest of the platform. Derived from real status/progress. */
export type IntentBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/**
 * Role lenses. A role does NOT create intents — it selects which REAL goals to emphasize by their real
 * `GoalCategory`. Founder sees every intent; each other role emphasizes its categories of concern.
 */
export type IntentRole =
  | 'founder'
  | 'ceo'
  | 'cto'
  | 'cfo'
  | 'coo'
  | 'sales'
  | 'marketing'
  | 'hr'
  | 'legal'
  | 'operations';

/** A real strategic objective (sub-metric of a goal) reprojected for an intent workspace. */
export interface IntentObjective {
  id: string;
  label: string;
  /** The real metric this objective tracks. */
  metric: string;
  current: number;
  target: number;
  unit: string;
  /** 0..100, from the real 0..1 attainment. */
  progressPct: number;
  status: StrategyStatus;
  band: IntentBand;
}

/** A real goal milestone (its horizon is the honest "when", never a fabricated calendar date). */
export interface IntentMilestone {
  id: string;
  label: string;
  horizon: StrategyHorizon;
  horizonLabel: string;
  status: StrategyStatus;
  band: IntentBand;
}

/** A real inter-goal dependency, resolved to the depended-on intent with its live status. */
export interface IntentDependency {
  id: string;
  name: string;
  status: StrategyStatus;
  band: IntentBand;
  /** True when this dependency is off-track/at-risk and therefore holding the dependent intent back. */
  blocking: boolean;
}

/** A real strategic decision that links to an intent by shared category. */
export interface IntentDecisionLink {
  id: string;
  title: string;
  recommendation: string;
  /** Real decision confidence (0..1) — this IS a real per-decision field, unlike per-goal confidence. */
  confidence: number;
  priority: StrategyPriority;
  band: IntentBand;
  requiresApproval: boolean;
}

/** Real approval requirement for advancing an intent, from the strategy plan step (governance chain aware). */
export interface IntentApproval {
  /** Whether an enabled approval chain governs the advancing action. */
  governed: boolean;
  chainName: string | null;
  steps: number;
  note: string;
}

/**
 * The single real next action for an intent — the strategy Planning Engine's advisory plan step for a
 * not-on-track goal (its action + the real approval it would require). Null when the goal is on-track and
 * the platform recommends no step (honest: no invented action).
 */
export interface IntentNextBestAction {
  intentId: string;
  label: string;
  action: string;
  approval: IntentApproval | null;
  evidence: string[];
}

/** A risk surfaced for an intent — its own off-track state and/or its off-track dependencies. Real, derived. */
export interface IntentRisk {
  id: string;
  label: string;
  detail: string;
  band: IntentBand;
}

/**
 * One intent in the multi-intent board. Every field maps to a real strategic-goal value or an honest
 * derivation over real values (band from status, urgency from status+progress, blocked from dependency
 * status). There is deliberately NO per-intent `confidence` field: goals carry none, so none is invented.
 */
export interface IntentSummary {
  id: string;
  name: string;
  description: string;
  category: GoalCategory;
  /** The real headline success metric, e.g. "Enterprise risk index < 40". */
  successMetric: string;
  /** 0..1 real attainment. */
  progress: number;
  /** 0..100 rounded. */
  progressPct: number;
  status: StrategyStatus;
  band: IntentBand;
  current: number;
  target: number;
  unit: string;
  /** The goal's real planning horizon — the honest "target horizon", not a fabricated completion date. */
  horizon: StrategyHorizon;
  horizonLabel: string;
  /** ids of real goals this intent depends on. */
  dependencies: string[];
  /** Names of dependencies currently off-track/at-risk (empty ⇒ not blocked). Derived from real status. */
  blockedBy: string[];
  blocked: boolean;
  objectiveCount: number;
  milestoneCount: number;
  evidenceCount: number;
  /** The real next plan-step label ("Advance …"), or null when on-track. Answers "what next?" per card. */
  nextAction: string | null;
  /**
   * Derived ranking key = status severity (off-track 100, at-risk 60, on-track 20). It is the PRIMARY board
   * sort key; progress breaks ties (lower progress ranks higher). An honest projection of the real status,
   * not a fabricated priority label.
   */
  urgency: number;
}

/**
 * The Intent Dashboard for "Today's Intent" — the Decision Center's evolution into an outcome view:
 * Current Outcome, Progress, Risks, Approvals, Recommendations, Next Best Action. Per-intent AI confidence
 * is intentionally absent (no real source); board-level strategic reasoning confidence is surfaced on the
 * board instead.
 */
export interface IntentDashboard {
  intent: IntentSummary;
  /** The real success metric = the outcome being pursued. */
  currentOutcome: string;
  risks: IntentRisk[];
  approval: IntentApproval | null;
  recommendations: IntentDecisionLink[];
  nextBestAction: IntentNextBestAction | null;
}

/**
 * A dynamic workspace auto-assembled for one intent — but ONLY from facets with a real per-intent source:
 * the goal's own objectives, milestones (timeline), evidence, dependencies, and the strategy decisions/
 * plan-step that link to it. Panels for which no real per-intent linkage exists (worker/connector rosters,
 * analytics) are NOT rendered — the layer never fabricates a workspace panel. `panels` names what is real
 * and present; `omitted` documents what was withheld for authenticity.
 */
export interface IntentWorkspace {
  intentId: string;
  intent: IntentSummary;
  objectives: IntentObjective[];
  timeline: IntentMilestone[];
  evidence: string[];
  dependencies: IntentDependency[];
  relatedDecisions: IntentDecisionLink[];
  nextBestAction: IntentNextBestAction | null;
  /** The workspace panels that are backed by a real per-intent source and therefore rendered. */
  panels: string[];
  /** Panels withheld because no real per-intent source exists (authenticity, not laziness). */
  omitted: string[];
}

/** A role lens over the real intent set: which real intents (by category) this role emphasizes. */
export interface IntentRoleView {
  role: IntentRole;
  label: string;
  focus: string;
  /** The real goal categories this role cares about (empty ⇒ founder: everything). */
  categories: GoalCategory[];
  /** ids of the real intents this role emphasizes, most urgent first. */
  intentIds: string[];
}

/** Board-level counts, straight from the real GoalManager plus derived blocked count. */
export interface IntentCounts {
  total: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  blocked: number;
}

/** The Intent Home board: Today's Intent + every active intent + roles + the one next best action. */
export interface IntentBoard {
  generatedAt: string;
  /** The single most urgent real intent, as a full dashboard. Null only when no goals exist. */
  todaysIntent: IntentDashboard | null;
  intents: IntentSummary[];
  counts: IntentCounts;
  /** Mean goal progress 0..1, from the real GoalManager. */
  overallProgress: number;
  overallProgressPct: number;
  /**
   * Strategic reasoning confidence (0..1) from the real P14 Reasoning Engine — surfaced at the BOARD level
   * and honestly labelled. It is NOT a per-intent confidence (goals carry none); it is the platform's
   * confidence in its strategic reasoning overall.
   */
  reasoningConfidence: number;
  roleViews: IntentRoleView[];
  /** The single highest-priority next action across all intents (Today's Intent's step). */
  nextBestAction: IntentNextBestAction | null;
  note: string;
}

/** All per-intent workspaces in one payload (IPC stays parameterless; the renderer selects by id). */
export interface IntentWorkspaces {
  workspaces: IntentWorkspace[];
  note: string;
}

/** Governance / posture for the intent layer, including the honest authenticity ledger. */
export interface IntentGovernance {
  intentScope: 'intent:read';
  law: string;
  /** The real systems this layer reads (and the scope each keeps). */
  reusedSystems: { system: string; permission: string }[];
  principles: string[];
  /** The authenticity ledger: every intent field and the real source it traces to. */
  provenance: { field: string; source: string }[];
  /** What was deliberately OMITTED rather than fabricated, and why. */
  omissions: { item: string; reason: string }[];
  note: string;
}
