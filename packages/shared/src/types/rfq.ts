/**
 * Procurement → RFQ — request-for-quotation domain types + the pure
 * quote-comparison engine (W3.1).
 *
 * An RFQ is one sourcing event: one product + quantity put to multiple
 * suppliers, their quotes collected as JSON lines (the journal-lines
 * convention), compared DETERMINISTICALLY, and awarded into a draft Purchase
 * Order through the existing procurement machinery — the PO then walks its own
 * certified approve → send → receive chain; nothing re-implemented.
 *
 * Comparison is transparent arithmetic, never judgment: BEST VALUE = lowest
 * unit cost (ties → shortest lead time, then supplier name); BEST LEAD TIME =
 * shortest lead time among quotes that state one (ties → lowest cost, then
 * name). Award takes the best-value quote — a buyer who wants a different
 * winner edits the quote lines first, so the decision trail stays honest.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The RFQs module id + record kind (the framework store key). */
export const RFQS_MODULE_ID = 'procurement-rfqs';
export const RFQ_KIND = 'rfq';

/** The most quote lines one RFQ accepts. */
export const MAX_RFQ_QUOTES = 50;

/** One supplier's quote line on an RFQ. */
export interface RfqQuote {
  supplier: string;
  unitCost: number;
  /** Days to deliver; null when the supplier did not state one. */
  leadTimeDays: number | null;
  notes: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}

/**
 * Parse quote lines — one JSON object per non-empty line:
 * `{"supplier":"Acme Supplies","unitCost":12.5,"leadTimeDays":7,"notes":"…"}`.
 * Errors carry line numbers; duplicate suppliers are refused by name.
 */
export function parseRfqQuotes(text: string): { quotes: RfqQuote[]; errors: string[] } {
  const quotes: RfqQuote[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const lines = str(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > MAX_RFQ_QUOTES) {
    return { quotes: [], errors: [`At most ${MAX_RFQ_QUOTES} quote lines are supported (got ${lines.length}).`] };
  }
  lines.forEach((line, index) => {
    const n = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      errors.push(`Line ${n}: not valid JSON.`);
      return;
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`Line ${n}: expected a JSON object.`);
      return;
    }
    const o = raw as Record<string, unknown>;
    const supplier = str(o.supplier).trim();
    if (!supplier) {
      errors.push(`Line ${n}: "supplier" is required.`);
      return;
    }
    if (seen.has(supplier)) {
      errors.push(`Line ${n}: duplicate quote from "${supplier}" — one quote per supplier.`);
      return;
    }
    const unitCost = typeof o.unitCost === 'number' ? o.unitCost : Number(str(o.unitCost));
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      errors.push(`Line ${n}: "unitCost" must be a number greater than zero.`);
      return;
    }
    let leadTimeDays: number | null = null;
    if (o.leadTimeDays !== undefined && o.leadTimeDays !== null && str(o.leadTimeDays) !== '') {
      const lead = typeof o.leadTimeDays === 'number' ? o.leadTimeDays : Number(str(o.leadTimeDays));
      if (!Number.isInteger(lead) || lead < 0) {
        errors.push(`Line ${n}: "leadTimeDays" must be a whole number of days (≥ 0).`);
        return;
      }
      leadTimeDays = lead;
    }
    seen.add(supplier);
    quotes.push({ supplier, unitCost, leadTimeDays, notes: str(o.notes) });
  });
  return { quotes, errors };
}

/** The deterministic comparison — see the header for the exact tie rules. */
export function compareRfqQuotes(quotes: RfqQuote[]): {
  bestValue: RfqQuote | null;
  bestLeadTime: RfqQuote | null;
} {
  let bestValue: RfqQuote | null = null;
  let bestLeadTime: RfqQuote | null = null;
  const lead = (q: RfqQuote): number => (q.leadTimeDays === null ? Number.POSITIVE_INFINITY : q.leadTimeDays);
  for (const q of quotes) {
    if (
      !bestValue ||
      q.unitCost < bestValue.unitCost ||
      (q.unitCost === bestValue.unitCost &&
        (lead(q) < lead(bestValue) || (lead(q) === lead(bestValue) && q.supplier < bestValue.supplier)))
    ) {
      bestValue = q;
    }
    if (q.leadTimeDays !== null) {
      if (
        !bestLeadTime ||
        q.leadTimeDays < (bestLeadTime.leadTimeDays as number) ||
        (q.leadTimeDays === bestLeadTime.leadTimeDays &&
          (q.unitCost < bestLeadTime.unitCost ||
            (q.unitCost === bestLeadTime.unitCost && q.supplier < bestLeadTime.supplier)))
      ) {
        bestLeadTime = q;
      }
    }
  }
  return { bestValue, bestLeadTime };
}

/** A typed view over an RFQ record's flat fields (+ envelope timestamps). */
export interface ProcurementRfq {
  id: string;
  rfqNumber: string;
  product: string;
  quantity: number;
  warehouse: string;
  neededBy: string | null;
  sourceRequest: string;
  quotes: RfqQuote[];
  status: 'open' | 'awarded' | 'cancelled';
  awardedSupplier: string;
  awardedAt: string | null;
  awardedOrder: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Project a framework record into a typed RFQ (quote lines re-parsed). */
export function rfqFromRecord(record: EnterpriseEntity): ProcurementRfq {
  const f = record.fields;
  const awardedAt = str(f.awardedAt) || null;
  const cancelledAt = str(f.cancelledAt) || null;
  return {
    id: record.id,
    rfqNumber: str(f.rfqNumber) || record.title,
    product: str(f.product),
    quantity: num(f.quantity),
    warehouse: str(f.warehouse),
    neededBy: str(f.neededBy) || null,
    sourceRequest: str(f.sourceRequest),
    quotes: parseRfqQuotes(str(f.quotesJson)).quotes,
    status: cancelledAt ? 'cancelled' : awardedAt ? 'awarded' : 'open',
    awardedSupplier: str(f.awardedSupplier),
    awardedAt,
    awardedOrder: str(f.awardedOrder),
    cancelledAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
