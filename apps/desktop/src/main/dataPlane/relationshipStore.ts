/**
 * Phase 6 — relationship persistence.
 *
 * Two collections, deliberately separate from the records themselves:
 *
 *   LINKS   a resolved edge: source record → target record, with the method,
 *           the actor and the correlation id that produced it.
 *   PENDING an unresolved or ambiguous reference waiting for either a human
 *           decision or the arrival of the record it points at.
 *
 * WHY NOT WRITE THE TARGET ID BACK INTO THE RECORD. The reference field holds
 * what the source system said — "ABC Hospital", "PO-1042". Overwriting it with
 * an internal id would destroy the evidence, break the round trip back out
 * through export, and make a wrong resolution unrecoverable. The link is stored
 * alongside instead, so the record keeps its own truth and the resolution keeps
 * its provenance. Undoing a bad link is deleting a row, not repairing data.
 *
 * PENDING is what makes import order not matter: invoices imported before
 * customers park here, and the next resolution pass picks them up.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import type { CandidateRecord } from './relationshipResolver';
import type { MatchMethod, RelationshipStatus } from './relationshipModel';

export interface RelationshipLink {
  id: string;
  /** Declared relationship key, e.g. `payment.invoice`. */
  relationshipKey: string;
  sourceModuleId: string;
  sourceRecordId: string;
  /** Descriptor field the reference was read from. */
  sourceField: string;
  /** The literal text the source system supplied — never overwritten. */
  sourceValue: string;
  targetModuleId: string;
  targetRecordId: string;
  method: MatchMethod;
  confidence: number;
  /** Null when the engine resolved it deterministically with no human involved. */
  decidedBy: string | null;
  at: string;
  /** Ties the link back to the import that produced it. */
  correlationId: string | null;
  reason: string;
}

export interface PendingRelationship {
  id: string;
  relationshipKey: string;
  sourceModuleId: string;
  sourceRecordId: string;
  sourceTitle: string;
  sourceField: string;
  sourceValue: string;
  targetModuleId: string;
  targetLabel: string;
  status: Extract<RelationshipStatus, 'ambiguous' | 'unresolved' | 'skipped'>;
  candidates: CandidateRecord[];
  reason: string;
  firstSeenAt: string;
  lastCheckedAt: string;
  /** How many resolution passes have looked at this without resolving it. */
  attempts: number;
  correlationId: string | null;
}

interface RelationshipFile {
  schemaVersion: number;
  links: RelationshipLink[];
  pending: PendingRelationship[];
}

/** Bound on retained pending items — a runaway import cannot grow this forever. */
const MAX_PENDING = 20_000;
const MAX_LINKS = 200_000;

export class RelationshipStore {
  private links: RelationshipLink[] = [];
  private pending: PendingRelationship[] = [];
  private loaded = false;
  /** `sourceRecordId relationshipKey` → link, for idempotency. */
  private linkIndex = new Map<string, RelationshipLink>();
  private pendingIndex = new Map<string, PendingRelationship>();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const res = await readStoreFile<RelationshipFile>(this.filePath);
    if (res.state === 'loaded' && res.data) {
      this.links = Array.isArray(res.data.links) ? res.data.links : [];
      this.pending = Array.isArray(res.data.pending) ? res.data.pending : [];
    }
    this.reindex();
    this.loaded = true;
  }

  private reindex(): void {
    this.linkIndex = new Map(this.links.map((l) => [slot(l.sourceRecordId, l.relationshipKey), l]));
    this.pendingIndex = new Map(this.pending.map((p) => [slot(p.sourceRecordId, p.relationshipKey), p]));
  }

  /**
   * Record a resolved edge.
   *
   * Idempotent per (source record, relationship): re-running resolution over the
   * same record REPLACES its link rather than accumulating duplicates, which is
   * what makes the deferred-resolution pass safe to run after every import.
   */
  async link(input: Omit<RelationshipLink, 'id'>): Promise<RelationshipLink> {
    const key = slot(input.sourceRecordId, input.relationshipKey);
    const existing = this.linkIndex.get(key);
    const link: RelationshipLink = { id: existing?.id ?? `rel_${randomUUID()}`, ...input };

    if (existing) {
      this.links[this.links.indexOf(existing)] = link;
    } else {
      this.links.push(link);
      if (this.links.length > MAX_LINKS) this.links.splice(0, this.links.length - MAX_LINKS);
    }
    this.linkIndex.set(key, link);

    // A resolved link retires its pending entry — the queue only ever holds
    // things that still need attention.
    this.dropPending(key);
    await this.persist();
    return link;
  }

  /** Park an unresolved or ambiguous reference. Idempotent per slot. */
  async park(input: Omit<PendingRelationship, 'id' | 'firstSeenAt' | 'attempts'>): Promise<PendingRelationship> {
    const key = slot(input.sourceRecordId, input.relationshipKey);
    const existing = this.pendingIndex.get(key);
    const entry: PendingRelationship = existing
      ? { ...existing, ...input, id: existing.id, firstSeenAt: existing.firstSeenAt, attempts: existing.attempts + 1 }
      : { ...input, id: `pen_${randomUUID()}`, firstSeenAt: input.lastCheckedAt, attempts: 1 };

    if (existing) this.pending[this.pending.indexOf(existing)] = entry;
    else {
      this.pending.push(entry);
      if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
    }
    this.pendingIndex.set(key, entry);
    await this.persist();
    return entry;
  }

  private dropPending(key: string): void {
    const existing = this.pendingIndex.get(key);
    if (!existing) return;
    this.pending.splice(this.pending.indexOf(existing), 1);
    this.pendingIndex.delete(key);
  }

  /** Mark a pending item as deliberately skipped — a decision, not a silence. */
  async skip(pendingId: string, actor: string | null, at: string): Promise<PendingRelationship | null> {
    const entry = this.pending.find((p) => p.id === pendingId);
    if (!entry) return null;
    entry.status = 'skipped';
    entry.lastCheckedAt = at;
    entry.reason = actor === null ? 'Skipped.' : `Skipped by ${actor}.`;
    await this.persist();
    return entry;
  }

  pendingById(id: string): PendingRelationship | null {
    return this.pending.find((p) => p.id === id) ?? null;
  }

  /** Items still needing attention, worst first (ambiguous before unresolved). */
  queue(limit = 200): PendingRelationship[] {
    const rank = { ambiguous: 0, unresolved: 1, skipped: 2 } as const;
    return [...this.pending]
      .sort((a, b) => rank[a.status] - rank[b.status] || a.firstSeenAt.localeCompare(b.firstSeenAt))
      .slice(0, limit);
  }

  /** Every pending entry that a resolution pass should retry. */
  retryable(): PendingRelationship[] {
    return this.pending.filter((p) => p.status !== 'skipped');
  }

  /** Links out of a record — what it points at. */
  outgoing(recordId: string): RelationshipLink[] {
    return this.links.filter((l) => l.sourceRecordId === recordId);
  }

  /** Links into a record — the backward-trace direction. */
  incoming(recordId: string): RelationshipLink[] {
    return this.links.filter((l) => l.targetRecordId === recordId);
  }

  linkFor(sourceRecordId: string, relationshipKey: string): RelationshipLink | null {
    return this.linkIndex.get(slot(sourceRecordId, relationshipKey)) ?? null;
  }

  counts(): { links: number; ambiguous: number; unresolved: number; skipped: number } {
    return {
      links: this.links.length,
      ambiguous: this.pending.filter((p) => p.status === 'ambiguous').length,
      unresolved: this.pending.filter((p) => p.status === 'unresolved').length,
      skipped: this.pending.filter((p) => p.status === 'skipped').length,
    };
  }

  private async persist(): Promise<void> {
    const payload: RelationshipFile = { ...envelopeStamp(), links: this.links, pending: this.pending };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}

function slot(recordId: string, relationshipKey: string): string {
  return `${recordId}::${relationshipKey}`;
}
