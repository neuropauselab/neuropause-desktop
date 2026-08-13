/**
 * Phase 6 — the relationship engine.
 *
 * Runs resolution over records and keeps the pending queue honest. Two entry
 * points matter:
 *
 *   `resolveRecords`  — after an import, resolve the references on what arrived.
 *   `retryPending`    — re-check everything parked, because the record a
 *                       reference points at may have arrived since.
 *
 * Together those two make IMPORT ORDER IRRELEVANT. Import invoices before
 * customers and every invoice parks as unresolved; import the customers and the
 * next pass links them. No duplicate customer is ever created to satisfy a
 * dangling reference — that is the failure mode this design exists to prevent.
 *
 * The engine takes stores as an injected lookup, never Electron, so it runs
 * under Node in tests exactly as it does in the app.
 */
import type { EnterpriseEntity, EnterpriseModuleDescriptor } from '@neuropause/shared';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { createLogger } from '../logger';
import {
  RELATIONSHIPS,
  relationshipByKey,
  relationshipsFrom,
  type RelationshipDef,
} from './relationshipModel';
import { TargetIndex, resolveReference } from './relationshipResolver';
import type { RelationshipLink, RelationshipStore } from './relationshipStore';

const log = createLogger('relationships');

export interface RelationshipEngineDeps {
  store: RelationshipStore;
  /** Resolve a module's record store, or null when the module is not wired. */
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  /** Descriptor lookup, for titles in the review queue. */
  describe: (moduleId: string) => EnterpriseModuleDescriptor | null;
  actor: () => string | null;
  now: () => string;
  audit: (entry: { action: string; target: string; summary: string }) => void;
}

export interface ResolutionPassResult {
  examined: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  /** References that were empty — nothing to do, and not a problem. */
  empty: number;
}

const EMPTY_PASS: ResolutionPassResult = { examined: 0, resolved: 0, ambiguous: 0, unresolved: 0, empty: 0 };

export class RelationshipEngine {
  constructor(private readonly deps: RelationshipEngineDeps) {}

  /**
   * Build the exact-match index for a target module.
   *
   * Cached per pass by the callers below, because building it is O(records) and
   * a pass over one import touches the same few target modules repeatedly.
   */
  private async indexFor(
    def: RelationshipDef,
    cache: Map<string, TargetIndex | null>,
  ): Promise<TargetIndex | null> {
    const cacheKey = `${def.toModuleId}::${def.keyFields.join(',')}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;

    const store = this.deps.storeFor(def.toModuleId);
    if (!store) {
      cache.set(cacheKey, null);
      return null;
    }
    await store.load();
    const index = new TargetIndex(store.list(), def.keyFields);
    cache.set(cacheKey, index);
    return index;
  }

  /** Resolve every declared reference on a set of records from one module. */
  async resolveRecords(
    moduleId: string,
    records: readonly EnterpriseEntity[],
    correlationId: string | null,
  ): Promise<ResolutionPassResult> {
    const defs = relationshipsFrom(moduleId);
    if (defs.length === 0 || records.length === 0) return { ...EMPTY_PASS };

    const cache = new Map<string, TargetIndex | null>();
    const result: ResolutionPassResult = { ...EMPTY_PASS };

    for (const def of defs) {
      const index = await this.indexFor(def, cache);
      if (!index) continue;
      for (const record of records) {
        await this.resolveOne(def, record, index, correlationId, result);
      }
    }
    return result;
  }

  private async resolveOne(
    def: RelationshipDef,
    record: EnterpriseEntity,
    index: TargetIndex,
    correlationId: string | null,
    result: ResolutionPassResult,
  ): Promise<void> {
    const raw = record.fields[def.field];
    const value = raw === null || raw === undefined ? '' : String(raw).trim();
    if (value.length === 0) {
      result.empty += 1;
      return;
    }

    result.examined += 1;
    const outcome = resolveReference(value, def, index);
    const now = this.deps.now();

    if (outcome.status === 'resolved' && outcome.targetRecordId !== null && outcome.method !== null) {
      await this.deps.store.link({
        relationshipKey: def.key,
        sourceModuleId: def.fromModuleId,
        sourceRecordId: record.id,
        sourceField: def.field,
        sourceValue: value,
        targetModuleId: def.toModuleId,
        targetRecordId: outcome.targetRecordId,
        method: outcome.method,
        confidence: outcome.confidence,
        decidedBy: null,
        at: now,
        correlationId,
        reason: outcome.reason,
      });
      result.resolved += 1;
      return;
    }

    await this.deps.store.park({
      relationshipKey: def.key,
      sourceModuleId: def.fromModuleId,
      sourceRecordId: record.id,
      sourceTitle: record.title,
      sourceField: def.field,
      sourceValue: value,
      targetModuleId: def.toModuleId,
      targetLabel: def.toLabel,
      status: outcome.status === 'ambiguous' ? 'ambiguous' : 'unresolved',
      candidates: outcome.candidates,
      reason: outcome.reason,
      lastCheckedAt: now,
      correlationId,
    });
    if (outcome.status === 'ambiguous') result.ambiguous += 1;
    else result.unresolved += 1;
  }

  /**
   * Re-check every parked reference.
   *
   * This is the half of the design that makes shuffled import order safe. It is
   * cheap: one index per target module per pass, then a Map lookup per item.
   * Skipped items are left alone — a person said no, and a later pass must not
   * quietly overrule them.
   */
  async retryPending(correlationId: string | null): Promise<ResolutionPassResult> {
    const items = this.deps.store.retryable();
    if (items.length === 0) return { ...EMPTY_PASS };

    const cache = new Map<string, TargetIndex | null>();
    const result: ResolutionPassResult = { ...EMPTY_PASS };

    for (const item of items) {
      const def = relationshipByKey(item.relationshipKey);
      if (!def) continue;
      const index = await this.indexFor(def, cache);
      if (!index) continue;

      const sourceStore = this.deps.storeFor(item.sourceModuleId);
      if (!sourceStore) continue;
      await sourceStore.load();
      const record = sourceStore.get(item.sourceRecordId);
      // The source record may have been deleted since it was parked; a pending
      // item for a record that no longer exists is noise, so it is retired.
      if (!record || record.status === 'deleted') continue;

      await this.resolveOne(def, record, index, correlationId ?? item.correlationId, result);
    }

    if (result.resolved > 0) {
      log.info('Deferred relationships resolved', { resolved: result.resolved, retried: items.length });
    }
    return result;
  }

  /**
   * Apply a human decision to a parked reference.
   *
   * Audited unconditionally: choosing which customer an invoice belongs to is a
   * business decision, and the trail records who made it and on what evidence.
   */
  async decide(
    pendingId: string,
    targetRecordId: string,
    correlationId: string | null,
  ): Promise<{ ok: boolean; message: string }> {
    await this.deps.store.load();
    const item = this.deps.store.pendingById(pendingId);
    if (!item) return { ok: false, message: 'That relationship is no longer waiting for review.' };

    const def = relationshipByKey(item.relationshipKey);
    if (!def) return { ok: false, message: 'That relationship type is not declared in this build.' };

    // The chosen target must genuinely exist and be live. A decision that
    // points at a deleted record is refused rather than stored.
    const targetStore = this.deps.storeFor(def.toModuleId);
    if (!targetStore) return { ok: false, message: `${def.toLabel} records are not available in this build.` };
    await targetStore.load();
    const target = targetStore.get(targetRecordId);
    if (!target || target.status === 'deleted') {
      return { ok: false, message: `That ${def.toLabel.toLowerCase()} no longer exists.` };
    }

    const actor = this.deps.actor();
    await this.deps.store.link({
      relationshipKey: def.key,
      sourceModuleId: item.sourceModuleId,
      sourceRecordId: item.sourceRecordId,
      sourceField: item.sourceField,
      sourceValue: item.sourceValue,
      targetModuleId: def.toModuleId,
      targetRecordId: target.id,
      method: 'manual',
      confidence: 1,
      decidedBy: actor,
      at: this.deps.now(),
      correlationId: correlationId ?? item.correlationId,
      reason: `Chosen by a reviewer from ${item.candidates.length} candidate(s).`,
    });

    this.deps.audit({
      action: 'relationship.decided',
      target: item.sourceRecordId,
      summary: `Linked ${item.sourceTitle} "${item.sourceValue}" to ${def.toLabel} "${target.title}".`,
    });
    return { ok: true, message: `Linked to ${target.title}.` };
  }

  /** Deliberately leave a reference unlinked, on the record and in the trail. */
  async skip(pendingId: string): Promise<{ ok: boolean; message: string }> {
    await this.deps.store.load();
    const item = this.deps.store.pendingById(pendingId);
    if (!item) return { ok: false, message: 'That relationship is no longer waiting for review.' };
    const actor = this.deps.actor();
    await this.deps.store.skip(pendingId, actor, this.deps.now());
    this.deps.audit({
      action: 'relationship.skipped',
      target: item.sourceRecordId,
      summary: `Left "${item.sourceValue}" unlinked on ${item.sourceTitle}.`,
    });
    return { ok: true, message: 'Left unlinked.' };
  }

  /**
   * The connected records around one record, one hop out in both directions.
   *
   * Every edge here is a stored link, so the graph can only ever show a
   * relationship the engine actually resolved — there is no decorative edge.
   */
  async neighbourhood(recordId: string): Promise<{
    record: { id: string; title: string; moduleId: string } | null;
    outgoing: GraphEdge[];
    incoming: GraphEdge[];
  }> {
    await this.deps.store.load();
    const out = this.deps.store.outgoing(recordId);
    const inc = this.deps.store.incoming(recordId);

    let self: { id: string; title: string; moduleId: string } | null = null;
    const anchor = out[0]?.sourceModuleId ?? inc[0]?.targetModuleId ?? null;
    if (anchor) {
      const store = this.deps.storeFor(anchor);
      if (store) {
        await store.load();
        const rec = store.get(recordId);
        if (rec) self = { id: rec.id, title: rec.title, moduleId: anchor };
      }
    }

    return {
      record: self,
      outgoing: await this.describeEdges(out, 'target'),
      incoming: await this.describeEdges(inc, 'source'),
    };
  }

  private async describeEdges(
    links: readonly RelationshipLink[],
    side: 'source' | 'target',
  ): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];
    for (const link of links) {
      const moduleId = side === 'target' ? link.targetModuleId : link.sourceModuleId;
      const recordId = side === 'target' ? link.targetRecordId : link.sourceRecordId;
      const store = this.deps.storeFor(moduleId);
      let title = recordId;
      if (store) {
        await store.load();
        const rec = store.get(recordId);
        // `get()` returns SOFT-DELETED records while `list()` hides them, so a
        // status check is required here — without it a link to a deleted
        // customer renders as a live customer. A broken edge is shown rather
        // than hidden: it is information, not something to paper over.
        title = rec && rec.status !== 'deleted' ? rec.title : `(deleted record ${recordId})`;
      }
      const def = relationshipByKey(link.relationshipKey);
      edges.push({
        relationshipKey: link.relationshipKey,
        label: def?.label ?? link.relationshipKey,
        moduleId,
        moduleTitle: this.deps.describe(moduleId)?.plural ?? moduleId,
        recordId,
        title,
        method: link.method,
        confidence: link.confidence,
        decidedBy: link.decidedBy,
        at: link.at,
        sourceValue: link.sourceValue,
      });
    }
    return edges;
  }
}

export interface GraphEdge {
  relationshipKey: string;
  label: string;
  moduleId: string;
  moduleTitle: string;
  recordId: string;
  title: string;
  method: string;
  confidence: number;
  decidedBy: string | null;
  at: string;
  sourceValue: string;
}

/** Every declared relationship, for the Coverage surface. */
export function declaredRelationships(): readonly RelationshipDef[] {
  return RELATIONSHIPS;
}
