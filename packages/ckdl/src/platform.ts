/**
 * CKDL composition root (NCEA 11.1, Phase 8). `createKnowledgeLayer(runtime)`
 * assembles the enterprise knowledge graph, relationships, evidence engine, trust
 * model, decision store, objectives, decision intelligence, and constitutional
 * search onto an EXISTING Enterprise Runtime — sharing its one audit chain and
 * event bus through one KnowledgeGovernance. This is the `runtime.knowledgeGraph()
 * /decisionGraph()/objectives()/evidence()/trust()/relationships()/decisions()/
 * analysis()` surface Mission Control consumes. One layer, one graph, hosted by
 * the runtime; no new runtime, no duplicate knowledge system.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { CKDL_VERSION } from './constants';
import { KnowledgeGovernance } from './governance';
import { RelationshipStore } from './relationships';
import { EnterpriseKnowledgeGraph } from './graph';
import { EvidenceEngine, type Provenance } from './evidence';
import { TrustModel } from './trust';
import { DecisionStore, type Decision } from './decisions';
import { PurposeModel } from './objectives';
import { DecisionIntelligence } from './analysis';
import { ConstitutionalSearch } from './search';

export interface KnowledgeLayerOptions {
  clock?: Clock;
}

/** Decision-centric graph view: a decision plus everything it links to. */
export interface DecisionGraphNode {
  decision: Decision;
  provenance: Provenance[];
  linkedTaskKeys: string[];
  linkedDocumentKeys: string[];
  linkedAiSessionIds: string[];
  riskKeys: string[];
}

export interface DecisionGraphView {
  node(id: string): DecisionGraphNode | undefined;
  all(): DecisionGraphNode[];
}

export interface KnowledgeLayer {
  version: string;
  knowledgeGraph(): EnterpriseKnowledgeGraph;
  decisionGraph(): DecisionGraphView;
  objectives(): PurposeModel;
  evidence(): EvidenceEngine;
  trust(): TrustModel;
  relationships(): RelationshipStore;
  decisions(): DecisionStore;
  analysis(): DecisionIntelligence;
  search(): ConstitutionalSearch;
  governance(): KnowledgeGovernance;
}

export function createKnowledgeLayer(runtime: EnterpriseRuntime, options: KnowledgeLayerOptions = {}): KnowledgeLayer {
  const clock = options.clock ?? systemClock;
  const governance = new KnowledgeGovernance(runtime, clock);

  const relationships = new RelationshipStore(clock, governance);
  const graph = new EnterpriseKnowledgeGraph(clock, governance, relationships);
  const evidence = new EvidenceEngine(clock, governance);
  const trust = new TrustModel(clock, governance);
  const decisions = new DecisionStore(clock, governance, evidence);
  const objectives = new PurposeModel(clock, governance);
  const analysis = new DecisionIntelligence({ graph, relationships, decisions, evidence, objectives, trust });
  const search = new ConstitutionalSearch({ graph, relationships, evidence, decisions, objectives, trust });

  const decisionGraph: DecisionGraphView = {
    node: (id) => {
      const decision = decisions.get(id);
      if (!decision) return undefined;
      return {
        decision,
        provenance: evidence.provenance(decision.evidenceIds),
        linkedTaskKeys: decision.linkedTaskKeys,
        linkedDocumentKeys: decision.linkedDocumentKeys,
        linkedAiSessionIds: decision.linkedAiSessionIds,
        riskKeys: decision.riskKeys,
      };
    },
    all: () =>
      decisions.list().map((decision) => ({
        decision,
        provenance: evidence.provenance(decision.evidenceIds),
        linkedTaskKeys: decision.linkedTaskKeys,
        linkedDocumentKeys: decision.linkedDocumentKeys,
        linkedAiSessionIds: decision.linkedAiSessionIds,
        riskKeys: decision.riskKeys,
      })),
  };

  return {
    version: CKDL_VERSION,
    knowledgeGraph: () => graph,
    decisionGraph: () => decisionGraph,
    objectives: () => objectives,
    evidence: () => evidence,
    trust: () => trust,
    relationships: () => relationships,
    decisions: () => decisions,
    analysis: () => analysis,
    search: () => search,
    governance: () => governance,
  };
}
