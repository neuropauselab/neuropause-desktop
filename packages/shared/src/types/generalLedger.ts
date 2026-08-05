/**
 * Finance → General Ledger — Chart of Accounts + Journal domain types and the
 * pure, deterministic double-entry rules the GL modules enforce.
 *
 * A LedgerAccount / JournalEntry is a typed *projection* of the framework's flat
 * `EnterpriseEntity` — the Enterprise Module Framework owns persistence, CRUD,
 * RBAC, audit, timeline, and UI (same blueprint as quotes/invoices). This file
 * adds the GL-specific typing and the DETERMINISTIC accounting rules, which are
 * the module-layer projection of the verified posting kernel in
 * `packages/business/src/erp.ts` (ErpCore): identical normal-balance mapping,
 * identical cents-rounded debits==credits posting rule, identical balance and
 * statement derivations. The kernel stays authoritative and untouched in its
 * wave package; these rules are pinned to it by the GL module tests. Pure
 * (no I/O); the AI explains these numbers, never sets them.
 */
import type { EnterpriseEntity } from './enterpriseModule';

/** The Chart of Accounts module id + record kind (the framework store key). */
export const LEDGER_ACCOUNTS_MODULE_ID = 'finance-ledger-accounts';
export const LEDGER_ACCOUNT_KIND = 'ledgerAccount';

/** The Journal module id + record kind (the framework store key). */
export const JOURNAL_ENTRIES_MODULE_ID = 'finance-journal-entries';
export const JOURNAL_ENTRY_KIND = 'journalEntry';

/** Account classes — the five roots of the chart (kernel: ACCOUNT_CLASSES). */
export type GlAccountClass = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export const GL_ACCOUNT_CLASSES: readonly GlAccountClass[] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
];

export function isGlAccountClass(value: unknown): value is GlAccountClass {
  return GL_ACCOUNT_CLASSES.includes(value as GlAccountClass);
}

/** Normal balance per class (kernel: NORMAL). */
export function glNormalBalance(accountClass: GlAccountClass): 'debit' | 'credit' {
  return accountClass === 'asset' || accountClass === 'expense' ? 'debit' : 'credit';
}

const CLASS_LABELS: Record<GlAccountClass, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expense',
};

export function glAccountClassLabel(accountClass: GlAccountClass): string {
  return CLASS_LABELS[accountClass];
}

/** A typed view over a ledger-account record's flat fields (+ envelope). */
export interface GlAccount {
  id: string;
  code: string;
  name: string;
  accountClass: GlAccountClass;
  normalBalance: 'debit' | 'credit';
  currency: string;
  description: string;
  debitTotal: number;
  creditTotal: number;
  balance: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One journal line: an account code plus a debit OR a credit (never both). */
export interface GlJournalLine {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface GlJournalTotals {
  debits: number;
  credits: number;
}

/** A typed view over a journal-entry record's flat fields (+ envelope). */
export interface GlJournalEntry {
  id: string;
  entryNumber: string;
  memo: string;
  entryDate: string;
  lines: GlJournalLine[];
  totalDebits: number;
  totalCredits: number;
  posted: boolean;
  postedAt: string;
  sourceModule: string;
  sourceRef: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Bounded so a pathological record cannot degrade the UI or the reconciler. */
export const MAX_JOURNAL_LINES = 200;

export type GlJournalLinesParse =
  | { ok: true; lines: GlJournalLine[] }
  | { ok: false; error: string };

/**
 * Parse the `lines` field (a JSON textarea, same convention as BOM components).
 * Deterministic guards: valid JSON array, known shape, non-negative amounts, one
 * side per line, at least one line, bounded line count. Balance is NOT enforced
 * here — a draft may be work-in-progress; posting enforces it (kernel parity).
 */
export function parseGlJournalLines(raw: string): GlJournalLinesParse {
  const text = str(raw).trim();
  if (!text) return { ok: false, error: 'At least one journal line is required.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Lines must be a JSON array of {account, debit, credit}.' };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: 'Lines must be a non-empty JSON array of {account, debit, credit}.' };
  }
  if (parsed.length > MAX_JOURNAL_LINES) {
    return { ok: false, error: `Too many lines (max ${MAX_JOURNAL_LINES}).` };
  }
  const lines: GlJournalLine[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `Line ${i + 1}: each line must be an object {account, debit, credit}.` };
    }
    const account = str(item.account).trim();
    const debit = num(item.debit);
    const credit = num(item.credit);
    if (!account) return { ok: false, error: `Line ${i + 1}: an account code is required.` };
    if (debit < 0 || credit < 0) {
      return { ok: false, error: `Line ${i + 1}: amounts must not be negative.` };
    }
    if (debit > 0 && credit > 0) {
      return { ok: false, error: `Line ${i + 1}: a line carries a debit OR a credit, not both.` };
    }
    if (debit === 0 && credit === 0) {
      return { ok: false, error: `Line ${i + 1}: a line must carry a debit or a credit.` };
    }
    const memo = str(item.memo).trim();
    lines.push(memo ? { account, debit, credit, memo } : { account, debit, credit });
  }
  return { ok: true, lines };
}

export function glJournalTotals(lines: readonly GlJournalLine[]): GlJournalTotals {
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    debits += l.debit;
    credits += l.credit;
  }
  return { debits, credits };
}

/** The posting rule — cents-rounded debits === credits (kernel: `post`). */
export function isBalancedGlJournal(totals: GlJournalTotals): boolean {
  return Math.round((totals.debits - totals.credits) * 100) === 0;
}

/** Fold an account's totals from the POSTED entries that reference its code. */
export function glAccountLedgerTotals(
  accountCode: string,
  postedEntries: readonly GlJournalEntry[],
): { debitTotal: number; creditTotal: number } {
  let debitTotal = 0;
  let creditTotal = 0;
  for (const e of postedEntries) {
    if (!e.posted) continue;
    for (const l of e.lines) {
      if (l.account !== accountCode) continue;
      debitTotal += l.debit;
      creditTotal += l.credit;
    }
  }
  return { debitTotal, creditTotal };
}

/** Signed balance in the account's normal direction (kernel: `accountBalance`). */
export function glAccountBalance(
  normalBalance: 'debit' | 'credit',
  debitTotal: number,
  creditTotal: number,
): number {
  return normalBalance === 'debit' ? debitTotal - creditTotal : creditTotal - debitTotal;
}

export interface GlTrialBalance {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

/** Trial balance over posted entries (kernel: `trialBalance` semantics). */
export function glTrialBalance(postedEntries: readonly GlJournalEntry[]): GlTrialBalance {
  let totalDebits = 0;
  let totalCredits = 0;
  for (const e of postedEntries) {
    if (!e.posted) continue;
    const t = glJournalTotals(e.lines);
    totalDebits += t.debits;
    totalCredits += t.credits;
  }
  return {
    totalDebits,
    totalCredits,
    balanced: Math.round((totalDebits - totalCredits) * 100) === 0,
  };
}

export interface GlStatement {
  revenue: number;
  expenses: number;
  netIncome: number;
  assets: number;
  liabilities: number;
  equity: number;
  hasData: boolean;
  note: string;
}

/**
 * Financial-statement aggregates from real posted balances (kernel: `statement`).
 * All zero — with the kernel's honest note — when nothing has been posted.
 */
export function glStatement(
  accounts: readonly GlAccount[],
  postedEntries: readonly GlJournalEntry[],
): GlStatement {
  const sumClass = (cls: GlAccountClass): number =>
    accounts
      .filter((a) => a.accountClass === cls)
      .reduce((s, a) => {
        const totals = glAccountLedgerTotals(a.code, postedEntries);
        return s + glAccountBalance(glNormalBalance(a.accountClass), totals.debitTotal, totals.creditTotal);
      }, 0);
  const revenue = sumClass('revenue');
  const expenses = sumClass('expense');
  const hasData = postedEntries.some((e) => e.posted);
  return {
    revenue,
    expenses,
    netIncome: revenue - expenses,
    assets: sumClass('asset'),
    liabilities: sumClass('liability'),
    equity: sumClass('equity'),
    hasData,
    note: hasData
      ? 'derived from real posted journal entries'
      : 'no accounting data — statements are empty, not fabricated',
  };
}

/* ── record projections ── */

/** Project a ledger-account record into its typed view. */
export function glAccountFromRecord(record: EnterpriseEntity): GlAccount {
  const f = record.fields;
  const accountClass = isGlAccountClass(f.class) ? f.class : 'asset';
  return {
    id: record.id,
    code: str(f.code).trim(),
    name: str(f.name),
    accountClass,
    normalBalance: glNormalBalance(accountClass),
    currency: str(f.currency) || 'USD',
    description: str(f.description),
    debitTotal: num(f.debitTotal),
    creditTotal: num(f.creditTotal),
    balance: num(f.balance),
    archived: record.status === 'archived',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Project a journal-entry record into its typed view (lines re-parsed live). */
export function glJournalEntryFromRecord(record: EnterpriseEntity): GlJournalEntry {
  const f = record.fields;
  const parsed = parseGlJournalLines(str(f.lines));
  const lines = parsed.ok ? parsed.lines : [];
  const totals = glJournalTotals(lines);
  const postedAt = str(f.postedAt);
  return {
    id: record.id,
    entryNumber: str(f.entryNumber),
    memo: str(f.memo),
    entryDate: str(f.entryDate),
    lines,
    totalDebits: totals.debits,
    totalCredits: totals.credits,
    posted: postedAt.length > 0,
    postedAt,
    sourceModule: str(f.sourceModule),
    sourceRef: str(f.sourceRef),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function formatGlAmount(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

/* ── deterministic summary fallbacks (used when the AI runner is absent) ── */

export function glAccountSummaryFallback(account: GlAccount): {
  summary: string;
  executiveExplanation: string;
} {
  const side = account.normalBalance === 'debit' ? 'debit-normal' : 'credit-normal';
  return {
    summary: `${account.code} ${account.name} is a ${side} ${glAccountClassLabel(account.accountClass).toLowerCase()} account with a balance of ${formatGlAmount(account.balance, account.currency)} (debits ${formatGlAmount(account.debitTotal, account.currency)}, credits ${formatGlAmount(account.creditTotal, account.currency)}).`,
    executiveExplanation:
      'Balance is derived from posted journal entries only — it is recomputed from the journal on every posting, never entered by hand.',
  };
}

export function glJournalSummaryFallback(entry: GlJournalEntry): {
  summary: string;
  executiveExplanation: string;
} {
  const totals = { debits: entry.totalDebits, credits: entry.totalCredits };
  const balance = isBalancedGlJournal(totals)
    ? 'balanced'
    : `unbalanced (debits ${totals.debits} ≠ credits ${totals.credits})`;
  const state = entry.posted ? `posted ${entry.postedAt.slice(0, 10)}` : 'draft';
  return {
    summary: `${entry.entryNumber} (${state}) carries ${entry.lines.length} line(s), ${balance}.`,
    executiveExplanation: entry.posted
      ? 'Posted entries are immutable; corrections are made by posting a reversing entry.'
      : 'Drafts may be edited freely; posting enforces the double-entry rule (debits must equal credits).',
  };
}

/* ── accounting periods: the close guard's domain ── */

/** The Accounting Periods module id + record kind (the framework store key). */
export const ACCOUNTING_PERIODS_MODULE_ID = 'finance-periods';
export const ACCOUNTING_PERIOD_KIND = 'accountingPeriod';

/** A typed view over an accounting-period record's flat fields (+ envelope). */
export interface GlAccountingPeriod {
  id: string;
  periodKey: string;
  label: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  closedAt: string;
  closedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Monthly period key (YYYY-MM) for an ISO date string; '' when unparseable. */
export function glPeriodKeyForDate(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(str(date).trim());
  return m ? `${m[1]}-${m[2]}` : '';
}

export function isGlPeriodKey(value: unknown): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(str(value));
}

/** First/last day of a period key's month — the seeded period boundaries. */
export function glPeriodBounds(periodKey: string): { startDate: string; endDate: string } {
  const [y, m] = periodKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { startDate: `${periodKey}-01`, endDate: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Project an accounting-period record into its typed view. */
export function glPeriodFromRecord(record: EnterpriseEntity): GlAccountingPeriod {
  const f = record.fields;
  return {
    id: record.id,
    periodKey: str(f.periodKey).trim(),
    label: str(f.label),
    startDate: str(f.startDate),
    endDate: str(f.endDate),
    closed: str(f.status) === 'closed',
    closedAt: str(f.closedAt),
    closedBy: str(f.closedBy),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * The close guard: a date is locked when ANY period record covering its key is
 * closed (conservative on duplicates — one closed record locks the month).
 */
export function glDateInClosedPeriod(date: string, periods: readonly GlAccountingPeriod[]): boolean {
  const key = glPeriodKeyForDate(date);
  if (!key) return false;
  return periods.some((p) => p.periodKey === key && p.closed);
}

/* ── tax reporting: period snapshots derived from POSTED books only ── */

/** The Tax Reports module id + record kind (the framework store key). */
export const TAX_REPORTS_MODULE_ID = 'finance-tax-reports';
export const TAX_REPORT_KIND = 'taxReport';

/** One invoice's books-derived row in a period tax report. */
export interface GlTaxReportLine {
  invoiceNumber: string;
  customer: string;
  customerGstin: string;
  /** Net amounts BOOKED for this invoice in the period (base + ADJ − REV). */
  bookedRevenue: number;
  bookedTax: number;
  /** The invoice record's own declared amounts — the cross-check side. */
  declaredSubtotal: number;
  declaredTax: number;
}

export interface GlTaxReport {
  periodKey: string;
  /** Net credit to the Tax Payable control account across the period's posted entries. */
  taxCollected: number;
  /** Net credit to the Sales Revenue control account across the period's posted entries. */
  taxableRevenue: number;
  invoiceCount: number;
  /** Σ declared invoice tax for the period's booked invoices. */
  declaredTax: number;
  /** taxCollected − declaredTax — non-zero is surfaced, never hidden. */
  discrepancy: number;
  lines: GlTaxReportLine[];
  note: string;
}

/** Net credit booked to one account across posted entries dated in a period. */
function periodNetCredit(
  accountCode: string,
  periodKey: string,
  entries: readonly GlJournalEntry[],
): number {
  let net = 0;
  for (const e of entries) {
    if (!e.posted || glPeriodKeyForDate(e.entryDate) !== periodKey) continue;
    for (const l of e.lines) if (l.account === accountCode) net += l.credit - l.debit;
  }
  return net;
}

/**
 * Compute a period's tax report FROM THE POSTED BOOKS. Attribution is
 * books-driven: an invoice appears when its auto-entries (`JE-INV-*`) posted
 * with an entry date inside the period; its booked figures are the NET of those
 * entries' Revenue/Tax lines (base + adjustments − reversal). The invoice
 * record's own declared amounts sit beside the booked figures, and any
 * difference between books-level tax and declared tax is reported as a
 * discrepancy — surfaced, never reconciled silently. Report generation only;
 * filing remains a human act.
 */
export function glTaxReportForPeriod(input: {
  periodKey: string;
  entries: readonly GlJournalEntry[];
  invoices: readonly {
    number: string;
    customer: string;
    customerGstin: string;
    subtotal: number;
    taxAmount: number;
  }[];
}): GlTaxReport {
  const { periodKey } = input;
  const taxCode = GL_CONTROL_ACCOUNTS.taxPayable.code;
  const revenueCode = GL_CONTROL_ACCOUNTS.salesRevenue.code;
  const taxCollected = periodNetCredit(taxCode, periodKey, input.entries);
  const taxableRevenue = periodNetCredit(revenueCode, periodKey, input.entries);

  const lines: GlTaxReportLine[] = [];
  for (const inv of input.invoices) {
    const number = inv.number.trim();
    if (!number) continue;
    const base = glInvoiceEntryNumber(number);
    const related = input.entries.filter(
      (e) =>
        e.posted &&
        glPeriodKeyForDate(e.entryDate) === periodKey &&
        (e.entryNumber === base ||
          e.entryNumber === `${base}-REV` ||
          e.entryNumber.startsWith(`${base}-ADJ`)),
    );
    if (related.length === 0) continue;
    let bookedRevenue = 0;
    let bookedTax = 0;
    for (const e of related) {
      for (const l of e.lines) {
        if (l.account === revenueCode) bookedRevenue += l.credit - l.debit;
        if (l.account === taxCode) bookedTax += l.credit - l.debit;
      }
    }
    lines.push({
      invoiceNumber: number,
      customer: inv.customer,
      customerGstin: inv.customerGstin,
      bookedRevenue,
      bookedTax,
      declaredSubtotal: inv.subtotal,
      declaredTax: inv.taxAmount,
    });
  }
  lines.sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1));
  const declaredTax = lines.reduce((s, l) => s + l.declaredTax, 0);
  const discrepancy = Math.round((taxCollected - declaredTax) * 100) / 100;
  const hasData = taxCollected !== 0 || taxableRevenue !== 0 || lines.length > 0;
  return {
    periodKey,
    taxCollected,
    taxableRevenue,
    invoiceCount: lines.length,
    declaredTax,
    discrepancy,
    lines,
    note: hasData
      ? discrepancy === 0
        ? 'derived from real posted journal entries; books and declared invoice tax agree'
        : `derived from real posted journal entries; books differ from declared invoice tax by ${discrepancy} — review before filing`
      : 'no posted tax activity in this period — the report is empty, not fabricated',
  };
}

/* ── auto-posting: the deterministic bookkeeping derived from commercial records ── */

/**
 * The seeded control accounts auto-posting resolves against, by CODE. The seed
 * creates them only into an EMPTY Chart of Accounts; a customized chart is never
 * overwritten — an unresolvable code simply leaves the derived entry as a
 * visible, unposted draft in the Journal.
 */
export const GL_CONTROL_ACCOUNTS = {
  cash: { code: '1000', name: 'Cash', accountClass: 'asset' as GlAccountClass },
  accountsReceivable: { code: '1100', name: 'Accounts Receivable', accountClass: 'asset' as GlAccountClass },
  taxPayable: { code: '2100', name: 'Tax Payable', accountClass: 'liability' as GlAccountClass },
  salesRevenue: { code: '4000', name: 'Sales Revenue', accountClass: 'revenue' as GlAccountClass },
} as const;

/** One derived journal entry the auto-posting layer should create (and post). */
export interface GlDerivedEntry {
  entryNumber: string;
  memo: string;
  lines: GlJournalLine[];
  sourceModule: string;
  sourceRef: string;
}

/** Deterministic entry numbers — the idempotency keys of auto-posting. */
export function glInvoiceEntryNumber(invoiceNumber: string): string {
  return `JE-INV-${invoiceNumber}`;
}
export function glPaymentEntryNumber(paymentNumber: string): string {
  return `JE-PAY-${paymentNumber}`;
}

function reversalOf(entry: GlDerivedEntry, reason: string): GlDerivedEntry {
  return {
    entryNumber: `${entry.entryNumber}-REV`,
    memo: `${reason} — reversal of ${entry.entryNumber}`,
    lines: entry.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })),
    sourceModule: entry.sourceModule,
    sourceRef: entry.sourceRef,
  };
}

/**
 * Decide the journal work an invoice's CURRENT state implies, given which
 * auto-entry numbers already exist. Pure and idempotent: fired twice, the
 * second call decides nothing. Issue (any post-draft, non-cancelled state)
 * derives Dr AR / Cr Revenue (+ Cr Tax Payable when taxed); cancellation or
 * deletion AFTER issue derives the mirrored reversal. Amount edits after issue
 * do NOT retro-adjust the books in this increment — adjustment entries are the
 * period-close scope (W1.3) and the gap is visible by comparing the entry to
 * the invoice.
 */
export function glDecideInvoicePostings(input: {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  deleted: boolean;
  existingEntryNumbers: ReadonlySet<string>;
  sourceModule: string;
}): GlDerivedEntry[] {
  const number = input.invoiceNumber.trim();
  if (!number || input.total <= 0) return [];
  const base = glInvoiceEntryNumber(number);
  const issued = !input.deleted && input.status !== 'draft' && input.status !== 'cancelled';
  const revoked = input.deleted || input.status === 'cancelled';
  const entry: GlDerivedEntry = {
    entryNumber: base,
    memo: `Invoice ${number} issued`,
    lines: glInvoiceExpectedLines(input.subtotal, input.taxAmount, input.total),
    sourceModule: input.sourceModule,
    sourceRef: input.invoiceId,
  };
  const out: GlDerivedEntry[] = [];
  if (issued && !input.existingEntryNumbers.has(base)) out.push(entry);
  if (revoked && input.existingEntryNumbers.has(base) && !input.existingEntryNumbers.has(`${base}-REV`)) {
    out.push(reversalOf(entry, input.deleted ? `Invoice ${number} deleted` : `Invoice ${number} cancelled`));
  }
  return out;
}

/**
 * Decide the journal work a payment's CURRENT state implies. Cleared derives
 * Dr Cash / Cr Accounts Receivable; void or deletion AFTER clearing derives the
 * mirrored reversal. Pure and idempotent, same contract as invoices.
 */
export function glDecidePaymentPostings(input: {
  paymentId: string;
  paymentNumber: string;
  status: string;
  amount: number;
  deleted: boolean;
  existingEntryNumbers: ReadonlySet<string>;
  sourceModule: string;
}): GlDerivedEntry[] {
  const number = input.paymentNumber.trim();
  if (!number || input.amount <= 0) return [];
  const base = glPaymentEntryNumber(number);
  const cleared = !input.deleted && input.status === 'cleared';
  const revoked = input.deleted || input.status === 'void';
  const entry: GlDerivedEntry = {
    entryNumber: base,
    memo: `Payment ${number} cleared`,
    lines: glPaymentExpectedLines(input.amount),
    sourceModule: input.sourceModule,
    sourceRef: input.paymentId,
  };
  const out: GlDerivedEntry[] = [];
  if (cleared && !input.existingEntryNumbers.has(base)) out.push(entry);
  if (revoked && input.existingEntryNumbers.has(base) && !input.existingEntryNumbers.has(`${base}-REV`)) {
    out.push(reversalOf(entry, input.deleted ? `Payment ${number} deleted` : `Payment ${number} voided`));
  }
  return out;
}

/** The cumulative lines an issued invoice's CURRENT amounts imply. */
export function glInvoiceExpectedLines(subtotal: number, taxAmount: number, total: number): GlJournalLine[] {
  return [
    { account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: total, credit: 0 },
    { account: GL_CONTROL_ACCOUNTS.salesRevenue.code, debit: 0, credit: subtotal },
    ...(taxAmount > 0 ? [{ account: GL_CONTROL_ACCOUNTS.taxPayable.code, debit: 0, credit: taxAmount }] : []),
  ];
}

/** The cumulative lines a cleared payment's CURRENT amount implies. */
export function glPaymentExpectedLines(amount: number): GlJournalLine[] {
  return [
    { account: GL_CONTROL_ACCOUNTS.cash.code, debit: amount, credit: 0 },
    { account: GL_CONTROL_ACCOUNTS.accountsReceivable.code, debit: 0, credit: amount },
  ];
}

/** Net signed (debit − credit) amount per account across a set of lines. */
function netByAccount(lines: readonly GlJournalLine[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const l of lines) net.set(l.account, (net.get(l.account) ?? 0) + l.debit - l.credit);
  return net;
}

/**
 * Decide the ADJUSTMENT entry (if any) that brings the books in line with a
 * source record whose amounts changed AFTER its base entry was booked — the
 * amount-edit gap W1.2 documented. Pure and idempotent: once booked, the
 * cumulative ledger equals the expectation, so the next call decides nothing.
 * Skipped entirely when the base entry is absent (nothing issued yet) or a
 * reversal exists (the cancel/void path owns the record). Balanced by
 * construction: expectation and booked entries are each balanced, so their
 * difference is too.
 */
export function glDecideAdjustment(input: {
  baseEntryNumber: string;
  memoSubject: string;
  expectedLines: readonly GlJournalLine[];
  existingEntries: readonly { entryNumber: string; lines: readonly GlJournalLine[] }[];
  sourceModule: string;
  sourceRef: string;
  /** Override the derived entry number (the revocation path emits `-REV`). */
  entryNumber?: string;
  /** Override the derived memo. */
  memo?: string;
}): GlDerivedEntry[] {
  const base = input.baseEntryNumber;
  const related = input.existingEntries.filter(
    (e) =>
      e.entryNumber === base ||
      e.entryNumber === `${base}-REV` ||
      e.entryNumber.startsWith(`${base}-ADJ`),
  );
  if (!related.some((e) => e.entryNumber === base)) return [];

  const expected = netByAccount(input.expectedLines);
  const booked = netByAccount(related.flatMap((e) => [...e.lines]));
  const accounts = new Set([...expected.keys(), ...booked.keys()]);
  const lines: GlJournalLine[] = [];
  for (const account of accounts) {
    const delta = (expected.get(account) ?? 0) - (booked.get(account) ?? 0);
    if (Math.round(delta * 100) === 0) continue;
    lines.push(delta > 0 ? { account, debit: delta, credit: 0 } : { account, debit: 0, credit: -delta });
  }
  if (lines.length === 0) return [];
  const index = related.filter((e) => e.entryNumber.startsWith(`${base}-ADJ`)).length + 1;
  return [
    {
      entryNumber: input.entryNumber ?? `${base}-ADJ${index}`,
      memo: input.memo ?? `${input.memoSubject} amount adjusted`,
      lines,
      sourceModule: input.sourceModule,
      sourceRef: input.sourceRef,
    },
  ];
}
