/**
 * Transaction-graph spine — correlation_id / causation_id across the ERP.
 *
 * A single business transaction fans out across many modules: a Quote becomes a
 * Sales Order, which becomes an Invoice AND ships stock (a movement), and both
 * the invoice and the movement post to the General Ledger. Before this spine,
 * each of those records only knew its immediate document cross-reference
 * (`sourceQuote`, `sourceOrder`, `referenceRecord`, `sourceRef`) — there was no
 * single id shared by the whole chain, so "show me everything that happened to
 * SO-1245" or "why is this order delayed?" could not be answered from persisted
 * data. The document links existed; the transaction did not.
 *
 * This module adds two ids, persisted in each record's free-form `metadata` bag
 * (the sanctioned home for cross-cutting bookkeeping — NOT `fields`, which is the
 * module's own validated data, and NOT the record's identity/scope, which
 * metadata must never smuggle):
 *
 *   • correlationId  — SHARED by every record in one business transaction.
 *   • causationId    — the id of the ONE record that directly caused this one
 *                      (its parent edge), plus `causedByModule` to resolve it.
 *   • correlationRoot — the transaction's origin, as a global ref.
 *
 * The rule is inheritance: a caused record adopts its source's correlationId if
 * the source has one, else the source becomes the root and its own global ref
 * becomes the correlationId. So the whole chain converges on ONE correlationId —
 * rooted at wherever the chain actually began — with NO back-writing required:
 * a child derives the same value whether or not the root was ever stamped.
 *
 * Untrusted-input note (§2 #6): correlation ids are system-derived bookkeeping,
 * never taken from AI output or from a renderer payload. `childCorrelationMeta`
 * derives them from the source record the main process already resolved.
 */
import type { EnterpriseEntity, EnterpriseRecordMeta } from '@neuropause/shared';
import type { EnterpriseModule } from './enterpriseModule';

/** Flat metadata keys — `EnterpriseRecordMeta` is a primitive-valued bag. */
export const CORRELATION_ID_KEY = 'correlationId';
export const CAUSATION_ID_KEY = 'causationId';
export const CAUSED_BY_MODULE_KEY = 'causedByModule';
export const CORRELATION_ROOT_KEY = 'correlationRoot';

/**
 * A globally-unique, deterministic reference to a record: `"<moduleId>:<id>"`.
 * Used as a transaction root id so descendants converge without back-writing the
 * root. The record id is already a uuid-backed `rec_<uuid>`, so the only
 * structural assumption is that a module id never contains the separator — which
 * holds for every registered module id (all slug-cased, no colons).
 */
export function globalRef(moduleId: string, recordId: string): string {
  return `${moduleId}:${recordId}`;
}

/** Parse a `globalRef` back into its parts, or null if it is not one. */
export function parseGlobalRef(ref: string): { moduleId: string; recordId: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0 || i >= ref.length - 1) return null;
  return { moduleId: ref.slice(0, i), recordId: ref.slice(i + 1) };
}

/** The correlation view of a record (null for any unstamped edge). */
export interface CorrelationView {
  correlationId: string | null;
  causationId: string | null;
  causedByModule: string | null;
  correlationRoot: string | null;
}

function str(v: string | number | boolean | null | undefined): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Read the correlation edges off a record's metadata. */
export function readCorrelation(record: { metadata?: EnterpriseRecordMeta }): CorrelationView {
  const m = record.metadata ?? {};
  return {
    correlationId: str(m[CORRELATION_ID_KEY]),
    causationId: str(m[CAUSATION_ID_KEY]),
    causedByModule: str(m[CAUSED_BY_MODULE_KEY]),
    correlationRoot: str(m[CORRELATION_ROOT_KEY]),
  };
}

/**
 * The metadata patch for a record CAUSED BY `source` (which lives in
 * `sourceModuleId`). Inherits the source's correlationId/root when present, else
 * roots the transaction at the source. Merges cleanly onto any existing metadata
 * (the store's `update` merges; `create` spreads), so it never clobbers other
 * bookkeeping keys.
 */
export function childCorrelationMeta(
  source: Pick<EnterpriseEntity, 'id' | 'metadata'>,
  sourceModuleId: string,
): EnterpriseRecordMeta {
  const src = readCorrelation(source);
  const root = src.correlationRoot ?? globalRef(sourceModuleId, source.id);
  const correlationId = src.correlationId ?? root;
  return {
    [CORRELATION_ID_KEY]: correlationId,
    [CAUSATION_ID_KEY]: source.id,
    [CAUSED_BY_MODULE_KEY]: sourceModuleId,
    [CORRELATION_ROOT_KEY]: root,
  };
}

/**
 * The metadata patch that marks `record` as a transaction ROOT (self-caused) —
 * but ONLY if it is not already part of a transaction. A record that already
 * carries a correlationId (e.g. an order raised from a quote) keeps it: returning
 * `{}` leaves its existing chain untouched. This lets a conversion stamp the
 * source it is already updating, so genuine origins self-identify in a trace,
 * without ever overwriting an inherited chain.
 */
export function rootMetaIfUnset(
  record: Pick<EnterpriseEntity, 'id' | 'metadata'>,
  moduleId: string,
): EnterpriseRecordMeta {
  if (readCorrelation(record).correlationId) return {};
  const ref = globalRef(moduleId, record.id);
  return {
    [CORRELATION_ID_KEY]: ref,
    [CORRELATION_ROOT_KEY]: ref,
  };
}

/** One node in a reconstructed transaction graph. */
export interface TransactionGraphNode {
  moduleId: string;
  recordId: string;
  title: string;
  status: string;
  /** The parent edge: the record that directly caused this one (null at the root). */
  causationId: string | null;
  causedByModule: string | null;
  /** `causedByModule:causationId` — the parent's global ref, for graph assembly. */
  parentRef: string | null;
  isRoot: boolean;
  /** Distance from the transaction root along causation edges (0 at the root). */
  depth: number;
  at: string;
}

/**
 * Reconstruct one business transaction from persisted data: every record across
 * the given modules that shares `correlationId`, ordered root-first by causation
 * depth. Tenant isolation is inherited — each store is already bound to the
 * active scope, so `store.list()` returns only the caller's tenant's records.
 *
 * The transaction ROOT is included even if it was never explicitly stamped: when
 * `correlationId` is a `globalRef`, the origin record is resolved directly. So a
 * trace is correct whether or not roots self-identify.
 *
 * Read-only: it lists and gets; it never writes. A best-effort helper for the
 * intelligence layer and future "explain this transaction" surfaces — it makes
 * no authorization decision and grants nothing (§2 #13: it informs, it does not
 * govern).
 */
export async function traceTransactionGraph(
  modules: readonly EnterpriseModule[],
  correlationId: string,
): Promise<TransactionGraphNode[]> {
  if (!correlationId) return [];
  const byRef = new Map<string, TransactionGraphNode>();

  const add = (module: EnterpriseModule, record: EnterpriseEntity, forcedRoot: boolean): void => {
    const ref = globalRef(module.descriptor.id, record.id);
    if (byRef.has(ref)) return;
    const corr = readCorrelation(record);
    const isRoot = forcedRoot || !corr.causationId;
    byRef.set(ref, {
      moduleId: module.descriptor.id,
      recordId: record.id,
      title: record.title,
      status: record.status,
      causationId: isRoot ? null : corr.causationId,
      causedByModule: isRoot ? null : corr.causedByModule,
      parentRef:
        !isRoot && corr.causationId && corr.causedByModule
          ? globalRef(corr.causedByModule, corr.causationId)
          : null,
      isRoot,
      depth: 0,
      at: record.updatedAt,
    });
  };

  // 1) Every record that carries this correlationId.
  for (const module of modules) {
    await module.store.load();
    for (const record of module.store.list()) {
      if (record.status === 'deleted') continue;
      if (readCorrelation(record).correlationId === correlationId) add(module, record, false);
    }
  }

  // 2) The origin record, resolved from the correlationId's global ref, so the
  //    root appears even if the chain never stamped it.
  const rootRef = parseGlobalRef(correlationId);
  if (rootRef && !byRef.has(correlationId)) {
    const rootModule = modules.find((m) => m.descriptor.id === rootRef.moduleId);
    const rootRecord = rootModule?.store.get(rootRef.recordId) ?? null;
    if (rootModule && rootRecord && rootRecord.status !== 'deleted') add(rootModule, rootRecord, true);
  }

  // 3) Causation depth from the root, so the graph is returned root-first.
  const nodes = [...byRef.values()];
  const depthOf = (node: TransactionGraphNode, guard: number): number => {
    if (node.isRoot || !node.parentRef) return 0;
    const parent = byRef.get(node.parentRef);
    if (!parent || guard <= 0) return 1; // parent outside the set / cycle guard
    return 1 + depthOf(parent, guard - 1);
  };
  for (const node of nodes) node.depth = depthOf(node, nodes.length);

  nodes.sort(
    (a, b) => a.depth - b.depth || a.at.localeCompare(b.at) || a.moduleId.localeCompare(b.moduleId),
  );
  return nodes;
}
