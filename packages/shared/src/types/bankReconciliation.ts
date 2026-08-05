/**
 * Finance → Bank Reconciliation — statement domain types and the pure,
 * DETERMINISTIC matching rules the reconciliation module enforces.
 *
 * A BankStatement is a typed *projection* of the framework's flat
 * `EnterpriseEntity` (same blueprint as quotes/invoices/GL). This file adds the
 * statement-line parsing and the matching engine: a statement line matches a
 * cleared customer payment by EXACT REFERENCE first, else by a UNIQUE
 * amount+date-window candidate; anything else stays honestly UNMATCHED — a
 * line is never auto-cleared, never guessed, and matching is idempotent
 * (re-running produces the same result). Pure (no I/O); the AI explains
 * matches, never makes them.
 */

/** The Bank Statements module id + record kind (the framework store key). */
export const BANK_STATEMENTS_MODULE_ID = 'finance-bank-statements';
export const BANK_STATEMENT_KIND = 'bankStatement';

/** One imported statement line (the JSON textarea row, BOM convention). */
export interface BankStatementLine {
  date: string;
  description: string;
  reference: string;
  /** Signed: deposits positive, withdrawals negative. */
  amount: number;
}

export type BankMatchType = 'exact-reference' | 'amount-date' | 'unmatched';

/** A line after matching — the input line plus the deterministic verdict. */
export interface BankMatchedLine extends BankStatementLine {
  matchType: BankMatchType;
  /** The matched payment's number ('' when unmatched). */
  paymentNumber: string;
}

export interface BankReconciliationSummary {
  lineCount: number;
  matchedCount: number;
  unmatchedCount: number;
  matchedAmount: number;
  unmatchedAmount: number;
}

/** The candidate side of matching: a cleared customer payment. */
export interface BankMatchCandidate {
  paymentNumber: string;
  amount: number;
  receivedDate: string;
  transactionRef: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Bounded so a pathological import cannot degrade the UI or the matcher. */
export const MAX_STATEMENT_LINES = 500;

export type BankLinesParse =
  | { ok: true; lines: BankStatementLine[] }
  | { ok: false; error: string };

/** Parse the `lines` field (a JSON textarea, the BOM/journal convention). */
export function parseBankStatementLines(raw: string): BankLinesParse {
  const text = str(raw).trim();
  if (!text) return { ok: false, error: 'At least one statement line is required.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Lines must be a JSON array of {date, description, reference, amount}.' };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: 'Lines must be a non-empty JSON array of {date, description, reference, amount}.' };
  }
  if (parsed.length > MAX_STATEMENT_LINES) {
    return { ok: false, error: `Too many lines (max ${MAX_STATEMENT_LINES}).` };
  }
  const lines: BankStatementLine[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `Line ${i + 1}: each line must be an object {date, description, reference, amount}.` };
    }
    const date = str(item.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: `Line ${i + 1}: date must be YYYY-MM-DD.` };
    }
    const amount = num(item.amount);
    if (amount === 0) return { ok: false, error: `Line ${i + 1}: amount must be non-zero (signed).` };
    lines.push({
      date,
      description: str(item.description).trim(),
      reference: str(item.reference).trim(),
      amount,
    });
  }
  return { ok: true, lines };
}

const DAY_MS = 86400000;

/** Whole-day distance between two YYYY-MM-DD dates (Infinity when unparseable). */
function dayDistance(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / DAY_MS;
}

/** Amount-date matching window: same amount, within ±3 days, exactly one candidate. */
export const BANK_MATCH_WINDOW_DAYS = 3;

/**
 * The matching engine. Deterministic, order-independent per line, idempotent,
 * and one-to-one: a payment matches at most one statement line (first by exact
 * reference, then by unique amount+date-window). Ambiguity — two candidates a
 * line could equally match — leaves the line UNMATCHED rather than guessing.
 * Only positive (deposit) lines match customer payments; withdrawals stay
 * unmatched until the vendor-payment side exists, and that is stated, not
 * papered over.
 */
export function matchBankStatement(
  lines: readonly BankStatementLine[],
  candidates: readonly BankMatchCandidate[],
): { lines: BankMatchedLine[]; summary: BankReconciliationSummary } {
  const taken = new Set<string>();
  const out: BankMatchedLine[] = [];

  // Pass 1 — exact reference (strongest signal wins first, in line order).
  const byRef = new Map<string, BankMatchCandidate[]>();
  for (const c of candidates) {
    const ref = c.transactionRef.trim();
    if (!ref) continue;
    const list = byRef.get(ref) ?? [];
    list.push(c);
    byRef.set(ref, list);
  }
  const verdicts: (BankMatchedLine | null)[] = lines.map(() => null);
  lines.forEach((line, i) => {
    if (line.amount <= 0 || !line.reference) return;
    const refMatches = (byRef.get(line.reference) ?? []).filter((c) => !taken.has(c.paymentNumber));
    if (refMatches.length === 1 && Math.round((refMatches[0].amount - line.amount) * 100) === 0) {
      taken.add(refMatches[0].paymentNumber);
      verdicts[i] = { ...line, matchType: 'exact-reference', paymentNumber: refMatches[0].paymentNumber };
    }
  });

  // Pass 2 — unique amount within the date window.
  lines.forEach((line, i) => {
    if (verdicts[i] || line.amount <= 0) return;
    const near = candidates.filter(
      (c) =>
        !taken.has(c.paymentNumber) &&
        Math.round((c.amount - line.amount) * 100) === 0 &&
        dayDistance(c.receivedDate, line.date) <= BANK_MATCH_WINDOW_DAYS,
    );
    if (near.length === 1) {
      taken.add(near[0].paymentNumber);
      verdicts[i] = { ...line, matchType: 'amount-date', paymentNumber: near[0].paymentNumber };
    }
  });

  lines.forEach((line, i) => {
    out.push(verdicts[i] ?? { ...line, matchType: 'unmatched', paymentNumber: '' });
  });

  const matched = out.filter((l) => l.matchType !== 'unmatched');
  const unmatched = out.filter((l) => l.matchType === 'unmatched');
  return {
    lines: out,
    summary: {
      lineCount: out.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      matchedAmount: matched.reduce((s, l) => s + l.amount, 0),
      unmatchedAmount: unmatched.reduce((s, l) => s + l.amount, 0),
    },
  };
}
