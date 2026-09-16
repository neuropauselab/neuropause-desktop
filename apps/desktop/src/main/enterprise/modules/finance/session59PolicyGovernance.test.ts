/**
 * ERP Session 59 — ADVANCED ENTERPRISE GOVERNANCE POLICY certification (the DEFINED, already-satisfied
 * decisions). S59 discovery established that three operator P0 policies are ALREADY met by existing
 * governed behavior; this file CERTIFIES each against the operator's exact constraints (no accounting
 * invented — the semantics under test all pre-date S59). The undefined items (D4/D5/D6 reversal &
 * adjustment record models, D8–D11 approval hierarchy, D12 PO lifecycle) are STOP+memo, not here.
 *
 *  D2 — PARTIAL CREDIT NOTES (operator: ALLOWED). Certifies: a note may be PARTIAL (amount < invoice);
 *       it must REFERENCE its invoice; CUMULATIVE credits may not exceed the eligible amount;
 *       accounting is COMPENSATING GL that balances; and the GL effect is IDEMPOTENT (the deterministic
 *       credit-note entry number + issued-note immutability mean no double booking on replay).
 *  D3 — REOPEN PAID INVOICE (operator: NOT ALLOWED). Certifies: a paid invoice is economically terminal —
 *       the edit door refuses any status change (the S45/S46 family guard), so it cannot be reopened to
 *       mutate economic state.
 *  D7 — IMPORTER ECONOMIC ROWS (operator: must NOT create posted economic effects). Certifies: the
 *       importer's write mechanism (`store.create`, no `onChange`/`runAction`) books NO GL — a directly
 *       written economic row carries no posted accounting effect; GL enters only via the governed action.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CREDIT_NOTES_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  PAYMENTS_MODULE_ID,
  glAccountFromRecord,
  adjustmentNoteFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createCreditNoteModule } from './creditNoteModule';
import { createPaymentModule } from './paymentModule';

const T0 = '2026-09-03T00:00:00.000Z';

describe('S59 · advanced governance policy — the already-satisfied P0 decisions, certified', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let creditNotes: EnterpriseModule;
  let payments: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-s59-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    creditNotes = createCreditNoteModule(join(dir, 'cn.json'), invoices.store);
    payments = createPaymentModule(join(dir, 'pay.json'), invoices.store);
    await Promise.all([accounts.store.load(), journal.store.load(), invoices.store.load(), creditNotes.store.load(), payments.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts
        : id === JOURNAL_ENTRIES_MODULE_ID ? journal
        : id === CREDIT_NOTES_MODULE_ID ? creditNotes
        : id === PAYMENTS_MODULE_ID ? payments
        : null,
      emit: () => undefined,
    };
  });
  afterEach(async () => {
    await Promise.all([accounts.store.flush(), journal.store.flush(), invoices.store.flush(), creditNotes.store.flush(), payments.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const balanceOf = (code: string): number => {
    const holder = accounts.store.list().find((r) => String(r.fields.code) === code);
    return holder ? glAccountFromRecord(holder).balance : 0;
  };
  const seedIssuedInvoice = (number: string, amount: number, taxRate: number): void => {
    invoices.store.create({ title: number, fields: { number, customer: 'Acme', currency: 'USD', status: 'issued', amount, taxRate, amountPaid: 0 } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
  };
  const draftCN = (noteNumber: string, ref: string, amount: number, taxRate: number): EnterpriseEntity => {
    const v = creditNotes.hooks.validate!({ fields: { noteNumber, documentRef: ref, party: 'Acme', amount, taxRate, currency: 'USD', status: 'draft' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return creditNotes.store.create({ title: noteNumber, fields: v.values, actor: 't@np', now: T0 });
  };

  // ── D2 — partial credit notes ─────────────────────────────────────────────
  it('D2 · a PARTIAL credit note references its invoice, books compensating GL, and refuses over-crediting', async () => {
    // must reference a real invoice
    expect(creditNotes.hooks.validate!({ fields: { noteNumber: 'CN-X', documentRef: 'NOPE', amount: 10, currency: 'USD', status: 'draft' } }).ok).toBe(false);
    seedIssuedInvoice('INV-1', 100, 18); // total 118
    // PARTIAL: 50 of 100 — allowed, books Dr Revenue 50 / Dr Tax 9 / Cr AR 59 (compensating, balances)
    const cn = draftCN('CN-1', 'INV-1', 50, 18);
    expect((await creditNotes.hooks.runAction!('issue', cn, ctx)).ok).toBe(true);
    expect(balanceOf('4000')).toBe(-50); // revenue reversed
    expect(balanceOf('1100')).toBe(-59); // AR reversed (compensating)
    // CUMULATIVE ceiling: 50 already credited, a further 60 (>59 remaining) is refused; exactly the
    // remaining eligible amount is allowed.
    const over = draftCN('CN-2', 'INV-1', 50.85, 18); // 60.00
    expect((await creditNotes.hooks.runAction!('issue', over, ctx)).ok).toBe(false);
    const rest = draftCN('CN-3', 'INV-1', 50, 18); // 59.00 — exactly the remainder
    expect((await creditNotes.hooks.runAction!('issue', rest, ctx)).ok).toBe(true);
  });

  it('D2 · the credit-note GL is IDEMPOTENT — an issued note is immutable and never double-books', async () => {
    seedIssuedInvoice('INV-2', 100, 0);
    const cn = draftCN('CN-ID', 'INV-2', 40, 0);
    expect((await creditNotes.hooks.runAction!('issue', cn, ctx)).ok).toBe(true);
    const glAfterFirst = journal.store.list().length;
    // a replay (re-issue of the same, now-issued note) is refused — no second booking.
    expect((await creditNotes.hooks.runAction!('issue', creditNotes.store.get(cn.id)!, ctx)).ok).toBe(false);
    expect(journal.store.list().length).toBe(glAfterFirst); // GL unchanged — idempotent
    expect(adjustmentNoteFromRecord(creditNotes.store.get(cn.id)!).status).toBe('issued');
  });

  // ── D3 — reopen paid invoice = NOT ALLOWED ────────────────────────────────
  it('D3 · a PAID invoice is economically terminal — the edit door refuses reopening it', () => {
    const inv = invoices.store.create({ title: 'INV-PAID', fields: { number: 'INV-PAID', customer: 'Acme', currency: 'USD', status: 'paid', amount: 100, taxRate: 0, amountPaid: 100 } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
    // Attempt to REOPEN by editing status paid → issued (would let its economic state be mutated).
    const reopen = invoices.hooks.validate!({ fields: { ...inv.fields, status: 'issued', recordId: inv.id } as EnterpriseEntity['fields'] & { recordId: string }, recordId: inv.id } as never);
    expect(reopen.ok).toBe(false);
    if (!reopen.ok) expect(JSON.stringify(reopen.errors)).toMatch(/Issue and Cancel|status changes only/i);
  });

  // ── D7 — importer economic rows carry no posted GL ────────────────────────
  it('D7 · a directly-written economic row (the importer mechanism) books NO GL — posting needs the governed action', () => {
    seedIssuedInvoice('INV-IMP', 100, 0);
    const glBefore = journal.store.list().length;
    // The importer writes via `store.create`, NOT the module action — so no `onChange`/`runAction`
    // GL path fires. Even a row written directly as 'cleared' produces no cash GL.
    payments.store.create({ title: 'PAY-IMP', fields: { paymentNumber: 'PAY-IMP', invoiceRef: 'INV-IMP', amount: 100, status: 'cleared', currency: 'USD' } as EnterpriseEntity['fields'], actor: 'importer', now: T0 });
    expect(journal.store.list().length).toBe(glBefore); // NO GL from the raw write — economic effect did not enter
    // (The GL effect enters ONLY through the governed ClearCustomerPayment command / `clear` action —
    //  certified by the S57 governed-clear pins; the import path cannot post it.)
  });
});
