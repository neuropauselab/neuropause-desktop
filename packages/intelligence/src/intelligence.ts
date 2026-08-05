/**
 * Module 8 — Intelligence Services. Deterministic analytics over the graph + timeline:
 * risk, trend, pattern, anomaly, dependency mapping, opportunity, knowledge
 * recommendations, and duplicate detection. Each returns evidence-cited findings with
 * confidence — no LLM, no fabrication.
 */
import { computeConfidence, type EvidenceRef } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseTimeline } from './timeline';
import type { ReasoningEngine } from './reasoning';
import type { IntelligenceService } from './constants';

export interface Finding {
  service: IntelligenceService;
  label: string;
  detail: string;
  entityId?: string;
  evidence: EvidenceRef[];
}

export interface ServiceResult {
  service: IntelligenceService;
  findings: Finding[];
  confidence: number;
}

const result = (service: IntelligenceService, findings: Finding[]): ServiceResult => ({
  service,
  findings,
  confidence: computeConfidence(findings.flatMap((f) => f.evidence)).score,
});

export class IntelligenceServices {
  constructor(
    private readonly graph: KnowledgeGraph,
    private readonly timeline: EnterpriseTimeline,
    private readonly reasoning: ReasoningEngine,
  ) {}

  risk(tenantId: string): ServiceResult {
    const inf = this.reasoning.riskDetection(tenantId);
    const findings: Finding[] = this.graph
      .list(tenantId)
      .filter((e) => ['at-risk', 'behind', 'error', 'expired'].includes(String(e.metadata.status)))
      .map((e) => ({ service: 'risk' as const, label: e.label, detail: `status ${e.metadata.status}`, entityId: e.id, evidence: e.evidence }));
    void inf;
    return result('risk', findings);
  }

  trend(tenantId: string): ServiceResult {
    const events = this.timeline.unified(tenantId);
    if (events.length < 2) return result('trend', []);
    const mid = events[Math.floor(events.length / 2)].at;
    const findings: Finding[] = (['engineering', 'data', 'security', 'operations', 'compliance'] as const).map((track) => {
      const first = events.filter((e) => e.track === track && e.at < mid).length;
      const second = events.filter((e) => e.track === track && e.at >= mid).length;
      const dir = second > first ? 'rising' : second < first ? 'falling' : 'flat';
      return { service: 'trend' as const, label: `${track} activity ${dir}`, detail: `${first} → ${second}`, evidence: [{ kind: 'timeline', id: track, source: 'timeline' }] };
    });
    return result('trend', findings.filter((f) => !f.label.endsWith('flat')));
  }

  pattern(tenantId: string): ServiceResult {
    const counts = new Map<string, number>();
    for (const e of this.timeline.unified(tenantId)) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const findings: Finding[] = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([type, n]) => ({ service: 'pattern' as const, label: `recurring: ${type}`, detail: `${n} occurrences`, evidence: [{ kind: 'timeline', id: type, source: 'timeline' }] }));
    return result('pattern', findings);
  }

  anomaly(tenantId: string): ServiceResult {
    const events = this.timeline.unified(tenantId);
    const errors = events.filter((e) => /error|fail|expired|behind/.test(e.type));
    const findings: Finding[] = errors.map((e) => ({ service: 'anomaly' as const, label: `anomaly: ${e.type}`, detail: `on ${e.entityId}`, entityId: e.entityId, evidence: [{ kind: 'timeline', id: e.entityId, source: e.source, detail: e.type, at: e.at }] }));
    return result('anomaly', findings);
  }

  dependency(tenantId: string): ServiceResult {
    const edges = [...this.graph.relations(tenantId, 'depends_on'), ...this.graph.relations(tenantId, 'blocks'), ...this.graph.relations(tenantId, 'measures')];
    const findings: Finding[] = edges.map((edge) => {
      const from = this.graph.get(edge.from);
      const to = this.graph.get(edge.to);
      return { service: 'dependency' as const, label: `${from?.label ?? edge.from} ${edge.type} ${to?.label ?? edge.to}`, detail: edge.type, evidence: [...(from?.evidence ?? []), ...(to?.evidence ?? [])] };
    });
    return result('dependency', findings);
  }

  opportunity(tenantId: string): ServiceResult {
    const findings: Finding[] = this.graph
      .list(tenantId, 'objective')
      .filter((o) => Number(o.metadata.progress ?? 0) >= 70 && o.metadata.status !== 'done')
      .map((o) => ({ service: 'opportunity' as const, label: `near completion: ${o.label}`, detail: `${o.metadata.progress}% progress`, entityId: o.id, evidence: o.evidence }));
    return result('opportunity', findings);
  }

  recommendation(tenantId: string): ServiceResult {
    const findings: Finding[] = this.graph
      .list(tenantId)
      .filter((e) => e.type !== 'organization' && this.graph.edgesOf(e.id).length === 0)
      .slice(0, 20)
      .map((e) => ({ service: 'recommendation' as const, label: `unlinked ${e.type}: ${e.label}`, detail: 'consider connecting to the graph', entityId: e.id, evidence: e.evidence }));
    return result('recommendation', findings);
  }

  duplicate(tenantId: string): ServiceResult {
    const groups = new Map<string, string[]>();
    for (const e of this.graph.list(tenantId)) {
      const key = `${e.type}:${e.label.toLowerCase().trim()}`;
      groups.set(key, [...(groups.get(key) ?? []), e.id]);
    }
    const findings: Finding[] = [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => ({ service: 'duplicate' as const, label: `possible duplicates: ${key}`, detail: `${ids.length} entities`, evidence: ids.flatMap((id) => this.graph.evidence(id)) }));
    return result('duplicate', findings);
  }

  all(tenantId: string): Record<IntelligenceService, ServiceResult> {
    return {
      risk: this.risk(tenantId),
      trend: this.trend(tenantId),
      pattern: this.pattern(tenantId),
      anomaly: this.anomaly(tenantId),
      dependency: this.dependency(tenantId),
      opportunity: this.opportunity(tenantId),
      recommendation: this.recommendation(tenantId),
      duplicate: this.duplicate(tenantId),
    };
  }
}
