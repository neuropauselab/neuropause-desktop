/**
 * Enterprise Digital Twin (P15) — view-model types.
 *
 * P15 is a READ-ONLY visualization/composition LAYER. It is NOT a new graph, timeline, or simulation
 * engine: it projects a continuously-updated Digital Twin of the enterprise by composing the EXISTING
 * systems — the P7 Enterprise Intelligence report (graph summary / health / risk / dependencies), the
 * Cloud Control Plane, the AI Workforce, Connectors, the Marketplace, Federation, and the P14 Strategy
 * Platform (goals / simulations / decisions) — plus the existing platform timeline for replay. Every
 * view is a projection: it renders and models the enterprise but executes nothing, mutates nothing,
 * and introduces no duplicate runtime, graph, timeline, or simulation engine. Names are prefixed
 * (`EnterpriseTwin*` / `Twin*`) to avoid colliding with the manufacturing digital-twin and strategy
 * scenario types. It reuses the platform `ExecutiveKpi` and P14 `SimulationReport` unmodified.
 */
import type { ExecutiveKpi } from './executiveCenter';
import type { SimulationReport } from './strategyIntelligence';

/** Health/risk band, mirrored locally (the intelligence `Band` is not exported). */
export type TwinBand = 'healthy' | 'watch' | 'at-risk' | 'critical';

/** The nine twin domains (eight domain twins + the enterprise rollup). */
export type TwinDomainId =
  | 'enterprise'
  | 'organization'
  | 'infrastructure'
  | 'workforce'
  | 'application'
  | 'connector'
  | 'marketplace'
  | 'federation'
  | 'strategy';

export interface TwinMetric {
  label: string;
  value: string;
}

/** A single domain twin — a live count + health + key metrics projected from an existing system. */
export interface EnterpriseTwinDomain {
  id: TwinDomainId;
  name: string;
  description: string;
  entityCount: number;
  band: TwinBand;
  status: string;
  metrics: TwinMetric[];
  /** The existing platform system this twin is projected from. */
  source: string;
  /**
   * Whether the twin reflects live/seeded data. Some domains legitimately read 0 on a fresh install
   * (no connectors connected, no cloud discovery) — `live: false` flags "projected, not yet populated".
   */
  live: boolean;
}

export interface TwinDomains {
  domains: EnterpriseTwinDomain[];
  totalEntities: number;
  healthyDomains: number;
  degradedDomains: number;
}

/* ── Live topology (domain-level projection of the enterprise graph summary) ── */

export interface TwinTopologyNode {
  id: string;
  domain: string;
  label: string;
  nodeCount: number;
  band: TwinBand | 'unknown';
}

export interface TwinTopologyLink {
  from: string;
  to: string;
  /** Derived from dependency findings (failure chains / cycles) — not the raw edge set. */
  kind: 'dependency';
  weight: number;
}

/** A topology layer/view (business / infrastructure / application / worker / connector / federation). */
export interface TwinTopologyLayer {
  id: string;
  label: string;
  nodeCount: number;
  domains: string[];
}

export interface TwinTopology {
  nodes: TwinTopologyNode[];
  links: TwinTopologyLink[];
  layers: TwinTopologyLayer[];
  totalNodes: number;
  totalEdges: number;
  crossDomainEdges: number;
  truncated: boolean;
  /** Honest description of what the topology is projected from. */
  note: string;
}

/* ── Health map ── */

export interface TwinHealthEntry {
  key: string;
  label: string;
  score: number;
  band: TwinBand;
  factors: string[];
}

export interface TwinDomainHealth {
  domain: TwinDomainId;
  label: string;
  band: TwinBand;
  entityCount: number;
}

export interface TwinHealthMap {
  overall: number;
  band: TwinBand;
  entries: TwinHealthEntry[];
  domains: TwinDomainHealth[];
}

/* ── Change impact / blast radius (reuses the dependency analysis) ── */

export interface TwinImpactNode {
  id: string;
  label: string;
  domain: string;
  blastRadius: number;
  dependents: number;
  risk: number | null;
}

export interface TwinImpact {
  nodes: TwinImpactNode[];
  criticalCount: number;
  cyclic: boolean;
  /** Honest note: ranked from the enterprise dependency analysis; drill down via the existing engine. */
  note: string;
}

/* ── Timeline replay (filtered windows over the EXISTING platform timeline) ── */

export type TwinReplayKind = 'historical' | 'incident' | 'deployment' | 'change' | 'federation' | 'worker';

export interface TwinReplayFrame {
  id: string;
  at: string;
  type: string;
  category: string;
  priority: string;
  source: string;
  label: string;
  resource: string | null;
}

export interface TwinReplayWindow {
  kind: TwinReplayKind;
  label: string;
  since: string;
  until: string;
  total: number;
  frames: TwinReplayFrame[];
  byDay: { day: string; count: number }[];
  /** Honest note (e.g. deployment/federation coverage caveats). */
  note: string;
}

export interface TwinReplay {
  windows: TwinReplayWindow[];
}

/* ── Scenario center (passes P14's SimulationReport through UNMODIFIED — never executed) ── */

export interface TwinScenarioCenter {
  simulation: SimulationReport;
  /** Safety note surfaced in the UI. */
  note: string;
}

/* ── Executive command center (groups EXISTING KPIs into executive twins — recomputes nothing) ── */

export type ExecutiveTwinId = 'executive' | 'operations' | 'business' | 'strategy' | 'risk' | 'compliance';

export interface ExecutiveTwin {
  id: ExecutiveTwinId;
  name: string;
  headline: string;
  band: TwinBand;
  kpis: ExecutiveKpi[];
}

export interface TwinCommandCenter {
  twins: ExecutiveTwin[];
}

/* ── Overview bundle ── */

export interface TwinSummary {
  generatedAt: string;
  domainCount: number;
  totalEntities: number;
  overallHealth: number;
  healthBand: TwinBand;
  overallRisk: number;
  riskBand: TwinBand;
  criticalImpactNodes: number;
  openDecisions: number;
  liveDomains: number;
}

export interface EnterpriseTwinOverview {
  summary: TwinSummary;
  domains: TwinDomains;
  topology: TwinTopology;
  health: TwinHealthMap;
  impact: TwinImpact;
  commandCenter: TwinCommandCenter;
}
