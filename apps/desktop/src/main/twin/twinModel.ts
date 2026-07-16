/**
 * Enterprise Digital Twin (P15) — the pure projection model.
 *
 * All non-trivial twin logic lives here (the house pure-model pattern) so it is unit-tested under
 * Node with no I/O. It projects a composed snapshot of the EXISTING platform — the P7 Enterprise
 * Intelligence report (graph summary / health / risk / dependencies), the Cloud Control Plane, the AI
 * Workforce, Connectors, the Marketplace, Federation, and the P14 Strategy Platform (goals /
 * simulations / decisions) — plus filtered windows over the EXISTING platform timeline — into unified
 * Digital Twin VIEW MODELS: domain twins, a domain-level topology, a health map, a blast-radius impact
 * view, a scenario center (P14's SimulationReport passed through UNMODIFIED), a timeline replay, and an
 * executive command center. It renders and models the enterprise but executes nothing, mutates
 * nothing, and introduces NO new graph, timeline, or simulation engine.
 */
import type {
  EnterpriseIntelligenceReport,
  EnterpriseTwinDomain,
  EnterpriseTwinOverview,
  ExecutiveKpi,
  ExecutiveTwin,
  SimulationReport,
  TwinBand,
  TwinCommandCenter,
  TwinDomains,
  TwinHealthMap,
  TwinImpact,
  TwinReplay,
  TwinReplayKind,
  TwinScenarioCenter,
  TwinSummary,
  TwinTopology,
  TwinTopologyLayer,
  TwinTopologyLink,
  TwinTopologyNode,
} from '@neuropause/shared';

/* ── The composed snapshot the projections read (assembled by the service from live sources) ── */

export interface TwinReplayInput {
  kind: TwinReplayKind;
  label: string;
  since: string;
  until: string;
  total: number;
  note: string;
  frames: { id: string; at: string; type: string; category: string; priority: string; source: string; resource: string | null }[];
}

export interface TwinState {
  generatedAt: string;
  org: { orgs: number; units: number; users: number; humans: number; workers: number };
  cloud: { deployments: number; healthyDeployments: number; regions: number; fleetStatus: string; fleetScore: number; monthlySpend: number; currency: string };
  workforce: { total: number; healthy: number; degraded: number; unhealthy: number; state: string; successRate: number };
  application: { deployments: number; healthy: number; avgUptimePct: number };
  connectors: { total: number; connected: number; healthy: number; degraded: number; down: number };
  marketplace: { published: number; certified: number; total: number };
  federation: { peers: number; activePeers: number; trustedPeers: number };
  strategy: { goalsTotal: number; goalsOnTrack: number; overallProgress: number; openDecisions: number; requiresApproval: number; healthBand: TwinBand };
  health: { overall: number; band: TwinBand; scores: { key: string; label: string; score: number; band: TwinBand; factors: string[] }[]; byKey: Record<string, number> };
  risk: { overall: number; band: TwinBand };
  graph: { nodes: number; edges: number; byDomain: Record<string, number>; crossDomainEdges: number; truncated: boolean };
  dependencies: {
    criticalCount: number;
    cyclic: boolean;
    spofs: { domain: string; blastRadius: number; dependents: number; risk: number | null }[];
    failureChains: { domains: string[] }[];
    cycles: { domains: string[] }[];
  };
  reportKpis: ExecutiveKpi[];
  strategyKpis: ExecutiveKpi[];
  simulation: SimulationReport;
  replay: TwinReplayInput[];
}

/* ── helpers ── */

const round = (n: number): number => Math.round(n);

function goodnessBand(score: number): TwinBand {
  return score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at-risk' : 'critical';
}
function fleetBand(status: string): TwinBand {
  return status === 'healthy' ? 'healthy' : status === 'degraded' ? 'at-risk' : 'critical';
}
function workforceBand(state: string): TwinBand {
  return state === 'healthy' ? 'healthy' : state === 'degraded' ? 'watch' : state === 'unhealthy' ? 'at-risk' : 'watch';
}
/** Health from a good/total ratio; an empty (not-yet-populated) domain reads 'watch', not 'critical'. */
function ratioBand(good: number, total: number): TwinBand {
  if (total <= 0) return 'watch';
  const pct = good / total;
  return pct >= 0.9 ? 'healthy' : pct >= 0.6 ? 'watch' : pct >= 0.3 ? 'at-risk' : 'critical';
}

const DOMAIN_LABEL: Record<string, string> = {
  infrastructure: 'Infrastructure',
  identity: 'Identity',
  security: 'Security',
  crm: 'CRM',
  finance: 'Finance',
  sales: 'Sales',
  operations: 'Operations',
  people: 'People',
  knowledge: 'Knowledge',
  automation: 'Automation',
  business: 'Business',
  unknown: 'Other',
};
const domainLabel = (d: string): string => DOMAIN_LABEL[d] ?? d.charAt(0).toUpperCase() + d.slice(1);

/* ── Report projection (assume-worst when the enterprise report is unavailable) ── */

export interface ReportProjection {
  health: TwinState['health'];
  risk: TwinState['risk'];
  graph: TwinState['graph'];
  dependencies: TwinState['dependencies'];
  reportKpis: ExecutiveKpi[];
  /** The report's generation timestamp, or null when the report is unavailable. */
  generatedAt: string | null;
}

/**
 * Project the P7 Enterprise Intelligence report into twin fields. A NULL / unavailable report ASSUMES
 * WORST — health 0/critical and risk maxed (100/critical, since *low* risk is the good direction) — so a
 * failed or missing read NEVER paints a falsely-healthy or falsely-low-risk enterprise. Dependency SPOFs
 * are projected WITHOUT their identifying id/label (aggregate domain + blast metrics only); named
 * drill-down stays behind the intelligence-scoped change-impact engine, which the twin never bypasses.
 */
export function projectReport(report: EnterpriseIntelligenceReport | null): ReportProjection {
  if (!report) {
    return {
      health: { overall: 0, band: 'critical', scores: [], byKey: {} },
      risk: { overall: 100, band: 'critical' },
      graph: { nodes: 0, edges: 0, byDomain: {}, crossDomainEdges: 0, truncated: false },
      dependencies: { criticalCount: 0, cyclic: false, spofs: [], failureChains: [], cycles: [] },
      reportKpis: [],
      generatedAt: null,
    };
  }
  return {
    health: {
      overall: report.health.overall,
      band: report.health.band,
      scores: report.health.scores.map((sc) => ({ key: sc.key, label: sc.label, score: sc.score, band: sc.band, factors: sc.factors })),
      byKey: report.health.byKey as Record<string, number>,
    },
    risk: { overall: report.risk.overall, band: report.risk.band },
    graph: { nodes: report.graph.nodes, edges: report.graph.edges, byDomain: report.graph.byDomain, crossDomainEdges: report.graph.crossDomainEdges, truncated: report.graph.truncated },
    dependencies: {
      criticalCount: report.dependencies.criticalCount,
      cyclic: report.dependencies.cyclic,
      // Identity (id/label) intentionally dropped at ingestion — the twin exposes aggregate blast metrics only.
      spofs: report.dependencies.spofs.map((n) => ({ domain: n.domain, blastRadius: n.blastRadius, dependents: n.dependents, risk: n.risk })),
      failureChains: report.dependencies.failureChains.map((c) => ({ domains: c.domains })),
      cycles: report.dependencies.cycles.map((c) => ({ domains: c.domains })),
    },
    reportKpis: report.kpis,
    generatedAt: report.generatedAt,
  };
}

/* ── Domain twins ── */

export function buildTwinDomains(s: TwinState): TwinDomains {
  const domains: EnterpriseTwinDomain[] = [
    {
      id: 'enterprise',
      name: 'Enterprise Twin',
      description: 'The whole enterprise as one composed graph (P7 Enterprise Intelligence).',
      entityCount: s.graph.nodes,
      band: s.health.band,
      status: `${s.health.overall}/100 health`,
      metrics: [
        { label: 'Graph nodes', value: `${s.graph.nodes}` },
        { label: 'Graph edges', value: `${s.graph.edges}` },
        { label: 'Cross-domain edges', value: `${s.graph.crossDomainEdges}` },
        { label: 'Risk', value: `${s.risk.overall}/100` },
      ],
      source: 'Enterprise Intelligence',
      live: true,
    },
    {
      id: 'organization',
      name: 'Organization Twin',
      description: 'Organizations, business units, teams, and people.',
      entityCount: s.org.users,
      band: s.org.orgs > 0 ? 'healthy' : 'watch',
      status: `${s.org.orgs} org(s)`,
      metrics: [
        { label: 'Organizations', value: `${s.org.orgs}` },
        { label: 'Units', value: `${s.org.units}` },
        { label: 'People', value: `${s.org.humans}` },
        { label: 'AI workers', value: `${s.org.workers}` },
      ],
      source: 'Organization Runtime',
      live: s.org.orgs > 0,
    },
    {
      id: 'infrastructure',
      name: 'Infrastructure Twin',
      description: 'Cloud fleet, regions, deployments, and spend.',
      entityCount: s.cloud.deployments,
      band: fleetBand(s.cloud.fleetStatus),
      status: `${s.cloud.fleetStatus} · ${s.cloud.fleetScore}/100`,
      metrics: [
        { label: 'Deployments', value: `${s.cloud.healthyDeployments}/${s.cloud.deployments} healthy` },
        { label: 'Regions', value: `${s.cloud.regions}` },
        { label: 'Monthly spend', value: `${s.cloud.currency} ${round(s.cloud.monthlySpend)}` },
      ],
      source: 'Cloud Control Plane',
      live: s.cloud.deployments > 0,
    },
    {
      id: 'workforce',
      name: 'Workforce Twin',
      description: 'AI workers, their health, and job throughput.',
      entityCount: s.workforce.total,
      band: workforceBand(s.workforce.state),
      status: `${s.workforce.healthy}/${s.workforce.total} healthy`,
      metrics: [
        { label: 'Healthy', value: `${s.workforce.healthy}` },
        { label: 'Degraded', value: `${s.workforce.degraded}` },
        { label: 'Success rate', value: `${round(s.workforce.successRate * 100)}%` },
      ],
      source: 'AI Workforce',
      live: s.workforce.total > 0,
    },
    {
      id: 'application',
      name: 'Application Twin',
      description: 'Deployed services (a projection of control-plane deployments — no first-class app domain).',
      entityCount: s.application.deployments,
      band: s.application.deployments > 0 ? ratioBand(s.application.healthy, s.application.deployments) : 'watch',
      status: s.application.deployments > 0 ? `${s.application.healthy}/${s.application.deployments} healthy` : 'No deployments',
      metrics: [
        { label: 'Deployments', value: `${s.application.deployments}` },
        { label: 'Healthy', value: `${s.application.healthy}` },
        { label: 'Avg uptime', value: `${round(s.application.avgUptimePct)}%` },
      ],
      source: 'Cloud Control Plane (deployments)',
      live: s.application.deployments > 0,
    },
    {
      id: 'connector',
      name: 'Connector Twin',
      description: 'Connected integrations and their sync health.',
      entityCount: s.connectors.connected,
      band: s.connectors.connected > 0 ? ratioBand(s.connectors.healthy, s.connectors.connected) : 'watch',
      status: s.connectors.connected > 0 ? `${s.connectors.healthy} healthy · ${s.connectors.down} down` : `${s.connectors.total} available, none connected`,
      metrics: [
        { label: 'Connected', value: `${s.connectors.connected}` },
        { label: 'Healthy', value: `${s.connectors.healthy}` },
        { label: 'Down', value: `${s.connectors.down}` },
        { label: 'Catalog', value: `${s.connectors.total}` },
      ],
      source: 'Connectors',
      live: s.connectors.connected > 0,
    },
    {
      id: 'marketplace',
      name: 'Marketplace Twin',
      description: 'Published marketplace packages and certification.',
      entityCount: s.marketplace.published,
      band: s.marketplace.published > 0 ? ratioBand(s.marketplace.certified, s.marketplace.published) : 'watch',
      status: `${s.marketplace.certified}/${s.marketplace.published} certified`,
      metrics: [
        { label: 'Published', value: `${s.marketplace.published}` },
        { label: 'Certified', value: `${s.marketplace.certified}` },
      ],
      source: 'Marketplace',
      live: s.marketplace.published > 0,
    },
    {
      id: 'federation',
      name: 'Federation Twin',
      description: 'Federated peer organizations and trust relationships.',
      entityCount: s.federation.peers,
      band: s.federation.peers > 0 ? ratioBand(s.federation.activePeers, s.federation.peers) : 'watch',
      status: s.federation.peers > 0 ? `${s.federation.activePeers}/${s.federation.peers} active` : 'No federated peers',
      metrics: [
        { label: 'Peers', value: `${s.federation.peers}` },
        { label: 'Active', value: `${s.federation.activePeers}` },
        { label: 'Trusted', value: `${s.federation.trustedPeers}` },
      ],
      source: 'Federation',
      live: s.federation.peers > 0,
    },
    {
      id: 'strategy',
      name: 'Strategy Twin',
      description: 'Strategic goals, progress, and advisory decisions (P14 — never executed).',
      entityCount: s.strategy.goalsTotal,
      band: s.strategy.healthBand,
      status: `${s.strategy.goalsOnTrack}/${s.strategy.goalsTotal} goals on track`,
      metrics: [
        { label: 'On track', value: `${s.strategy.goalsOnTrack}/${s.strategy.goalsTotal}` },
        { label: 'Progress', value: `${round(s.strategy.overallProgress * 100)}%` },
        { label: 'Open decisions', value: `${s.strategy.openDecisions}` },
      ],
      source: 'Strategy Platform',
      live: true,
    },
  ];

  const domainOnly = domains.filter((d) => d.id !== 'enterprise');
  const healthyDomains = domainOnly.filter((d) => d.band === 'healthy').length;
  const degradedDomains = domainOnly.filter((d) => d.band === 'at-risk' || d.band === 'critical').length;
  const totalEntities = domainOnly.reduce((n, d) => n + d.entityCount, 0);
  return { domains, totalEntities, healthyDomains, degradedDomains };
}

/* ── Live topology (domain-level projection of the enterprise graph summary) ── */

const TOPOLOGY_GRAPH_LAYERS: { id: string; label: string; domains: string[] }[] = [
  { id: 'business', label: 'Business', domains: ['crm', 'finance', 'sales', 'operations', 'people', 'business'] },
  { id: 'infrastructure', label: 'Infrastructure', domains: ['infrastructure', 'identity', 'security'] },
  { id: 'knowledge', label: 'Knowledge & Automation', domains: ['knowledge', 'automation'] },
];

export function buildTwinTopology(s: TwinState): TwinTopology {
  const nodes: TwinTopologyNode[] = Object.entries(s.graph.byDomain)
    .map(([domain, nodeCount]) => ({ id: `domain:${domain}`, domain, label: domainLabel(domain), nodeCount, band: 'unknown' as const }))
    .sort((a, b) => b.nodeCount - a.nodeCount || a.domain.localeCompare(b.domain));

  // Domain→domain links are derived from dependency FINDINGS (failure chains + cycles co-occurrence),
  // NOT the raw edge set (only a scalar cross-domain count is on the report). Honest + zero new graph.
  const linkMap = new Map<string, number>();
  for (const group of [...s.dependencies.failureChains, ...s.dependencies.cycles]) {
    const doms = [...new Set(group.domains)];
    for (let i = 0; i < doms.length; i++) {
      for (let j = i + 1; j < doms.length; j++) {
        const [a, b] = [doms[i], doms[j]].sort();
        if (a === b) continue;
        linkMap.set(`${a}|${b}`, (linkMap.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
  }
  const links: TwinTopologyLink[] = [...linkMap.entries()].map(([key, weight]) => {
    const [from, to] = key.split('|');
    return { from: `domain:${from}`, to: `domain:${to}`, kind: 'dependency', weight };
  });

  const graphLayers: TwinTopologyLayer[] = TOPOLOGY_GRAPH_LAYERS.map((l) => ({
    id: l.id,
    label: l.label,
    nodeCount: l.domains.reduce((n, d) => n + (s.graph.byDomain[d] ?? 0), 0),
    domains: l.domains,
  }));
  const twinLayers: TwinTopologyLayer[] = [
    { id: 'workforce', label: 'Workforce', nodeCount: s.workforce.total, domains: ['automation'] },
    { id: 'connector', label: 'Connectors', nodeCount: s.connectors.connected, domains: [] },
    { id: 'federation', label: 'Federation', nodeCount: s.federation.peers, domains: [] },
  ];

  return {
    nodes,
    links,
    layers: [...graphLayers, ...twinLayers],
    totalNodes: s.graph.nodes,
    totalEdges: s.graph.edges,
    crossDomainEdges: s.graph.crossDomainEdges,
    truncated: s.graph.truncated,
    note: 'Domain-level topology projected from the Enterprise Graph summary. Nodes are aggregated per domain (sized by node count); cross-domain links are derived from dependency findings (failure chains + cycles). Structural view — see the Health Map for health.',
  };
}

/* ── Health map ── */

export function buildTwinHealthMap(s: TwinState): TwinHealthMap {
  const entries = s.health.scores.map((sc) => ({ key: sc.key, label: sc.label, score: sc.score, band: sc.band, factors: sc.factors }));
  const domains = buildTwinDomains(s)
    .domains.filter((d) => d.id !== 'enterprise')
    .map((d) => ({ domain: d.id, label: d.name, band: d.band, entityCount: d.entityCount }));
  return { overall: s.health.overall, band: s.health.band, entries, domains };
}

/* ── Change impact / blast radius (reuses the dependency analysis; no per-node engine calls) ── */

export function buildTwinImpact(s: TwinState): TwinImpact {
  const nodes = s.dependencies.spofs
    .map((n) => ({ domain: n.domain, blastRadius: n.blastRadius, dependents: n.dependents, risk: n.risk }))
    .sort((a, b) => b.blastRadius - a.blastRadius || b.dependents - a.dependents || a.domain.localeCompare(b.domain))
    .slice(0, 25)
    // Redact to a synthetic, non-identifying rank — the twin exposes the blast-radius distribution by
    // domain, never the underlying entity's id/name (which can be a customer/employee/supplier record).
    .map((n, i) => ({
      id: `twin-spof-${i + 1}`,
      label: `${domainLabel(n.domain)} · SPOF #${i + 1}`,
      domain: n.domain,
      blastRadius: n.blastRadius,
      dependents: n.dependents,
      risk: n.risk,
    }));
  return {
    nodes,
    criticalCount: s.dependencies.criticalCount,
    cyclic: s.dependencies.cyclic,
    note: 'Top blast-radius single points of failure, ranked from the enterprise dependency analysis and aggregated by domain with entity identities redacted. Named drill-down stays behind the existing change-impact engine (ipc.enterpriseIntel.changeImpact, intelligence:read); nothing is executed.',
  };
}

/* ── Scenario center (P14 SimulationReport passed through UNMODIFIED) ── */

export function buildTwinScenarioCenter(s: TwinState): TwinScenarioCenter {
  return {
    simulation: s.simulation,
    note: 'Reuses the P14 Strategy simulation engine. Scenarios (current vs A/B/C) are deterministic advisory what-if projections and are NEVER applied or executed by the twin.',
  };
}

/* ── Executive command center (groups EXISTING KPIs — recomputes nothing) ── */

function filterKpis(kpis: ExecutiveKpi[], ...needles: string[]): ExecutiveKpi[] {
  return kpis.filter((k) => needles.some((n) => k.key.includes(n)));
}

export function buildTwinCommandCenter(s: TwinState): TwinCommandCenter {
  const complianceScore = s.health.byKey['compliance'] ?? s.health.overall;
  const twins: ExecutiveTwin[] = [
    { id: 'executive', name: 'Executive Twin', headline: `Enterprise health ${s.health.overall}/100`, band: s.health.band, kpis: s.reportKpis.slice(0, 6) },
    { id: 'operations', name: 'Operations Twin', headline: `${s.cloud.healthyDeployments}/${s.cloud.deployments} deployments healthy`, band: fleetBand(s.cloud.fleetStatus), kpis: filterKpis(s.reportKpis, 'availability', 'performance', 'capacity', 'incident', 'health') },
    { id: 'business', name: 'Business Twin', headline: `${s.strategy.goalsOnTrack}/${s.strategy.goalsTotal} goals on track`, band: s.strategy.healthBand, kpis: filterKpis(s.strategyKpis, 'goals', 'growth', 'savings') },
    { id: 'strategy', name: 'Strategy Twin', headline: `${round(s.strategy.overallProgress * 100)}% overall progress`, band: s.strategy.healthBand, kpis: s.strategyKpis },
    { id: 'risk', name: 'Risk Twin', headline: `Enterprise risk ${s.risk.overall}/100`, band: s.risk.band, kpis: filterKpis(s.reportKpis, 'risk') },
    { id: 'compliance', name: 'Compliance Twin', headline: `Compliance ${round(complianceScore)}/100`, band: goodnessBand(complianceScore), kpis: filterKpis(s.reportKpis, 'compliance') },
  ];
  return { twins };
}

/* ── Timeline replay (formats the composition root's filtered windows) ── */

function humanizeType(type: string): string {
  const t = type.replace(/[._]/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function buildTwinReplay(s: TwinState): TwinReplay {
  const windows = s.replay.map((w) => {
    const byDayMap = new Map<string, number>();
    for (const f of w.frames) {
      const day = f.at.slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1);
    }
    const byDay = [...byDayMap.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => (a.day < b.day ? -1 : 1));
    return {
      kind: w.kind,
      label: w.label,
      since: w.since,
      until: w.until,
      total: w.total,
      frames: w.frames.map((f) => ({ id: f.id, at: f.at, type: f.type, category: f.category, priority: f.priority, source: f.source, label: humanizeType(f.type), resource: f.resource })),
      byDay,
      note: w.note,
    };
  });
  return { windows };
}

/* ── Summary + overview bundle ── */

export function buildTwinSummary(s: TwinState): TwinSummary {
  const domains = buildTwinDomains(s);
  return {
    generatedAt: s.generatedAt,
    domainCount: domains.domains.filter((d) => d.id !== 'enterprise').length,
    totalEntities: domains.totalEntities,
    overallHealth: s.health.overall,
    healthBand: s.health.band,
    overallRisk: s.risk.overall,
    riskBand: s.risk.band,
    criticalImpactNodes: s.dependencies.spofs.filter((n) => n.blastRadius >= 5).length,
    openDecisions: s.strategy.openDecisions,
    liveDomains: domains.domains.filter((d) => d.id !== 'enterprise' && d.live).length,
  };
}

export function buildEnterpriseTwinOverview(s: TwinState): EnterpriseTwinOverview {
  return {
    summary: buildTwinSummary(s),
    domains: buildTwinDomains(s),
    topology: buildTwinTopology(s),
    health: buildTwinHealthMap(s),
    impact: buildTwinImpact(s),
    commandCenter: buildTwinCommandCenter(s),
  };
}
