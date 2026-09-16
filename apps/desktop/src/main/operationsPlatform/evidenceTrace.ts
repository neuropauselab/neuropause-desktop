/**
 * S126 — Evidence Trace / Correlation Timeline (pure, deterministic, read-only).
 *
 * Given an EXISTING `correlationId` (from an S125 search hit), compose the already-persisted, already-
 * tenant-scoped canonical evidence into ONE chronological trace: the committed-command records
 * (`DurableCommandJournal`) and the delivered-event records (`DeliveredEventLog`) that ACTUALLY carry
 * that correlationId. It is a pure fold over rows the governed reads already return — no new event store,
 * timeline store, correlation engine, or index.
 *
 * HONESTY (each pinned):
 *   • EXACT-MATCH ONLY on `correlationId` — no fuzzy inference, no "temporally adjacent ⇒ same
 *     transaction". A trace links records that genuinely share the id, nothing else.
 *   • INBOUND WEBHOOK LINEAGE CARRIES NO correlationId (S119) — so it is NEVER joined into a correlation
 *     trace. A correlation trace does not invent linkage it cannot prove; the response states this.
 *   • EMPTY / MISSING correlationId ⇒ honest `found:false` "no correlation identifier available", never a
 *     fabricated id or a fuzzy match.
 *   • TENANT-SAFE by construction: the caller passes rows ALREADY scoped to the server-resolved tenant
 *     (`journal.records(tenantId)` / `deliveredLog.delivered(tenantId)`); this module resolves no tenant.
 *   • CREDENTIAL-FREE: emits only safe metadata — ids / types / statuses / timestamps / aggregate ids /
 *     the correlationId itself. Never raw command results, raw outbox error text, secrets, or payloads.
 *   • BOUNDED: never "return everything"; entries are clamped to a caller limit.
 */
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import type { DeliveredEventRecord } from '../platform/command/deliveredEventLog';
import type { DeliveryState } from '../platform/command/deliveryOperations';

export const MAX_TRACE_ENTRIES = 200;
export const DEFAULT_TRACE_ENTRIES = 100;

export type TraceSource = 'command-journal' | 'delivered-events';

/**
 * S127 — the delivery posture for one trace entry, joined by EXACT txId to the canonical S35 delivery
 * evidence (a pure derivation over the SAME journal record's outbox — see `deliveryOperations.deriveState`).
 *   - `state` is the canonical `DeliveryState` (PENDING / IN_FLIGHT / RETRYING / DELIVERED) when the entry
 *     has a canonical txId that resolves to a delivery row;
 *   - `NOT_LINKED` when the entry carries no txId to join on (delivered-sink entries hold an event id, not
 *     a txId), or its txId is absent from the delivery evidence — an honest "not linked", never invented;
 *   - `UNAVAILABLE` when no delivery evidence was supplied to the composition at all.
 * No new delivery status is invented; there is deliberately no "FAILED" (RETRYING is the canonical
 * failure-in-progress state). Read-only, credential-free.
 */
export type TraceDeliveryState = DeliveryState | 'NOT_LINKED' | 'UNAVAILABLE';
export interface TraceDeliveryPosture {
  state: TraceDeliveryState;
  linked: boolean;
  attempts: number | null;
  deliveredAt: string | null;
}
/** The exact-txId delivery lookup the composer joins against (built by the caller from S35 evidence). */
export type DeliveryPosture = { state: DeliveryState; attempts: number; deliveredAt?: string };

export interface TraceEntry {
  source: TraceSource;
  /** stable evidence id (command txId / delivered-event id). */
  id: string;
  /** epoch ms for ordering; 0 when unknown. */
  timestamp: number;
  /** ISO instant the evidence carries (committedAt / deliveredAt). */
  at: string;
  /** the record/event type. */
  type: string;
  /** descriptive status already carried (outbox status for commands; 'delivered' for delivered events). */
  status: string | null;
  /** the aggregate the evidence concerns, where present. */
  aggregateId: string | null;
  /** the correlation id this entry genuinely carries (always === the queried id here). */
  correlationId: string;
  /** S127 — delivery/outbox posture joined by exact txId (NOT_LINKED / UNAVAILABLE when no canonical join). */
  delivery: TraceDeliveryPosture;
}

export interface EvidenceTrace {
  correlationId: string;
  /** true when at least one record genuinely carries this correlationId. */
  found: boolean;
  counts: { command: number; delivered: number; total: number };
  /** chronological (oldest → newest), bounded. */
  entries: TraceEntry[];
  bounded: boolean;
  /**
   * honesty note: inbound connector webhook lineage carries NO correlationId (S119), so it is never
   * part of a correlation trace. Stated so the absence is explicit, never mistaken for "nothing happened".
   */
  inboundCorrelatable: false;
  /** present when the correlationId is empty/blank — an honest "no identifier" state, not an error. */
  note?: string;
}

export interface EvidenceTraceOptions {
  limit?: number;
  /**
   * S127 — exact-txId → delivery-posture lookup, built by the caller from the canonical S35 delivery
   * evidence (`journal.records(tenantId)` via `deriveState`). When omitted, every entry's delivery is
   * `UNAVAILABLE` (honest: no delivery evidence was provided). Only command-journal entries have a txId
   * to join on; delivered-sink entries are always `NOT_LINKED`.
   */
  deliveryByTxId?: ReadonlyMap<string, DeliveryPosture>;
}

const NOT_LINKED: TraceDeliveryPosture = { state: 'NOT_LINKED', linked: false, attempts: null, deliveredAt: null };
const UNAVAILABLE: TraceDeliveryPosture = { state: 'UNAVAILABLE', linked: false, attempts: null, deliveredAt: null };

export function boundTraceLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_TRACE_ENTRIES;
  return Math.min(n, MAX_TRACE_ENTRIES);
}

const isoToMs = (v: string): number => {
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compose the correlation trace for exactly ONE correlationId over ALREADY-tenant-scoped commands +
 * delivered events. Pure and total. A blank correlationId returns an honest no-identifier state; a
 * non-matching id returns `found:false` with zero entries (never a throw, never a fuzzy match).
 */
export function composeEvidenceTrace(
  commands: readonly CommittedCommand[],
  delivered: readonly DeliveredEventRecord[],
  correlationId: string,
  options: EvidenceTraceOptions = {},
): EvidenceTrace {
  const limit = boundTraceLimit(options.limit);
  const deliveryMap = options.deliveryByTxId;
  // A command-journal entry joins by EXACT txId (entry.id === rec.id === the S35 delivery row's txId).
  const deliveryForTx = (txId: string): TraceDeliveryPosture => {
    if (!deliveryMap) return UNAVAILABLE; // no delivery evidence supplied
    const p = deliveryMap.get(txId);
    if (!p) return NOT_LINKED; // exact-match miss — never a fuzzy/temporal join
    return { state: p.state, linked: true, attempts: Number.isFinite(p.attempts) ? p.attempts : null, deliveredAt: p.deliveredAt ?? null };
  };
  const id = typeof correlationId === 'string' ? correlationId.trim() : '';
  if (id === '') {
    return {
      correlationId: '',
      found: false,
      counts: { command: 0, delivered: 0, total: 0 },
      entries: [],
      bounded: false,
      inboundCorrelatable: false,
      note: 'No correlation identifier available for this evidence.',
    };
  }

  const entries: TraceEntry[] = [];

  for (const rec of commands) {
    if ((rec.event?.correlationId ?? '') !== id) continue; // EXACT match only
    entries.push({
      source: 'command-journal',
      id: rec.id,
      timestamp: rec.committedAt ? isoToMs(rec.committedAt) : 0,
      at: rec.committedAt ?? '',
      type: rec.commandType,
      status: rec.outbox?.status ?? null,
      aggregateId: rec.event?.aggregateId ?? null,
      correlationId: id,
      delivery: deliveryForTx(rec.id), // exact txId → canonical delivery posture
    });
  }

  for (const d of delivered) {
    if ((d.correlationId ?? '') !== id) continue; // EXACT match only
    entries.push({
      source: 'delivered-events',
      id: d.id,
      timestamp: d.deliveredAt ? isoToMs(d.deliveredAt) : 0,
      at: d.deliveredAt ?? '',
      type: d.type,
      status: 'delivered',
      aggregateId: d.aggregateId ?? null,
      correlationId: id,
      // delivered-sink entries hold an event id, not a txId — no canonical delivery-posture join exists.
      delivery: NOT_LINKED,
    });
  }

  const commandCount = entries.filter((e) => e.source === 'command-journal').length;
  const deliveredCount = entries.filter((e) => e.source === 'delivered-events').length;
  // Chronological oldest → newest; ties broken deterministically by source then id.
  entries.sort((a, b) => a.timestamp - b.timestamp || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  const boundedEntries = entries.slice(0, limit);

  return {
    correlationId: id,
    found: entries.length > 0,
    counts: { command: commandCount, delivered: deliveredCount, total: entries.length },
    entries: boundedEntries,
    bounded: entries.length > boundedEntries.length,
    inboundCorrelatable: false,
  };
}
