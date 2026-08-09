/**
 * Deterministic answers — the seam that keeps the LLM out of questions that
 * do not need one.
 *
 * The product principle this file implements: *NeuroPause chooses the right
 * intelligence for the job, and "no AI" is a first-class choice.* "What is
 * 2 + 2", "what's today's date", "what is our outstanding invoice total",
 * "how many units are left in lot LOT-001" — these have exactly one correct
 * answer, computable from arithmetic, the system clock, or the records the
 * user already owns. Routing them through a model would be slower, costlier,
 * and able to be *wrong*.
 *
 * Rules this file lives by:
 *  • A resolver either answers with certainty or returns null. There is no
 *    "probably". A null falls through to the existing pipeline (structured
 *    resolvers → retrieval → the AI routing planner).
 *  • Record-backed answers name their source and carry counts — the same
 *    honesty shape as the assistant's findings.
 *  • A permission refusal is an ANSWER ("you don't have access"), not a
 *    fall-through — otherwise the model would end up answering a question
 *    the records were not allowed to.
 *
 * Pure: ports injected, no I/O, no Electron. Tested without the app runtime.
 */
import type { AssistantFinding, AssistantSourceRef } from '@neuropause/shared';

/* ── ports ─────────────────────────────────────────────────────────────────── */

/** A module read that respects RBAC: rows, or 'forbidden', or null (absent). */
export type RecordsPort = (
  moduleId: string,
) => { rows: { id: string; title: string; status: string; fields: Record<string, unknown> }[] } | 'forbidden' | null;

export interface DeterministicPorts {
  /** RBAC-gated reads over registered enterprise modules. */
  records?: RecordsPort;
  /** Live count of jobs awaiting approval (the existing jobStore read). */
  pendingApprovals?: () => number;
}

/* ── result ────────────────────────────────────────────────────────────────── */

export interface DeterministicAnswer {
  /** The one-sentence answer shown as Layer 1. */
  answer: string;
  /** Layer 2 — how it was computed, in a sentence. */
  reason: string;
  /** Layer 3 — the computed evidence rows. */
  findings: AssistantFinding[];
  sources: AssistantSourceRef[];
  /** Which resolver answered (for the trace + tests). */
  resolver: string;
}

const finding = (label: string, text: string): AssistantFinding => ({
  label,
  text,
  at: null,
  connectorId: null,
  evidence: [],
});

/* ── arithmetic ────────────────────────────────────────────────────────────── */

/**
 * Evaluate a plain arithmetic expression with + − × ÷, parentheses and
 * decimals. Deliberately NOT eval(): the grammar below is the whole language,
 * so nothing outside `0-9 . ( ) + - * / x ×` can execute.
 */
export function evaluateArithmetic(raw: string): number | null {
  const expr = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/[xX]/g, '*').replace(/\s+/g, '');
  if (!/^[\d.()+\-*/]+$/.test(expr) || !/\d/.test(expr)) return null;
  let pos = 0;
  const peek = (): string => expr[pos] ?? '';
  const parsePrimary = (): number | null => {
    if (peek() === '(') {
      pos += 1;
      const inner = parseAddSub();
      if (peek() !== ')') return null;
      pos += 1;
      return inner;
    }
    const start = pos;
    if (peek() === '-') pos += 1;
    while (/[\d.]/.test(peek())) pos += 1;
    if (pos === start || (expr[start] === '-' && pos === start + 1)) return null;
    const value = Number(expr.slice(start, pos));
    return Number.isFinite(value) ? value : null;
  };
  const parseMulDiv = (): number | null => {
    let left = parsePrimary();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      pos += 1;
      const right = parsePrimary();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const parseAddSub = (): number | null => {
    let left = parseMulDiv();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      pos += 1;
      const right = parseMulDiv();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const result = parseAddSub();
  if (result === null || pos !== expr.length) return null;
  return Math.round((result + Number.EPSILON) * 1e9) / 1e9;
}

const ARITHMETIC_PATTERNS = [
  /^(?:what\s+is|what's|calculate|compute|evaluate)\s+([\d\s.()+\-*/x×÷]+)\??$/i,
  /^([\d\s.()+\-*/x×÷]+)\s*=\s*\??$/,
];

function resolveArithmetic(text: string): DeterministicAnswer | null {
  for (const pattern of ARITHMETIC_PATTERNS) {
    const match = text.trim().match(pattern);
    if (!match?.[1]) continue;
    const value = evaluateArithmetic(match[1]);
    if (value === null) return null;
    return {
      answer: `${match[1].trim()} = ${value}`,
      reason: 'Computed arithmetically. No records were read and no AI model ran.',
      findings: [finding('Calculation', `${match[1].trim()} = ${value}`)],
      sources: [],
      resolver: 'arithmetic',
    };
  }
  return null;
}

/* ── date / time ───────────────────────────────────────────────────────────── */

function resolveDateTime(text: string, nowIso: string): DeterministicAnswer | null {
  const q = text.trim().toLowerCase();
  const asksDate = /^(?:what\s+is|what's|whats)\s+(?:today'?s?\s+date|the\s+date(?:\s+today)?)\??$/.test(q);
  const asksDay = /^what\s+day\s+is\s+(?:it|today)\??$/.test(q);
  const asksTime = /^(?:what\s+time\s+is\s+it|what\s+is\s+the\s+time)\??$/.test(q);
  if (!asksDate && !asksDay && !asksTime) return null;
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;
  const answer = asksTime
    ? `It is ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
    : `Today is ${now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
  return {
    answer,
    reason: 'Read from this device’s clock. No AI model ran.',
    findings: [finding('System clock', nowIso)],
    sources: [],
    resolver: 'datetime',
  };
}

/* ── record-backed resolvers ───────────────────────────────────────────────── */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function forbidden(subject: string, resolver: string): DeterministicAnswer {
  return {
    answer: `You don't have access to ${subject}.`,
    reason: 'Your role does not include the permission this data requires. An administrator can grant it.',
    findings: [],
    sources: [],
    resolver,
  };
}

/** "What is our outstanding invoice total?" → Σ max(total − amountPaid, 0). */
function resolveOutstandingInvoices(
  text: string,
  ports: DeterministicPorts,
): DeterministicAnswer | null {
  if (!/\b(outstanding|unpaid|open)\b.*\binvoice/i.test(text) && !/\binvoice.*\b(outstanding|unpaid|open)\b/i.test(text)) {
    return null;
  }
  if (!/\b(total|amount|balance|value|how much)\b/i.test(text)) return null;
  const read = ports.records?.('finance-invoices');
  if (read === undefined || read === null) return null; // finance module absent → fall through
  if (read === 'forbidden') return forbidden('invoices', 'finance.outstanding');

  let outstanding = 0;
  let open = 0;
  for (const row of read.rows) {
    if (row.status === 'deleted') continue;
    const total = num(row.fields.total) || num(row.fields.amount);
    const paid = num(row.fields.amountPaid);
    const due = Math.max(total - paid, 0);
    if (due > 0) {
      outstanding += due;
      open += 1;
    }
  }
  outstanding = Math.round((outstanding + Number.EPSILON) * 100) / 100;
  return {
    answer:
      open === 0
        ? 'There are no invoices with an outstanding balance.'
        : `The outstanding invoice total is ${outstanding.toLocaleString()} across ${open} invoice${open === 1 ? '' : 's'}.`,
    reason:
      'Computed from your invoice records: the sum of (total − amount paid) over every invoice that still has a balance. No AI model ran.',
    findings: [
      finding('Invoices with a balance', String(open)),
      finding('Outstanding total', outstanding.toLocaleString()),
    ],
    sources: [{ id: 'finance-invoices', label: 'Invoices', kind: 'records', count: read.rows.length }],
    resolver: 'finance.outstanding',
  };
}

/** "How many units are left in lot LOT-001?" → the lot's derived remainder. */
function resolveLotQuantity(text: string, ports: DeterministicPorts): DeterministicAnswer | null {
  const match = text.match(/\b(?:in|of)\s+lot\s+([A-Za-z0-9][A-Za-z0-9._/-]*)\??/i);
  if (!match?.[1] || !/\b(how many|units|quantity|remaining|left)\b/i.test(text)) return null;
  const wanted = match[1].replace(/[?.]+$/, '').toLowerCase();
  const read = ports.records?.('md-lots');
  if (read === undefined || read === null) return null;
  if (read === 'forbidden') return forbidden('batch/lot records', 'medicalDevice.lot');

  const row = read.rows.find(
    (r) => r.status !== 'deleted' && str(r.fields.lotNumber).toLowerCase() === wanted,
  );
  if (!row) {
    return {
      answer: `No lot named "${match[1]}" exists in your records.`,
      reason: `Searched ${read.rows.length} lot record${read.rows.length === 1 ? '' : 's'} by exact lot number. No AI model ran.`,
      findings: [],
      sources: [{ id: 'md-lots', label: 'Batch / Lot', kind: 'records', count: read.rows.length }],
      resolver: 'medicalDevice.lot',
    };
  }
  const quantity = num(row.fields.quantity);
  const consumed = num(row.fields.consumedQuantity);
  const split = num(row.fields.splitQuantity);
  const remaining = Math.round((quantity - consumed - split + Number.EPSILON) * 1e6) / 1e6;
  const unit = str(row.fields.unit) || 'unit';
  return {
    answer: `Lot ${str(row.fields.lotNumber)} has ${remaining} ${unit} remaining (status: ${str(row.fields.status)}).`,
    reason: `Derived from the lot record: ${quantity} original − ${consumed} consumed − ${split} split into child lots. No AI model ran.`,
    findings: [
      finding('Original quantity', `${quantity} ${unit}`),
      finding('Consumed', `${consumed} ${unit}`),
      finding('Split into child lots', `${split} ${unit}`),
      finding('Remaining', `${remaining} ${unit}`),
    ],
    sources: [{ id: 'md-lots', label: 'Batch / Lot', kind: 'records', count: 1 }],
    resolver: 'medicalDevice.lot',
  };
}

/** "What is the current inventory quantity of SKU-0001?" → the product's derived stock. */
function resolveInventoryQuantity(text: string, ports: DeterministicPorts): DeterministicAnswer | null {
  if (!/\b(stock|inventory|on hand|units)\b/i.test(text)) return null;
  const match = text.match(/\b(?:of|for)\s+([A-Za-z0-9][A-Za-z0-9._-]{2,})\??$/i);
  if (!match?.[1]) return null;
  const wanted = match[1].replace(/[?.]+$/, '').toLowerCase();
  const read = ports.records?.('inventory-products');
  if (read === undefined || read === null) return null;
  if (read === 'forbidden') return forbidden('inventory', 'inventory.stock');

  const row = read.rows.find(
    (r) =>
      r.status !== 'deleted' &&
      (str(r.fields.sku).toLowerCase() === wanted || r.title.toLowerCase() === wanted),
  );
  if (!row) return null; // an unknown SKU may be a product question for retrieval — fall through
  const current = num(row.fields.currentStock);
  const available = num(row.fields.availableStock);
  const reserved = num(row.fields.reservedStock);
  return {
    answer: `${str(row.fields.sku)} (${row.title}): ${current} on hand, ${available} available, ${reserved} reserved.`,
    reason:
      'Read from the product record, whose stock figures are derived from the immutable movement ledger. No AI model ran.',
    findings: [
      finding('On hand', String(current)),
      finding('Available', String(available)),
      finding('Reserved', String(reserved)),
    ],
    sources: [{ id: 'inventory-products', label: 'Products', kind: 'records', count: 1 }],
    resolver: 'inventory.stock',
  };
}

/** "How many approvals are pending?" → the live jobStore count. */
function resolvePendingApprovals(text: string, ports: DeterministicPorts): DeterministicAnswer | null {
  if (!/\bapprovals?\b/i.test(text) || !/\b(how many|pending|waiting|outstanding|open)\b/i.test(text)) {
    return null;
  }
  const count = ports.pendingApprovals?.();
  if (count === undefined) return null;
  return {
    answer:
      count === 0
        ? 'No approvals are waiting on you.'
        : `${count} approval${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} waiting.`,
    reason: 'Counted from the live approval queue. No AI model ran.',
    findings: [finding('Pending approvals', String(count))],
    sources: [{ id: 'approvals', label: 'Approvals', kind: 'operational', count }],
    resolver: 'approvals.pending',
  };
}

/* ── the seam ──────────────────────────────────────────────────────────────── */

const RESOLVERS: readonly ((
  text: string,
  ports: DeterministicPorts,
  nowIso: string,
) => DeterministicAnswer | null)[] = [
  (t) => resolveArithmetic(t),
  (t, _p, now) => resolveDateTime(t, now),
  (t, p) => resolveOutstandingInvoices(t, p),
  (t, p) => resolveLotQuantity(t, p),
  (t, p) => resolveInventoryQuantity(t, p),
  (t, p) => resolvePendingApprovals(t, p),
];

/**
 * Try every deterministic resolver, first hit wins. Null means "this question
 * needs more than a lookup" and the existing pipeline continues unchanged.
 */
export function resolveDeterministicAnswer(
  text: string,
  ports: DeterministicPorts,
  nowIso: string,
): DeterministicAnswer | null {
  for (const resolver of RESOLVERS) {
    const hit = resolver(text, ports, nowIso);
    if (hit) return hit;
  }
  return null;
}
