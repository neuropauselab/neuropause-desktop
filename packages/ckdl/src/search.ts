/**
 * Constitutional Search (NCEA 11.1, Phase 7). This does NOT do text or semantic
 * matching — that stays in the existing search interfaces (keyword today, vector
 * when available). It COMPOSES on top: given the entities an upstream search
 * already matched, it enriches each with its governed context — relationships,
 * evidence, linked decisions and objectives, linked work, and an explainable
 * trust indicator. Search results stop being flat rows and become entry points
 * into the governed graph.
 */
import type { EntityRef, EntityKind } from './entities';
import { refKey } from './entities';
import type { EnterpriseKnowledgeGraph } from './graph';
import type { RelationshipStore } from './relationships';
import type { EvidenceEngine } from './evidence';
import type { DecisionStore } from './decisions';
import type { PurposeModel } from './objectives';
import type { TrustModel, TrustAssessment } from './trust';

export interface ConstitutionalResult {
  ref: EntityRef;
  key: string;
  kind: EntityKind;
  label: string;
  relationshipCount: number;
  neighborKeys: string[];
  evidenceCount: number;
  decisionIds: string[];
  objectiveIds: string[];
  linkedWorkKeys: string[];
  trust?: TrustAssessment;
}

export interface SearchDeps {
  graph: EnterpriseKnowledgeGraph;
  relationships: RelationshipStore;
  evidence: EvidenceEngine;
  decisions: DecisionStore;
  objectives: PurposeModel;
  trust: TrustModel;
}

export class ConstitutionalSearch {
  constructor(private readonly deps: SearchDeps) {}

  /** Enrich one matched entity with its full governed context. */
  forEntity(ref: EntityRef): ConstitutionalResult {
    const key = refKey(ref);
    const node = this.deps.graph.get(ref);
    const evidence = this.deps.evidence.about(ref);
    const decisions = this.deps.decisions
      .list()
      .filter((d) => d.linkedTaskKeys.includes(key) || d.linkedDocumentKeys.includes(key) || d.riskKeys.includes(key));
    const objectives = this.deps.objectives.list().filter((o) => o.linkKeys.includes(key));
    const edges = this.deps.relationships.of(key);
    const linkedWork = edges
      .map((e) => (e.from === key ? e.to : e.from))
      .filter((k) => k.startsWith('task:') || k.startsWith('document:') || k.startsWith('project:'));

    const result: ConstitutionalResult = {
      ref,
      key,
      kind: ref.kind,
      label: node?.label ?? key,
      relationshipCount: edges.length,
      neighborKeys: this.deps.relationships.neighbors(key),
      evidenceCount: evidence.length,
      decisionIds: decisions.map((d) => d.id),
      objectiveIds: objectives.map((o) => o.id),
      linkedWorkKeys: [...new Set(linkedWork)],
    };
    if (evidence.length > 0) result.trust = this.deps.trust.assessEvidence(evidence);
    return result;
  }

  /** Enrich a set of matched entities (the output of the existing search). */
  enrich(refs: EntityRef[]): ConstitutionalResult[] {
    return refs.map((ref) => this.forEntity(ref));
  }
}
