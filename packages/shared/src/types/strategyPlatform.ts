/**
 * Enterprise Strategy Platform — shared types (Phase 6 Stage 10).
 *
 * Stage 10 is the enterprise DIRECTION layer composed over everything Stages
 * 1–9 built: company/department objectives measured ONLY by existing
 * aggregates, an initiative portfolio composed from real records (UDM project
 * entities, Stage 8 playbooks, Stage 9 services, governed decisions), a
 * decision→outcome business-value view (computed, never estimated — no
 * currency exists in the platform and none is invented), relative-horizon
 * executive planning whose every item REUSES the Stage 9 Principle-C
 * recommendation type, the Enterprise Capability Map (the approved
 * enhancement: twelve BUSINESS capabilities threaded through objectives,
 * initiatives, KPIs, risks, and decision categories), strategy health that
 * composes S6+S7+S8+S9+P14, the executive dashboard, and the board report.
 *
 * Types + small pure guards only. No engine, store, scheduler, or executor
 * lives here — or anywhere else in Stage 10.
 */
import type { InsightOutcomeStage } from './insight';
import type { OperationsRecommendation, ServiceOwnerRef } from './operationsPlatform';

/* ── the Enterprise Capability Map (approved enhancement) ─────────────────── */

/** Twelve BUSINESS capabilities (not AI skills) — the strategic backbone. */
export type BusinessCapabilityKey =
  | 'sales'
  | 'marketing'
  | 'customer-success'
  | 'finance'
  | 'procurement'
  | 'engineering'
  | 'manufacturing'
  | 'compliance'
  | 'risk'
  | 'security'
  | 'operations'
  | 'support';

export const BUSINESS_CAPABILITIES: readonly BusinessCapabilityKey[] = [
  'sales',
  'marketing',
  'customer-success',
  'finance',
  'procurement',
  'engineering',
  'manufacturing',
  'compliance',
  'risk',
  'security',
  'operations',
  'support',
] as const;

/** A live signal that evidences a capability's condition (never invented). */
export interface CapabilityEvidenceRef {
  kind: 'insight-domain' | 'kpi' | 's9-service' | 'readiness-dimension' | 'mined-process' | 'compliance-checks';
  ref: string;
}

export interface CapabilityDef {
  key: BusinessCapabilityKey;
  label: string;
  /** Org-unit NAME ownership resolves against (a REAL seeded unit name). */
  owningUnitName: string;
  /** The live signals that evidence this capability. Thin lists are honest. */
  evidence: CapabilityEvidenceRef[];
  /** Stage 7 knowledge topic tokens for the standards join. */
  knowledgeTopics: string[];
}

/* ── themes · objectives · initiatives · risks (registry data) ────────────── */

export type StrategyHorizonKey = 'current-quarter' | 'next-quarter' | 'annual';

// Named *_KEYS (mirroring STRATEGY_QUESTION_KEYS) because the P14
// strategyIntelligence module already exports a `STRATEGY_HORIZONS` — the
// shared barrel re-exports both modules and must stay unambiguous (TS2308).
export const STRATEGY_HORIZON_KEYS: readonly StrategyHorizonKey[] = ['current-quarter', 'next-quarter', 'annual'] as const;

export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  capabilityKeys: BusinessCapabilityKey[];
}

/** A measure is ALWAYS an existing aggregate — a KPI key, an S9 SLA target id,
 *  or a Stage 6 health domain. Direction states what "good" means. */
export interface ObjectiveMeasureRef {
  kind: 'kpi' | 'sla' | 'insight-domain';
  ref: string;
  /** 'met' applies to SLA refs; bands apply to kpi/domain refs. */
  good: 'healthy-band' | 'met';
}

export interface CompanyObjectiveDef {
  id: string;
  label: string;
  description: string;
  themeId: string;
  owningUnitName: string;
  horizon: StrategyHorizonKey;
  measures: ObjectiveMeasureRef[];
  capabilityKeys: BusinessCapabilityKey[];
}

export interface DepartmentObjectiveDef {
  id: string;
  label: string;
  /** A REAL seeded unit name. */
  unitName: string;
  companyObjectiveId: string;
  measures: ObjectiveMeasureRef[];
  capabilityKeys: BusinessCapabilityKey[];
}

/** An initiative composes EXISTING records — it never stores its own. */
export interface InitiativeSourceRef {
  kind: 'project-entities' | 'playbook' | 's9-service' | 'decision-category' | 'mined-process';
  ref: string;
}

/** Milestones are OBSERVABLE CONDITIONS over live signals — never dates. */
export interface MilestoneCondition {
  id: string;
  label: string;
  predicate:
    | { kind: 'sla-met'; targetId: string }
    | { kind: 'readiness-ready'; dimension: string }
    | { kind: 'kpi-healthy'; key: string }
    | { kind: 'monitor-clear'; findingKind: string }
    | { kind: 'decisions-executed'; category: string; atLeast: number };
}

export interface InitiativeDef {
  id: string;
  label: string;
  description: string;
  companyObjectiveId: string;
  capabilityKeys: BusinessCapabilityKey[];
  sources: InitiativeSourceRef[];
  milestones: MilestoneCondition[];
  dependsOn: string[];
}

export interface StrategicRiskDef {
  id: string;
  label: string;
  description: string;
  capabilityKeys: BusinessCapabilityKey[];
  /** The live signals that would substantiate this risk. */
  evidencedBy: {
    kind: 'incident-domain' | 'readiness-dimension' | 'sla-target' | 'ap-finding-kind';
    ref: string;
  }[];
}

/** Registry maps from existing vocabularies into capabilities. */
export interface KpiCapabilityRef {
  key: string;
  capabilityKey: BusinessCapabilityKey;
}

export interface DecisionCategoryCapabilityRef {
  category: string;
  capabilityKeys: BusinessCapabilityKey[];
}

/* ── computed: objectives ─────────────────────────────────────────────────── */

export type ObjectiveHealthState = 'on-track' | 'at-risk' | 'off-track' | 'unknown';

export interface MeasureReading {
  kind: ObjectiveMeasureRef['kind'];
  ref: string;
  /** Human reading of the live value, or null when unreadable. */
  reading: string | null;
  state: 'good' | 'bad' | 'unknown';
  detail: string;
}

export interface ObjectiveView {
  id: string;
  kind: 'company' | 'department';
  label: string;
  description: string;
  themeId: string | null;
  horizon: StrategyHorizonKey | null;
  owner: ServiceOwnerRef | null;
  unitName: string;
  companyObjectiveId: string | null;
  capabilityKeys: BusinessCapabilityKey[];
  measures: MeasureReading[];
  health: ObjectiveHealthState;
  healthDetail: string;
  /** Department objective ids rolling up (company objectives only). */
  rollup: string[];
}

export interface StrategyGap {
  kind: 'ownership' | 'measure' | 'source' | 'standards' | 'alignment';
  subject: string;
  detail: string;
}

export interface StrategyUnavailable {
  system: string;
  reason: string;
}

export interface ObjectivesReport {
  generatedAt: string;
  company: ObjectiveView[];
  departments: ObjectiveView[];
  totals: { onTrack: number; atRisk: number; offTrack: number; unknown: number };
  gaps: StrategyGap[];
  unavailable: StrategyUnavailable[];
}

/* ── computed: the initiative portfolio ───────────────────────────────────── */

export type InitiativeState = 'advancing' | 'blocked' | 'stalled' | 'done' | 'unknown';

export interface InitiativeSourceReading {
  kind: InitiativeSourceRef['kind'];
  ref: string;
  available: boolean;
  summary: string;
}

export interface MilestoneReading {
  id: string;
  label: string;
  /** true/false = evaluated against live signals; null = not evaluable now. */
  satisfied: boolean | null;
  detail: string;
}

export interface InitiativeView {
  id: string;
  label: string;
  description: string;
  companyObjectiveId: string;
  capabilityKeys: BusinessCapabilityKey[];
  owner: ServiceOwnerRef | null;
  state: InitiativeState;
  stateDetail: string;
  sources: InitiativeSourceReading[];
  milestones: MilestoneReading[];
  blockers: { reason: string; evidence: string[] }[];
  dependsOn: string[];
}

export interface PortfolioReport {
  generatedAt: string;
  initiatives: InitiativeView[];
  totals: { advancing: number; blocked: number; stalled: number; done: number; unknown: number };
  gaps: StrategyGap[];
  unavailable: StrategyUnavailable[];
}

/* ── computed: business value (decision → outcome; never estimated) ───────── */

export type OutcomeVerdict = 'delivered' | 'partial' | 'not-yet-observed' | 'unmeasurable';

export interface MeasureDelta {
  label: string;
  /** Window-start / window-end values from the EXISTING 90-day history, or null. */
  before: number | null;
  after: number | null;
  detail: string;
}

export interface DecisionValueView {
  decisionId: string;
  title: string;
  category: string;
  capabilityKeys: BusinessCapabilityKey[];
  status: string;
  expectedOutcome: string;
  businessImpact: string;
  /** The Stage 6 outcome-loop stage of the linked recommendation, or null. */
  outcomeStage: InsightOutcomeStage | null;
  deltas: MeasureDelta[];
  verdict: OutcomeVerdict;
  verdictDetail: string;
  evidence: string[];
}

export interface BusinessValueReport {
  generatedAt: string;
  decisions: DecisionValueView[];
  totals: { delivered: number; partial: number; notYetObserved: number; unmeasurable: number };
  /** The structural honesty statement (no currency; measured deltas only). */
  disclosure: string;
  unavailable: StrategyUnavailable[];
}

/* ── computed: executive planning (recommends, never executes) ────────────── */

export interface HorizonPlan {
  horizon: StrategyHorizonKey;
  label: string;
  /** The relative window, computed from the clock at read time. */
  window: { fromIso: string; toIso: string };
  objectiveIds: string[];
  initiativeIds: string[];
  /** Every focus item is a Stage 9 Principle-C recommendation (REUSED type). */
  focus: OperationsRecommendation[];
  summary: string;
}

export interface PlanningReport {
  generatedAt: string;
  horizons: HorizonPlan[];
  unavailable: StrategyUnavailable[];
}

/* ── computed: the Capability Map ─────────────────────────────────────────── */

export interface CapabilityAnalysis {
  key: BusinessCapabilityKey;
  label: string;
  owner: ServiceOwnerRef | null;
  /** Composed condition from the capability's declared evidence signals. */
  condition: ObjectiveHealthState;
  conditionDetail: string;
  /** 0..1 — how much declared evidence was actually readable. */
  evidenceCoverage: number;
  objectives: { total: number; atRisk: number };
  initiatives: { total: number; blocked: number };
  kpis: { key: string; band: string | null }[];
  riskIds: string[];
  /** Composed attention: initiatives + recent decisions in mapped categories.
   *  COUNTS, not currency — the platform records no costs. */
  decisionAttention: number;
  standards: { matched: boolean; refs: { ref: string; matched: boolean }[] };
  operationalRisk: { findings: number; breachedSlas: number; detail: string };
  gaps: string[];
}

export interface CapabilityMapView {
  generatedAt: string;
  capabilities: CapabilityAnalysis[];
  /** Named ONLY when a judged capability is at-risk/off-track; null when every
   *  readable capability is on-track or nothing was judgeable — an arbitrary
   *  pick would be an invented judgment. */
  weakest: { key: BusinessCapabilityKey; detail: string } | null;
  /** Capabilities with ZERO initiatives supporting them. */
  unsupported: BusinessCapabilityKey[];
  /** Attention ranking (counts, not currency — disclosed). */
  investmentFocus: { key: BusinessCapabilityKey; attention: number }[];
  /** Capabilities whose knowledge-topic lookups matched no standards. */
  lackingStandards: BusinessCapabilityKey[];
  highestOperationalRisk: { key: BusinessCapabilityKey; detail: string } | null;
  disclosure: string;
  unavailable: StrategyUnavailable[];
}

/* ── computed: strategy health + risks ────────────────────────────────────── */

export interface StrategicRiskView {
  id: string;
  label: string;
  description: string;
  capabilityKeys: BusinessCapabilityKey[];
  /** substantiated = at least one evidencing signal is live; else honest. */
  substantiated: boolean;
  evidence: { kind: string; ref: string; live: boolean; detail: string }[];
  detail: string;
}

export interface StrategyHealthView {
  generatedAt: string;
  themes: { id: string; label: string; state: ObjectiveHealthState; detail: string }[];
  /** The five composed layers (S6/S7/S8/S9/P14) — per-layer isolation. */
  layers: { layer: 'intelligence' | 'knowledge' | 'automation' | 'operations' | 'p14-strategy'; state: ObjectiveHealthState; detail: string }[];
  capabilities: CapabilityMapView;
  risks: StrategicRiskView[];
  alignment: { unitName: string; companyObjectiveIds: string[]; aligned: boolean; detail: string }[];
  unavailable: StrategyUnavailable[];
}

/* ── computed: dashboard + board report ───────────────────────────────────── */

export interface StrategyDashboard {
  generatedAt: string;
  objectives: ObjectivesReport['totals'] & { company: number; departments: number };
  portfolio: PortfolioReport['totals'];
  value: BusinessValueReport['totals'];
  planning: { horizons: number; focusItems: number };
  capabilities: { weakest: BusinessCapabilityKey | null; unsupported: number; lackingStandards: number };
  risks: { substantiated: number; unsubstantiated: number };
  kpis: { key: string; label: string; display: string; band: string | null }[];
  recommendations: OperationsRecommendation[];
  disclosures: string[];
  unavailable: StrategyUnavailable[];
}

export interface BoardReport {
  generatedAt: string;
  title: string;
  sections: { title: string; lines: string[] }[];
}

/* ── assistant questions (D-8 + the capability enhancement) ───────────────── */

export type StrategyQuestionKey =
  | 'strategy-status'
  | 'objectives-at-risk'
  | 'initiative-portfolio'
  | 'business-value'
  | 'alignment'
  | 'executive-focus'
  | 'strategic-risks'
  | 'roadmap-outlook'
  | 'investment-priorities'
  | 'board-brief'
  | 'capability-analysis';

export const STRATEGY_QUESTION_KEYS: readonly StrategyQuestionKey[] = [
  'strategy-status',
  'objectives-at-risk',
  'initiative-portfolio',
  'business-value',
  'alignment',
  'executive-focus',
  'strategic-risks',
  'roadmap-outlook',
  'investment-priorities',
  'board-brief',
  'capability-analysis',
] as const;
