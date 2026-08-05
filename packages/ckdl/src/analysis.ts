/**
 * Decision Intelligence (NCEA 11.1, Phase 6). Read-only analyses over the governed
 * graph, decisions, evidence, and objectives. EVERY output references its
 * supporting evidence or the explicit relationships it was derived from — the
 * layer explains its reasoning rather than asserting conclusions. Similarity is a
 * transparent keyword+overlap heuristic (real embeddings are infra-pending), so
 * "similar decisions" always shows WHY two decisions are considered similar.
 */
import type { EntityRef } from './entities';
import { refKey } from './entities';
import type { EnterpriseKnowledgeGraph } from './graph';
import type { RelationshipStore, RelationshipType } from './relationships';
import type { DecisionStore, Decision } from './decisions';
import type { EvidenceEngine, EvidenceRecord, Provenance } from './evidence';
import type { PurposeModel } from './objectives';
import type { TrustModel, TrustAssessment } from './trust';
import { keywordSimilarity } from './util';

export interface SimilarDecision {
  decision: Decision;
  score: number;
  sharedEvidenceIds: string[];
  why: string;
}

export interface EvidenceGap {
  kind: string;
  detail: string;
}

export interface RecommendationExplanation {
  statement: string;
  evidenceCount: number;
  provenance: Provenance[];
  unknownEvidenceIds: string[];
  trust: TrustAssessment;
  explanation: string;
}

export interface AnalysisDeps {
  graph: EnterpriseKnowledgeGraph;
  relationships: RelationshipStore;
  decisions: DecisionStore;
  evidence: EvidenceEngine;
  objectives: PurposeModel;
  trust: TrustModel;
}

const IMPACT_TYPES: RelationshipType[] = ['depends-on', 'blocks', 'contributes-to'];

export class DecisionIntelligence {
  constructor(private readonly deps: AnalysisDeps) {}

  /** Evidence about an entity plus evidence about its one-hop neighbours. */
  relatedEvidence(ref: EntityRef): EvidenceRecord[] {
    const seen = new Set<string>();
    const out: EvidenceRecord[] = [];
    const collect = (r: EntityRef): void => {
      for (const e of this.deps.evidence.about(r)) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    };
    collect(ref);
    for (const neighbor of this.deps.graph.neighbors(ref)) collect({ kind: neighbor.kind, id: neighbor.sourceId });
    return out;
  }

  /** Rank other decisions by transparent similarity: text overlap + shared evidence. */
  similarDecisions(decisionId: string, limit = 5): SimilarDecision[] {
    const target = this.deps.decisions.get(decisionId);
    if (!target) return [];
    const targetEvidence = new Set(target.evidenceIds);
    const out: SimilarDecision[] = [];
    for (const decision of this.deps.decisions.list()) {
      if (decision.id === decisionId) continue;
      const textScore = keywordSimilarity(`${target.purpose} ${target.context}`, `${decision.purpose} ${decision.context}`);
      const shared = decision.evidenceIds.filter((id) => targetEvidence.has(id));
      const union = new Set([...target.evidenceIds, ...decision.evidenceIds]).size;
      const evidenceScore = union > 0 ? shared.length / union : 0;
      const score = 0.6 * textScore + 0.4 * evidenceScore;
      if (score > 0)
        out.push({
          decision,
          score,
          sharedEvidenceIds: shared,
          why: `text overlap ${(textScore * 100).toFixed(0)}%, ${shared.length} shared evidence item(s)`,
        });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Entities that would be affected if this one changed (incoming impact edges, transitively). */
  impactAnalysis(ref: EntityRef): { affectedKeys: string[]; objectivesTouched: string[] } {
    const start = refKey(ref);
    const affected = this.walk(start, 'incoming');
    const objectivesTouched = this.deps.objectives
      .list()
      .filter((o) => o.linkKeys.some((k) => affected.includes(k) || k === start))
      .map((o) => o.id);
    return { affectedKeys: affected, objectivesTouched };
  }

  /** What this entity depends on (outgoing depends-on edges, transitively). */
  dependencyAnalysis(ref: EntityRef): string[] {
    const start = refKey(ref);
    return this.walk(start, 'outgoing');
  }

  private walk(start: string, direction: 'incoming' | 'outgoing'): string[] {
    const seen = new Set<string>([start]);
    const result: string[] = [];
    const queue = [start];
    while (queue.length) {
      const key = queue.shift()!;
      for (const edge of this.deps.relationships.of(key)) {
        let next: string | undefined;
        if (direction === 'outgoing' && edge.from === key && edge.type === 'depends-on') next = edge.to;
        if (direction === 'incoming' && edge.to === key && IMPACT_TYPES.includes(edge.type)) next = edge.from;
        if (next && !seen.has(next)) {
          seen.add(next);
          result.push(next);
          queue.push(next);
        }
      }
    }
    return result;
  }

  /** Evidence gaps in a decision — surfaced honestly so weak decisions are visible. */
  missingEvidence(decisionId: string): EvidenceGap[] {
    const decision = this.deps.decisions.get(decisionId);
    if (!decision) return [];
    const records = decision.evidenceIds.map((id) => this.deps.evidence.get(id)).filter((e): e is EvidenceRecord => Boolean(e));
    const gaps: EvidenceGap[] = [];
    if (!records.some((e) => e.type === 'human-input')) gaps.push({ kind: 'human-input', detail: 'no human input is recorded for this decision' });
    if (!records.some((e) => e.verified)) gaps.push({ kind: 'verification', detail: 'no evidence has been independently verified' });
    if (!records.some((e) => e.type === 'metric')) gaps.push({ kind: 'metric', detail: 'no quantitative metric backs this decision' });
    for (const alt of decision.alternatives) if (!alt.rationale) gaps.push({ kind: 'rationale', detail: `alternative "${alt.label}" has no rationale` });
    if (decision.confidence === undefined) gaps.push({ kind: 'confidence', detail: 'the owner has not stated a confidence level' });
    return gaps;
  }

  /**
   * Explain a recommendation. A recommendation MUST reference evidence; this
   * resolves that evidence to provenance and attaches an explainable trust
   * assessment. Throws if no evidence is referenced — recommendations without
   * provenance are not permitted.
   */
  explainRecommendation(input: { statement: string; evidenceIds: string[] }, options: { now?: number } = {}): RecommendationExplanation {
    if (input.evidenceIds.length === 0) throw new Error('a recommendation must reference evidence');
    const records = input.evidenceIds.map((id) => this.deps.evidence.get(id)).filter((e): e is EvidenceRecord => Boolean(e));
    const unknownEvidenceIds = input.evidenceIds.filter((id) => !this.deps.evidence.has(id));
    const trust = this.deps.trust.assessEvidence(records, {}, options);
    return {
      statement: input.statement,
      evidenceCount: records.length,
      provenance: this.deps.evidence.provenance(input.evidenceIds),
      unknownEvidenceIds,
      trust,
      explanation: `Backed by ${records.length} evidence item(s); trust ${trust.band} (${(trust.score * 100).toFixed(0)}%).${unknownEvidenceIds.length ? ` ${unknownEvidenceIds.length} referenced id(s) not found.` : ''}`,
    };
  }
}
