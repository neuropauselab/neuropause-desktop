/**
 * S125 — Operational Evidence Search (pure, deterministic, read-only).
 *
 * A deterministic LEXICAL/FILTER search over already-persisted, already-tenant-scoped CANONICAL
 * operational evidence — the committed-command history (`DurableCommandJournal`) and the verified
 * connector inbound lineage (the EventBus ring, S119). It makes previously fragmented, page-only
 * evidence actually discoverable to an operator, WITHOUT any new search engine, vector database, memory
 * store, or index: it is a pure fold over rows the governed reads already return.
 *
 * WHAT IT HARVESTS: only the deterministic lexical-match CONCEPT used by the canonical
 * `search/enterpriseSearch.ts` (case-insensitive substring / prefix scoring) — NOT its engine or its
 * sources (entity/graph/memory/timeline are different stores on a different wiring). No second search.
 *
 * DISCIPLINE:
 *   • PURE + TOTAL: no store, no clock beyond ordering, no I/O, no mutation. Injected rows only.
 *   • TENANT-SAFE by construction: the caller passes rows ALREADY scoped to the server-resolved tenant
 *     (`journal.records(tenantId)` / `readInboundLineage(source, tenantId)`); this module resolves and
 *     trusts NO tenant claim.
 *   • CREDENTIAL-FREE: matches and emits only safe metadata — ids / types / statuses / timestamps /
 *     connector+provider / correlation & lineage ids. It deliberately does NOT match against or emit
 *     raw command results, raw outbox error text, secrets, tokens, or connector payloads.
 *   • BOUNDED: never "return everything"; the result is clamped to a caller limit.
 *   • NO INVENTED MEANING: no severity, incident, SLO, or authority — only the descriptive status the
 *     evidence already carries. `score` is a lexical relevance number, not a business judgement.
 */
import type { CommittedCommand } from '../platform/command/durableCommandJournal';
import type { InboundLineageRow } from '../connectors/inbound/lineage';

export const MAX_EVIDENCE_RESULTS = 100;
export const DEFAULT_EVIDENCE_RESULTS = 25;

export type EvidenceKind = 'command' | 'inbound';

export interface EvidenceHit {
  kind: EvidenceKind;
  /** stable evidence identifier (command txId / inbound eventId). */
  id: string;
  /** the source/domain the evidence came from. */
  source: string;
  /** the record/event type. */
  type: string;
  /** epoch ms (or ISO→ms) of the evidence, for ordering; 0 when unknown. */
  timestamp: number;
  /** a concise, sanitized, credential-free one-line summary. */
  summary: string;
  /** descriptive status/direction already carried by the evidence (never invented). */
  status: string | null;
  /** canonical correlation id where the evidence already carries one. */
  correlationId: string | null;
  /** canonical connector id for inbound evidence. */
  connectorId: string | null;
  /** lexical relevance score (higher = better match); NOT a business judgement. */
  score: number;
}

export interface EvidenceSearchResult {
  query: string;
  hits: EvidenceHit[];
  counts: { command: number; inbound: number; total: number };
  bounded: boolean;
}

export interface EvidenceSearchOptions {
  limit?: number;
  /** restrict to one evidence kind; omitted = both. */
  kind?: EvidenceKind;
}

export function boundEvidenceLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_EVIDENCE_RESULTS;
  return Math.min(n, MAX_EVIDENCE_RESULTS);
}

/** Tokenize a free-text query into lowercase terms (bounded count; hostile input cannot escape). */
function tokenize(query: unknown): string[] {
  const s = typeof query === 'string' ? query : '';
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 16); // bounded: a pathological query cannot blow up the match loop
}

/** All tokens must appear (AND) in the haystack; score = matched tokens + a small prefix/exact bonus. */
function scoreHaystack(haystack: string, tokens: string[]): number | null {
  if (tokens.length === 0) return 0; // empty query matches everything (browse), score 0
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!h.includes(t)) return null; // AND semantics: a missing token drops the row
    score += 1;
    if (h.startsWith(t)) score += 0.5;
  }
  return score;
}

const isoToMs = (v: string): number => {
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Search a set of ALREADY-tenant-scoped committed commands + inbound lineage rows. Pure and total.
 * Empty query returns the most-recent bounded evidence (browse); a query filters with AND-token
 * lexical matching. Results are sorted by score desc, then timestamp desc, and bounded.
 */
export function searchOperationalEvidence(
  commands: readonly CommittedCommand[],
  lineage: readonly InboundLineageRow[],
  query: string,
  options: EvidenceSearchOptions = {},
): EvidenceSearchResult {
  const limit = boundEvidenceLimit(options.limit);
  const tokens = tokenize(query);
  const wantCommand = options.kind === undefined || options.kind === 'command';
  const wantInbound = options.kind === undefined || options.kind === 'inbound';
  const hits: EvidenceHit[] = [];

  if (wantCommand) {
    for (const rec of commands) {
      // SAFE haystack only — never the raw result payload or raw outbox error text.
      const haystack = [
        rec.commandType,
        rec.event?.actor ?? '',
        rec.event?.aggregateId ?? '',
        rec.event?.aggregateType ?? '',
        rec.event?.type ?? '',
        rec.event?.correlationId ?? '',
        rec.outbox?.status ?? '',
        rec.id,
        rec.idempotencyKey,
      ].join(' ');
      const score = scoreHaystack(haystack, tokens);
      if (score === null) continue;
      hits.push({
        kind: 'command',
        id: rec.id,
        source: 'command-journal',
        type: rec.commandType,
        timestamp: rec.committedAt ? isoToMs(rec.committedAt) : 0,
        summary: `${rec.commandType} · ${rec.outbox?.status ?? 'PENDING'}`,
        status: rec.outbox?.status ?? null,
        correlationId: rec.event?.correlationId ?? null,
        connectorId: null,
        score,
      });
    }
  }

  if (wantInbound) {
    for (const row of lineage) {
      const haystack = [row.connectorId, row.provider, row.verifiedSource, row.eventId].join(' ');
      const score = scoreHaystack(haystack, tokens);
      if (score === null) continue;
      hits.push({
        kind: 'inbound',
        id: row.eventId,
        source: 'connector-inbound',
        type: 'inbound_webhook',
        timestamp: Number.isFinite(row.receivedAt) ? row.receivedAt : 0,
        summary: `${row.connectorId} · ${row.provider} · verified`,
        status: 'verified',
        correlationId: null,
        connectorId: row.connectorId,
        score,
      });
    }
  }

  const commandTotal = hits.filter((h) => h.kind === 'command').length;
  const inboundTotal = hits.filter((h) => h.kind === 'inbound').length;
  hits.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  const bounded = hits.slice(0, limit);

  return {
    query: tokens.join(' '),
    hits: bounded,
    counts: { command: commandTotal, inbound: inboundTotal, total: commandTotal + inboundTotal },
    bounded: hits.length > bounded.length,
  };
}
