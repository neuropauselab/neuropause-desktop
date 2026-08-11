/**
 * Medical Device Pack — persistence for traceability edges.
 *
 * An edge is a recorded fact about material that moved. Three properties this
 * store guarantees, each because getting it wrong produces a trace that lies:
 *
 * 1. **Append-only.** There is no update and no delete. A trace whose history
 *    can be edited answers a recall with whatever someone last typed. The one
 *    permitted mutation is attaching provenance to an edge that already exists,
 *    which adds evidence rather than changing a fact.
 * 2. **Idempotent.** Writing the same edge twice — a re-run import, a retried
 *    IPC call — yields one edge. The key is (tenant, kind, from, to); without
 *    it, re-importing a shipment file would double every lot's apparent
 *    destinations.
 * 3. **Tenant-scoped on read.** Every query takes a tenant and filters by it in
 *    this file, not in its callers. A cross-tenant leak in a traceability graph
 *    is one customer being told about another customer's shipments.
 *
 * Persisted with the same envelope + atomic-rename discipline as
 * `EnterpriseRecordStore`, so a corrupt or future-versioned file is quarantined
 * rather than silently treated as an empty history.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { TraceEdge, TraceNodeRef, TraceProvenance } from '@neuropause/shared';
import { traceEdgeKey, traceNodeKey } from '@neuropause/shared';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'medical-device-trace-edges',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: "Caps at 500,000 and evicts 10% OF THE WRITING TENANT'S edges as of Round 7. It was a global splice over regulated recall evidence.",
  reason: 'TraceEdge.tenantId is part of the idempotency key and every read predicate. The rows are regulated lot and shipment movement — the evidence for a recall.',
});

interface TraceFile {
  schemaVersion?: number;
  edges: TraceEdge[];
}

export interface RecordEdgeInput {
  tenantId: string;
  kind: TraceEdge['kind'];
  from: TraceNodeRef;
  to: TraceNodeRef;
  quantity?: number | null;
  unit?: string;
  at: string;
  actor?: string | null;
  provenance?: TraceProvenance;
}

/** A guard against an unbounded graph file on a long-lived install. */
const DEFAULT_MAX_EDGES = 500_000;

export class TraceEdgeStore extends EventEmitter {
  private edges: TraceEdge[] = [];
  private byKey = new Map<string, TraceEdge>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  /** Where a corrupt/newer store file was preserved at load, if any. */
  quarantinedTo: string | null = null;

  constructor(
    private readonly filePath: string,
    private readonly maxEdges: number = DEFAULT_MAX_EDGES,
  ) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const result = await readStoreFile<Partial<TraceFile>>(this.filePath);
    if (result.state === 'loaded' && result.data) {
      for (const edge of result.data.edges ?? []) {
        if (!edge?.id) continue;
        this.edges.push(edge);
        this.byKey.set(traceEdgeKey(edge), edge);
      }
    } else if (result.state !== 'first-run') {
      this.quarantinedTo = result.quarantinedTo;
      this.emit('quarantined', { path: result.quarantinedTo });
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const file: TraceFile = { ...envelopeStamp(), edges: this.edges };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
        if (!retryable || attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 20 * attempt));
      }
    }
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /**
   * Record an edge. Returns the existing edge unchanged when one with the same
   * identity is already present — the caller cannot tell whether it was the
   * first writer, which is exactly right for an idempotent operation.
   */
  record(input: RecordEdgeInput): TraceEdge {
    const key = traceEdgeKey(input);
    const existing = this.byKey.get(key);
    if (existing) {
      // The only permitted mutation: attach provenance evidence to a fact that
      // is already recorded. Never overwrites provenance that is already there.
      if (input.provenance && !existing.provenance) {
        existing.provenance = input.provenance;
        this.schedulePersist();
        this.emit('changed');
      }
      return existing;
    }
    const edge: TraceEdge = {
      id: `tre_${randomUUID()}`,
      tenantId: input.tenantId,
      kind: input.kind,
      from: input.from,
      to: input.to,
      quantity: input.quantity ?? null,
      unit: input.unit ?? '',
      at: input.at,
      actor: input.actor ?? null,
      ...(input.provenance ? { provenance: input.provenance } : {}),
    };
    this.edges.push(edge);
    this.byKey.set(key, edge);
    if (this.edges.length > this.maxEdges) this.evictOldest();
    this.schedulePersist();
    this.emit('changed');
    return edge;
  }

  /** Every edge in a tenant. The traversal functions take the whole set. */
  forTenant(tenantId: string): TraceEdge[] {
    return this.edges.filter((e) => e.tenantId === tenantId);
  }

  /** Edges touching one node, either side. Used for a lot's immediate context. */
  around(tenantId: string, ref: Pick<TraceNodeRef, 'type' | 'id'>): TraceEdge[] {
    const key = traceNodeKey(ref);
    return this.edges.filter(
      (e) => e.tenantId === tenantId && (traceNodeKey(e.from) === key || traceNodeKey(e.to) === key),
    );
  }

  count(tenantId?: string): number {
    if (tenantId === undefined) return this.edges.length;
    let n = 0;
    for (const e of this.edges) if (e.tenantId === tenantId) n += 1;
    return n;
  }

  /**
   * Drop the oldest edges when the cap is reached.
   *
   * This is a real loss of history and it is logged as such by the caller. The
   * cap exists because an unbounded file eventually fails to write at all,
   * which loses everything; a bounded one loses the oldest tenth. Neither is
   * good, and the cap is set high enough that a mid-size manufacturer will not
   * reach it — see the performance section of the traceability documentation.
   */
  /**
   * P13C ROUND 7 (final sweep) — PER TENANT.
   *
   * `this.edges.splice(0, drop)` took the globally oldest tenth, so one
   * manufacturer's traceability volume deleted another's. Every READ path in this
   * file already filters on `tenantId`; the retention policy did not — and what
   * it deletes is regulated evidence for a recall.
   */
  private evictOldest(): void {
    const drop = Math.ceil(this.maxEdges * 0.1);
    /**
     * The tenant to evict from is the tenant that just WROTE — `record()` is the
     * only caller, and the row it appended names its owner. Deriving it from the
     * newest edge rather than from an ambient resolver keeps this store free of a
     * scope dependency it otherwise does not need, and it is the correct answer:
     * the tenant that filled the store is the one whose history rotates.
     */
    const writer = this.edges[this.edges.length - 1]?.tenantId ?? null;
    const mine = writer === null ? this.edges : this.edges.filter((e) => e.tenantId === writer);
    const doomed = new Set(mine.slice(0, drop));
    const removed = this.edges.filter((e) => doomed.has(e));
    this.edges = this.edges.filter((e) => !doomed.has(e));
    for (const edge of removed) this.byKey.delete(traceEdgeKey(edge));
    this.emit('evicted', { count: removed.length });
  }
}
