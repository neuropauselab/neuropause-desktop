/**
 * Module 3 — Enterprise Reasoning Engine. DETERMINISTIC analytics over the knowledge
 * graph + timeline — root cause, dependency, impact, timeline reasoning, risk detection,
 * decision explanation, evidence aggregation. No LLM is used or needed: these are graph
 * algorithms, and every result cites the real evidence it used. "No AI answer may bypass
 * evidence" is structural — an inference with no evidence returns confidence 0 and an
 * explicit insufficient-evidence answer.
 */
import { computeConfidence, type Inference, type EvidenceRef, type Entity } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseTimeline } from './timeline';

const RISKY_STATUS = new Set(['at-risk', 'behind', 'error', 'expired']);

function reachable(graph: KnowledgeGraph, startId: string, cap = 200): Entity[] {
  const seen = new Set<string>([startId]);
  const out: Entity[] = [];
  const queue = [startId];
  while (queue.length && out.length < cap) {
    const id = queue.shift()!;
    for (const n of graph.neighbors(id)) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
        queue.push(n.id);
      }
    }
  }
  return out;
}

const timelineEvidence = (source: string, id: string, type: string, at: number): EvidenceRef => ({ kind: 'timeline', id, source, detail: type, at });

export class ReasoningEngine {
  constructor(
    private readonly graph: KnowledgeGraph,
    private readonly timeline: EnterpriseTimeline,
  ) {}

  rootCause(tenantId: string, entityId: string): Inference {
    const entity = this.graph.get(entityId);
    const events = this.timeline.forEntity(tenantId, entityId);
    const failures = events.filter((e) => /error|fail|at-risk|behind|expired/.test(e.type));
    const upstream = this.graph.neighbors(entityId, 'depends_on');
    const evidence: EvidenceRef[] = [
      ...(entity?.evidence ?? []),
      ...failures.map((e) => timelineEvidence(e.source, e.entityId, e.type, e.at)),
      ...upstream.flatMap((u) => u.evidence),
    ];
    const answer = failures.length
      ? `Likely contributing signals: ${failures.slice(-3).map((e) => e.type).join(', ')}${upstream.length ? `; upstream dependencies: ${upstream.map((u) => u.label).join(', ')}` : ''}.`
      : 'No failure signals found in the timeline for this entity — insufficient evidence for a root cause.';
    return {
      question: `Root cause for ${entity?.label ?? entityId}`,
      kind: 'root-cause',
      answer,
      confidence: computeConfidence(evidence),
      evidence,
      steps: [`Inspected ${events.length} timeline event(s)`, `Found ${failures.length} failure signal(s)`, `Traced ${upstream.length} upstream dependency(ies)`],
    };
  }

  dependencyAnalysis(tenantId: string, entityId: string): Inference {
    void tenantId;
    const entity = this.graph.get(entityId);
    const dependsOn = this.graph.neighbors(entityId, 'depends_on');
    const blocks = this.graph.neighbors(entityId, 'blocks');
    const measures = this.graph.neighbors(entityId, 'measures');
    const related = [...dependsOn, ...blocks, ...measures];
    const evidence = [...(entity?.evidence ?? []), ...related.flatMap((r) => r.evidence)];
    return {
      question: `Dependencies of ${entity?.label ?? entityId}`,
      kind: 'dependency',
      answer: related.length
        ? `Depends on ${dependsOn.length}, blocks ${blocks.length}, measured by ${measures.length}: ${related.map((r) => r.label).slice(0, 8).join(', ')}.`
        : 'No dependency edges found — insufficient evidence.',
      confidence: computeConfidence(evidence),
      evidence,
      steps: [`depends_on: ${dependsOn.length}`, `blocks: ${blocks.length}`, `measures: ${measures.length}`],
    };
  }

  impactAnalysis(tenantId: string, entityId: string): Inference {
    void tenantId;
    const entity = this.graph.get(entityId);
    const impacted = reachable(this.graph, entityId);
    const evidence = [...(entity?.evidence ?? []), ...impacted.flatMap((i) => i.evidence)];
    return {
      question: `Blast radius of ${entity?.label ?? entityId}`,
      kind: 'impact',
      answer: impacted.length
        ? `${impacted.length} connected entity(ies) could be affected, including: ${impacted.map((i) => i.label).slice(0, 8).join(', ')}.`
        : 'No connected entities — impact appears isolated (or insufficient graph evidence).',
      confidence: computeConfidence(evidence),
      evidence,
      steps: [`Breadth-first reach from ${entity?.label ?? entityId}`, `${impacted.length} entities reachable`],
    };
  }

  timelineReasoning(tenantId: string, entityId?: string): Inference {
    const events = entityId ? this.timeline.forEntity(tenantId, entityId) : this.timeline.unified(tenantId);
    const evidence = events.slice(-10).map((e) => timelineEvidence(e.source, e.entityId, e.type, e.at));
    const first = events[0];
    const last = events[events.length - 1];
    return {
      question: entityId ? `Timeline for ${entityId}` : 'Tenant activity timeline',
      kind: 'timeline',
      answer: events.length
        ? `${events.length} event(s) from ${first?.type ?? '?'} to ${last?.type ?? '?'}; most recent: ${events.slice(-3).map((e) => e.type).join(', ')}.`
        : 'No timeline events recorded — insufficient evidence.',
      confidence: computeConfidence(evidence),
      evidence,
      steps: [`${events.length} events examined chronologically`],
    };
  }

  riskDetection(tenantId: string): Inference {
    const risky = this.graph.list(tenantId).filter((e) => RISKY_STATUS.has(String(e.metadata.status)) || String(e.metadata.risk ?? '') !== '');
    const evidence = risky.flatMap((e) => e.evidence);
    return {
      question: 'Enterprise risk detection',
      kind: 'risk',
      answer: risky.length
        ? `${risky.length} at-risk entity(ies): ${risky.map((e) => `${e.label} (${e.metadata.status ?? e.metadata.risk})`).slice(0, 8).join(', ')}.`
        : 'No at-risk entities detected in current data.',
      confidence: computeConfidence(evidence),
      evidence,
      steps: [`Scanned ${this.graph.list(tenantId).length} entities for risky status/flags`, `${risky.length} flagged`],
    };
  }

  /** Aggregate the evidence backing a set of entities (Evidence Aggregation). */
  evidenceAggregation(entityIds: string[]): { evidence: EvidenceRef[]; confidence: ReturnType<typeof computeConfidence> } {
    const evidence = entityIds.flatMap((id) => this.graph.evidence(id));
    return { evidence, confidence: computeConfidence(evidence) };
  }

  /** Structured, evidence-cited rationale for a decision/question over named entities. */
  decisionExplanation(tenantId: string, question: string, entityIds: string[]): Inference {
    void tenantId;
    const entities = entityIds.map((id) => this.graph.get(id)).filter((e): e is Entity => e !== undefined);
    const evidence = entities.flatMap((e) => e.evidence);
    return {
      question,
      kind: 'decision-explanation',
      answer: entities.length
        ? `Grounded in ${entities.length} entity(ies): ${entities.map((e) => `${e.type} '${e.label}'`).join('; ')}.`
        : 'No matching entities — cannot explain without evidence.',
      confidence: computeConfidence(evidence),
      evidence,
      steps: entities.map((e) => `Considered ${e.type} '${e.label}'`),
    };
  }
}
