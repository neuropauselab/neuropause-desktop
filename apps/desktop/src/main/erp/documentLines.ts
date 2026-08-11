/**
 * Phase 6 — ERP line-item documents.
 *
 * THE STRUCTURAL GAP THIS CLOSES. Every enterprise record stores its fields as
 * `Record<string, string | number | boolean | null>` — flat scalars. A sales
 * order therefore carried ONE product, ONE quantity, ONE total, which made
 * quantity/price matching (three-way match), line-level costing (COGS) and any
 * honest invoice impossible.
 *
 * Design chosen (option 1 from PHASE-6-FINAL-WIRING-PLAN §D): lines are their
 * OWN records keyed by parent document, not a widened field type. That keeps
 * `EnterpriseFieldValue` — and therefore all 104 modules, the descriptor
 * validator, the sync `rev` model and the certification lock — untouched.
 *
 * The cost of that choice is honest and stated: JSON storage has no foreign
 * keys and no cascade, so parent/child integrity is enforced HERE in the
 * service layer. `deleteForDocument` is the cascade; orphan detection is
 * explicit.
 *
 * Money is computed in integer minor units. Float arithmetic on currency drifts
 * (0.1 + 0.2 !== 0.3), and a totals engine that drifts is worse than none.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { envelopeStamp, readStoreFile } from '../storage/storeEnvelope';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'erp-document-lines',
  scope: 'WORKSPACE',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /** P13C ROUND 10 — the enum form. The guarantee is BORROWED; see below. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'No cap, no TTL, no eviction — and the 1,000-line limit is the interesting part: `setLines` ' +
    'REFUSES an over-length document (`ok: false`, nothing written) rather than truncating it, so ' +
    'the one bound in this file cannot delete anything, anyone\'s. Two removals remain, both keyed ' +
    'on `(documentType, documentId)` and both replacing exactly one document\'s lines: `setLines` ' +
    '(replace-whole-document, all-or-nothing after validating every line) and `deleteForDocument` ' +
    '(the parent-delete cascade JSON storage cannot give us). NEITHER CHECKS AN OWNER ITSELF, and ' +
    'it cannot: a DocumentLine has no tenant field — its owner is its parent document. The ' +
    'boundary is the caller\'s: the IPC path resolves the parent through the scoped enterprise ' +
    'module store first, so a foreign documentId reads as absent before this store is reached. ' +
    'That is a BORROWED guarantee and is written down rather than assumed, because an in-process ' +
    'caller that skips the resolve would delete across it (the Round 8 finding, still open by ' +
    'design).',
  reason: 'Product, quantity, unit price, discount, tax, warehouse. The row has no owner field: its owner is the parent document, whose scoped resolve gates the IPC path. ROUND 8 FINDING: in-process callers bypass that gate, so the guarantee is borrowed and is written down rather than assumed.',
});

/**
 * Documents that carry lines. `journalEntry` is deliberately ABSENT — the
 * general ledger already has a real line model (`GlJournalLine`, balance-guarded
 * in `journalEntryModule`). Duplicating it here would create a second, divergent
 * accounting truth.
 */
export type LineDocumentType =
  | 'salesQuote'
  | 'salesOrder'
  | 'delivery'
  | 'invoice'
  | 'purchaseRequest'
  | 'purchaseOrder'
  | 'goodsReceipt'
  | 'bill';

export const LINE_DOCUMENT_TYPES: readonly LineDocumentType[] = [
  'salesQuote',
  'salesOrder',
  'delivery',
  'invoice',
  'purchaseRequest',
  'purchaseOrder',
  'goodsReceipt',
  'bill',
];

export interface DocumentLine {
  id: string;
  documentId: string;
  documentType: LineDocumentType;
  /** 1-based position within the document. */
  lineNo: number;
  productId: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  /** Percentage discount, 0–100. Mutually exclusive with `discountAmount`. */
  discountPercent: number | null;
  /** Absolute discount in document currency. Wins when both are supplied. */
  discountAmount: number | null;
  taxRatePercent: number | null;
  currency: string;
  /** Optional analytical dimensions. */
  accountId: string | null;
  warehouseId: string | null;
  projectId: string | null;
  costCenterId: string | null;
  batchId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface LineInput {
  productId?: string | null;
  description?: string;
  quantity: number;
  unit?: string | null;
  unitPrice?: number;
  discountPercent?: number | null;
  discountAmount?: number | null;
  taxRatePercent?: number | null;
  currency?: string;
  accountId?: string | null;
  warehouseId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
  batchId?: string | null;
}

export interface LineTotals {
  /** quantity × unitPrice, before discount. */
  gross: number;
  discount: number;
  /** gross − discount: the tax base. */
  taxable: number;
  tax: number;
  total: number;
}

export interface DocumentTotals extends LineTotals {
  lineCount: number;
  currency: string;
  /** Set when lines disagree on currency — a document must be single-currency. */
  currencyMismatch: boolean;
}

// ---------------------------------------------------------------------------
// Money — integer minor units, half-up at each monetary step
// ---------------------------------------------------------------------------

/** Round to 2dp, half-up, without float drift. Negative amounts round away from zero. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  // The 1e-9 nudge absorbs representation error (e.g. 1.005 stored as 1.00499…)
  // so a genuine half lands up rather than silently down.
  const cents = Math.floor(Math.abs(value) * 100 + 0.5 + 1e-9);
  return (sign * cents) / 100;
}

/** Deterministic per-line arithmetic. Every monetary step is rounded before the next. */
export function computeLineTotals(line: Pick<DocumentLine, 'quantity' | 'unitPrice' | 'discountPercent' | 'discountAmount' | 'taxRatePercent'>): LineTotals {
  const gross = round2(line.quantity * line.unitPrice);

  let discount = 0;
  if (line.discountAmount !== null && line.discountAmount !== undefined) {
    discount = round2(line.discountAmount);
  } else if (line.discountPercent !== null && line.discountPercent !== undefined) {
    discount = round2((gross * line.discountPercent) / 100);
  }
  // A discount never exceeds the line, and never flips its sign.
  if (gross >= 0) discount = Math.min(discount, gross);
  else discount = Math.max(discount, gross);

  const taxable = round2(gross - discount);
  const tax = line.taxRatePercent ? round2((taxable * line.taxRatePercent) / 100) : 0;
  const total = round2(taxable + tax);
  return { gross, discount, taxable, tax, total };
}

/**
 * Document totals are the SUM OF ROUNDED LINE TOTALS, not a re-computation over
 * summed inputs. Summing first and rounding once produces figures that disagree
 * with the printed lines by a cent — the classic invoice dispute.
 */
export function computeDocumentTotals(lines: readonly DocumentLine[], fallbackCurrency = 'INR'): DocumentTotals {
  const acc: LineTotals = { gross: 0, discount: 0, taxable: 0, tax: 0, total: 0 };
  for (const line of lines) {
    const t = computeLineTotals(line);
    acc.gross = round2(acc.gross + t.gross);
    acc.discount = round2(acc.discount + t.discount);
    acc.taxable = round2(acc.taxable + t.taxable);
    acc.tax = round2(acc.tax + t.tax);
    acc.total = round2(acc.total + t.total);
  }
  const currencies = new Set(lines.map((l) => l.currency));
  return {
    ...acc,
    lineCount: lines.length,
    currency: lines[0]?.currency ?? fallbackCurrency,
    currencyMismatch: currencies.size > 1,
  };
}

// ---------------------------------------------------------------------------
// Domain-specific validation
// ---------------------------------------------------------------------------

interface LineSpec {
  /** A price is meaningless on some documents (a receipt records quantity). */
  requiresPrice: boolean;
  /** Documents that move goods must name what moved. */
  requiresProduct: boolean;
  allowNegativeQuantity: boolean;
  allowZeroQuantity: boolean;
}

const SPECS: Record<LineDocumentType, LineSpec> = {
  salesQuote: { requiresPrice: true, requiresProduct: false, allowNegativeQuantity: false, allowZeroQuantity: false },
  salesOrder: { requiresPrice: true, requiresProduct: true, allowNegativeQuantity: false, allowZeroQuantity: false },
  // A delivery records movement, not money.
  delivery: { requiresPrice: false, requiresProduct: true, allowNegativeQuantity: false, allowZeroQuantity: false },
  // Credit lines are legitimate on an invoice (returns, corrections).
  invoice: { requiresPrice: true, requiresProduct: false, allowNegativeQuantity: true, allowZeroQuantity: false },
  purchaseRequest: { requiresPrice: false, requiresProduct: false, allowNegativeQuantity: false, allowZeroQuantity: false },
  purchaseOrder: { requiresPrice: true, requiresProduct: true, allowNegativeQuantity: false, allowZeroQuantity: false },
  // Over/under-receipt against a PO is normal; a rejection is a negative receipt.
  goodsReceipt: { requiresPrice: false, requiresProduct: true, allowNegativeQuantity: true, allowZeroQuantity: true },
  bill: { requiresPrice: true, requiresProduct: false, allowNegativeQuantity: true, allowZeroQuantity: false },
};

export interface LineValidation {
  ok: boolean;
  errors: string[];
}

export function validateLine(documentType: LineDocumentType, input: LineInput): LineValidation {
  const spec = SPECS[documentType];
  const errors: string[] = [];

  if (!Number.isFinite(input.quantity)) errors.push('Quantity must be a number.');
  else {
    if (input.quantity === 0 && !spec.allowZeroQuantity) errors.push('Quantity must not be zero.');
    if (input.quantity < 0 && !spec.allowNegativeQuantity) {
      errors.push(`Quantity must not be negative on a ${documentType}.`);
    }
  }

  if (spec.requiresPrice) {
    if (input.unitPrice === undefined || !Number.isFinite(input.unitPrice)) {
      errors.push('Unit price is required.');
    } else if (input.unitPrice < 0) {
      errors.push('Unit price must not be negative.');
    }
  }

  if (spec.requiresProduct && (input.productId === undefined || input.productId === null || input.productId === '')) {
    errors.push(`A product is required on a ${documentType} line.`);
  }

  if ((input.description ?? '').trim() === '' && (input.productId ?? '') === '') {
    errors.push('A line needs either a product or a description.');
  }

  if (input.discountPercent !== undefined && input.discountPercent !== null) {
    if (input.discountPercent < 0 || input.discountPercent > 100) errors.push('Discount percent must be between 0 and 100.');
  }
  if (input.taxRatePercent !== undefined && input.taxRatePercent !== null) {
    if (input.taxRatePercent < 0 || input.taxRatePercent > 100) errors.push('Tax rate must be between 0 and 100.');
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface LineFile {
  schemaVersion?: number;
  lines: DocumentLine[];
}

export const MAX_LINES_PER_DOCUMENT = 1_000;

export class DocumentLineStore {
  private lines: DocumentLine[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const res = await readStoreFile<LineFile>(this.filePath);
    if (res.state === 'loaded' && res.data && Array.isArray(res.data.lines)) this.lines = res.data.lines;
    this.loaded = true;
  }

  /** Lines of one document, in line order. */
  forDocument(documentType: LineDocumentType, documentId: string): DocumentLine[] {
    return this.lines
      .filter((l) => l.documentType === documentType && l.documentId === documentId)
      .sort((a, b) => a.lineNo - b.lineNo);
  }

  totals(documentType: LineDocumentType, documentId: string): DocumentTotals {
    return computeDocumentTotals(this.forDocument(documentType, documentId));
  }

  /**
   * Replace every line of a document in one operation. Documents are edited as a
   * whole — a partial line write with no transaction is how parent and children
   * drift apart in a store with no foreign keys.
   */
  async setLines(
    documentType: LineDocumentType,
    documentId: string,
    inputs: readonly LineInput[],
    ctx: { actor: string | null; now: string; idFactory?: () => string },
  ): Promise<{ ok: boolean; lines: DocumentLine[]; errors: { lineNo: number; errors: string[] }[] }> {
    await this.load();
    if (inputs.length > MAX_LINES_PER_DOCUMENT) {
      return { ok: false, lines: [], errors: [{ lineNo: 0, errors: [`A document may not exceed ${MAX_LINES_PER_DOCUMENT} lines.`] }] };
    }

    // Validate EVERY line before writing any — all-or-nothing.
    const errors: { lineNo: number; errors: string[] }[] = [];
    inputs.forEach((input, i) => {
      const v = validateLine(documentType, input);
      if (!v.ok) errors.push({ lineNo: i + 1, errors: v.errors });
    });
    if (errors.length > 0) return { ok: false, lines: this.forDocument(documentType, documentId), errors };

    const newId = ctx.idFactory ?? ((): string => `line_${randomUUID()}`);
    const existing = this.forDocument(documentType, documentId);
    const created: DocumentLine[] = inputs.map((input, i) => ({
      id: existing[i]?.id ?? newId(),
      documentId,
      documentType,
      lineNo: i + 1,
      productId: input.productId ?? null,
      description: (input.description ?? '').trim(),
      quantity: input.quantity,
      unit: input.unit ?? null,
      unitPrice: input.unitPrice ?? 0,
      discountPercent: input.discountPercent ?? null,
      discountAmount: input.discountAmount ?? null,
      taxRatePercent: input.taxRatePercent ?? null,
      currency: input.currency ?? 'INR',
      accountId: input.accountId ?? null,
      warehouseId: input.warehouseId ?? null,
      projectId: input.projectId ?? null,
      costCenterId: input.costCenterId ?? null,
      batchId: input.batchId ?? null,
      createdAt: existing[i]?.createdAt ?? ctx.now,
      updatedAt: ctx.now,
      createdBy: existing[i]?.createdBy ?? ctx.actor,
    }));

    this.lines = this.lines.filter((l) => !(l.documentType === documentType && l.documentId === documentId));
    this.lines.push(...created);
    await this.persist();
    return { ok: true, lines: created, errors: [] };
  }

  /** The cascade JSON storage cannot give us. Call when a parent is deleted. */
  async deleteForDocument(documentType: LineDocumentType, documentId: string): Promise<number> {
    await this.load();
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => !(l.documentType === documentType && l.documentId === documentId));
    const removed = before - this.lines.length;
    if (removed > 0) await this.persist();
    return removed;
  }

  /**
   * Referential-integrity sweep: lines whose parent no longer exists. Explicit,
   * because nothing else in a JSON store will notice.
   */
  orphans(documentExists: (documentType: LineDocumentType, documentId: string) => boolean): DocumentLine[] {
    return this.lines.filter((l) => !documentExists(l.documentType, l.documentId));
  }

  count(): number {
    return this.lines.length;
  }

  private async persist(): Promise<void> {
    const payload: LineFile = { ...envelopeStamp(), lines: this.lines };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
