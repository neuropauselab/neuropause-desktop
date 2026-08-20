/**
 * NP-011 — AGGREGATION-SHAPED INGESTION (operator green-light, 20 Aug 2026).
 *
 * Some sources are not row-per-record: a bank-statement CSV is many transaction
 * ROWS that make ONE statement record; a Tally export is vouchers whose ledger
 * lines make ONE journal entry each. Rather than teaching the importer a second
 * write shape, these extractors PRE-FOLD the source into ordinary flat tables
 * whose `Lines (JSON)` cell carries the shared line shapes the destination
 * modules already parse (`parseBankStatementLines`, `parseGlJournalLines`).
 *
 * HONESTY BOUNDARIES:
 *  - Folding never invents data: unparseable amounts/dates pass through for the
 *    destination module's validation to refuse; ledger names are carried
 *    VERBATIM (resolution against the Chart of Accounts is the module's job).
 *  - Imported journal entries land as DRAFTS. Nothing reaches the GL without
 *    the `post` action's full guard (parse → resolve accounts → balance →
 *    closed-period policy) — ingestion is observation-class; posting is the
 *    consequence gate.
 *  - Detection is conservative: a table that does not look like a bank
 *    statement is left untouched; an XML file without Tally voucher structure
 *    returns null and flows to the generic XML parser.
 */
import type { BankStatementLine, GlJournalLine } from '@neuropause/shared';
import type { CellValue, ParsedTable } from './parsers';
import { eachElement, decodeXml } from './xmlScanner';

function norm(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findHeader(headers: string[], names: readonly string[]): number {
  const normalized = headers.map(norm);
  for (const n of names) {
    const i = normalized.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function num(v: CellValue): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[,\s₹$]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function str(v: CellValue): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Normalize obviously-parseable dates to YYYY-MM-DD; otherwise pass through verbatim. */
function isoDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Day-first (the shape Indian bank exports use): DD/MM/YYYY or DD-MM-YYYY.
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return s; // not confidently parseable — the module's validation speaks, not a guess
}

/* ── Bank-statement CSV/XLSX fold ─────────────────────────────────────────────── */

const DATE_H = ['date', 'txn date', 'transaction date', 'value date', 'tran date', 'post date'] as const;
const DESC_H = ['description', 'narration', 'particulars', 'details', 'transaction details', 'remarks'] as const;
const REF_H = ['reference', 'ref no', 'ref', 'cheque no', 'chq no', 'cheque number', 'utr', 'reference number'] as const;
const DEBIT_H = ['debit', 'withdrawal', 'withdrawals', 'debit amount', 'dr', 'withdrawal amt'] as const;
const CREDIT_H = ['credit', 'deposit', 'deposits', 'credit amount', 'cr', 'deposit amt'] as const;
const AMOUNT_H = ['amount', 'transaction amount'] as const;
const BALANCE_H = ['balance', 'closing balance', 'running balance', 'available balance'] as const;

/**
 * Detect a bank-transaction table and fold it into ONE statement row whose
 * `Lines (JSON)` cell is `BankStatementLine[]` (deposits positive, withdrawals
 * negative — the shared convention). Returns null when the table is not
 * bank-statement-shaped; the caller keeps the original.
 */
export function foldBankStatementTable(table: ParsedTable, sourceName: string): ParsedTable | null {
  const dateIdx = findHeader(table.headers, DATE_H);
  const descIdx = findHeader(table.headers, DESC_H);
  const refIdx = findHeader(table.headers, REF_H);
  const debitIdx = findHeader(table.headers, DEBIT_H);
  const creditIdx = findHeader(table.headers, CREDIT_H);
  const amountIdx = findHeader(table.headers, AMOUNT_H);
  const balanceIdx = findHeader(table.headers, BALANCE_H);

  const hasSplitAmounts = debitIdx !== -1 && creditIdx !== -1;
  const hasAmount = amountIdx !== -1;
  // Conservative: date + description + an amount shape, plus at least one more
  // bank signal (split columns, a balance, or a reference column).
  if (dateIdx === -1 || descIdx === -1 || (!hasSplitAmounts && !hasAmount)) return null;
  if (!hasSplitAmounts && balanceIdx === -1 && refIdx === -1) return null;
  if (table.rows.length === 0) return null;

  const lines: BankStatementLine[] = table.rows.map((row) => {
    const amount = hasSplitAmounts
      ? num(row[creditIdx] ?? null) - num(row[debitIdx] ?? null)
      : num(row[amountIdx] ?? null);
    return {
      date: isoDate(str(row[dateIdx] ?? null)),
      description: str(row[descIdx] ?? null),
      reference: refIdx === -1 ? '' : str(row[refIdx] ?? null),
      amount,
    };
  });

  const stem = sourceName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9-]+/g, '-');
  const dates = lines.map((l) => l.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const statementDate = dates.length > 0 ? dates[dates.length - 1]! : '';
  return {
    name: `${table.name} (bank statement)`,
    headers: ['Statement Number', 'Bank Account', 'Statement Date', 'Lines (JSON)'],
    rows: [[`STMT-${stem}`, stem, statementDate, JSON.stringify(lines)]],
    headerRowIndex: table.headerRowIndex,
    firstDataRowIndex: table.firstDataRowIndex,
    truncated: table.truncated,
  };
}

/* ── Tally XML voucher extraction ─────────────────────────────────────────────── */

/** First occurrence's decoded text — Tally nests repeated tags, so textOf's concatenation would lie. */
function firstText(xml: string, tag: string): string {
  let out: string | null = null;
  eachElement(xml, tag, (el) => {
    if (out === null) out = decodeXml(el.inner).trim();
  });
  return out ?? '';
}

/** Tally DATE is YYYYMMDD. */
function tallyDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw.trim();
}

/**
 * Detect a Tally export (ENVELOPE → TALLYMESSAGE → VOUCHER) and extract one
 * row per voucher: Entry Number · Date · Memo · `Lines (JSON)` as
 * `GlJournalLine[]`. Tally's sign convention: negative amounts are DEBITS.
 * Returns null for non-Tally XML.
 */
export function extractTallyVouchers(xmlText: string): ParsedTable | null {
  if (!/<TALLYMESSAGE[\s>]/.test(xmlText) || !/<VOUCHER[\s>]/.test(xmlText)) return null;

  const rows: CellValue[][] = [];
  let voucherIndex = 0;
  eachElement(xmlText, 'VOUCHER', (voucher) => {
    voucherIndex += 1;
    const lines: GlJournalLine[] = [];
    const collect = (listTag: string): void => {
      eachElement(voucher.inner, listTag, (entry) => {
        const account = firstText(entry.inner, 'LEDGERNAME');
        if (!account) return;
        const amount = num(firstText(entry.inner, 'AMOUNT'));
        lines.push(
          amount < 0
            ? { account, debit: -amount, credit: 0 }
            : { account, debit: 0, credit: amount },
        );
      });
    };
    collect('ALLLEDGERENTRIES.LIST');
    if (lines.length === 0) collect('LEDGERENTRIES.LIST');
    if (lines.length === 0) return; // a voucher without ledger lines cannot be a journal entry — skipped, not invented

    const number = firstText(voucher.inner, 'VOUCHERNUMBER') || `TALLY-${voucherIndex}`;
    const vchType = voucher.attrs.VCHTYPE ?? firstText(voucher.inner, 'VOUCHERTYPENAME');
    const narration = firstText(voucher.inner, 'NARRATION');
    const memo = [vchType, narration].filter((s) => s.length > 0).join(': ');
    rows.push([number, tallyDate(firstText(voucher.inner, 'DATE')), memo, JSON.stringify(lines)]);
  });

  if (rows.length === 0) return null;
  return {
    name: 'Tally vouchers',
    headers: ['Entry Number', 'Date', 'Memo', 'Lines (JSON)'],
    rows,
    headerRowIndex: null,
    firstDataRowIndex: 1,
    truncated: false,
  };
}

/* ── GSTR-2B (GST portal JSON) extraction ─────────────────────────────────────── */

interface Gstr2bInvoice {
  inum?: unknown;
  dt?: unknown;
  txval?: unknown;
  igst?: unknown;
  cgst?: unknown;
  sgst?: unknown;
  cess?: unknown;
}
interface Gstr2bSupplier {
  ctin?: unknown;
  trdnm?: unknown;
  inv?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** GST portal dates are DD-MM-YYYY. */
function gstDate(raw: string): string {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : raw.trim();
}

/**
 * Detect a GSTR-2B return file (root → data? → docdata → b2b[] of
 * {ctin, trdnm, inv[]}) and emit one flat VENDOR-BILL DRAFT row per invoice.
 * The derived Tax Rate % is an approximation for the module's tax math; the
 * EXACT source amounts (taxable, IGST/CGST/SGST/cess) are preserved verbatim
 * in Notes so nothing is lost to rounding. Bills land as DRAFTS — the
 * `approve` action stays the gate. Returns null for non-GSTR JSON.
 */
export function extractGstr2bBills(root: unknown): ParsedTable | null {
  const r0 = asRecord(root);
  if (!r0) return null;
  const data = asRecord(r0.data) ?? r0;
  const docdata = asRecord(data.docdata) ?? data;
  const b2b = docdata.b2b;
  if (!Array.isArray(b2b) || b2b.length === 0) return null;

  const rows: CellValue[][] = [];
  for (const supplierRaw of b2b) {
    const supplier = asRecord(supplierRaw) as Gstr2bSupplier | null;
    if (!supplier || typeof supplier.ctin !== 'string' || !Array.isArray(supplier.inv)) continue;
    const vendor =
      typeof supplier.trdnm === 'string' && supplier.trdnm.trim() !== '' ? supplier.trdnm.trim() : supplier.ctin;
    for (const invRaw of supplier.inv) {
      const inv = asRecord(invRaw) as Gstr2bInvoice | null;
      if (!inv || typeof inv.inum !== 'string') continue;
      const txval = num(inv.txval as CellValue);
      const igst = num(inv.igst as CellValue);
      const cgst = num(inv.cgst as CellValue);
      const sgst = num(inv.sgst as CellValue);
      const cess = num(inv.cess as CellValue);
      const tax = igst + cgst + sgst;
      const taxRate = txval > 0 ? Math.round((tax / txval) * 10000) / 100 : 0;
      rows.push([
        inv.inum,
        vendor,
        supplier.ctin,
        txval,
        taxRate,
        gstDate(String(inv.dt ?? '')),
        `GSTR-2B source amounts (verbatim): taxable ${txval}, IGST ${igst}, CGST ${cgst}, SGST ${sgst}, cess ${cess}. Tax Rate % above is derived for the module's tax math; these figures are the filing truth.`,
      ]);
    }
  }
  if (rows.length === 0) return null;
  return {
    name: 'GSTR-2B vendor bills',
    headers: ['Bill Number', 'Vendor', 'Vendor GSTIN', 'Subtotal', 'Tax Rate %', 'Bill Date', 'Notes'],
    rows,
    headerRowIndex: null,
    firstDataRowIndex: 1,
    truncated: false,
  };
}
