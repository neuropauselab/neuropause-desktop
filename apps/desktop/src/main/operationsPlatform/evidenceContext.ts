/**
 * S128 — AI evidence GROUNDING (pure, deterministic, read-only).
 *
 * Turns governed operational EVIDENCE (the S125 evidence-search hits + the S126/S127 correlation-trace
 * entries) into `AiContextItem[]` — the SAME context shape the assistant's canonical Context Builder
 * already consumes (mirrors `capabilities/capabilityAiContext.ts projectCapabilitiesForAI`). It lets the
 * live Brain be GROUNDED on what actually happened operationally, WITHOUT any new AI runtime, store, or
 * retrieval engine — it is a pure projection over evidence the governed reads already produced.
 *
 * BOUNDARIES (each pinned):
 *   • READ-ONLY: pure function, no store/clock/IO/mutation; produces context, never executes anything.
 *   • EVIDENCE ≠ INTERPRETATION: every item is a sanitized factual line tagged with EXPLICIT per-item
 *     provenance in `evidence:[{kind,id}]` (kind = the canonical source, id = the record id). The text is
 *     evidence, not an AI conclusion. The frozen `AiContextItem.source` is a COARSE channel label
 *     (`'timeline'`); the precise provenance is the per-item `evidence[]` (as capabilities use
 *     `'mission-brief'` coarsely).
 *   • CREDENTIAL-FREE: only ids/types/statuses/timestamps/summaries — never payloads, secrets, tokens, or
 *     raw outbox error text (the inputs already exclude those).
 *   • BOUNDED: never "return everything"; clamped to a caller cap.
 *   • TENANT-SAFE by construction: the caller supplies evidence ALREADY scoped to the server-resolved
 *     tenant; this module resolves no tenant.
 *   • NO FROZEN CHANGE: reuses the frozen `AiContextItem` type + an existing `AiContextSource` value; it
 *     neither modifies nor extends the shared contract.
 */
import type { AiContextItem } from '@neuropause/shared';
import type { EvidenceHit } from './evidenceSearch';
import type { TraceEntry } from './evidenceTrace';
import type { ReliabilitySummary } from './operationalReliability';
import type { ConnectorInboundIntelligence } from '../connectors/inbound/lineage';

/** Coarse context channel (frozen enum). Exact provenance is carried per-item in `evidence[]`. */
const EVIDENCE_SOURCE = 'timeline' as const;
export const MAX_GROUNDING_ITEMS = 50;
export const DEFAULT_GROUNDING_ITEMS = 20;

export function boundGroundingLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return DEFAULT_GROUNDING_ITEMS;
  return Math.min(n, MAX_GROUNDING_ITEMS);
}

const iso = (ms: number): string => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : 'unknown time');

/** One evidence-search hit → a grounding item (factual line + exact provenance). */
function hitToItem(h: EvidenceHit): AiContextItem {
  const bits = [
    `${h.type}`,
    h.status ? `status ${h.status}` : null,
    h.connectorId ? `connector ${h.connectorId}` : null,
    h.correlationId ? `correlation ${h.correlationId}` : null,
    `at ${iso(h.timestamp)}`,
  ].filter(Boolean);
  return { source: EVIDENCE_SOURCE, text: `Operational evidence — ${bits.join(' · ')}.`, evidence: [{ kind: h.source, id: h.id }] };
}

/**
 * S133 — project the tenant's operational RELIABILITY POSTURE into grounding item(s). The bounded evidence
 * ROWS (hits/trace) cannot convey an AGGREGATE — a question like "is delivery healthy?" needs the ratios
 * over ALL commands, which 20 sampled rows cannot express. This adds a compact, credential-free posture
 * summary (totals + success/delivery-failure ratios + the single top recurring error signature) computed
 * by the SAME `summarizeReliability` the operator reads via QueryReliabilitySummary. Pure; ≤2 items.
 *
 * DISCIPLINE: DEFINITIONAL facts only (counts/ratios are arithmetic, not a verdict — no SLO/health label
 * invented); CREDENTIAL-FREE (reliability signatures are already trimmed, and command types carry no
 * secrets); provenance tagged `operational-posture`. Empty journal ⇒ empty (honest: nothing to ground on).
 */
export function projectPostureForAI(summary: ReliabilitySummary): AiContextItem[] {
  const t = summary.totals;
  if (t.commands === 0) return []; // no governed commands ⇒ no posture to ground on (never fabricated)
  const pct = (r: number): string => `${Math.round(r * 1000) / 10}%`;
  const out: AiContextItem[] = [
    {
      source: EVIDENCE_SOURCE,
      text:
        `Operational posture — ${t.commands} governed command(s): ${t.delivered} delivered (${pct(summary.successRatio)}), ` +
        `${t.retryable} retrying (${pct(summary.deliveryFailureRatio)} delivery-failure), ${t.pending} pending, ${t.processing} in-flight; ` +
        `${t.retried} took more than one attempt.`,
      evidence: [{ kind: 'operational-posture', id: 'reliability' }],
    },
  ];
  const top = summary.topErrors[0];
  if (top) {
    out.push({
      source: EVIDENCE_SOURCE,
      text: `Operational posture — top recurring delivery error (${top.count}×): ${top.signature}`,
      evidence: [{ kind: 'operational-posture', id: 'top-error' }],
    });
  }
  return out;
}

/**
 * S135 — project per-connector CONNECTOR INBOUND INTELLIGENCE into grounding item(s). Lets the Brain answer
 * "which connectors are active / new / quiet, and how much verified inbound arrived" — descriptive facts the
 * evidence rows alone don't aggregate. Bounded, credential-free, provenance-tagged `connector-intelligence`
 * (distinct from the row-level `connector-inbound` search-hit kind, so the aggregate is unambiguous).
 * DESCRIPTIVE ONLY: reuses S123's NEW/QUIET/ACTIVE state + volume direction — no invented health/SLO/score.
 */
export function projectConnectorIntelligenceForAI(intel: readonly ConnectorInboundIntelligence[], limit = 10): AiContextItem[] {
  const out: AiContextItem[] = [];
  for (const c of intel.slice(0, Math.max(0, limit))) {
    const bits = [
      `${c.connectorId} (${c.provider})`,
      `${c.events} verified inbound`,
      `state ${c.state}`,
      c.trendDirection ? `trend ${c.trendDirection}` : null,
      `at ${iso(c.lastReceivedAt)}`,
      'not correlatable',
    ].filter(Boolean);
    out.push({
      source: EVIDENCE_SOURCE,
      text: `Connector inbound — ${bits.join(' · ')}.`,
      evidence: [{ kind: 'connector-intelligence', id: c.connectorId }],
    });
  }
  return out;
}

/** One correlation-trace entry → a grounding item (factual line + exact provenance incl. delivery posture). */
function traceEntryToItem(e: TraceEntry): AiContextItem {
  const bits = [
    `${e.type}`,
    e.status ? `status ${e.status}` : null,
    e.delivery && e.delivery.state !== 'UNAVAILABLE' ? `delivery ${e.delivery.state}` : null,
    e.aggregateId ? `aggregate ${e.aggregateId}` : null,
    `at ${e.at || 'unknown time'}`,
  ].filter(Boolean);
  return { source: EVIDENCE_SOURCE, text: `Correlated evidence — ${bits.join(' · ')}.`, evidence: [{ kind: e.source, id: e.id }] };
}

/**
 * S130 — tokenize a free-text question into lowercase relevance terms (bounded; hostile input cannot
 * escape). Mirrors the S125 search tokenizer intentionally: the same term class ranks and searches, so
 * the grounding relevance number is the SAME kind of lexical measure the operator already sees on the
 * evidence-search surface — never a business judgement.
 */
function relevanceTokens(query: unknown): string[] {
  const s = typeof query === 'string' ? query : '';
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2) // 1-char noise ("a", "i") never boosts
    .slice(0, 16); // bounded: a pathological question cannot blow up the ranking loop
}

/**
 * S130 — the count of distinct query tokens that appear in an item's SAFE text. A pure, deterministic
 * lexical OVERLAP measure; 0 means "no lexical relevance to the question", never "exclude". Deliberately
 * NON-EXCLUDING (unlike the S125 AND-search): grounding must never go empty when evidence exists — a
 * question with no lexical overlap simply leaves every score at 0 and the original recency order stands.
 */
export function relevanceScore(item: AiContextItem, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const h = item.text.toLowerCase();
  let score = 0;
  for (const t of tokens) if (h.includes(t)) score += 1;
  return score;
}

export interface EvidenceGroundingInput {
  /** evidence-search hits (already tenant-scoped, sanitized). */
  hits?: readonly EvidenceHit[];
  /** correlation-trace entries (already tenant-scoped, sanitized). */
  traceEntries?: readonly TraceEntry[];
  limit?: number;
  /**
   * S130 — the operator/AI question, used ONLY to RANK (never to exclude) which evidence floats into the
   * bound. Absent/empty ⇒ pure recency order (identical to prior behavior). It is a relevance signal, not
   * a tenant selector: the caller has ALREADY tenant-scoped `hits`/`traceEntries`; this string filters
   * nothing across tenants and grants nothing.
   */
  query?: string;
}

/**
 * Project governed evidence into grounding context for the Brain. Pure and total. Trace entries (the more
 * specific "what happened for this correlation") lead, then search hits, deduplicated by provenance
 * (kind:id). When a `query` is supplied it re-orders the deduped items by lexical relevance (STABLE:
 * higher overlap first, original relative order preserved on ties and for zero-overlap items) BEFORE the
 * bound, so the most relevant evidence survives the cap. Empty input ⇒ empty context (honest: nothing to
 * ground on), never fabricated. No `query` (or no lexical overlap) ⇒ byte-identical to recency order.
 */
export function projectEvidenceForAI(input: EvidenceGroundingInput): AiContextItem[] {
  const limit = boundGroundingLimit(input.limit);
  const seen = new Set<string>();
  const out: AiContextItem[] = [];
  const push = (item: AiContextItem): void => {
    const prov = item.evidence?.[0];
    const key = prov ? `${prov.kind}:${prov.id}` : item.text;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  for (const e of input.traceEntries ?? []) push(traceEntryToItem(e));
  for (const h of input.hits ?? []) push(hitToItem(h));

  const tokens = relevanceTokens(input.query);
  if (tokens.length > 0) {
    // Stable relevance sort: decorate with original index so equal scores keep the recency order and a
    // zero-overlap question is a no-op. Never drops an item — ranking, not filtering.
    return out
      .map((item, index) => ({ item, index, score: relevanceScore(item, tokens) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((d) => d.item);
  }
  return out.slice(0, limit);
}
