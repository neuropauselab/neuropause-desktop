/**
 * Experience Program v1.0 — the view-model types for the Decision-First Experience LAYER.
 *
 * This is a READ-ONLY compression/summary layer over the ENTIRE existing platform (P1–P20). It changes HOW
 * humans interact with NeuroPause, not how NeuroPause works: it takes the rich data the twenty increments
 * already produce and distills it into the primitives an executive decides on — Business Health, Today's
 * Mission, Revenue, One Decision, One Risk, One Approval, an AI Workforce summary, a Decision Queue (only
 * what needs a human), per-module one-line summaries, a three-level progressive-disclosure map, and an
 * intent catalog. It introduces NO new runtime, engine, or store. THE CORE UX LAW: never ask a human to
 * process information the AI can process first — AI compresses, humans decide. The interface must never
 * display everything NeuroPause knows; only what the human needs to decide right now.
 */

export type ExperienceBand = 'healthy' | 'watch' | 'at-risk' | 'critical';
export type ExperienceRole = 'founder' | 'ceo' | 'cto' | 'cfo' | 'coo' | 'sales' | 'marketing' | 'hr';

/* ── Home / Decision Center ── */

export interface ExperienceKpiLite {
  label: string;
  display: string;
  band: ExperienceBand;
}

/** A role's adaptive slice of the home screen — its focus and its three headline KPIs. */
export interface RoleView {
  role: ExperienceRole;
  label: string;
  focus: string;
  kpis: ExperienceKpiLite[];
}

export interface BusinessHealthLite {
  score: number;
  band: ExperienceBand;
  headline: string;
}

export interface MissionLite {
  title: string;
  detail: string;
  why: string;
}

export interface RevenueLite {
  display: string;
  label: string;
  band: ExperienceBand;
  detail: string;
}

export interface WorkforceLite {
  headline: string;
  successPct: number;
  activeWorkers: number;
  needApproval: number;
}

export interface DecisionSummary {
  id: string;
  title: string;
  why: string;
  band: ExperienceBand;
  source: string;
  requiredApprovals: number;
  evidenceCount: number;
}

export interface ExperienceRiskSummary {
  id: string;
  title: string;
  domain: string;
  risk: number;
  band: ExperienceBand;
  reason: string;
}

export interface ApprovalSummary {
  id: string;
  title: string;
  source: string;
  requestedBy: string | null;
  band: ExperienceBand;
}

export interface ExperienceHome {
  greeting: string;
  generatedAt: string;
  businessHealth: BusinessHealthLite;
  todaysMission: MissionLite;
  revenue: RevenueLite;
  aiWorkforce: WorkforceLite;
  /** The single most important decision, risk, and approval — everything else is progressively disclosed. */
  oneDecision: DecisionSummary | null;
  oneRisk: ExperienceRiskSummary | null;
  oneApproval: ApprovalSummary | null;
  /** Role-adaptive slices — the renderer shows the active role's focus + KPIs. */
  roleViews: RoleView[];
  /** How many raw signals were compressed into this one screen (the compression ratio the law demands). */
  compressedSignals: number;
  note: string;
}

/* ── Decision Queue (replaces the notification center) ── */

export type DecisionKind = 'decision' | 'approval' | 'risk' | 'optimization';

export interface DecisionQueueItem {
  id: string;
  kind: DecisionKind;
  title: string;
  why: string;
  band: ExperienceBand;
  /** Rank 0..100 — higher is more urgent. */
  urgency: number;
  source: string;
  requiredApprovals: number;
  evidenceCount: number;
}

export interface ExperienceDecisions {
  items: DecisionQueueItem[];
  total: number;
  needApproval: number;
  /** Raw actionable-signal count before compression to the queue. */
  compressedFrom: number;
  note: string;
}

/* ── AI Summary Engine: per-module one-liners + progressive disclosure ── */

export type DisclosureLevelId = 'executive' | 'management' | 'specialist';

export interface DisclosureLevel {
  id: DisclosureLevelId;
  name: string;
  timeToValue: string;
  audience: string;
  shows: string[];
}

export interface ModuleSummary {
  key: string;
  label: string;
  /** The ONE executive sentence produced before any detail. */
  headline: string;
  band: ExperienceBand;
  /** How many raw items were compressed into the headline. */
  compressedFrom: number;
  detail: string;
  /** The section a human expands into for the full detail. */
  expandTo: string;
}

export interface ExperienceSummaries {
  modules: ModuleSummary[];
  disclosure: DisclosureLevel[];
  totalCompressed: number;
  note: string;
}

/* ── Intent-first catalog (replaces traditional search + navigation) ── */

export interface IntentItem {
  id: string;
  label: string;
  prompt: string;
  targetSection: string;
  targetLabel: string;
  category: string;
  keywords: string[];
  /** True when the platform has backing data/workflow for this intent today. */
  available: boolean;
}

export interface ExperienceIntents {
  intents: IntentItem[];
  note: string;
}

/* ── Experience governance / posture ── */

export interface ExperienceScopeRow {
  system: string;
  permission: string;
}

export interface ExperienceGovernance {
  experienceScope: string;
  law: string;
  reusedSystems: ExperienceScopeRow[];
  principles: string[];
  note: string;
}
