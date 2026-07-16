/**
 * Global AI Orchestration Platform (P17) — the pure projection model.
 *
 * All non-trivial orchestration logic lives here (the house pure-model pattern) so it is unit-tested
 * under Node with no I/O. It projects a composed snapshot of the EXISTING platform — the P14 Strategy
 * planning/approval engine, the AI Workforce runtime (registry + jobs + the shipped delegation matcher),
 * the P11 Cloud Control Plane, the P16 Knowledge Fabric, the P15 Digital Twin, the Marketplace, and
 * Federation — into unified orchestration VIEW MODELS: goal routing (reusing `scoreCandidate` /
 * `isEligible`), workforce coordination (reusing `workforceIntelligence`), cloud coordination, knowledge
 * delivery, cross-system coordination, the six flows, and a governance posture. It ROUTES and VISUALIZES
 * but EXECUTES nothing — dispatch/approval stay with the existing Workforce Runtime + ExecuteEngine, and
 * every route respects the existing approval chains. It introduces NO new runtime, engine, or scheduler.
 */
import {
  isEligible,
  scoreCandidate,
  type ApprovalGateRow,
  type CapabilityPool,
  type CapacityRow,
  type CoordinatedSystem,
  type DelegationCandidate,
  type DelegationTaskInput,
  type DeploymentCoordination,
  type ExecutiveKpi,
  type GoalRoute,
  type KnowledgeDelivery,
  type OrchScopeRow,
  type OrchestrationBand,
  type OrchestrationBottleneck,
  type OrchestrationCloud,
  type OrchestrationCoordination,
  type OrchestrationFlow,
  type OrchestrationFlowReport,
  type OrchestrationGoalRouting,
  type OrchestrationGovernance,
  type OrchestrationKnowledge,
  type OrchestrationOverview,
  type OrchestrationSummary,
  type OrchestrationWorkforce,
  type OrchestratorStatus,
  type OrgCoordination,
  type RegionCoordination,
  type WorkerRole,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the service from live sources) ── */

export interface OrchestrationRouteStep {
  id: string;
  label: string;
  /** The plan action (the routing key). */
  action: string;
  approvalGoverned: boolean;
  approvalChain: string | null;
  approvalSteps: number;
  evidenceCount: number;
}

export interface OrchestrationState {
  generatedAt: string;
  health: { overall: number; band: OrchestrationBand };
  /** Ready-to-route plan steps from the EXISTING Strategy planning engine. */
  routeSteps: OrchestrationRouteStep[];
  /** Worker candidates for the EXISTING delegation matcher (identity redacted downstream). */
  candidates: DelegationCandidate[];
  workforce: {
    summaries: { role: WorkerRole; lifecycle: DelegationCandidate['lifecycle']; trustScore: number }[];
    activeWorkers: number;
    inFlight: number;
    overallSuccessRate: number;
    bottlenecks: { scope: string; kind: string; reason: string; value: number; sampleSize: number }[];
    orgs: { orgId: string; orgName: string; units: number; workers: number }[];
  };
  cloud: {
    fleetStatus: string;
    fleetScore: number;
    regions: { id: string; name: string; available: boolean; deployments: number; healthyDeployments: number; replication: string; health: string }[];
    deployments: { service: string; region: string; status: string; gate: string; uptimePct: number }[];
    quotas: { resource: string; utilizationPct: number }[];
    monthlySpend: number;
    currency: string;
  };
  knowledge: {
    explanations: number;
    evidenceCoverage: number;
    avgConfidence: number;
    byKind: { kind: string; count: number; avgConfidence: number }[];
    lineageStages: { stage: string; count: number }[];
  };
  marketplace: { published: number; certified: number; total: number; installs: number };
  federation: { peers: number; activePeers: number; trustedPeers: number; canShareWorkers: number; sharedOut: number; sharedIn: number };
  industry: { live: boolean };
  developer: { live: boolean };
  kpis: ExecutiveKpi[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);
const clamp01 = (n: number): number => (!Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n);

export function confBand(c: number): OrchestrationBand {
  return c >= 0.75 ? 'healthy' : c >= 0.5 ? 'watch' : c >= 0.25 ? 'at-risk' : 'critical';
}
/** Good/total ratio → band; an empty pool reads 'watch', not the alarmist 'critical'. */
export function ratioBand(good: number, total: number): OrchestrationBand {
  if (total <= 0) return 'watch';
  const p = good / total;
  return p >= 0.9 ? 'healthy' : p >= 0.6 ? 'watch' : p >= 0.3 ? 'at-risk' : 'critical';
}
function fleetBand(status: string): OrchestrationBand {
  // down / unavailable (a failed read) assume-worst → critical; never a false green.
  return status === 'healthy' ? 'healthy' : status === 'degraded' ? 'at-risk' : 'critical';
}
const titleRole = (r: string): string => (r ? r.charAt(0).toUpperCase() + r.slice(1) : r);

/** Map a plan action to the worker capability pool (role) it routes to. Substring-matched for robustness. */
export function actionToRole(action: string): WorkerRole {
  const a = (action || '').toLowerCase();
  if (a.includes('cloud') || a.includes('infra')) return 'infrastructure';
  if (a.includes('workforce') || a.includes('staff') || a.includes('hire') || a.includes('headcount')) return 'hr';
  if (a.includes('governance') || a.includes('compliance') || a.includes('policy')) return 'legal';
  if (a.includes('budget') || a.includes('spend') || a.includes('cost')) return 'finance';
  if (a.includes('risk') || a.includes('security') || a.includes('mitigate')) return 'engineering';
  if (a.includes('growth') || a.includes('revenue') || a.includes('sales')) return 'sales';
  return 'operations';
}

/* ── Goal routing (reuses the shipped delegation matcher — a PLAN, never an execution) ── */

export function buildOrchestrationGoals(s: OrchestrationState): OrchestrationGoalRouting {
  const routes: GoalRoute[] = s.routeSteps
    .map((step) => {
      const targetRole = actionToRole(step.action);
      const task: DelegationTaskInput = { id: step.id, title: step.label, role: targetRole };
      // Scope routing to the target capability pool — eligibility is a SUBSET of the pool, so a goal is
      // never "routable" to an empty pool and eligibleCount never exceeds poolSize.
      const pool = s.candidates.filter((c) => c.role === targetRole);
      const eligible = pool.filter((c) => isEligible(task, c));
      // Band from the DISPLAYED (rounded) score so the badge never disagrees with the shown percentage.
      const score = Number(clamp01(eligible.reduce((mx, c) => Math.max(mx, scoreCandidate(task, c).total), 0)).toFixed(2));
      const routable = eligible.length > 0;
      return {
        id: step.id,
        goal: step.label,
        capability: step.action,
        targetRole,
        poolSize: pool.length,
        eligibleCount: eligible.length,
        topMatchScore: score,
        band: routable ? confBand(score) : 'at-risk',
        approvalGoverned: step.approvalGoverned,
        approvalChain: step.approvalChain,
        approvalSteps: step.approvalSteps,
        evidenceCount: step.evidenceCount,
        routable,
        note: step.approvalGoverned
          ? `Routes to the ${titleRole(targetRole)} pool under approval chain “${step.approvalChain}” (${step.approvalSteps} step${step.approvalSteps === 1 ? '' : 's'}) — advisory plan, not executed.`
          : `Routes to the ${titleRole(targetRole)} pool — no approval chain governs this action; surfaced as an ungoverned route (advisory only, never executed).`,
      };
    })
    .sort((a, b) => b.topMatchScore - a.topMatchScore || a.id.localeCompare(b.id));
  const governed = routes.filter((r) => r.approvalGoverned).length;
  return {
    routes,
    total: routes.length,
    routable: routes.filter((r) => r.routable).length,
    governed,
    ungoverned: routes.length - governed,
    note: 'Enterprise goals routed to existing worker capability pools using the shipped delegation matcher (scoreCandidate / isEligible). Every route respects the existing approval chain; this is an advisory PLAN — the orchestration layer dispatches and executes nothing.',
  };
}

/* ── Global workforce coordination (load distribution + capability pools + cross-org) ── */

export function buildOrchestrationWorkforce(s: OrchestrationState): OrchestrationWorkforce {
  const byRole = new Map<string, { workers: number; eligible: number; trustSum: number }>();
  for (const w of s.workforce.summaries) {
    const e = byRole.get(w.role) ?? { workers: 0, eligible: 0, trustSum: 0 };
    e.workers += 1;
    if (w.lifecycle !== 'stopped' && w.lifecycle !== 'errored') e.eligible += 1;
    e.trustSum += clamp01(w.trustScore);
    byRole.set(w.role, e);
  }
  const pools: CapabilityPool[] = [...byRole.entries()]
    .map(([role, e]) => ({ role, workers: e.workers, eligible: e.eligible, avgTrust: Number((e.workers ? e.trustSum / e.workers : 0).toFixed(2)), band: ratioBand(e.eligible, e.workers) }))
    .sort((a, b) => b.workers - a.workers || a.role.localeCompare(b.role));
  const bottlenecks: OrchestrationBottleneck[] = s.workforce.bottlenecks.map((b) => ({ scope: b.scope, kind: b.kind, reason: b.reason, value: b.value, sampleSize: b.sampleSize }));
  const orgs: OrgCoordination[] = [...s.workforce.orgs].sort((a, b) => b.workers - a.workers || a.orgName.localeCompare(b.orgName));
  return {
    pools,
    load: {
      totalWorkers: s.workforce.summaries.length,
      activeWorkers: s.workforce.activeWorkers,
      inFlight: s.workforce.inFlight,
      overallSuccessRate: Number(clamp01(s.workforce.overallSuccessRate).toFixed(2)),
      busiestRole: pools[0]?.role ?? null,
      bottleneckCount: bottlenecks.length,
    },
    bottlenecks,
    orgs,
    note: 'Workforce coordination projected from the AI Workforce runtime — capability pools by role, load from the shipped workforceIntelligence deriver, and cross-organization/department structure from the org store. Aggregate only; per-worker management stays in the Workforce Center. No new runtime.',
  };
}

/* ── Cloud coordination (regions / clusters / deployments / capacity) ── */

export function buildOrchestrationCloud(s: OrchestrationState): OrchestrationCloud {
  const regions: RegionCoordination[] = s.cloud.regions.map((r) => ({
    id: r.id,
    name: r.name,
    available: r.available,
    deployments: r.deployments,
    healthyDeployments: r.healthyDeployments,
    replication: r.replication,
    band: !r.available ? 'critical' : fleetBand(r.health),
  }));
  const deployments: DeploymentCoordination[] = s.cloud.deployments
    .map((d) => ({ service: d.service, region: d.region, status: d.status, gate: d.gate, uptimePct: round(d.uptimePct), band: d.gate === 'ok' ? 'healthy' : d.gate === 'degraded' ? 'at-risk' : 'critical' as OrchestrationBand }))
    .sort((a, b) => a.uptimePct - b.uptimePct || a.service.localeCompare(b.service))
    .slice(0, 30);
  const capacity: CapacityRow[] = s.cloud.quotas
    .map((q) => ({ resource: q.resource, utilizationPct: round(q.utilizationPct), band: q.utilizationPct >= 90 ? 'critical' : q.utilizationPct >= 75 ? 'at-risk' : q.utilizationPct >= 50 ? 'watch' : 'healthy' as OrchestrationBand }))
    .sort((a, b) => b.utilizationPct - a.utilizationPct || a.resource.localeCompare(b.resource));
  return {
    fleetStatus: s.cloud.fleetStatus,
    fleetScore: round(s.cloud.fleetScore),
    band: fleetBand(s.cloud.fleetStatus),
    regions,
    deployments,
    capacity,
    monthlySpend: round(s.cloud.monthlySpend),
    currency: s.cloud.currency,
    note: 'Cloud coordination projected from the Cloud Control Plane — regions, deployments (advisory gates), and capacity/quota utilization. Deployment promotion + execution stay with the control plane; this is a read-only coordination view.',
  };
}

/* ── Knowledge coordination (context / evidence / lineage / confidence to decisions) ── */

export function buildOrchestrationKnowledge(s: OrchestrationState): OrchestrationKnowledge {
  const delivered: KnowledgeDelivery[] = s.knowledge.byKind
    .map((k) => ({ decisionKind: k.kind, count: k.count, avgConfidence: Number(clamp01(k.avgConfidence).toFixed(2)), band: confBand(k.avgConfidence) }))
    .sort((a, b) => b.count - a.count || a.decisionKind.localeCompare(b.decisionKind));
  return {
    explanations: s.knowledge.explanations,
    evidenceCoverage: round(s.knowledge.evidenceCoverage),
    avgConfidence: Number(clamp01(s.knowledge.avgConfidence).toFixed(2)),
    confidenceBand: confBand(s.knowledge.avgConfidence),
    delivered,
    lineageStages: s.knowledge.lineageStages.map((l) => ({ stage: l.stage, count: l.count })),
    note: 'Knowledge delivered to every orchestration decision from the P16 Knowledge Fabric — context (reasoning + sources), evidence (resolved refs), lineage (origin → transformation → usage → consumers), and confidence. Reused unmodified; the fabric already explains the strategy decisions this layer routes.',
  };
}

/* ── Cross-system coordination (marketplace / federation / industry / developer) ── */

export function buildOrchestrationCoordination(s: OrchestrationState): OrchestrationCoordination {
  const systems: CoordinatedSystem[] = [
    { id: 'marketplace', name: 'Marketplace', status: `${s.marketplace.certified}/${s.marketplace.published} certified`, entityCount: s.marketplace.total, band: s.marketplace.published > 0 ? ratioBand(s.marketplace.certified, s.marketplace.published) : 'watch', live: s.marketplace.published > 0, note: 'Package catalog coordination.' },
    { id: 'federation', name: 'Federation', status: `${s.federation.activePeers}/${s.federation.peers} active peers`, entityCount: s.federation.peers, band: s.federation.peers > 0 ? ratioBand(s.federation.activePeers, s.federation.peers) : 'watch', live: s.federation.peers > 0, note: 'Cross-organization coordination.' },
    { id: 'industry', name: 'Industry Packs', status: s.industry.live ? 'registered' : 'not populated', entityCount: 0, band: 'watch', live: s.industry.live, note: 'Solution-pack coordination.' },
    { id: 'developer', name: 'Developer Platform', status: s.developer.live ? 'registered' : 'not populated', entityCount: 0, band: 'watch', live: s.developer.live, note: 'Developer registry coordination.' },
  ];
  return {
    systems,
    marketplace: { published: s.marketplace.published, certified: s.marketplace.certified, total: s.marketplace.total, installs: s.marketplace.installs },
    federation: { peers: s.federation.peers, activePeers: s.federation.activePeers, trustedPeers: s.federation.trustedPeers, canShareWorkers: s.federation.canShareWorkers, sharedOut: s.federation.sharedOut, sharedIn: s.federation.sharedIn },
    note: 'Cross-system coordination — marketplace packages and federated peer organizations (with worker/data-sharing trust flags), plus industry + developer platforms. Read-only projection; no system is duplicated.',
  };
}

/* ── The six orchestration flows ── */

export function buildOrchestrationFlows(s: OrchestrationState): OrchestrationFlow[] {
  const goals = buildOrchestrationGoals(s);
  const totalWorkers = s.workforce.summaries.length;
  const activeW = Math.min(s.workforce.activeWorkers, totalWorkers); // clamp: active is a subset of total
  return [
    { id: 'goal', name: 'Goal Flow', from: 'Strategy Platform', to: 'Workforce', volume: goals.routable, band: s.health.band, note: 'Enterprise goals routable to worker capability pools (via existing planning + approval).' },
    { id: 'worker', name: 'Worker Flow', from: 'Workforce', to: 'Execution Runtime', volume: s.workforce.inFlight, band: totalWorkers > 0 ? ratioBand(activeW, totalWorkers) : 'watch', note: 'In-flight worker jobs (dispatch/execution stays with the runtime).' },
    { id: 'knowledge', name: 'Knowledge Flow', from: 'Knowledge Fabric', to: 'Orchestration Decisions', volume: s.knowledge.explanations, band: confBand(s.knowledge.avgConfidence), note: 'Context/evidence/lineage/confidence delivered to decisions.' },
    { id: 'cloud', name: 'Cloud Flow', from: 'Control Plane', to: 'Deployments', volume: s.cloud.deployments.length, band: fleetBand(s.cloud.fleetStatus), note: 'Cloud regions/deployments/capacity coordination.' },
    { id: 'marketplace', name: 'Marketplace Flow', from: 'Marketplace', to: 'Installs', volume: s.marketplace.installs, band: s.marketplace.published > 0 ? ratioBand(s.marketplace.certified, s.marketplace.published) : 'watch', note: 'Package catalog + installs coordination.' },
    { id: 'federation', name: 'Federation Flow', from: 'Federation', to: 'Peer Orgs', volume: s.federation.activePeers, band: s.federation.peers > 0 ? ratioBand(s.federation.activePeers, s.federation.peers) : 'watch', note: 'Cross-organization sharing coordination.' },
  ];
}

export function buildOrchestrationFlowReport(s: OrchestrationState): OrchestrationFlowReport {
  return {
    flows: buildOrchestrationFlows(s),
    note: 'The six orchestration flows for the global dashboard — each lane projects volume + health from an existing system; nothing flows through a new runtime.',
  };
}

/* ── The nine orchestrators ── */

export function buildOrchestrators(s: OrchestrationState): OrchestratorStatus[] {
  const goals = buildOrchestrationGoals(s);
  const workerCount = s.workforce.summaries.length;
  const activeW = Math.min(s.workforce.activeWorkers, workerCount); // clamp to the registry population
  const deployCount = s.cloud.deployments.length;
  // Healthy deployments from the SAME deployment list as the denominator (consistent population).
  const healthyDeploys = s.cloud.deployments.filter((d) => d.status === 'healthy').length;
  return [
    { id: 'global', name: 'Global Orchestrator', coordinates: 'Every enterprise capability', entityCount: goals.total + workerCount + s.cloud.deployments.length + s.marketplace.total + s.federation.peers, band: s.health.band, live: true, source: 'Composed over all systems', note: 'The unified coordination layer.' },
    { id: 'goal', name: 'Goal Orchestrator', coordinates: 'Enterprise goals → workers', entityCount: goals.total, band: goals.total > 0 ? ratioBand(goals.routable, goals.total) : 'watch', live: goals.total > 0, source: 'P14 Strategy planning + approval', note: 'Routes goals via the existing matcher.' },
    { id: 'workforce', name: 'Workforce Orchestrator', coordinates: 'Workers across orgs/departments', entityCount: workerCount, band: workerCount > 0 ? ratioBand(activeW, workerCount) : 'watch', live: workerCount > 0, source: 'AI Workforce runtime', note: 'Load distribution + capability pools.' },
    { id: 'cloud', name: 'Cloud Orchestrator', coordinates: 'Regions / clusters / capacity', entityCount: s.cloud.regions.length, band: fleetBand(s.cloud.fleetStatus), live: s.cloud.regions.length > 0, source: 'P11 Cloud Control Plane', note: 'Region + capacity coordination.' },
    { id: 'knowledge', name: 'Knowledge Orchestrator', coordinates: 'Context/evidence to decisions', entityCount: s.knowledge.explanations, band: confBand(s.knowledge.avgConfidence), live: s.knowledge.explanations > 0, source: 'P16 Knowledge Fabric', note: 'Delivers knowledge to decisions.' },
    { id: 'marketplace', name: 'Marketplace Orchestrator', coordinates: 'Package catalog', entityCount: s.marketplace.total, band: s.marketplace.published > 0 ? ratioBand(s.marketplace.certified, s.marketplace.published) : 'watch', live: s.marketplace.published > 0, source: 'Enterprise Marketplace', note: 'Catalog coordination.' },
    { id: 'federation', name: 'Federation Orchestrator', coordinates: 'Cross-org peers + trust', entityCount: s.federation.peers, band: s.federation.peers > 0 ? ratioBand(s.federation.activePeers, s.federation.peers) : 'watch', live: s.federation.peers > 0, source: 'Federation runtime', note: 'Peer/trust coordination.' },
    { id: 'deployment', name: 'Deployment Orchestrator', coordinates: 'Service deployments', entityCount: deployCount, band: deployCount > 0 ? ratioBand(healthyDeploys, deployCount) : 'watch', live: deployCount > 0, source: 'P11 Cloud Control Plane', note: 'Deployment status (advisory gates).' },
    { id: 'operations', name: 'Operations Orchestrator', coordinates: 'Enterprise health + governance', entityCount: round(s.health.overall), band: s.health.band, live: true, source: 'P7 Enterprise Intelligence', note: 'Monitoring + governance posture.' },
  ];
}

/* ── Governance (reuses RBAC / Governance / Approval — never bypass) ── */

export function buildOrchestrationGovernance(s: OrchestrationState): OrchestrationGovernance {
  const goals = buildOrchestrationGoals(s);
  const gateMap = new Map<string, ApprovalGateRow>();
  for (const r of goals.routes) {
    const prev = gateMap.get(r.capability);
    if (!prev) {
      gateMap.set(r.capability, { capability: r.capability, governed: r.approvalGoverned, chain: r.approvalChain, steps: r.approvalSteps });
    } else if (prev.governed && !r.approvalGoverned) {
      // Any ungoverned instance downgrades the gate — surface the governance gap, never hide it.
      gateMap.set(r.capability, { capability: r.capability, governed: false, chain: null, steps: 0 });
    }
  }
  const approvalGates = [...gateMap.values()].sort((a, b) => a.capability.localeCompare(b.capability));
  const scopes: OrchScopeRow[] = [
    { system: 'Goal routing (Strategy)', permission: 'strategy:read' },
    { system: 'Workforce coordination', permission: 'workforce:read' },
    { system: 'Cloud coordination', permission: 'cloud:read' },
    { system: 'Knowledge delivery', permission: 'knowledge:read' },
    { system: 'Marketplace coordination', permission: 'marketplace:read' },
    { system: 'Federation coordination', permission: 'federation:read' },
  ].sort((a, b) => a.system.localeCompare(b.system));
  return {
    orchestrationScope: 'orchestration:read',
    neverBypass: 'Orchestration routes are ADVISORY plans. Every route surfaces its approval requirement; the layer never dispatches, approves, or executes — dispatch and approval stay with the existing Workforce Runtime + ExecuteEngine and their governance chains.',
    approvalGates,
    scopes,
    redactions: [
      'Worker identities are redacted in routing/coordination — only capability pools, ranks, and match scores are projected (per-worker management stays in the Workforce Center under workforce:read).',
      'Bottleneck subject keys are redacted to scope + kind; no worker/skill id is exposed.',
      'Ungoverned routes (no approval chain) are surfaced, never hidden — the layer flags governance gaps rather than bypassing them.',
      "Organizations expose the tenant's own org-chart names with aggregate worker counts only (co-scoped with org:read); federated peers are counts only — no worker or peer identity is exposed.",
    ],
    governedRoutes: goals.governed,
    ungovernedRoutes: goals.ungoverned,
    note: 'Orchestration governance reuses the existing RBAC, approval, and audit spine. All channels require orchestration:read; each coordinated system keeps its own production scope. The layer adds no new governance engine and bypasses none.',
  };
}

/* ── Summary + overview bundle ── */

export function buildOrchestrationSummary(s: OrchestrationState): OrchestrationSummary {
  const orchestrators = buildOrchestrators(s);
  const goals = buildOrchestrationGoals(s);
  return {
    generatedAt: s.generatedAt,
    orchestrators: orchestrators.length,
    liveOrchestrators: orchestrators.filter((o) => o.live).length,
    coordinatedEntities: s.workforce.summaries.length + s.cloud.deployments.length + s.marketplace.total + s.federation.peers + s.knowledge.explanations + goals.total,
    routableGoals: goals.routable,
    governedRoutes: goals.governed,
    totalWorkers: s.workforce.summaries.length,
    overallHealth: round(s.health.overall),
    healthBand: s.health.band,
  };
}

export function buildOrchestrationOverview(s: OrchestrationState): OrchestrationOverview {
  return {
    summary: buildOrchestrationSummary(s),
    orchestrators: buildOrchestrators(s),
    flows: buildOrchestrationFlows(s),
    kpis: s.kpis,
  };
}
