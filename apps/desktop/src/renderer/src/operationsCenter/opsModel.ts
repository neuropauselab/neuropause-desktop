/**
 * P7.1 — the Enterprise Operations Center view-model. PURE + dependency-free
 * (no React, no DOM), so the whole presentation layer is verified by the same
 * Node vitest gate as the backend engines.
 *
 * Everything here derives display state from the EXISTING P7 report shapes
 * (`@neuropause/shared` intelligence types) — status → {label, tone} maps, human
 * labels, formatters, KPI grouping, the 6-category risk heatmap, and the
 * dependency-graph element builder + deterministic domain-clustered layout that
 * back the interactive Graph Explorer. No data is invented and nothing is
 * recomputed — the backend already ran every engine.
 */
import type {
  Bottleneck,
  CategoryRisk,
  ChangeImpactReport,
  DependencyCycle,
  DependencyReport,
  EnterpriseHealthReport,
  EnterpriseIntelligenceReport,
  EnterpriseRiskReport,
  EventSeverity,
  ExecutiveKpi,
  FailureChain,
  HealthScore,
  Incident,
  IntelRecommendation,
  PressureLevel,
  RecoCategory,
  RecoPriority,
  RiskCategory,
  RootCauseReport,
  SinglePointOfFailure,
} from '@neuropause/shared';

/** The design-system tone union (structurally identical to operations `OpsTone`). */
export type Tone = 'green' | 'orange' | 'red' | 'blue' | 'purple' | 'accent' | 'gray';

/** The Operations Center screens (tab ids), shared by the shell + cross-links. */
export type OpsCenterTab =
  | 'home'
  | 'intelligence'
  | 'health'
  | 'risk'
  | 'capacity'
  | 'incidents'
  | 'recommendations'
  | 'dependencies'
  | 'impact'
  | 'rootcause'
  | 'graph'
  | 'timeline'
  | 'search'
  | 'diagnostics';

/** `ExecutiveKpi['band']` is optional; this is the non-null band union. */
export type Band = NonNullable<ExecutiveKpi['band']>;

/* ── status → tone maps ─────────────────────────────────────────────────────── */

/** A health/risk band → tone. Bands already encode severity, so map directly. */
export function bandTone(band: Band): Tone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'blue';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
  }
}

export function bandLabel(band: Band): string {
  switch (band) {
    case 'healthy':
      return 'Healthy';
    case 'watch':
      return 'Watch';
    case 'at-risk':
      return 'At Risk';
    case 'critical':
      return 'Critical';
  }
}

export function severityTone(sev: EventSeverity): Tone {
  switch (sev) {
    case 'info':
      return 'blue';
    case 'warning':
      return 'orange';
    case 'critical':
      return 'red';
  }
}

export function severityLabel(sev: EventSeverity): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

export function priorityTone(p: RecoPriority): Tone {
  switch (p) {
    case 'low':
      return 'gray';
    case 'medium':
      return 'blue';
    case 'high':
      return 'orange';
    case 'critical':
      return 'red';
  }
}

/** Priority rank for sorting/grading (higher = more urgent). */
export const PRIORITY_RANK: Record<RecoPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function pressureTone(p: PressureLevel): Tone {
  switch (p) {
    case 'low':
      return 'green';
    case 'moderate':
      return 'blue';
    case 'high':
      return 'orange';
    case 'critical':
      return 'red';
  }
}

/** A 0–100 RISK score → tone (higher risk = brighter/hotter). */
export function riskScoreTone(score: number): Tone {
  if (score >= 70) return 'red';
  if (score >= 45) return 'orange';
  if (score >= 20) return 'blue';
  return 'green';
}

/** A 0–100 HEALTH/quality score → tone (higher = better). Inverse of risk. */
export function healthScoreTone(score: number): Tone {
  if (score >= 75) return 'green';
  if (score >= 50) return 'blue';
  if (score >= 30) return 'orange';
  return 'red';
}

/** A 0–1 confidence → tone. */
export function confidenceTone(confidence: number): Tone {
  if (confidence >= 0.75) return 'green';
  if (confidence >= 0.5) return 'blue';
  if (confidence >= 0.25) return 'orange';
  return 'gray';
}

/* ── labels ─────────────────────────────────────────────────────────────────── */

const DOMAIN_LABELS: Record<string, string> = {
  infrastructure: 'Infrastructure',
  identity: 'Identity',
  security: 'Security',
  crm: 'CRM',
  finance: 'Finance',
  sales: 'Sales',
  operations: 'Operations',
  business: 'Business',
  people: 'People',
  data: 'Data',
  collaboration: 'Collaboration',
  external: 'External',
  unknown: 'Unknown',
};

/** Human label for an enterprise domain / risk-category domain (acronyms upper-cased). */
export function domainLabel(domain: string): string {
  if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
  return domain
    .split(/[_-]/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  operational: 'Operational',
  business: 'Business',
  security: 'Security',
  infrastructure: 'Infrastructure',
  identity: 'Identity',
  dependency: 'Dependency',
};

export function riskCategoryLabel(c: RiskCategory): string {
  return RISK_CATEGORY_LABELS[c] ?? domainLabel(c);
}

const RECO_CATEGORY_LABELS: Record<RecoCategory, string> = {
  health: 'Health',
  risk: 'Risk',
  drift: 'Drift',
  dependency: 'Dependency',
  capacity: 'Capacity',
  incident: 'Incident',
  security: 'Security',
};

export function recoCategoryLabel(c: RecoCategory): string {
  return RECO_CATEGORY_LABELS[c] ?? domainLabel(c);
}

/* ── formatters ─────────────────────────────────────────────────────────────── */

/** 0–1 → integer percent string, clamped. */
export function pct01(n: number): string {
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

/** A 0–100 score → "NN" (rounded, clamped). */
export function score100(n: number): string {
  return `${Math.round(Math.max(0, Math.min(100, n)))}`;
}

/** Drop trailing decimal zeros so exact thousands/millions read cleanly (2.00M → 2M). */
function trimZero(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Compact integer formatting: 1234 → "1.2k", 2_000_000 → "2M", 999_600 → "1M". */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return `${Math.round(n)}`;
  // 999_500+ would round up to "1000k" under toFixed(0); promote it into the M range instead.
  if (abs < 999_500) return `${trimZero((n / 1000).toFixed(abs < 10_000 ? 1 : 0))}k`;
  return `${trimZero((n / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0))}M`;
}

/** USD-ish money formatting for capacity cost (no locale dep). */
export function formatMoney(n: number): string {
  if (n <= 0) return '$0';
  if (n < 1000) return `$${Math.round(n)}`;
  if (n < 999_500) return `$${trimZero((n / 1000).toFixed(n < 10_000 ? 1 : 0))}k`;
  return `$${trimZero((n / 1_000_000).toFixed(2))}M`;
}

/** Relative time from an epoch-ms or ISO timestamp to `nowMs`. Pure (nowMs passed in). */
export function relativeTime(ts: number | string, nowMs: number): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  const diff = nowMs - t;
  const future = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const fmt = (v: number, unit: string): string =>
    future ? `in ${v}${unit}` : `${v}${unit} ago`;
  // Cascade on the ROUNDED unit, not on `s`, so a value just under a tier boundary
  // (e.g. 3599s) rounds up cleanly to "1h" instead of printing "60m".
  if (s < 45) return future ? 'soon' : 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return fmt(m, 'm');
  const h = Math.round(s / 3600);
  if (h < 24) return fmt(h, 'h');
  const d = Math.round(s / 86400);
  if (d < 30) return fmt(d, 'd');
  return fmt(Math.round(s / 2_592_000), 'mo');
}

/** Duration between two epoch-ms marks, humanized (for incident spans). */
export function formatDuration(startMs: number, endMs: number): string {
  const ms = Math.max(0, endMs - startMs);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/* ── KPI grouping ───────────────────────────────────────────────────────────── */

export interface KpiGroup {
  /** The engine/segment key (e.g. 'health', 'risk', 'capacity'). */
  key: string;
  label: string;
  kpis: ExecutiveKpi[];
}

/**
 * Group the report's executive KPIs by the second dotted segment of their key
 * (`enterprise.capacity.pressure` → group `capacity`), preserving first-seen
 * order. KPIs whose key has no clear segment fall into an 'overview' group.
 */
export function groupKpis(kpis: ExecutiveKpi[]): KpiGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ExecutiveKpi[]>();
  for (const kpi of kpis) {
    const parts = kpi.key.split('.');
    const seg = parts.length >= 2 ? parts[1] : parts[0] || 'overview';
    if (!byKey.has(seg)) {
      byKey.set(seg, []);
      order.push(seg);
    }
    byKey.get(seg)!.push(kpi);
  }
  return order.map((key) => ({ key, label: domainLabel(key), kpis: byKey.get(key)! }));
}

/* ── risk heatmap ───────────────────────────────────────────────────────────── */

export interface HeatCell {
  category: RiskCategory;
  label: string;
  score: number;
  band: Band;
  tone: Tone;
  sampleSize: number;
  /** 0–1 intensity for the heat fill. */
  intensity: number;
}

/** Turn the risk report's categories into ranked heatmap cells (hottest first). */
export function riskHeatCells(risk: EnterpriseRiskReport): HeatCell[] {
  return [...risk.categories]
    .map((c: CategoryRisk) => ({
      category: c.category,
      label: riskCategoryLabel(c.category),
      score: c.score,
      band: c.band,
      // Derive tone from the engine's authoritative band so the fill colour never
      // contradicts the band label (the band scale, not the raw-score scale, is truth).
      tone: bandTone(c.band),
      sampleSize: c.sampleSize,
      intensity: Math.max(0, Math.min(1, c.score / 100)),
    }))
    .sort((a, b) => b.score - a.score);
}

/* ── health scores ──────────────────────────────────────────────────────────── */

export interface HealthDial {
  key: HealthScore['key'];
  label: string;
  /** 0–1 for the ScoreRing. */
  value: number;
  score: number;
  band: Band;
  tone: Tone;
  factors: string[];
}

/**
 * Present the 7 health scores as dials. The engine already assigns each score the
 * correct band (a `goodBand` for quality dimensions, a `riskBand` for the 'risk'
 * magnitude), so tone is derived from that band — no per-key scale special-casing,
 * and the dial colour always agrees with its band label.
 */
export function healthDials(health: EnterpriseHealthReport): HealthDial[] {
  return health.scores.map((s) => ({
    key: s.key,
    label: s.label,
    value: Math.max(0, Math.min(1, s.score / 100)),
    score: s.score,
    band: s.band,
    tone: bandTone(s.band),
    factors: s.factors,
  }));
}

/* ── headline summary (Home) ────────────────────────────────────────────────── */

export interface OpsHeadline {
  healthScore: number;
  healthBand: Band;
  healthTone: Tone;
  riskScore: number;
  riskBand: Band;
  riskTone: Tone;
  openIncidents: number;
  criticalRecommendations: number;
  spofCount: number;
  driftScore: number;
  capacityPressure: number;
  nodes: number;
  edges: number;
}

/** One-glance headline numbers for the Home hero. Pure projection of the report. */
export function headline(report: EnterpriseIntelligenceReport): OpsHeadline {
  const criticalRecommendations = report.recommendations.filter(
    (r) => r.priority === 'critical' || r.priority === 'high',
  ).length;
  return {
    healthScore: report.health.overall,
    healthBand: report.health.band,
    healthTone: bandTone(report.health.band),
    riskScore: report.risk.overall,
    riskBand: report.risk.band,
    riskTone: bandTone(report.risk.band),
    openIncidents: report.incidents.open,
    criticalRecommendations,
    spofCount: report.dependencies.spofs.length,
    driftScore: report.drift.driftScore,
    capacityPressure: report.capacity.pressureScore,
    nodes: report.graph.nodes,
    edges: report.graph.edges,
  };
}

/** Recommendations sorted by priority (critical→low), stable within a tier. */
export function sortedRecommendations(recs: IntelRecommendation[]): IntelRecommendation[] {
  return [...recs].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
}

/** Incidents sorted most-recent-first (by start), open/critical surfaced. */
export function sortedIncidents(incidents: Incident[]): Incident[] {
  return [...incidents].sort((a, b) => b.startTs - a.startTs);
}

/* ── dependency graph elements (Graph Explorer) ─────────────────────────────── */

export type GraphRole = 'spof' | 'bottleneck' | 'chain' | 'cycle';

export interface GraphNode {
  id: string;
  label: string;
  domain: string;
  role: GraphRole;
  /** Structural weight → node radius (blast radius / throughput / 1). */
  weight: number;
  /** 0–100 risk if known (spofs), else null. */
  risk: number | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'depends' | 'cycle';
}

export interface GraphElements {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Role precedence when the same id appears in several dependency findings. */
const ROLE_RANK: Record<GraphRole, number> = { spof: 4, bottleneck: 3, chain: 2, cycle: 1 };

/** Strip id prefixes (`res:` / `erp:`) and take the last meaningful segment as a label. */
export function shortLabel(id: string): string {
  let s = id;
  if (s.startsWith('res:')) s = s.slice(4);
  else if (s.startsWith('erp:')) s = s.slice(4);
  const parts = s.split(':').filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : s;
  return tail.length > 28 ? `${tail.slice(0, 27)}…` : tail || id;
}

/**
 * Build an interactive node-link graph PURELY from the dependency report — the
 * exact structure the P7 dependency engine found: single points of failure and
 * bottlenecks as hubs, failure chains as directed paths, and cycles as rings.
 * No second data source, no new IPC. Deterministic; dedupes nodes (highest role
 * wins) and edges. `domainOf` supplies a domain for ids only seen in chains/
 * cycles (whose entries carry domains at the finding level, not per node).
 */
export function buildGraphElements(dep: DependencyReport): GraphElements {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const upsert = (id: string, patch: Omit<GraphNode, 'id'>): void => {
    const existing = nodes.get(id);
    if (!existing || ROLE_RANK[patch.role] > ROLE_RANK[existing.role]) {
      nodes.set(id, { id, ...patch });
    } else {
      // Keep the higher-precedence role but let a later finding fill a missing risk/weight.
      if (existing.risk == null && patch.risk != null) existing.risk = patch.risk;
      if (patch.weight > existing.weight) existing.weight = patch.weight;
    }
  };

  for (const s of dep.spofs as SinglePointOfFailure[]) {
    upsert(s.id, {
      label: s.label || shortLabel(s.id),
      domain: s.domain,
      role: 'spof',
      weight: Math.max(1, s.blastRadius),
      risk: s.risk,
    });
  }
  for (const b of dep.bottlenecks as Bottleneck[]) {
    upsert(b.id, {
      label: b.label || shortLabel(b.id),
      domain: b.domain,
      role: 'bottleneck',
      weight: Math.max(1, b.throughput),
      risk: null,
    });
  }

  const addEdge = (from: string, to: string, kind: GraphEdge['kind']): void => {
    if (from === to) return;
    const id = `${from}|${to}|${kind}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, kind });
  };

  for (const chain of dep.failureChains as FailureChain[]) {
    const dom = chain.domains[0] ?? 'unknown';
    for (let i = 0; i < chain.path.length; i++) {
      const id = chain.path[i];
      if (!nodes.has(id)) {
        upsert(id, { label: shortLabel(id), domain: dom, role: 'chain', weight: 1, risk: null });
      }
      if (i > 0) addEdge(chain.path[i - 1], id, 'depends');
    }
  }

  for (const cyc of dep.cycles as DependencyCycle[]) {
    const dom = cyc.domains[0] ?? 'unknown';
    const ring = cyc.nodes;
    for (let i = 0; i < ring.length; i++) {
      const id = ring[i];
      if (!nodes.has(id)) {
        upsert(id, { label: shortLabel(id), domain: dom, role: 'cycle', weight: 1, risk: null });
      }
      if (ring.length > 1) addEdge(ring[i], ring[(i + 1) % ring.length], 'cycle');
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Distinct domains present in the graph elements, in stable (label) order. */
export function graphDomains(elements: GraphElements): string[] {
  return [...new Set(elements.nodes.map((n) => n.domain))].sort((a, b) =>
    domainLabel(a).localeCompare(domainLabel(b)),
  );
}

/** Filter graph elements to a domain (or 'all'); edges are kept only when both ends survive. */
export function filterGraph(elements: GraphElements, domain: string): GraphElements {
  if (domain === 'all') return elements;
  const nodes = elements.nodes.filter((n) => n.domain === domain);
  const keep = new Set(nodes.map((n) => n.id));
  const edges = elements.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes, edges };
}

export interface Positioned extends GraphNode {
  /** Layout position in a centered [-1, 1] square. */
  x: number;
  y: number;
}

/**
 * Deterministic domain-clustered radial layout in a centered unit square — no
 * randomness (so it's stable across renders + testable). Each domain occupies an
 * angular sector; nodes within a domain spiral outward by descending weight so
 * the heaviest hubs sit nearest their cluster center.
 */
export function layoutGraph(elements: GraphElements): Positioned[] {
  const domains = graphDomains(elements);
  const domainCount = Math.max(1, domains.length);
  const sectorAngle = (2 * Math.PI) / domainCount;
  const clusterRadius = domainCount === 1 ? 0 : 0.62;

  const out: Positioned[] = [];
  domains.forEach((domain, di) => {
    const members = elements.nodes
      .filter((n) => n.domain === domain)
      .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
    const centerAngle = di * sectorAngle - Math.PI / 2;
    const cx = clusterRadius * Math.cos(centerAngle);
    const cy = clusterRadius * Math.sin(centerAngle);
    members.forEach((n, mi) => {
      if (mi === 0) {
        out.push({ ...n, x: cx, y: cy });
        return;
      }
      // Spiral: ring index grows with sqrt so density stays even.
      const ring = Math.sqrt(mi) * 0.14;
      const a = mi * 2.399963; // golden angle → low-overlap distribution
      out.push({ ...n, x: cx + ring * Math.cos(a), y: cy + ring * Math.sin(a) });
    });
  });
  // The spiral radius is unbounded for a large domain, so normalize into the
  // centered [-1, 1] square with a single uniform scale (clustering is preserved).
  let maxAbs = 0;
  for (const p of out) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  if (maxAbs > 1) for (const p of out) {
    p.x /= maxAbs;
    p.y /= maxAbs;
  }
  return out;
}

/* ── change impact + root cause presentation ───────────────────────────────── */

export interface ImpactDomainRow {
  domain: string;
  label: string;
  count: number;
  /** 0–1 share of the blast radius. */
  share: number;
}

/** Domain breakdown rows for a change-impact report (largest first). */
export function impactDomainRows(impact: ChangeImpactReport): ImpactDomainRow[] {
  const total = Object.values(impact.affectedByDomain).reduce((s, n) => s + n, 0);
  return Object.entries(impact.affectedByDomain)
    .map(([domain, count]) => ({
      domain,
      label: domainLabel(domain),
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Severity band for a blast radius (used to tone the impact hero). */
export function blastRadiusTone(blastRadius: number): Tone {
  if (blastRadius >= 20) return 'red';
  if (blastRadius >= 8) return 'orange';
  if (blastRadius >= 1) return 'blue';
  return 'green';
}

/** Whether a root-cause report has a usable answer (a symptom + at least one candidate). */
export function hasRootCause(rc: RootCauseReport | null | undefined): boolean {
  return !!rc && rc.symptom != null && rc.candidates.length > 0;
}
