/**
 * P7 — the Recommendation Engine. Synthesizes ONE ranked list of enterprise recommendations across every P7
 * engine (health, risk, dependency, drift, capacity, incidents) — deduped and ranked by priority × confidence.
 * Pure + deterministic. It explains findings the other engines already produced; it does not create new
 * intelligence, mirroring the existing Executive recommendation pattern.
 */
import type { CapacityReport } from './enterpriseCapacity';
import type { DependencyReport } from './enterpriseGraph';
import type { EnterpriseDriftReport } from './enterpriseDrift';
import type { EnterpriseHealthReport, EnterpriseRiskReport } from './enterpriseHealth';
import type { IncidentReport } from './enterpriseRootCause';

export type RecoCategory = 'health' | 'risk' | 'drift' | 'dependency' | 'capacity' | 'incident' | 'security';
export type RecoPriority = 'critical' | 'high' | 'medium' | 'low';

export interface IntelRecommendation {
  id: string;
  category: RecoCategory;
  title: string;
  detail: string;
  priority: RecoPriority;
  /** 0–1. */
  confidence: number;
  /** Node/incident/domain ids backing the recommendation. */
  evidence: string[];
}

export interface RecommendationInput {
  health: EnterpriseHealthReport;
  risk: EnterpriseRiskReport;
  dependencies: DependencyReport;
  drift: EnterpriseDriftReport;
  capacity: CapacityReport;
  incidents: IncidentReport;
}

const PRIORITY_RANK: Record<RecoPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
function bandToPriority(score: number, higherIsWorse: boolean): RecoPriority {
  const risk = higherIsWorse ? score : 100 - score;
  if (risk >= 75) return 'critical';
  if (risk >= 50) return 'high';
  if (risk >= 25) return 'medium';
  return 'low';
}

/** Synthesize + rank recommendations across all engines. */
export function buildEnterpriseRecommendations(input: RecommendationInput, _nowMs: number): IntelRecommendation[] {
  const recs: IntelRecommendation[] = [];

  // Incidents (highest signal).
  for (const inc of input.incidents.incidents.slice(0, 10)) {
    if (inc.severity === 'info') continue;
    recs.push({
      id: `reco:${inc.id}`,
      category: 'incident',
      title: inc.title,
      detail: inc.recommendedActions[0] ?? 'Investigate the correlated events.',
      priority: inc.severity === 'critical' ? 'critical' : 'high',
      confidence: inc.confidence,
      evidence: inc.resourceIds.slice(0, 5),
    });
  }

  // Risk categories that are elevated.
  for (const c of input.risk.categories) {
    if (c.score < 50) continue;
    recs.push({
      id: `reco:risk:${c.category}`,
      category: c.category === 'security' || c.category === 'identity' ? 'security' : 'risk',
      title: `Reduce ${c.category} risk (${c.score}/100)`,
      detail: c.contributors.length ? `Top contributor: ${c.contributors[0].label} — ${c.contributors[0].reason}.` : `${c.category} risk is elevated across ${c.sampleSize} entities.`,
      priority: bandToPriority(c.score, true),
      confidence: input.risk.confidence,
      evidence: c.contributors.slice(0, 5).map((x) => x.id),
    });
  }

  // Dependency structure.
  if (input.dependencies.cycles.length) {
    recs.push({ id: 'reco:dep:cycles', category: 'dependency', title: `Break ${input.dependencies.cycles.length} dependency cycle(s)`, detail: `Largest cycle spans ${input.dependencies.cycles[0].size} nodes across ${input.dependencies.cycles[0].domains.join(', ')}.`, priority: 'high', confidence: 0.9, evidence: input.dependencies.cycles[0].nodes.slice(0, 5) });
  }
  for (const spof of input.dependencies.spofs.filter((s) => s.blastRadius >= 5).slice(0, 3)) {
    recs.push({ id: `reco:spof:${spof.id}`, category: 'dependency', title: `Add redundancy for ${spof.label}`, detail: `Single point of failure — ${spof.blastRadius} resources transitively depend on it.`, priority: spof.blastRadius >= 10 ? 'critical' : 'high', confidence: 0.85, evidence: [spof.id] });
  }

  // Drift.
  if (input.drift.totalDrifted > 0) {
    recs.push({ id: 'reco:drift', category: 'drift', title: `Reconcile ${input.drift.totalDrifted} drifted item(s)`, detail: input.drift.topDrift.length ? `Top: ${input.drift.topDrift[0].label} (${input.drift.topDrift[0].status}).` : 'Configuration diverges from the declared baseline.', priority: bandToPriority(input.drift.driftScore, false), confidence: 0.9, evidence: input.drift.topDrift.slice(0, 5).map((d) => d.key) });
  }

  // Capacity.
  for (const p of input.capacity.pressureNodes.slice(0, 3)) {
    recs.push({ id: `reco:cap:${p.id}`, category: 'capacity', title: `Scale ${p.label}`, detail: `${p.utilization ?? '?'}% utilization — ${p.pressure} capacity pressure.`, priority: p.pressure === 'critical' ? 'high' : 'medium', confidence: 0.8, evidence: [p.id] });
  }

  // Health scores that are poor.
  for (const s of input.health.scores) {
    if (s.key === 'risk' || s.key === 'confidence') continue;
    if (s.score >= 50) continue;
    recs.push({ id: `reco:health:${s.key}`, category: s.key === 'security' || s.key === 'compliance' ? 'security' : 'health', title: `Improve ${s.label} (${s.score}/100)`, detail: s.factors.join('; '), priority: bandToPriority(s.score, false), confidence: 0.75, evidence: [] });
  }

  // Dedupe by id (keep the highest priority), then rank.
  const byId = new Map<string, IntelRecommendation>();
  for (const r of recs) {
    const prev = byId.get(r.id);
    if (!prev || PRIORITY_RANK[r.priority] > PRIORITY_RANK[prev.priority]) byId.set(r.id, r);
  }
  return [...byId.values()]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, 50);
}
