/**
 * S128 — AI evidence grounding (pure). Proves governed evidence → AiContextItem[] with explicit per-item
 * provenance, evidence-not-interpretation text, trace-leads-then-hits ordering, provenance dedup, bounding,
 * credential-free output, and honest-empty behavior. No AI execution (pure projection).
 */
import { describe, it, expect } from 'vitest';
import type { EvidenceHit } from './evidenceSearch';
import type { TraceEntry } from './evidenceTrace';
import { projectEvidenceForAI, projectPostureForAI, relevanceScore, MAX_GROUNDING_ITEMS, DEFAULT_GROUNDING_ITEMS, boundGroundingLimit } from './evidenceContext';
import type { ReliabilitySummary } from './operationalReliability';

function hit(over: Partial<EvidenceHit> = {}): EvidenceHit {
  return { kind: 'command', id: 'tx_1', source: 'command-journal', type: 'CreateSalesOrder', timestamp: 1_700_000_000_000, summary: 'CreateSalesOrder · DELIVERED', status: 'DELIVERED', correlationId: 'corr-1', connectorId: null, score: 1, ...over } as EvidenceHit;
}
function entry(over: Partial<TraceEntry> = {}): TraceEntry {
  return { source: 'command-journal', id: 'tx_1', timestamp: 1, at: '2026-09-05T00:00:01.000Z', type: 'CreateSalesOrder', status: 'DELIVERED', aggregateId: 'so-1', correlationId: 'corr-1', delivery: { state: 'DELIVERED', linked: true, attempts: 1, deliveredAt: '2026-09-05T00:00:05.000Z' }, ...over } as TraceEntry;
}

describe('S128 · AI evidence grounding (pure)', () => {
  it('projects search hits into AiContextItem[] with EXACT per-item provenance', () => {
    const items = projectEvidenceForAI({ hits: [hit({ id: 'tx_A', source: 'command-journal' })] });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('timeline'); // coarse channel (frozen enum), exact provenance below
    expect(items[0].evidence).toEqual([{ kind: 'command-journal', id: 'tx_A' }]);
    expect(items[0].text).toContain('CreateSalesOrder'); // evidence, not interpretation
  });

  it('trace entries lead, then hits; deduped by provenance (kind:id)', () => {
    const items = projectEvidenceForAI({
      traceEntries: [entry({ id: 'tx_1', source: 'command-journal' })],
      hits: [hit({ id: 'tx_1', source: 'command-journal' }), hit({ id: 'gh1', source: 'connector-inbound', kind: 'inbound', connectorId: 'github' })],
    });
    // tx_1 appears once (trace wins), plus the distinct connector-inbound hit
    expect(items.map((i) => i.evidence?.[0])).toEqual([
      { kind: 'command-journal', id: 'tx_1' },
      { kind: 'connector-inbound', id: 'gh1' },
    ]);
    expect(items[0].text).toContain('Correlated evidence'); // trace-derived
  });

  it('is bounded by the caller limit', () => {
    const hits = Array.from({ length: MAX_GROUNDING_ITEMS + 10 }, (_, i) => hit({ id: `tx_${i}` }));
    expect(projectEvidenceForAI({ hits, limit: 5 })).toHaveLength(5);
    expect(projectEvidenceForAI({ hits }).length).toBe(DEFAULT_GROUNDING_ITEMS); // no limit ⇒ default cap
    expect(projectEvidenceForAI({ hits, limit: MAX_GROUNDING_ITEMS }).length).toBe(MAX_GROUNDING_ITEMS); // capped at max
  });

  it('empty input ⇒ empty context (honest, never fabricated)', () => {
    expect(projectEvidenceForAI({})).toEqual([]);
  });

  it('grounding items carry NO credential/secret/raw payload material', () => {
    const items = projectEvidenceForAI({
      hits: [hit({ id: 'tx_1' })],
      traceEntries: [entry({ id: 'tx_2', source: 'delivered-events' })],
    });
    const blob = JSON.stringify(items).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody', 'bearer']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('boundGroundingLimit clamps junk to default and caps at max', () => {
    expect(boundGroundingLimit('junk')).toBeGreaterThan(0);
    expect(boundGroundingLimit(-1)).toBeGreaterThan(0);
    expect(boundGroundingLimit(9999)).toBe(MAX_GROUNDING_ITEMS);
  });
});

describe('S130 · relevance-ranked grounding (pure, non-excluding)', () => {
  it('NO query ⇒ byte-identical to recency order (backward compatible)', () => {
    const hits = [hit({ id: 'tx_a', type: 'CreateSalesOrder' }), hit({ id: 'tx_b', type: 'PaySupplierInvoice' })];
    expect(projectEvidenceForAI({ hits })).toEqual(projectEvidenceForAI({ hits, query: '' }));
    expect(projectEvidenceForAI({ hits, query: '   ' })).toEqual(projectEvidenceForAI({ hits }));
  });

  it('a relevant question FLOATS matching evidence to the top within the bound', () => {
    // recency order puts the invoice first; a question about sales orders must re-rank it above.
    const hits = [
      hit({ id: 'tx_pay', type: 'PaySupplierInvoice', status: null, correlationId: null }),
      hit({ id: 'tx_so', type: 'CreateSalesOrder', status: null, correlationId: null }),
    ];
    const ranked = projectEvidenceForAI({ hits, query: 'what happened with my sales order' });
    expect(ranked[0].evidence?.[0]).toEqual({ kind: 'command-journal', id: 'tx_so' });
    expect(ranked).toHaveLength(2); // NON-EXCLUDING: the unrelated item is kept, just ranked lower
  });

  it('a question with NO lexical overlap keeps every item (degrades to recency, never empties)', () => {
    const hits = [hit({ id: 'tx_a' }), hit({ id: 'tx_b' })];
    const ranked = projectEvidenceForAI({ hits, query: 'zzz nonsense unrelated tokens' });
    expect(ranked).toHaveLength(2);
    expect(ranked).toEqual(projectEvidenceForAI({ hits })); // stable: identical to recency order
  });

  it('ranking selects the most relevant items INTO the bound (beyond default recency)', () => {
    // 30 unrelated recent hits + 1 older relevant hit; limit 3 must include the relevant one.
    const noise = Array.from({ length: 30 }, (_, i) => hit({ id: `tx_${i}`, type: 'PaySupplierInvoice', status: null, correlationId: null, connectorId: null }));
    const relevant = hit({ id: 'tx_target', type: 'CreateSalesOrder', status: null, correlationId: null, connectorId: null });
    const ranked = projectEvidenceForAI({ hits: [...noise, relevant], query: 'sales order', limit: 3 });
    expect(ranked).toHaveLength(3);
    expect(ranked.some((i) => i.evidence?.[0]?.id === 'tx_target')).toBe(true);
  });

  it('relevance is STABLE on ties (equal-overlap items keep original relative order)', () => {
    const hits = [hit({ id: 'tx_1', type: 'CreateSalesOrder', status: null, correlationId: null }), hit({ id: 'tx_2', type: 'CreateSalesOrder', status: null, correlationId: null })];
    const ranked = projectEvidenceForAI({ hits, query: 'sales order' });
    expect(ranked.map((i) => i.evidence?.[0]?.id)).toEqual(['tx_1', 'tx_2']);
  });

  it('relevanceScore is a pure non-excluding lexical overlap count (0 = no relevance, never drop)', () => {
    const item = { source: 'timeline' as const, text: 'Operational evidence — CreateSalesOrder · status DELIVERED.', evidence: [{ kind: 'command-journal', id: 'tx' }] };
    // The measure counts DISTINCT query tokens present as substrings of the item text (case-insensitive).
    expect(relevanceScore(item, ['sales'])).toBe(1); // "sales" is a substring of "createsalesorder"
    expect(relevanceScore(item, ['delivered', 'createsalesorder'])).toBe(2);
    expect(relevanceScore(item, ['delivered', 'delivered'])).toBe(2); // counts per token position, not de-duped — bounded anyway
    expect(relevanceScore(item, [])).toBe(0); // empty query never boosts
    expect(relevanceScore(item, ['zzz'])).toBe(0); // no overlap, but the caller keeps the item
  });

  it('hostile / pathological question cannot exclude evidence or blow up (bounded tokens)', () => {
    const hits = [hit({ id: 'tx_1' })];
    const huge = Array.from({ length: 5000 }, (_, i) => `t${i}`).join(' ');
    expect(() => projectEvidenceForAI({ hits, query: huge })).not.toThrow();
    expect(projectEvidenceForAI({ hits, query: huge })).toHaveLength(1); // still present (non-excluding)
    // injection-shaped text is treated as plain lexical tokens, never executed/interpreted
    expect(() => projectEvidenceForAI({ hits, query: '"; DROP TABLE; ${process.exit()}' })).not.toThrow();
  });
});

function summary(over: Partial<ReliabilitySummary> = {}): ReliabilitySummary {
  return {
    totals: { commands: 10, delivered: 8, pending: 0, processing: 0, retryable: 2, attempts: 14, retried: 3, everErrored: 2 },
    successRatio: 0.8,
    deliveryFailureRatio: 0.2,
    byCommandType: [],
    topErrors: [{ signature: 'Graph 429 rate limited', count: 5 }],
    ...over,
  } as ReliabilitySummary;
}

describe('S133 · AI operational-posture grounding (pure, definitional)', () => {
  it('projects an aggregate posture item + a top-error item (≤2), tagged operational-posture', () => {
    const items = projectPostureForAI(summary());
    expect(items).toHaveLength(2);
    expect(items[0].evidence).toEqual([{ kind: 'operational-posture', id: 'reliability' }]);
    expect(items[0].text).toContain('10 governed command(s)');
    expect(items[0].text).toContain('8 delivered (80%)');
    expect(items[0].text).toContain('2 retrying (20% delivery-failure)');
    expect(items[1].evidence).toEqual([{ kind: 'operational-posture', id: 'top-error' }]);
    expect(items[1].text).toContain('Graph 429 rate limited');
    expect(items[1].text).toContain('(5×)');
  });

  it('omits the top-error item when there are no recurring errors', () => {
    const items = projectPostureForAI(summary({ topErrors: [] }));
    expect(items).toHaveLength(1);
    expect(items[0].evidence?.[0]?.id).toBe('reliability');
  });

  it('empty journal ⇒ NO posture (honest: nothing to ground on, never fabricated)', () => {
    const empty = summary({ totals: { commands: 0, delivered: 0, pending: 0, processing: 0, retryable: 0, attempts: 0, retried: 0, everErrored: 0 }, successRatio: 0, deliveryFailureRatio: 0, topErrors: [] });
    expect(projectPostureForAI(empty)).toEqual([]);
  });

  it('posture text is definitional (ratios/counts) — carries NO credential/secret/payload material', () => {
    const blob = JSON.stringify(projectPostureForAI(summary())).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'bearer']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
