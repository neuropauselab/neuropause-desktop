/**
 * Evidence Engine (NCEA 11.1, Phase 3). Every recommendation and every decision
 * references evidence, and every piece of evidence carries provenance — its type,
 * its source, when it was observed, and (optionally) the entity it concerns. The
 * engine never invents evidence: callers record what actually happened (a human
 * note, an AI output, a connector event, a document, a metric, an audit entry, a
 * runtime event, an external reference), and downstream analysis can only cite
 * evidence that exists here.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { EntityRef } from './entities';
import { refKey } from './entities';
import { clamp01 } from './util';
import type { KnowledgeGovernance } from './governance';

export const EVIDENCE_TYPES = [
  'human-input',
  'ai-output',
  'connector-event',
  'document',
  'metric',
  'audit-history',
  'runtime-event',
  'external-reference',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface EvidenceRecord {
  id: string;
  type: EvidenceType;
  summary: string;
  /** Provenance: where this evidence came from (actor, connector id, doc id, url). */
  source: string;
  /** The entity this evidence concerns, if any (its graph key). */
  aboutKey?: string;
  /** Self-reported confidence of the source (e.g. an AI's own confidence). 0..1. */
  sourceConfidence?: number;
  verified: boolean;
  at: number;
  meta: Record<string, unknown>;
}

export interface Provenance {
  id: string;
  type: EvidenceType;
  source: string;
  at: number;
  verified: boolean;
}

export interface RecordEvidenceInput {
  type: EvidenceType;
  summary: string;
  source: string;
  about?: EntityRef;
  sourceConfidence?: number;
  verified?: boolean;
  actor?: string;
  meta?: Record<string, unknown>;
}

export class EvidenceEngine {
  private readonly records = new Map<string, EvidenceRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: KnowledgeGovernance,
  ) {}

  async record(input: RecordEvidenceInput): Promise<EvidenceRecord> {
    if (!input.summary.trim()) throw new Error('evidence requires a non-empty summary');
    if (!input.source.trim()) throw new Error('evidence requires a source (provenance)');
    const evidence: EvidenceRecord = {
      id: randomId('ev'),
      type: input.type,
      summary: input.summary,
      source: input.source,
      ...(input.about ? { aboutKey: refKey(input.about) } : {}),
      ...(input.sourceConfidence !== undefined ? { sourceConfidence: clamp01(input.sourceConfidence) } : {}),
      verified: input.verified ?? false,
      at: this.clock.now(),
      meta: input.meta ?? {},
    };
    this.records.set(evidence.id, evidence);
    await this.governance.record({
      domain: 'evidence',
      action: `record.${input.type}`,
      entity: evidence.id,
      actor: input.actor ?? 'system',
      ok: true,
      evidenceIds: [evidence.id],
      meta: { type: evidence.type, source: evidence.source, aboutKey: evidence.aboutKey },
    });
    return evidence;
  }

  async verify(id: string, actor = 'system'): Promise<EvidenceRecord> {
    const evidence = this.require(id);
    evidence.verified = true;
    await this.governance.record({
      domain: 'evidence',
      action: 'verify',
      entity: id,
      actor,
      ok: true,
      evidenceIds: [id],
    });
    return evidence;
  }

  get(id: string): EvidenceRecord | undefined {
    return this.records.get(id);
  }

  list(type?: EvidenceType): EvidenceRecord[] {
    const all = [...this.records.values()];
    return type ? all.filter((e) => e.type === type) : all;
  }

  /** Evidence concerning a given entity. */
  about(ref: EntityRef): EvidenceRecord[] {
    const key = refKey(ref);
    return [...this.records.values()].filter((e) => e.aboutKey === key);
  }

  /** Resolve ids → provenance records; unknown ids are dropped (never faked). */
  provenance(ids: string[]): Provenance[] {
    return ids
      .map((id) => this.records.get(id))
      .filter((e): e is EvidenceRecord => Boolean(e))
      .map((e) => ({ id: e.id, type: e.type, source: e.source, at: e.at, verified: e.verified }));
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  private require(id: string): EvidenceRecord {
    const evidence = this.records.get(id);
    if (!evidence) throw new Error(`evidence '${id}' not found`);
    return evidence;
  }
}
