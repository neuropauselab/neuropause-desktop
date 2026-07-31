/**
 * Enterprise Operations Platform — shared types (Phase 6 Stage 9).
 *
 * Stage 9 is orchestration-layer COMPOSITION over engines that already exist:
 * the Stage 6 intelligence layer (eight-domain health, computed incidents,
 * predictions), the P7 engines, the Stage 7 knowledge platform, the Stage 8
 * automation platform, the ExecuteEngine, the workforce runtime, governance,
 * the DR store, the backup manager, the runtime supervisor, process mining,
 * the executive center, and continuous validation. These types describe:
 *
 *   - the Operations Registry (code-shipped, versioned, doc-locked data:
 *     domains · services · SLA targets · objectives · processes),
 *   - the computed Service Catalog (registry × live signals; honest gaps),
 *   - the SLA framework (targets measured ONLY by existing aggregates;
 *     unmeasurable targets are DECLARED, never estimated),
 *   - the composed operational health, readiness (four-state, honest
 *     `unknown`), capacity, and continuity (honest zero) views,
 *   - the incident lifecycle view (`transient: true` is structural — no
 *     incident store exists; persistence is the existing decision path),
 *   - Principle-C operational recommendations (seven mandatory fields),
 *   - the dashboard and the assistant's ten operations questions.
 *
 * Types + small pure guards only. No engine, store, scheduler, or executor
 * lives here — or anywhere else in Stage 9.
 */
import type { InsightHealthDomainKey, InsightHealthFramework, InsightIncidentView, InsightPrediction } from './insight';

/* ── Principle C — structurally mandatory recommendation fields ───────────── */

/** Every operational recommendation MUST expose all seven fields — tests and
 *  the composing model reject absence (the Stage 8 explainability precedent). */
export interface OperationsRecommendation {
  id: string;
  title: string;
  detail: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  suggestedAction: string;
  /** 1. Real record references (session/job/rule/incident/target ids). */
  evidence: string[];
  /** 2. Why this recommendation follows from the evidence. */
  reasoning: string;
  /** 3. 0..1 — composition confidence, never invented. */
  confidence: number;
  /** 4. Which systems the recommendation touches. */
  affectedSystems: string[];
  /** 5. What it means for day-to-day operations. */
  operationalImpact: string;
  /** 6. The expected business outcome if acted on (qualitative, never invented currency). */
  expectedBusinessOutcome: string;
  /** 7. Rollback implications of acting (honest — external effects may have none). */
  rollbackImplications: string;
}

/** Pure structural check (used by tests AND the composing model, which throws). */
export function recommendationIssues(r: OperationsRecommendation): string[] {
  const issues: string[] = [];
  if (r.evidence.length === 0) issues.push('evidence is empty');
  if (r.reasoning.trim().length === 0) issues.push('reasoning is empty');
  if (!(r.confidence > 0 && r.confidence <= 1)) issues.push('confidence must be in (0,1]');
  if (r.affectedSystems.length === 0) issues.push('affectedSystems is empty');
  if (r.operationalImpact.trim().length === 0) issues.push('operationalImpact is empty');
  if (r.expectedBusinessOutcome.trim().length === 0) issues.push('expectedBusinessOutcome is empty');
  if (r.rollbackImplications.trim().length === 0) issues.push('rollbackImplications is empty');
  return issues;
}

/* ── the Operations Registry (code-shipped, versioned, doc-locked data) ───── */

/** Operational domains REUSE the Stage 6 eight-domain vocabulary — no second
 *  domain model is introduced. */
export type OperationalDomainKey = InsightHealthDomainKey;

export interface OperationalDomainDef {
  key: OperationalDomainKey;
  label: string;
  /** Org-unit NAME the domain's operational ownership resolves against at
   *  runtime (case-insensitive). No match → an honest ownership gap. */
  owningUnitName: string;
}

/** The real signal source a service row is measured by (never invented). */
export type ServiceSignalSource =
  | 'execution-stats' // executeEngine.stats()
  | 'workforce' // jobStore pages + worker registry
  | 'automation-monitor' // getAutomationMonitor()
  | 'connectors' // connectorService.list()
  | 'ai-engine' // engineManager.state
  | 'none-measured'; // DECLARED: the platform records no aggregate for this service

export interface ServiceDef {
  id: string;
  name: string;
  description: string;
  domain: OperationalDomainKey;
  signal: ServiceSignalSource;
  /** SLA target ids bound to this service (registry-internal refs). */
  slaTargetIds: string[];
  /** Executive KPI keys this service surfaces (joined live when present). */
  kpiKeys: string[];
  /** Existing subsystems this service depends on (names, for the catalog row). */
  dependsOn: string[];
}

export type SlaMetric =
  | 'success-rate' // executions: successRate (0..1)
  | 'avg-runtime-ms' // executions: averageRuntimeMs
  | 'queue-depth' // workforce: queued jobs
  | 'approval-age-hours' // workforce: oldest awaiting_approval age
  | 'failure-ratio' // automation monitor: failed / (completed + failed)
  | 'healthy-ratio' // connectors: healthy / configured
  | 'engine-ready' // ai: engineManager.state === 'ready' (1 or 0)
  | 'response-latency-ms'; // NOT recorded anywhere — measurable only if measuredBy != null

export interface SlaTargetDef {
  id: string;
  serviceId: string;
  label: string;
  metric: SlaMetric;
  comparator: 'gte' | 'lte';
  target: number;
  unit: string;
  /** The EXISTING aggregate that measures this target, or null — null is the
   *  DECLARED-unmeasurable path (D-3): no estimation, ever. */
  measuredBy: string | null;
  windowLabel: string;
}

export interface ObjectiveDef {
  id: string;
  label: string;
  domain: OperationalDomainKey;
  /** KPI keys + SLA target ids this objective reviews. */
  kpiKeys: string[];
  slaTargetIds: string[];
  reviewCadence: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

export interface ProcessDef {
  id: string;
  name: string;
  /** The mined process TYPE this maps to (process mining vocabulary), or null
   *  when the registry names a process mining has not yet discovered. */
  minedType: string | null;
  domain: OperationalDomainKey;
}

/* ── the Service Catalog (computed: registry × live signals) ──────────────── */

export type ServiceState = 'operational' | 'degraded' | 'failed' | 'unknown';

export interface ServiceOwnerRef {
  unitId: string;
  unitName: string;
  leadUserId: string | null;
  leadName: string | null;
}

export interface ServiceCatalogEntry {
  serviceId: string;
  name: string;
  description: string;
  domain: OperationalDomainKey;
  signal: ServiceSignalSource;
  state: ServiceState;
  /** WHY the state is what it is — computed statements citing the signal. */
  stateDetail: string;
  /** Resolved from the registry's domain→unit mapping, or null (honest gap). */
  owner: ServiceOwnerRef | null;
  slaTargetIds: string[];
  /** KPI keys found LIVE in the executive snapshot (missing keys are gaps). */
  kpiKeys: { key: string; present: boolean }[];
  dependsOn: string[];
  evidence: string[];
}

export interface OperationsGap {
  kind: 'ownership' | 'kpi' | 'signal' | 'process';
  subject: string;
  detail: string;
}

export interface OperationsUnavailable {
  system: string;
  reason: string;
}

export interface ServiceCatalog {
  generatedAt: string;
  entries: ServiceCatalogEntry[];
  domains: { key: OperationalDomainKey; label: string; owner: ServiceOwnerRef | null; services: number }[];
  gaps: OperationsGap[];
  totals: { services: number; operational: number; degraded: number; failed: number; unknown: number };
  unavailable: OperationsUnavailable[];
}

/* ── the SLA framework (targets vs EXISTING aggregates) ───────────────────── */

export type SlaStatusKind = 'met' | 'breached' | 'unmeasurable';

export interface SlaStatus {
  targetId: string;
  serviceId: string;
  label: string;
  metric: SlaMetric;
  comparator: 'gte' | 'lte';
  target: number;
  unit: string;
  /** The measured value from the EXISTING aggregate, or null. */
  measured: number | null;
  status: SlaStatusKind;
  /** met/breached: the measurement statement · unmeasurable: WHY (declared). */
  detail: string;
  evidence: string[];
  windowLabel: string;
}

export interface SlaReport {
  generatedAt: string;
  statuses: SlaStatus[];
  totals: { targets: number; met: number; breached: number; unmeasurable: number };
  unavailable: OperationsUnavailable[];
}

/* ── operational health (compose, never recompute) ────────────────────────── */

export interface OperationalHealthView {
  generatedAt: string;
  /** The Stage 6 framework, verbatim (composed, never recomputed). */
  framework: InsightHealthFramework;
  system: { score: number; level: string } | null;
  workforce: { healthy: number; degraded: number; unhealthy: number; unknown: number } | null;
  connectors: { total: number; configured: number; healthy: number } | null;
  /** History points from the EXISTING 90-day store (day + overall). */
  trend: { day: string; overall: number }[];
  unavailable: OperationsUnavailable[];
}

/* ── readiness (seven dimensions, four honest states) ─────────────────────── */

export type ReadinessDimensionKey =
  | 'deployment'
  | 'organization'
  | 'connectors'
  | 'automation'
  | 'workforce'
  | 'ai'
  | 'governance';

export const READINESS_DIMENSIONS: readonly ReadinessDimensionKey[] = [
  'deployment',
  'organization',
  'connectors',
  'automation',
  'workforce',
  'ai',
  'governance',
] as const;

export type ReadinessState = 'ready' | 'degraded' | 'not-ready' | 'unknown';

export interface ReadinessDimension {
  key: ReadinessDimensionKey;
  label: string;
  state: ReadinessState;
  /** Real record references backing the state. */
  evidence: string[];
  /** What is missing to reach `ready` (empty when ready). */
  missing: string[];
  detail: string;
}

export interface ReadinessAssessment {
  generatedAt: string;
  dimensions: ReadinessDimension[];
  totals: { ready: number; degraded: number; notReady: number; unknown: number };
  unavailable: OperationsUnavailable[];
}

/* ── incidents (lifecycle VIEW over computed incidents; transient by law) ─── */

export type IncidentStage = 'detected' | 'investigating' | 'recovering' | 'verified-closed';

export interface IncidentLifecycleView {
  /** The Stage 6 computed incident, reused verbatim. */
  incident: InsightIncidentView;
  /** STRUCTURAL honesty: incidents are computed views, never stored records. */
  transient: true;
  domain: OperationalDomainKey | null;
  /** Ownership resolved registry-domain → org-unit lead, or null (a gap). */
  owner: ServiceOwnerRef | null;
  stage: IncidentStage;
  stageDetail: string;
  /** Stage 7 knowledge refs (SOP/topic tokens) matched for this domain. */
  sopRefs: { ref: string; matched: boolean }[];
  /** The honest persistence path: convert to a governed decision (existing). */
  conversion: { available: boolean; how: string };
  investigation: {
    rootCauseLabel: string | null;
    rootCauseConfidence: number;
    eventIds: string[];
    /** Where to replay the window — the EXISTING timeline surface. */
    replayHint: string;
  };
}

export interface IncidentLifecycleReport {
  generatedAt: string;
  incidents: IncidentLifecycleView[];
  totals: { open: number; bySeverity: { severity: InsightIncidentView['severity']; count: number }[] };
  unavailable: OperationsUnavailable[];
}

/* ── capacity ─────────────────────────────────────────────────────────────── */

export interface CapacityBottleneck {
  scope: string;
  key: string;
  kind: string;
  reason: string;
  value: number;
  sampleSize: number;
}

export interface CapacityView {
  generatedAt: string;
  executions: { active: number; queued: number; successRate: number | null } | null;
  workforce: { queueDepth: number; awaitingApproval: number } | null;
  automation: { running: number; failed: number; paused: number } | null;
  bottlenecks: CapacityBottleneck[];
  /** Composed pressure over the available inputs; unknown when nothing read. */
  pressure: 'low' | 'elevated' | 'high' | 'unknown';
  pressureDetail: string;
  /** Stage 6 predictions REUSED as the only forecast (no new model). */
  forecast: InsightPrediction[];
  unavailable: OperationsUnavailable[];
}

/* ── continuity (honest zero; RPO only from recorded validations) ─────────── */

export interface ContinuityMechanism {
  name: string;
  kind: 'recovery' | 'backup' | 'replication' | 'validation';
  detail: string;
  evidence: string[];
}

export interface ContinuityView {
  generatedAt: string;
  posture: {
    haEnabled: boolean;
    multiRegion: boolean;
    rpoTargetSeconds: number;
    rtoTargetSeconds: number;
    lastDrillAt: string | null;
    score: number;
  } | null;
  replication: { replicas: number; inSync: number; lagging: number } | null;
  validations: {
    total: number;
    lastAt: string | null;
    lastStatus: 'pass' | 'fail' | null;
    /** Observed RPO from the LAST recorded validation — never estimated. */
    rpoObservedSeconds: number | null;
  } | null;
  localBackups: { count: number; lastAt: string | null; lastValid: boolean | null } | null;
  supervisor: { recoveryCount: number; recentFailures: number } | null;
  mechanisms: ContinuityMechanism[];
  unavailable: OperationsUnavailable[];
}

/* ── business processes (registry names × the MINED reality) ──────────────── */

export interface MinedProcessMetrics {
  type: string;
  cases: number;
  medianDurationMs: number | null;
  onTimeRate: number | null;
}

export interface BusinessProcessRow {
  processId: string;
  name: string;
  domain: string;
  minedType: string | null;
  /** Joined metrics from the EXISTING assessment, or null (not mined). */
  metrics: MinedProcessMetrics | null;
  status: 'mined' | 'not-mined' | 'unregistered';
}

export interface BusinessProcessReport {
  generatedAt: string;
  rows: BusinessProcessRow[];
  gaps: OperationsGap[];
  totals: { registered: number; mined: number; unregistered: number };
  unavailable: OperationsUnavailable[];
}

/* ── KPI catalog (catalog the EXISTING producers — no metrics engine) ─────── */

export interface KpiCatalogRow {
  key: string;
  label: string;
  display: string;
  value: number | null;
  band: string | null;
  /** Which existing producer surfaced it. */
  source: string;
}

/* ── the dashboard ────────────────────────────────────────────────────────── */

export interface OperationsDashboard {
  generatedAt: string;
  catalog: { services: number; operational: number; degraded: number; failed: number; unknown: number; gaps: number };
  health: { overall: number | null; band: string; domains: { key: OperationalDomainKey; band: string }[] };
  sla: { targets: number; met: number; breached: number; unmeasurable: number };
  readiness: { ready: number; degraded: number; notReady: number; unknown: number };
  incidents: { open: number; critical: number };
  capacity: { pressure: CapacityView['pressure']; bottlenecks: number };
  continuity: { score: number | null; validations: number; localBackups: number | null };
  kpis: KpiCatalogRow[];
  objectives: { id: string; label: string; reviewCadence: string; owner: ServiceOwnerRef | null }[];
  recommendations: OperationsRecommendation[];
  disclosures: string[];
  unavailable: OperationsUnavailable[];
}

/* ── assistant questions (D-8: ten resolvers) ─────────────────────────────── */

export type OperationsQuestionKey =
  | 'ops-status'
  | 'service-health'
  | 'bottlenecks'
  | 'readiness'
  | 'continuity'
  | 'incidents'
  | 'sla'
  | 'business-impact'
  | 'capacity'
  | 'ops-planning';

export const OPERATIONS_QUESTION_KEYS: readonly OperationsQuestionKey[] = [
  'ops-status',
  'service-health',
  'bottlenecks',
  'readiness',
  'continuity',
  'incidents',
  'sla',
  'business-impact',
  'capacity',
  'ops-planning',
] as const;
