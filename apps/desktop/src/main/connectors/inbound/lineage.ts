/**
 * S119 — INBOUND-EVENT LINEAGE (read-only, tenant-scoped projection over the S114 verified event).
 *
 * A PURE, READ-ONLY projection over the platform events the S114 webhook router already emits for a
 * VERIFIED inbound delivery (`type: 'connector.online'`, `metadata.kind: 'inbound_webhook'`). It adds
 * NO connector framework, NO registry, NO event store, NO event bus — it reads the EXISTING per-tenant
 * event ring (`EventBus.replay`, already tenant-scoped and fail-closed) and reshapes it into lineage rows.
 *
 * SAFETY BOUNDARY (each pinned in lineage.test.ts):
 *   - TENANT SCOPE comes from the AUTHORITATIVE bus-stamped `event.tenantId` (materialized from the
 *     resolved tenant), NEVER from the webhook payload. A row whose authoritative tenant ≠ the reader's
 *     tenant is dropped; a webhook payload cannot forge tenant/workspace identity.
 *   - READ-ONLY: it imports only types; it mutates no store, creates no ERP transaction, dispatches no
 *     command, and grants no AI/execution authority. Lineage is DESCRIPTION, never an authorization input.
 *   - NO SECRETS: the source event carries no payload/headers/secret/token (S114), and this projection
 *     emits a fixed row shape that has no field for any of them.
 *   - FAIL-CLOSED: no resolved tenant ⇒ no rows; an event missing connectorId/provider is dropped
 *     (incomplete lineage is not fabricated); the S114 event carries no dedupe/idempotency reference, so
 *     `dedupeRef` is honestly `null` (ABSENT) — never invented.
 *   - S114 UNCHANGED: this file does not import or modify the router/verify path.
 */
import type { PlatformEvent } from '@neuropause/shared';

/** One verified inbound-webhook delivery, projected for read-only lineage/context. */
export interface InboundLineageRow {
  /** the platform event's own id (stable per delivery; duplicates remain distinct — S114 does not dedupe). */
  eventId: string;
  connectorId: string;
  provider: string;
  /** the verified source = the provider that passed S114 signature/clientState verification. */
  verifiedSource: string;
  /** epoch ms the router received the verified delivery (authoritative server clock). */
  receivedAt: number;
  /** authoritative tenant (bus-stamped), never from payload. */
  tenantId: string;
  /** S114 carries no dedupe/idempotency reference on the event ⇒ ABSENT (never fabricated). */
  dedupeRef: null;
  /** structural marker: lineage never carries credential/secret material. */
  credentialsPresent: false;
}

const INBOUND_EVENT_TYPE = 'connector.online';
const INBOUND_KIND = 'inbound_webhook';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Project the verified inbound-webhook events for exactly ONE authoritative tenant. Pure; drops any
 * event that is not a verified inbound webhook, is missing connectorId/provider, or belongs to a
 * different (or unresolved) tenant. The caller supplies the AUTHORITATIVE tenant id (never the payload).
 */
export function projectInboundLineage(events: readonly PlatformEvent[], tenantId: string): InboundLineageRow[] {
  if (str(tenantId) === null) return []; // fail-closed: no resolved tenant → no lineage
  const out: InboundLineageRow[] = [];
  for (const e of events) {
    if (e.type !== INBOUND_EVENT_TYPE) continue;
    const meta = e.metadata ?? {};
    if (meta.kind !== INBOUND_KIND) continue;
    // AUTHORITATIVE tenant scoping — the bus-stamped tenantId, not any payload/metadata claim.
    if (e.tenantId !== tenantId) continue;
    const connectorId = str(meta.connectorId);
    const provider = str(meta.provider);
    if (connectorId === null || provider === null) continue; // fail-closed: incomplete lineage not fabricated
    const receivedAt = typeof meta.receivedAt === 'number' && Number.isFinite(meta.receivedAt)
      ? meta.receivedAt
      : Date.parse(e.timestamp);
    out.push({
      eventId: e.id,
      connectorId,
      provider,
      verifiedSource: provider,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0,
      tenantId,
      dedupeRef: null,
      credentialsPresent: false,
    });
  }
  return out;
}

/**
 * S121 — a pure per-connector rollup of inbound lineage (operational activity intelligence). Derived
 * ONLY from already-projected, already-tenant-scoped rows; adds no data source and no authority. Sorted
 * by most-recent activity first. Useful for an operator to see, per connector, how many verified inbound
 * deliveries arrived and when the last one was.
 */
export interface InboundLineageConnectorSummary {
  connectorId: string;
  provider: string;
  events: number;
  lastReceivedAt: number;
}
export function summarizeInboundLineage(rows: readonly InboundLineageRow[]): InboundLineageConnectorSummary[] {
  const byConnector = new Map<string, InboundLineageConnectorSummary>();
  for (const r of rows) {
    const cur = byConnector.get(r.connectorId);
    if (cur) {
      cur.events += 1;
      if (r.receivedAt > cur.lastReceivedAt) cur.lastReceivedAt = r.receivedAt;
    } else {
      byConnector.set(r.connectorId, { connectorId: r.connectorId, provider: r.provider, events: 1, lastReceivedAt: r.receivedAt });
    }
  }
  return [...byConnector.values()].sort((a, b) => b.lastReceivedAt - a.lastReceivedAt);
}

/**
 * S123 — CONNECTOR INBOUND TREND (pure, deterministic, policy-free). A symmetric companion to the
 * reliability trend, over the SAME already-tenant-scoped lineage rows (the EventBus ring). It splits the
 * rows into an older ("previous") half and a newer ("recent") half by `receivedAt` and reports DESCRIPTIVE
 * per-connector volume movement plus which connectors are NEW (recent-only) or QUIET (previous-only,
 * i.e. no inbound deliveries in the recent half). It invents NO threshold, NO alert, NO SLO — QUIET means
 * strictly "absent from the recent window", not "below some limit". Credential-free by construction.
 */
export type InboundTrendDirection = 'INCREASE' | 'DECREASE' | 'STABLE';
export interface InboundConnectorTrendRow {
  connectorId: string;
  provider: string;
  previous: number;
  recent: number;
  delta: number;
  direction: InboundTrendDirection;
}
export interface InboundLineageTrend {
  comparable: boolean;
  window: { previous: number; recent: number };
  totalVolume: { previous: number; recent: number; delta: number; direction: InboundTrendDirection };
  /** connectors delivering in the recent window but not the previous one. */
  newConnectors: string[];
  /** connectors that delivered in the previous window but not the recent one. */
  quietConnectors: string[];
  /** per-connector volume movement, most-changed first, bounded. */
  byConnector: InboundConnectorTrendRow[];
}

export const DEFAULT_INBOUND_TREND_WINDOW = 50;
export const MAX_INBOUND_TREND_WINDOW = 200;
export const MAX_INBOUND_TREND_ROWS = 10;

function boundInboundWindow(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_INBOUND_TREND_WINDOW;
  return Math.min(n, MAX_INBOUND_TREND_WINDOW);
}
function inboundDir(delta: number): InboundTrendDirection {
  if (!Number.isFinite(delta) || delta === 0) return 'STABLE';
  return delta > 0 ? 'INCREASE' : 'DECREASE';
}
function countByConnector(rows: readonly InboundLineageRow[]): Map<string, { provider: string; n: number }> {
  const m = new Map<string, { provider: string; n: number }>();
  for (const r of rows) {
    const cur = m.get(r.connectorId);
    if (cur) cur.n += 1;
    else m.set(r.connectorId, { provider: r.provider, n: 1 });
  }
  return m;
}

export function summarizeInboundLineageTrend(
  rows: readonly InboundLineageRow[],
  options: { window?: number } = {},
): InboundLineageTrend {
  const window = boundInboundWindow(options.window);
  const empty: InboundLineageTrend = {
    comparable: false,
    window: { previous: 0, recent: 0 },
    totalVolume: { previous: 0, recent: 0, delta: 0, direction: 'STABLE' },
    newConnectors: [],
    quietConnectors: [],
    byConnector: [],
  };
  if (rows.length < 2) return empty;

  // Stable chronological order by receivedAt (ties keep input order).
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.receivedAt - b.r.receivedAt || a.i - b.i)
    .map((x) => x.r);
  const considered = ordered.slice(-2 * window);
  const mid = Math.floor(considered.length / 2);
  const prevRows = considered.slice(0, mid);
  const recRows = considered.slice(mid);
  if (prevRows.length === 0 || recRows.length === 0) return empty;

  const prev = countByConnector(prevRows);
  const rec = countByConnector(recRows);
  const newConnectors = [...rec.keys()].filter((c) => !prev.has(c)).sort();
  const quietConnectors = [...prev.keys()].filter((c) => !rec.has(c)).sort();
  const byConnector: InboundConnectorTrendRow[] = [...new Set([...prev.keys(), ...rec.keys()])]
    .map((connectorId) => {
      const p = prev.get(connectorId)?.n ?? 0;
      const r = rec.get(connectorId)?.n ?? 0;
      const provider = rec.get(connectorId)?.provider ?? prev.get(connectorId)?.provider ?? '';
      return { connectorId, provider, previous: p, recent: r, delta: r - p, direction: inboundDir(r - p) };
    })
    .filter((row) => row.direction !== 'STABLE')
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.connectorId.localeCompare(b.connectorId))
    .slice(0, MAX_INBOUND_TREND_ROWS);

  return {
    comparable: true,
    window: { previous: prevRows.length, recent: recRows.length },
    totalVolume: { previous: prevRows.length, recent: recRows.length, delta: recRows.length - prevRows.length, direction: inboundDir(recRows.length - prevRows.length) },
    newConnectors,
    quietConnectors,
    byConnector,
  };
}

/**
 * S135 — CONNECTOR INBOUND INTELLIGENCE (pure, deterministic, policy-free). A per-connector MERGE of the
 * existing S121 rollup (`summarizeInboundLineage`) and the S123 trend (`summarizeInboundLineageTrend`) over
 * the SAME already-tenant-scoped lineage rows, so an operator/AI sees ONE intelligible record per connector
 * instead of cross-referencing two arrays. It adds NO data source, NO store, NO authority.
 *
 * DESCRIPTIVE ONLY — every field is either a count/timestamp fact or a state already DEFINED by S123's
 * trend semantics. It invents NO health/SLO/reliability/anomaly/correctness score and NO threshold:
 *   • `state` is `NEW` (S123 recent-only) / `QUIET` (S123 previous-only) / `ACTIVE` (present, neither) —
 *     ACTIVE means "has verified deliveries and is not new/quiet", NOT a health judgement.
 *   • `trendDirection` is the S123 per-connector volume direction, or `null` when the trend is not
 *     comparable (fewer than two rows) — never fabricated.
 *   • `correlatable` is `false` by construction — inbound webhook lineage carries no correlationId (S126),
 *     so an inbound event is never part of a correlation trace. Honest, not a defect.
 *   • `dedupeRefStatus` is `'absent'` — the S114 event carries no dedupe/idempotency reference; this
 *     preserves the existing `dedupeRef: null` semantics without inventing one.
 *   • `sampleEventIds` is bounded provenance (event ids only — never a payload/secret).
 * CREDENTIAL-FREE by construction (the row shape has no secret field).
 */
export type ConnectorInboundState = 'NEW' | 'QUIET' | 'ACTIVE';
export interface ConnectorInboundIntelligence {
  connectorId: string;
  provider: string;
  verifiedSource: string;
  events: number;
  lastReceivedAt: number;
  trendDirection: InboundTrendDirection | null;
  state: ConnectorInboundState;
  /** inbound webhook lineage carries no correlationId (S126) ⇒ never part of a correlation trace. */
  correlatable: false;
  /** S114 carries no dedupe/idempotency reference ⇒ ABSENT (preserves the `dedupeRef: null` semantics). */
  dedupeRefStatus: 'absent';
  /** bounded provenance — verified inbound event ids only (never payload/secret). */
  sampleEventIds: string[];
}

/** Max provenance event ids surfaced per connector — bounded, never "return everything". */
export const MAX_CONNECTOR_INTEL_EVENT_IDS = 5;

export function composeConnectorInboundIntelligence(
  rows: readonly InboundLineageRow[],
  options: { window?: number } = {},
): ConnectorInboundIntelligence[] {
  const summary = summarizeInboundLineage(rows); // per-connector events + lastReceivedAt, most-recent first
  const trend = summarizeInboundLineageTrend(rows, options);
  const dirByConnector = new Map<string, InboundTrendDirection>(trend.byConnector.map((r) => [r.connectorId, r.direction]));
  const newSet = new Set(trend.newConnectors);
  const quietSet = new Set(trend.quietConnectors);
  // bounded provenance sample per connector (first-seen order over the rows)
  const idsByConnector = new Map<string, string[]>();
  for (const r of rows) {
    const cur = idsByConnector.get(r.connectorId) ?? [];
    if (cur.length < MAX_CONNECTOR_INTEL_EVENT_IDS) cur.push(r.eventId);
    idsByConnector.set(r.connectorId, cur);
  }
  return summary.map((s) => {
    const state: ConnectorInboundState = newSet.has(s.connectorId) ? 'NEW' : quietSet.has(s.connectorId) ? 'QUIET' : 'ACTIVE';
    return {
      connectorId: s.connectorId,
      provider: s.provider,
      verifiedSource: s.provider,
      events: s.events,
      lastReceivedAt: s.lastReceivedAt,
      trendDirection: trend.comparable ? dirByConnector.get(s.connectorId) ?? null : null,
      state,
      correlatable: false,
      dedupeRefStatus: 'absent',
      sampleEventIds: idsByConnector.get(s.connectorId) ?? [],
    };
  });
}

/** The minimal read surface this projection needs — satisfied by the existing `EventBus`. */
export interface InboundLineageSource {
  replay(filter?: { types?: readonly string[]; limit?: number }): PlatformEvent[];
}

/**
 * Read verified inbound-webhook lineage for the active tenant from the EXISTING event ring. Fail-closed:
 * a null tenant returns []. Reuses `EventBus.replay` (already tenant-scoped); adds no new store or channel.
 */
export function readInboundLineage(source: InboundLineageSource, tenantId: string | null): InboundLineageRow[] {
  if (tenantId === null || str(tenantId) === null) return [];
  return projectInboundLineage(source.replay({ types: [INBOUND_EVENT_TYPE] }), tenantId);
}
