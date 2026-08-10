/**
 * What a document is, and what is written in it.
 *
 * Deterministic and pure. No model, no network, no clock. Two functions:
 * `classifyDocument` decides what kind of thing this is, and
 * `extractInvoiceFields` reads named values out of an invoice. Both return
 * their evidence, and both are happy to answer "I do not know".
 *
 * WHY NOT AN LLM
 *
 * An LLM asked "what is the total on this invoice?" will produce a number
 * whether or not one is present, and the number will be plausible. For a value
 * that ends up in a ledger, plausible is the failure mode — a wrong total that
 * looks wrong gets caught, and a wrong total that looks right does not. These
 * rules can only return text that is actually in the document, because they
 * work by locating it and slicing it out.
 *
 * The confidence numbers are FIXED PER METHOD, and the method is reported. A
 * confidence that varies for reasons nobody can state is worse than none.
 */
import type {
  DocumentEvidence,
  DocumentField,
  DocumentIssue,
  DocumentKind,
} from '@neuropause/shared';

/* ── classification ────────────────────────────────────────────────────── */

interface KindRule {
  kind: DocumentKind;
  /** Phrases that, present in the text, argue for this kind. Weighted. */
  strong: readonly string[];
  weak: readonly string[];
  /** Phrases that argue AGAINST it, to separate near-neighbours. */
  against: readonly string[];
}

/**
 * The near-neighbour problem is the whole difficulty here.
 *
 * A purchase order and an invoice share most of their vocabulary — both have a
 * number, a vendor, line items and a total. What separates them is a handful
 * of phrases each one has and the other does not, which is why every rule
 * carries `against` as well as `strong`.
 */
const RULES: readonly KindRule[] = [
  {
    kind: 'invoice',
    strong: ['tax invoice', 'invoice number', 'invoice no', 'invoice #', 'bill to', 'amount due'],
    weak: ['invoice', 'due date', 'subtotal', 'gstin', 'payment terms'],
    against: ['purchase order', 'quotation', 'delivery note'],
  },
  {
    kind: 'purchase_order',
    strong: ['purchase order', 'po number', 'po no', 'order number'],
    weak: ['ship to', 'deliver to', 'requested by', 'expected delivery'],
    against: ['tax invoice', 'amount due', 'receipt'],
  },
  {
    kind: 'receipt',
    strong: ['receipt', 'payment received', 'paid in full', 'transaction id'],
    weak: ['cash', 'card', 'change due', 'thank you for your purchase'],
    against: ['amount due', 'purchase order'],
  },
  {
    kind: 'quote',
    strong: ['quotation', 'quote number', 'valid until', 'estimate'],
    weak: ['proposal', 'pricing'],
    against: ['tax invoice', 'amount due'],
  },
  {
    kind: 'contract',
    strong: ['agreement', 'this contract', 'terms and conditions', 'governing law', 'signature'],
    weak: ['party', 'parties', 'effective date', 'termination', 'confidentiality'],
    against: ['invoice number', 'amount due'],
  },
  {
    kind: 'statement',
    strong: ['statement of account', 'account statement', 'opening balance', 'closing balance'],
    weak: ['balance', 'transactions'],
    against: ['purchase order'],
  },
  {
    kind: 'report',
    strong: ['report', 'summary of findings', 'executive summary'],
    weak: ['analysis', 'conclusion', 'methodology'],
    against: ['invoice number', 'amount due'],
  },
];

/**
 * Below this, the engine will not name a kind.
 *
 * A wrong classification is not a small error: it decides which extractor
 * runs, and therefore which fields get read. "Not recognised, tell me what
 * this is" costs one click; a receipt read as an invoice costs a wrong ledger
 * entry.
 */
export const KIND_CONFIDENCE_FLOOR = 0.45;

/**
 * How far ahead the winner must be.
 *
 * One strong phrase is worth 3, so a margin of 2 means the leader has at least
 * one piece of evidence the runner-up does not — the minimum that makes
 * "this rather than that" a statement about the document.
 */
export const MIN_KIND_MARGIN = 2;

export interface Classification {
  kind: DocumentKind;
  confidence: number;
  reasons: string[];
}

/** A phrase, matched as whole words. */
function mentions(hay: string, phrase: string): boolean {
  /**
   * `hay.includes(' report')` also matches "reporting", "receipt" matches
   * "receipts", and "estimate" matches "estimated" — so a quarterly REPORTING
   * document classified as a `report` at 0.98 confidence, which decides which
   * extractor runs. Word boundaries on both ends.
   */
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay);
}

export function classifyDocument(text: string, filename: string): Classification {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const name = filename.toLowerCase();

  if (hay.trim().length === 0) {
    return {
      kind: 'unknown',
      confidence: 0,
      reasons: ['No text could be read from this file, so there is nothing to classify.'],
    };
  }

  const scored = RULES.map((rule) => {
    const strongHits = rule.strong.filter((p) => mentions(hay, p));
    const weakHits = rule.weak.filter((p) => mentions(hay, p));
    const againstHits = rule.against.filter((p) => mentions(hay, p));
    // The FILENAME is worth something and not much. A file called
    // `invoice-final-v3.docx` containing a contract is a contract.
    const nameHit = ['', '-', '_', ' '].some((sep) => name.includes(rule.kind.replace('_', sep)));

    const score =
      strongHits.length * 3 + weakHits.length * 1 + (nameHit ? 1 : 0) - againstHits.length * 3;

    const reasons: string[] = [];
    if (strongHits.length > 0) reasons.push(`Contains ${strongHits.map((h) => `“${h}”`).join(', ')}.`);
    if (weakHits.length > 0) reasons.push(`Also mentions ${weakHits.map((h) => `“${h}”`).join(', ')}.`);
    if (nameHit) reasons.push('The file name points the same way.');
    if (againstHits.length > 0) {
      reasons.push(`Argues against: ${againstHits.map((h) => `“${h}”`).join(', ')}.`);
    }
    return { rule, score, reasons, strongHits: strongHits.length };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];

  /**
   * At least one STRONG phrase, or no answer.
   *
   * The weak lists are corroboration, not identification: "analysis",
   * "conclusion" and "methodology" together scored a confident `report` for a
   * document that never used the word. Since the kind decides which extractor
   * runs, naming one on circumstantial evidence alone is how a document gets
   * read as something it is not.
   */
  if (best && best.strongHits === 0) {
    return {
      kind: 'unknown',
      confidence: 0,
      reasons: [
        ...best.reasons,
        'Nothing in this document names a document type outright — please say which it is.',
      ],
    };
  }

  if (!best || best.score <= 0) {
    return {
      kind: 'unknown',
      confidence: 0,
      reasons: ['No phrase in this document matched a known document type.'],
    };
  }

  /**
   * Confidence is the WINNING MARGIN, not the raw score.
   *
   * A document that scores 9 for invoice and 8 for purchase order is not a
   * confident invoice, however high 9 is. Scoring the gap is what makes the
   * floor below mean "the two candidates are too close to call".
   */
  const margin = best.score - (runnerUp?.score ?? 0);
  const confidence = Math.min(0.98, Math.max(0, best.score * 0.08 + margin * 0.12));

  /**
   * The margin GATES, it does not merely contribute.
   *
   * Folding it into one number let a strong score carry a zero margin over the
   * floor: quote 6 / report 6 scored 0.48 and was resolved by the order of the
   * rules array. Two candidates that tie are not a confident answer at any
   * score, so they are refused separately.
   */
  if (margin < MIN_KIND_MARGIN) {
    return {
      kind: 'unknown',
      confidence: Math.min(confidence, KIND_CONFIDENCE_FLOOR - 0.01),
      reasons: [
        ...best.reasons,
        `Too close to call between ${best.rule.kind.replace('_', ' ')} and ${(runnerUp?.rule.kind ?? 'another type').replace('_', ' ')} — please say which it is.`,
      ],
    };
  }

  if (confidence < KIND_CONFIDENCE_FLOOR) {
    return {
      kind: 'unknown',
      confidence,
      reasons: [
        ...best.reasons,
        runnerUp && runnerUp.score > 0
          ? `Too close to call between ${best.rule.kind.replace('_', ' ')} and ${runnerUp.rule.kind.replace('_', ' ')} — please say which it is.`
          : 'Not enough evidence to name a type — please say which it is.',
      ],
    };
  }

  return { kind: best.rule.kind, confidence, reasons: best.reasons };
}

/* ── extraction ────────────────────────────────────────────────────────── */

/** Fixed per method, and stated. See the file header. */
const METHOD_CONFIDENCE: Record<DocumentEvidence['method'], { value: number; basis: string }> = {
  labelled_value: { value: 0.95, basis: 'A label and its value on the same line.' },
  labelled_next_line: { value: 0.85, basis: 'A label with the value on the following line.' },
  table_cell: { value: 0.9, basis: 'Read from a cell the parser recognised as tabular.' },
  pattern: { value: 0.6, basis: 'Matched by shape alone, with no label next to it.' },
  filename: { value: 0.3, basis: 'Read from the file name — weak evidence.' },
  user_correction: { value: 1, basis: 'Entered by a person.' },
};

/** The confidence a person's own answer carries. One source of truth. */
export const CORRECTION_CONFIDENCE = {
  confidence: METHOD_CONFIDENCE.user_correction.value,
  confidenceBasis: METHOD_CONFIDENCE.user_correction.basis,
} as const;

/**
 * Keep a corrected value the same KIND of thing the extractor produced.
 *
 * Correcting a numeric `total` to the STRING "1180" made `validateInvoice`'s
 * `typeof v === 'number'` guard fail, which switched off both the arithmetic
 * check and the "could not be checked" warning — so an invoice that had raised
 * "the arithmetic does not agree" came back clean and became an approvable
 * proposal. Refused rather than coerced silently where it cannot be read.
 */
export function coerceCorrection(
  field: DocumentField,
  raw: string | number | null,
): string | number | null {
  const NUMERIC = new Set(['subtotal', 'tax', 'total']);
  const DATES = new Set(['invoiceDate', 'dueDate']);

  if (NUMERIC.has(field.key) || typeof field.value === 'number') {
    if (raw === null) return null;
    const n = typeof raw === 'number' ? raw : parseAmount(raw);
    if (n === null) {
      throw new Error(`“${field.label}” is a number on this document — “${String(raw)}” cannot be read as one.`);
    }
    return n;
  }

  if (DATES.has(field.key)) {
    if (raw === null) return null;
    const d = parseDocumentDate(String(raw));
    if (d === null) {
      throw new Error(
        `“${field.label}” must be a date in YYYY-MM-DD form. “${String(raw)}” is ambiguous — 12/08 is two different days depending on where you are.`,
      );
    }
    return d;
  }

  return raw;
}

function fieldFrom(
  key: string,
  label: string,
  value: string | number | null,
  evidence: DocumentEvidence,
): DocumentField {
  const conf = METHOD_CONFIDENCE[evidence.method];
  return {
    key,
    label,
    value,
    evidence,
    confidence: conf.value,
    confidenceBasis: conf.basis,
    corrected: false,
  };
}

/**
 * Every place a label appears, in PRIORITY order, with what follows it.
 *
 * Two things here were bugs, and both were silent:
 *
 *  1. LINE-MAJOR ORDER read the wrong value. Scanning line by line and trying
 *     every label on each one means the FIRST LINE wins, not the best label —
 *     so on an invoice reading `Subtotal: 1000` above `Grand Total: 1180`, the
 *     bare label `total` matched the subtotal line and the invoice total came back
 *     as 1000. Label-major order asks "is there a grand total?" before it asks
 *     "is there anything called total?".
 *
 *  2. SUBSTRING MATCHING read `total` inside `subtotal`. The boundary check
 *     below is what stops that, and it is why label priority alone is not
 *     enough.
 *
 * Returning ALL candidates rather than the first also matters: `TAX INVOICE`
 * is a heading, and a `tax` label that stops there never reaches
 * `Total Tax: 180` further down. The caller takes the first candidate whose
 * value actually parses.
 */
interface LabelledCandidate {
  raw: string;
  evidence: DocumentEvidence;
}

/** Whole-word presence of a label anywhere in an already-lowercased line. */
function mentionsLabel(lower: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower);
}

function findLabelledCandidates(
  lines: readonly string[],
  labels: readonly string[],
  /**
   * Labels belonging to a DIFFERENT field that may appear on the same line.
   *
   * A boundary check alone is not enough: `Sub Total: 1000` writes the words
   * with a space, so the bare label `total` starts a word there and reads the
   * subtotal as the invoice total. With no tax line to contradict it, the
   * wrong number shipped as a clean extraction. A line that announces itself
   * as something else is skipped outright.
   */
  avoid: readonly string[] = [],
): LabelledCandidate[] {
  const out: LabelledCandidate[] = [];
  for (const label of labels) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const lower = line.toLowerCase();
      if (avoid.some((other) => mentionsLabel(lower, other))) continue;
      let at = lower.indexOf(label);
      while (at !== -1) {
        const before = at === 0 ? '' : lower[at - 1] ?? '';
        const after = lower[at + label.length] ?? '';
        // A label must be a whole word at BOTH ends. Without the leading
        // check, `total` matches inside `subtotal`; without the trailing one,
        // `tax` matches inside `taxable`.
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
          const tail = line.slice(at + label.length).replace(/^[\s:#—–-]+/, '').trim();
          if (tail.length > 0) {
            out.push({
              raw: tail,
              evidence: { method: 'labelled_value', snippet: line.trim(), line: i + 1, table: null },
            });
          } else {
            const next = (lines[i + 1] ?? '').trim();
            if (next.length > 0) {
              out.push({
                raw: next,
                // The snippet carries BOTH lines, because the evidence for a
                // value found this way is the pairing, not either line alone.
                evidence: {
                  method: 'labelled_next_line',
                  snippet: `${line.trim()} ⏎ ${next}`,
                  line: i + 2,
                  table: null,
                },
              });
            }
          }
        }
        at = lower.indexOf(label, at + 1);
      }
    }
  }
  return out;
}

/**
 * A money amount, as a number, from text that may carry a symbol and grouping.
 *
 * Returns null rather than a guess. `"approx 1,000"` is not a number, and
 * `Number('approx 1,000')` being NaN is the only reason to look.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[₹$€£¥]/g, '')
    // `\b` after an optional dot forces a backtrack that leaves ". 1000"
    // behind, so `Rs. 1,000` — the dominant Indian invoice form — parsed as
    // null and the total silently went unread.
    .replace(/\b(inr|usd|eur|gbp|rs)\b\.?/gi, '')
    .replace(/,/g, '')
    .trim();
  const m = /^-?\d+(\.\d+)?$/.exec(cleaned);
  if (!m) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const;
const CURRENCY_SYMBOL: Record<string, string> = { '₹': 'INR', $: 'USD', '€': 'EUR', '£': 'GBP' };

/** ISO or common date forms, normalised to YYYY-MM-DD. Null when ambiguous. */
export function parseDocumentDate(raw: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : `${y}-${m}-${d}`;
  }
  // `12/08/2026` is 12 August or 8 December depending on where you are, and
  // guessing produces a date that is wrong four months a year without ever
  // looking wrong. Refused.
  return null;
}

export interface ExtractionResult {
  fields: DocumentField[];
  issues: DocumentIssue[];
}

/**
 * Read an invoice's named values out of its text.
 *
 * Every field emitted carries the line it came from. A field that cannot be
 * located is ABSENT rather than null-with-a-guess, and its absence becomes a
 * validation issue if the field is required.
 */
export function extractInvoiceFields(text: string, tables: readonly { name: string }[]): ExtractionResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const fields: DocumentField[] = [];
  const issues: DocumentIssue[] = [];

  const add = (
    key: string,
    label: string,
    labels: readonly string[],
    transform: (raw: string) => string | number | null,
    avoid: readonly string[] = [],
  ): DocumentField | null => {
    const candidates = findLabelledCandidates(lines, labels, avoid);
    if (candidates.length === 0) return null;

    /**
     * The first candidate whose value actually parses.
     *
     * Stopping at the first LABEL match instead loses real values to
     * headings: `TAX INVOICE` matches `tax`, yields the unparseable word
     * "INVOICE", and the genuine `Total Tax: 180` three lines down is never
     * reached.
     */
    for (const candidate of candidates) {
      const value = transform(candidate.raw);
      if (value === null) continue;
      const f = fieldFrom(key, label, value, candidate.evidence);
      fields.push(f);
      return f;
    }

    // Every candidate was unreadable. That is worth saying — the label IS in
    // the document, so silence would read as "this invoice has no total".
    issues.push({
      severity: 'warning',
      fieldKey: key,
      message: `“${label}” appears in this document but could not be read: “${candidates[0]?.raw ?? ''}”.`,
    });
    return null;
  };

  add('invoiceNumber', 'Invoice number', ['tax invoice no', 'invoice number', 'invoice no', 'invoice #'], (r) => {
    const token = r.split(/\s{2,}|\s\|/)[0]?.trim() ?? r.trim();
    return token.length > 0 && token.length <= 64 ? token : null;
  });

  /**
   * No bare `from`.
   *
   * "Goods shipped from Mumbai warehouse" produced `vendor = "Mumbai
   * warehouse"` at 0.95 confidence, with a real source snippet — satisfying
   * the letter of "no fabricated extraction" while asserting something the
   * document does not say, and then feeding it to supplier matching.
   */
  add('vendor', 'Vendor', ['vendor', 'supplier', 'billed from', 'sold by'], (r) =>
    r.length > 0 && r.length <= 200 ? r : null,
  );
  add('customer', 'Customer', ['bill to', 'billed to', 'customer', 'sold to'], (r) =>
    r.length > 0 && r.length <= 200 ? r : null,
  );

  add('invoiceDate', 'Invoice date', ['invoice date', 'date of issue', 'dated', 'date'], parseDocumentDate);
  add('dueDate', 'Due date', ['due date', 'payment due', 'pay by'], parseDocumentDate);

  // Currency: a named code beats a symbol, because `$` is at least four
  // different currencies and the code is unambiguous.
  const currencyLine = lines.findIndex((l) => CURRENCIES.some((c) => new RegExp(`\\b${c}\\b`).test(l)));
  if (currencyLine >= 0) {
    const line = lines[currencyLine] ?? '';
    const code = CURRENCIES.find((c) => new RegExp(`\\b${c}\\b`).test(line));
    if (code) {
      fields.push(
        fieldFrom('currency', 'Currency', code, {
          method: 'pattern',
          snippet: line,
          line: currencyLine + 1,
          table: null,
        }),
      );
    }
  } else {
    const symbolLine = lines.findIndex((l) => /[₹$€£]/.test(l));
    if (symbolLine >= 0) {
      const line = lines[symbolLine] ?? '';
      const symbol = Object.keys(CURRENCY_SYMBOL).find((sym) => line.includes(sym));
      if (symbol) {
        fields.push(
          fieldFrom('currency', 'Currency', CURRENCY_SYMBOL[symbol] as string, {
            method: 'pattern',
            snippet: line,
            line: symbolLine + 1,
            table: null,
          }),
        );
      }
    }
  }

  const SUBTOTAL_LABELS = ['subtotal', 'sub total', 'net amount', 'taxable value'];
  const TAX_LABELS = ['tax amount', 'total tax', 'gst', 'vat', 'tax'];

  add('subtotal', 'Subtotal', SUBTOTAL_LABELS, parseAmount);
  add('tax', 'Tax', TAX_LABELS, parseAmount, SUBTOTAL_LABELS);
  /**
   * Most specific label first, AND every line that announces itself as a
   * subtotal or a tax line excluded outright.
   *
   * Ordering alone was not enough. `Sub Total: 1000` contains the whole word
   * `total`, so a document with no "grand total" line read its subtotal as
   * the invoice total — and with no tax line present, `validateInvoice` had
   * nothing to disagree with, so the wrong number shipped as `extracted`.
   */
  add(
    'total',
    'Total',
    ['grand total', 'amount due', 'total amount', 'invoice total', 'total'],
    parseAmount,
    [...SUBTOTAL_LABELS, ...TAX_LABELS],
  );

  if (tables.length > 0) {
    /**
     * The snippet is the table NAMES, which are text the parser read out of
     * the document. An earlier version wrote "2 tables found in the document"
     * — generated prose in a field whose contract says the snippet is the
     * actual source text, which is exactly the kind of small lie that makes
     * the whole evidence trail untrustworthy.
     */
    fields.push(
      fieldFrom('lineItemTables', 'Line-item tables', tables.map((t) => t.name).join(', '), {
        method: 'table_cell',
        snippet: tables.map((t) => t.name).join(', '),
        line: null,
        table: tables[0]?.name ?? null,
      }),
    );
  }

  return { fields, issues };
}

/* ── validation ────────────────────────────────────────────────────────── */

const REQUIRED_INVOICE_FIELDS: readonly { key: string; label: string }[] = [
  { key: 'invoiceNumber', label: 'Invoice number' },
  { key: 'total', label: 'Total' },
];

/**
 * Check an extraction against itself.
 *
 * Arithmetic is the strongest signal available without a second source: if the
 * total does not equal the subtotal plus the tax, then at least one of the
 * three was misread, and which one is not knowable from here. So the result is
 * "these three disagree", not a correction.
 */
export function validateInvoice(fields: readonly DocumentField[]): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const by = new Map(fields.map((f) => [f.key, f]));

  for (const req of REQUIRED_INVOICE_FIELDS) {
    if (!by.has(req.key)) {
      issues.push({
        severity: 'error',
        fieldKey: req.key,
        message: `No ${req.label.toLowerCase()} could be found in this document.`,
      });
    }
  }

  const num = (key: string): number | null => {
    const v = by.get(key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const subtotal = num('subtotal');
  const tax = num('tax');
  const total = num('total');

  if (subtotal !== null && tax !== null && total !== null) {
    // A cent of tolerance for rounding; anything more is a real disagreement.
    const expected = Math.round((subtotal + tax) * 100) / 100;
    const actual = Math.round(total * 100) / 100;
    if (Math.abs(expected - actual) > 0.01) {
      issues.push({
        severity: 'error',
        fieldKey: 'total',
        message: `The arithmetic does not agree: subtotal ${subtotal} + tax ${tax} = ${expected}, but the total reads ${actual}. One of the three was misread — check the document before using any of them.`,
      });
    }
  } else if (total !== null && (subtotal === null || tax === null)) {
    issues.push({
      severity: 'warning',
      fieldKey: null,
      message: 'The total could not be checked against a subtotal and tax, because one of them is missing.',
    });
  }

  const currency = by.get('currency')?.value;
  if (typeof currency === 'string' && !CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) {
    issues.push({
      severity: 'warning',
      fieldKey: 'currency',
      message: `“${currency}” is not a currency this build handles (${CURRENCIES.join(', ')}).`,
    });
  }

  const issue = by.get('invoiceDate')?.value;
  const due = by.get('dueDate')?.value;
  if (typeof issue === 'string' && typeof due === 'string' && due < issue) {
    issues.push({
      severity: 'warning',
      fieldKey: 'dueDate',
      message: `The due date (${due}) is before the invoice date (${issue}).`,
    });
  }

  return issues;
}
