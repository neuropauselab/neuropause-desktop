/**
 * Decision Graph (NCEA 11.1, Phase 2). Governed, evidence-bound, replayable
 * decisions. A decision CANNOT be recorded without referencing evidence that
 * actually exists in the Evidence Engine — "every decision has evidence" is
 * enforced here, not assumed. Each decision keeps an append-only lifecycle log
 * (propose → approve/reject → execute/supersede), so `replay()` reconstructs
 * exactly how it unfolded. Every transition is governed (audit + event).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EntityRef } from './entities';
import { refKey } from './entities';
import type { EvidenceEngine, Provenance } from './evidence';
import type { KnowledgeGovernance } from './governance';

export type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'executed' | 'superseded';
export type DecisionApproval = 'pending' | 'approved' | 'rejected';

export interface Alternative {
  label: string;
  chosen: boolean;
  rationale?: string;
}

export interface DecisionEvent {
  at: number;
  action: string;
  actor: string;
  detail?: string;
}

export interface Decision {
  id: string;
  purpose: string;
  context: string;
  alternatives: Alternative[];
  evidenceIds: string[];
  riskKeys: string[];
  owner: string;
  status: DecisionStatus;
  approval: DecisionApproval;
  outcome?: string;
  /** Owner-declared confidence in the decision, 0..1 — recorded, never invented. */
  confidence?: number;
  linkedTaskKeys: string[];
  linkedDocumentKeys: string[];
  linkedAiSessionIds: string[];
  createdAt: number;
  decidedAt?: number;
  history: DecisionEvent[];
}

export interface ProposeDecisionInput {
  purpose: string;
  context: string;
  alternatives: Alternative[];
  evidenceIds: string[];
  owner: string;
  confidence?: number;
  risks?: EntityRef[];
  linkedTasks?: EntityRef[];
  linkedDocuments?: EntityRef[];
  linkedAiSessions?: string[];
}

export class DecisionStore {
  private readonly decisions = new Map<string, Decision>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: KnowledgeGovernance,
    private readonly evidence: EvidenceEngine,
  ) {}

  async propose(input: ProposeDecisionInput): Promise<Decision> {
    // Constitutional rule: a decision must reference evidence, and that evidence
    // must actually exist. No fabricated backing.
    if (input.evidenceIds.length === 0) throw new Error('a decision must reference at least one piece of evidence');
    const missing = input.evidenceIds.filter((id) => !this.evidence.has(id));
    if (missing.length) throw new Error(`decision references unknown evidence: ${missing.join(', ')}`);
    if (!input.alternatives.some((a) => a.chosen)) throw new Error('a decision must mark one alternative as chosen');

    const now = this.clock.now();
    const decision: Decision = {
      id: randomId('dec'),
      purpose: input.purpose,
      context: input.context,
      alternatives: input.alternatives,
      evidenceIds: [...input.evidenceIds],
      riskKeys: (input.risks ?? []).map(refKey),
      owner: input.owner,
      status: 'proposed',
      approval: 'pending',
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      linkedTaskKeys: (input.linkedTasks ?? []).map(refKey),
      linkedDocumentKeys: (input.linkedDocuments ?? []).map(refKey),
      linkedAiSessionIds: [...(input.linkedAiSessions ?? [])],
      createdAt: now,
      history: [{ at: now, action: 'proposed', actor: input.owner }],
    };
    this.decisions.set(decision.id, decision);
    await this.governance.record({
      domain: 'decision',
      action: 'propose',
      entity: decision.id,
      actor: input.owner,
      ok: true,
      evidenceIds: decision.evidenceIds,
      meta: { purpose: decision.purpose, alternatives: decision.alternatives.length },
    });
    return decision;
  }

  async decide(id: string, approve: boolean, actor: string, detail?: string): Promise<Decision> {
    const decision = this.require(id);
    decision.approval = approve ? 'approved' : 'rejected';
    decision.status = approve ? 'approved' : 'rejected';
    decision.decidedAt = this.clock.now();
    decision.history.push({ at: decision.decidedAt, action: approve ? 'approved' : 'rejected', actor, ...(detail ? { detail } : {}) });
    await this.governance.record({
      domain: 'decision',
      action: approve ? 'approve' : 'reject',
      entity: id,
      actor,
      ok: true,
      evidenceIds: decision.evidenceIds,
    });
    return decision;
  }

  async execute(id: string, outcome: string, actor: string): Promise<Decision> {
    const decision = this.require(id);
    if (decision.approval !== 'approved') throw new Error('only an approved decision can be executed');
    decision.status = 'executed';
    decision.outcome = outcome;
    decision.history.push({ at: this.clock.now(), action: 'executed', actor, detail: outcome });
    await this.governance.record({ domain: 'decision', action: 'execute', entity: id, actor, ok: true, evidenceIds: decision.evidenceIds });
    return decision;
  }

  async supersede(id: string, bySupersedingId: string, actor: string): Promise<Decision> {
    const decision = this.require(id);
    decision.status = 'superseded';
    decision.history.push({ at: this.clock.now(), action: 'superseded', actor, detail: bySupersedingId });
    await this.governance.record({ domain: 'decision', action: 'supersede', entity: id, actor, ok: true, meta: { by: bySupersedingId } });
    return decision;
  }

  get(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  list(status?: DecisionStatus): Decision[] {
    const all = [...this.decisions.values()];
    return status ? all.filter((d) => d.status === status) : all;
  }

  /** Replay the decision exactly as it unfolded — the lifecycle log + its evidence provenance. */
  replay(id: string): { decision: Decision; timeline: DecisionEvent[]; provenance: Provenance[] } {
    const decision = this.require(id);
    return {
      decision,
      timeline: [...decision.history],
      provenance: this.evidence.provenance(decision.evidenceIds),
    };
  }

  private require(id: string): Decision {
    const decision = this.decisions.get(id);
    if (!decision) throw new Error(`decision '${id}' not found`);
    return decision;
  }
}
