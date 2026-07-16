/**
 * Global AI Orchestration Platform (P17) — view-model types.
 *
 * P17 is a READ-ONLY coordination / routing LAYER. It is NOT a new runtime, worker runtime, execution
 * engine, scheduler, graph, memory, or search: it ORCHESTRATES the existing systems by projecting how
 * enterprise goals ROUTE to existing workers (reusing the shipped delegation matcher `scoreCandidate` /
 * `isEligible`), how load DISTRIBUTES across the workforce (reusing `workforceIntelligence`), and how
 * cloud / knowledge / marketplace / federation COORDINATE — plus the knowledge (context / evidence /
 * lineage / confidence) delivered to every orchestration decision. Every route respects the EXISTING
 * approval chains; the layer plans and visualizes but EXECUTES nothing (dispatch/approval stay with the
 * existing Workforce Runtime + ExecuteEngine). Names are prefixed `Orchestration*` (verified
 * collision-free). It reuses the platform `ExecutiveKpi` type unmodified.
 */
import type { ExecutiveKpi } from './executiveCenter';

/** Health / confidence band, mirrored locally. */
export type OrchestrationBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/* ── Orchestrators (the nine coordinators, each a projection of an existing system) ── */

export interface OrchestratorStatus {
  id: string;
  name: string;
  /** What this orchestrator coordinates. */
  coordinates: string;
  entityCount: number;
  band: OrchestrationBand;
  live: boolean;
  /** The existing system this orchestrator projects from (provenance). */
  source: string;
  note: string;
}

/* ── Flows (the six orchestration flows for the dashboard) ── */

export interface OrchestrationFlow {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Count flowing through this lane. */
  volume: number;
  band: OrchestrationBand;
  note: string;
}

export interface OrchestrationFlowReport {
  flows: OrchestrationFlow[];
  note: string;
}

/* ── Goal routing (route goals to existing workers, respecting existing approval) ── */

export interface GoalRoute {
  id: string;
  /** The plan step being routed (from the existing Strategy planning engine). */
  goal: string;
  /** The capability the step needs (the plan action) — the routing key. */
  capability: string;
  /** The worker capability pool this goal routes to. */
  targetRole: string;
  /** Workers in the target-role pool. */
  poolSize: number;
  /** Eligible candidates (not stopped/errored). */
  eligibleCount: number;
  /** Best delegation-match score (0..1) from the EXISTING matcher — a plan, not an assignment. */
  topMatchScore: number;
  band: OrchestrationBand;
  /** Whether an approval chain governs this route (from the existing approval system). */
  approvalGoverned: boolean;
  approvalChain: string | null;
  approvalSteps: number;
  evidenceCount: number;
  /** True when eligible candidates exist — the goal CAN be routed (it is not executed here). */
  routable: boolean;
  note: string;
}

export interface OrchestrationGoalRouting {
  routes: GoalRoute[];
  total: number;
  routable: number;
  governed: number;
  ungoverned: number;
  note: string;
}

/* ── Global workforce coordination (load distribution + capability pools + cross-org) ── */

export interface CapabilityPool {
  role: string;
  workers: number;
  eligible: number;
  /** Mean trust across the pool, 0..1. */
  avgTrust: number;
  band: OrchestrationBand;
}

export interface WorkforceLoad {
  totalWorkers: number;
  activeWorkers: number;
  inFlight: number;
  /** 0..1. */
  overallSuccessRate: number;
  busiestRole: string | null;
  bottleneckCount: number;
}

export interface OrchestrationBottleneck {
  scope: string;
  kind: string;
  reason: string;
  value: number;
  sampleSize: number;
}

export interface OrgCoordination {
  orgId: string;
  orgName: string;
  units: number;
  workers: number;
}

export interface OrchestrationWorkforce {
  pools: CapabilityPool[];
  load: WorkforceLoad;
  bottlenecks: OrchestrationBottleneck[];
  orgs: OrgCoordination[];
  note: string;
}

/* ── Cloud coordination (regions / clusters / deployments / capacity) ── */

export interface RegionCoordination {
  id: string;
  name: string;
  available: boolean;
  deployments: number;
  healthyDeployments: number;
  replication: string;
  band: OrchestrationBand;
}

export interface DeploymentCoordination {
  service: string;
  region: string;
  status: string;
  gate: string;
  uptimePct: number;
  band: OrchestrationBand;
}

export interface CapacityRow {
  resource: string;
  utilizationPct: number;
  band: OrchestrationBand;
}

export interface OrchestrationCloud {
  fleetStatus: string;
  fleetScore: number;
  band: OrchestrationBand;
  regions: RegionCoordination[];
  deployments: DeploymentCoordination[];
  capacity: CapacityRow[];
  monthlySpend: number;
  currency: string;
  note: string;
}

/* ── Knowledge coordination (context / evidence / lineage / confidence to decisions) ── */

export interface KnowledgeDelivery {
  decisionKind: string;
  count: number;
  /** 0..1. */
  avgConfidence: number;
  band: OrchestrationBand;
}

export interface OrchestrationKnowledge {
  explanations: number;
  /** 0..100. */
  evidenceCoverage: number;
  /** 0..1. */
  avgConfidence: number;
  confidenceBand: OrchestrationBand;
  delivered: KnowledgeDelivery[];
  lineageStages: { stage: string; count: number }[];
  note: string;
}

/* ── Cross-system coordination (marketplace / federation / industry / developer) ── */

export interface CoordinatedSystem {
  id: string;
  name: string;
  status: string;
  entityCount: number;
  band: OrchestrationBand;
  live: boolean;
  note: string;
}

export interface OrchestrationCoordination {
  systems: CoordinatedSystem[];
  marketplace: { published: number; certified: number; total: number; installs: number };
  federation: { peers: number; activePeers: number; trustedPeers: number; canShareWorkers: number; sharedOut: number; sharedIn: number };
  note: string;
}

/* ── Governance (reuses RBAC / Governance / Approval — never bypass) ── */

export interface ApprovalGateRow {
  capability: string;
  governed: boolean;
  chain: string | null;
  steps: number;
}

export interface OrchScopeRow {
  system: string;
  permission: string;
}

export interface OrchestrationGovernance {
  orchestrationScope: string;
  /** The load-bearing assertion: orchestration routes are advisory and never bypass governance. */
  neverBypass: string;
  approvalGates: ApprovalGateRow[];
  scopes: OrchScopeRow[];
  redactions: string[];
  governedRoutes: number;
  ungovernedRoutes: number;
  note: string;
}

/* ── Summary + overview bundle ── */

export interface OrchestrationSummary {
  generatedAt: string;
  orchestrators: number;
  liveOrchestrators: number;
  coordinatedEntities: number;
  routableGoals: number;
  governedRoutes: number;
  totalWorkers: number;
  overallHealth: number;
  healthBand: OrchestrationBand;
}

export interface OrchestrationOverview {
  summary: OrchestrationSummary;
  orchestrators: OrchestratorStatus[];
  flows: OrchestrationFlow[];
  /** Strategic KPIs reused from the platform ExecutiveKpi type (traceable, never recomputed). */
  kpis: ExecutiveKpi[];
}
