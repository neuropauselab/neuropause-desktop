/**
 * P7 — the Enterprise RISK Engine + the global Enterprise HEALTH Engine.
 *
 * RISK unifies the many pre-existing risk signals (per-resource health, ERP node/edge risk, drift risk, dependency
 * structure) into ONE normalized 0–100 scale across SIX categories: operational, business, security,
 * infrastructure, identity, dependency. It does NOT reinvent a risk model — it composes the risk the domain graphs
 * already carry.
 *
 * HEALTH derives the SEVEN mission scores — health, risk, confidence, availability, security, performance,
 * compliance — from the unified Enterprise Graph + the risk report + the dependency report. All scores are 0–100
 * (higher = better, except `risk` where higher = worse), each with a band + contributing factors. Both engines are
 * pure + deterministic and emit `ExecutiveKpi[]` so they surface through the existing Executive Center unchanged.
 */
import type { ExecutiveKpi } from '../types/executiveCenter';
import type { DependencyReport, EnterpriseDomain, EnterpriseGraphModel, EnterpriseNode } from './enterpriseGraph';

/* ── shared helpers ─────────────────────────────────────────────────────────────── */

type Band = 'healthy' | 'watch' | 'at-risk' | 'critical';
/** Band for a GOODNESS score (higher = better). */
function goodBand(score: number): Band {
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'watch';
  if (score >= 25) return 'at-risk';
  return 'critical';
}
/** Band for a RISK score (higher = worse). */
function riskBand(score: number): Band {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'at-risk';
  if (score >= 25) return 'watch';
  return 'healthy';
}
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
/** Emphasize the worst nodes: blend the mean with the mean of the worst quartile. */
function pressure(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => b - a);
  const worstN = Math.max(1, Math.round(sorted.length / 4));
  const worst = sorted.slice(0, worstN);
  return (mean(sorted)! * 0.5 + mean(worst)! * 0.5);
}

/* ── RISK Engine ─────────────────────────────────────────────────────────────────── */

export type RiskCategory = 'operational' | 'business' | 'security' | 'infrastructure' | 'identity' | 'dependency';
export const RISK_CATEGORIES: readonly RiskCategory[] = ['operational', 'business', 'security', 'infrastructure', 'identity', 'dependency'] as const;

export interface RiskContributor {
  id: string;
  label: string;
  domain: EnterpriseDomain;
  risk: number;
  reason: string;
}
export interface CategoryRisk {
  category: RiskCategory;
  score: number;
  band: Band;
  sampleSize: number;
  contributors: RiskContributor[];
}
export interface EnterpriseRiskReport {
  categories: CategoryRisk[];
  byCategory: Record<RiskCategory, number>;
  overall: number;
  band: Band;
  topRisks: RiskContributor[];
  confidence: number;
  builtAt: string;
}

export interface RiskInput {
  model: EnterpriseGraphModel;
  dependencies?: DependencyReport | null;
  /** 0–100 infra/config drift severity (from the drift engine), lifts infrastructure + dependency risk. */
  driftSeverity?: number | null;
}

const BUSINESS_DOMAINS = new Set<EnterpriseDomain>(['crm', 'finance', 'sales', 'operations', 'business', 'people']);

function nodeRisk(n: EnterpriseNode): number {
  if (typeof n.risk === 'number') return n.risk;
  if (typeof n.health === 'number') return clamp(100 - n.health);
  return n.healthState === 'critical' ? 85 : n.healthState === 'degraded' ? 50 : 0;
}

function categoryFrom(nodes: EnterpriseNode[], category: RiskCategory): CategoryRisk {
  const risks = nodes.map(nodeRisk);
  const score = clamp(pressure(risks) ?? 0);
  const contributors: RiskContributor[] = nodes
    .map((n) => ({ id: n.id, label: n.label, domain: n.domain, risk: nodeRisk(n), reason: n.healthState === 'critical' ? 'critical health' : n.status ?? `${n.kind} risk` }))
    .filter((c) => c.risk >= 40)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 8);
  return { category, score, band: riskBand(score), sampleSize: nodes.length, contributors };
}

/** Compute the unified 6-category enterprise risk report. */
export function computeEnterpriseRisk(input: RiskInput, nowMs: number): EnterpriseRiskReport {
  const nodes = input.model.nodes;
  const infra = nodes.filter((n) => n.domain === 'infrastructure');
  const identity = nodes.filter((n) => n.domain === 'identity');
  const security = nodes.filter((n) => n.domain === 'security');
  const business = nodes.filter((n) => BUSINESS_DOMAINS.has(n.domain));

  const infraCat = categoryFrom(infra, 'infrastructure');
  const identityCat = categoryFrom(identity, 'identity');
  const securityCat = categoryFrom(security, 'security');
  const businessCat = categoryFrom(business, 'business');
  // Operational = the blend of what keeps the enterprise running (infra availability + business execution).
  const operationalScore = clamp((infraCat.score + businessCat.score) / 2 + criticalCount(nodes) * 2);
  const operationalCat: CategoryRisk = { category: 'operational', score: operationalScore, band: riskBand(operationalScore), sampleSize: infra.length + business.length, contributors: [...infraCat.contributors, ...businessCat.contributors].sort((a, b) => b.risk - a.risk).slice(0, 8) };
  // Dependency risk = structural (cycles + single points of failure), lifted by drift severity.
  const dep = input.dependencies;
  const depStructural = dep ? Math.min(100, dep.cycles.length * 12 + dep.spofs.slice(0, 5).reduce((s, x) => s + Math.min(20, x.blastRadius), 0)) : 0;
  const depScore = clamp(Math.max(depStructural, input.driftSeverity ?? 0));
  const depContribs: RiskContributor[] = (dep?.spofs ?? []).slice(0, 8).map((s) => ({ id: s.id, label: s.label, domain: s.domain, risk: clamp(50 + s.blastRadius * 4), reason: `single point of failure (${s.blastRadius} dependents)` }));
  const depCat: CategoryRisk = { category: 'dependency', score: depScore, band: riskBand(depScore), sampleSize: dep?.spofs.length ?? 0, contributors: depContribs };

  const categories = [operationalCat, businessCat, securityCat, infraCat, identityCat, depCat];
  const byCategory = Object.fromEntries(categories.map((c) => [c.category, c.score])) as Record<RiskCategory, number>;
  // Overall = risk-weighted toward the worst categories.
  const overall = clamp((pressure(categories.map((c) => c.score)) ?? 0));
  const topRisks = categories.flatMap((c) => c.contributors).sort((a, b) => b.risk - a.risk).slice(0, 12);
  const scored = nodes.filter((n) => n.risk != null || n.health != null).length;
  const confidence = nodes.length ? Math.round((scored / nodes.length) * 100) / 100 : 0;

  return { categories, byCategory, overall, band: riskBand(overall), topRisks, confidence, builtAt: new Date(nowMs).toISOString() };
}

function criticalCount(nodes: EnterpriseNode[]): number {
  return nodes.filter((n) => n.healthState === 'critical').length;
}

export function riskKpis(report: EnterpriseRiskReport): ExecutiveKpi[] {
  return [
    { key: 'enterprise.risk.overall', label: 'Enterprise Risk', value: report.overall, display: `${report.overall}/100`, band: report.band },
    ...report.categories.map((c) => ({ key: `enterprise.risk.${c.category}`, label: `${c.category[0].toUpperCase()}${c.category.slice(1)} Risk`, value: c.score, display: `${c.score}/100`, band: c.band })),
  ];
}

/* ── HEALTH Engine (the 7 scores) ────────────────────────────────────────────────── */

export interface HealthScore {
  key: 'health' | 'risk' | 'confidence' | 'availability' | 'security' | 'performance' | 'compliance';
  label: string;
  score: number;
  band: Band;
  factors: string[];
}
export interface EnterpriseHealthReport {
  overall: number;
  band: Band;
  scores: HealthScore[];
  byKey: Record<HealthScore['key'], number>;
  builtAt: string;
}

export interface HealthInput {
  model: EnterpriseGraphModel;
  risk: EnterpriseRiskReport;
  dependencies?: DependencyReport | null;
  /** 0–100 compliance signal (e.g. policy coverage / permission-drift inverse); defaults to a security-derived proxy. */
  complianceSignal?: number | null;
}

/** Availability from node health, weighting critical nodes heavily. */
function availabilityScore(nodes: EnterpriseNode[]): { score: number; factors: string[] } {
  const scored = nodes.filter((n) => n.health != null);
  if (!scored.length) return { score: 100, factors: ['no health-bearing nodes yet'] };
  const healthy = scored.filter((n) => n.healthState === 'healthy').length;
  const degraded = scored.filter((n) => n.healthState === 'degraded').length;
  const critical = scored.filter((n) => n.healthState === 'critical').length;
  const score = clamp((healthy * 100 + degraded * 55 + critical * 10) / scored.length - critical * 2);
  return { score, factors: [`${healthy} healthy`, `${degraded} degraded`, `${critical} critical`] };
}

/** Compute the 7 enterprise health scores. */
export function computeEnterpriseHealth(input: HealthInput, nowMs: number): EnterpriseHealthReport {
  const nodes = input.model.nodes;
  const avail = availabilityScore(nodes);

  const bottlenecks = input.dependencies?.bottlenecks.length ?? 0;
  const cycles = input.dependencies?.cycles.length ?? 0;
  const perfScore = clamp(avail.score - bottlenecks * 3 - cycles * 4);

  const securityRisk = input.risk.byCategory.security;
  const identityRisk = input.risk.byCategory.identity;
  const secScore = clamp(100 - (securityRisk * 0.6 + identityRisk * 0.4));

  const compliance = input.complianceSignal != null ? clamp(input.complianceSignal) : clamp(secScore * 0.8 + (100 - input.risk.byCategory.dependency) * 0.2);

  const riskScore = input.risk.overall;
  const scoredNodes = nodes.filter((n) => n.risk != null || n.health != null).length;
  const confidence = clamp(nodes.length ? (scoredNodes / nodes.length) * 100 : 0);

  const overall = clamp(avail.score * 0.3 + perfScore * 0.2 + secScore * 0.2 + compliance * 0.15 + (100 - riskScore) * 0.15);

  const scores: HealthScore[] = [
    { key: 'health', label: 'Enterprise Health', score: overall, band: goodBand(overall), factors: [`${nodes.length} nodes`, `${input.model.crossDomainEdges} cross-domain links`] },
    { key: 'availability', label: 'Availability', score: avail.score, band: goodBand(avail.score), factors: avail.factors },
    { key: 'performance', label: 'Performance', score: perfScore, band: goodBand(perfScore), factors: [`${bottlenecks} bottlenecks`, `${cycles} cycles`] },
    { key: 'security', label: 'Security', score: secScore, band: goodBand(secScore), factors: [`security risk ${securityRisk}`, `identity risk ${identityRisk}`] },
    { key: 'compliance', label: 'Compliance', score: compliance, band: goodBand(compliance), factors: input.complianceSignal != null ? ['policy signal'] : ['derived from security posture'] },
    { key: 'risk', label: 'Risk', score: riskScore, band: riskBand(riskScore), factors: [`${input.risk.topRisks.length} tracked risks`] },
    { key: 'confidence', label: 'Confidence', score: confidence, band: goodBand(confidence), factors: [`${scoredNodes}/${nodes.length} scored`] },
  ];
  const byKey = Object.fromEntries(scores.map((s) => [s.key, s.score])) as Record<HealthScore['key'], number>;

  return { overall, band: goodBand(overall), scores, byKey, builtAt: new Date(nowMs).toISOString() };
}

export function healthKpis(report: EnterpriseHealthReport): ExecutiveKpi[] {
  return report.scores.map((s) => ({ key: `enterprise.health.${s.key}`, label: s.label, value: s.score, display: `${s.score}/100`, band: s.band }));
}
