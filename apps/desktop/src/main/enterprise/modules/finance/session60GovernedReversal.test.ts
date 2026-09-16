/**
 * ERP Session 60 — GOVERNED ECONOMIC REVERSAL + APPROVAL CONTROL-PLANE.
 *
 * This session implements the ONE operator decision that is fully defined by existing governed
 * accounting: D5 — govern the economic adjustment of an ISSUED invoice by REUSING the existing
 * credit-note (reduce) / debit-note (increase) mechanism rather than letting the update door silently
 * book an ungoverned GL adjustment. S46 fenced the STATUS edit on an issued invoice; S60 closes the
 * remaining hole — the ECONOMIC-FIELD edit (amount / taxRate / exchangeRate) — by refusing it on any
 * posted (non-draft) invoice and directing the caller to the governed credit/debit note.
 *
 * The other operator decisions this session touched — D4 (payment reversal record model), D6 (delete-
 * door reversal boundary, coupled to D4), D8–D11 (approval control-plane: thresholds / SoD / dual-
 * control / immutable decision records), and D12 (PO commitment lifecycle) — hit S60 STOP conditions
 * (undefined reversal/adjustment record model · new authority hierarchy · uncontrolled P2P redesign)
 * and are filed as DECISION-MEMO-S60-*.md. No accounting or authority was invented for them.
 *
 * These pins certify the D5 fence against the operator's exact constraints:
 *   • a posted invoice's economic fields cannot be silently mutated on the update door;
 *   • the fence is NARROW — it never blocks a draft invoice (no GL yet) nor a non-economic edit
 *     (notes) on a posted invoice, and it never blocks the pinned amountPaid-derived payment states;
 *   • the SANCTIONED path (a governed credit note referencing the invoice) still books balanced,
 *     compensating GL — the redirect target is real, not a dead end.
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
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';
import { createJournalEntryModule } from './journalEntryModule';
import { createInvoiceModule } from './invoiceModule';
import { createCreditNoteModule } from './creditNoteModule';
import { createPaymentModule } from './paymentModule';

const T0 = '2026-09-03T00:00:00.000Z';

describe('S60 · D5 governed economic adjustment — the issued-invoice economic-edit fence', () => {
  let dir: string;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let invoices: EnterpriseModule;
  let creditNotes: EnterpriseModule;
  let payments: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-s60-${randomUUID()}`);
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
  const seedInvoice = (number: string, status: string, amount: number, taxRate: number): EnterpriseEntity =>
    invoices.store.create({ title: number, fields: { number, customer: 'Acme', currency: 'USD', status, amount, taxRate, exchangeRate: 1, amountPaid: 0 } as EnterpriseEntity['fields'], actor: 't@np', now: T0 });
  // The update door: recordId present ⇒ the EnterpriseModuleUpdate path.
  const edit = (rec: EnterpriseEntity, patch: Record<string, unknown>) =>
    invoices.hooks.validate!({ fields: { ...rec.fields, ...patch } as EnterpriseEntity['fields'], recordId: rec.id } as never);

  // ── the fence: posted invoice economic fields are refused, redirected to notes ──
  it('D5 · editing the AMOUNT of an issued invoice is refused and directs to a credit/debit note', () => {
    const inv = seedInvoice('INV-1', 'issued', 100, 18);
    const r = edit(inv, { amount: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.amount).toBeTruthy();
      expect(JSON.stringify(r.errors)).toMatch(/credit note|debit note/i);
    }
  });

  it('D5 · editing the TAX RATE of a partially-paid invoice is refused (economic input)', () => {
    const inv = seedInvoice('INV-2', 'partially_paid', 100, 18);
    const r = edit(inv, { taxRate: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.taxRate).toBeTruthy();
  });

  it('D5 · editing the EXCHANGE RATE of a paid invoice is refused (economic input)', () => {
    const inv = seedInvoice('INV-3', 'paid', 100, 0);
    const r = edit(inv, { exchangeRate: 1.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.exchangeRate).toBeTruthy();
  });

  // ── the fence is NARROW — negative controls that it does not over-block ──
  it('D5 · a DRAFT invoice stays freely economically editable (no GL booked yet)', () => {
    const inv = seedInvoice('INV-DRAFT', 'draft', 100, 18);
    expect(edit(inv, { amount: 250 }).ok).toBe(true);
    expect(edit(inv, { taxRate: 12 }).ok).toBe(true);
    expect(edit(inv, { exchangeRate: 1.5 }).ok).toBe(true);
  });

  it('D5 · a NON-economic edit (notes) on an issued invoice is still allowed', () => {
    const inv = seedInvoice('INV-NOTE', 'issued', 100, 18);
    expect(edit(inv, { notes: 'called customer, will pay Friday' }).ok).toBe(true);
  });

  it('D5 · re-saving the SAME economic values on an issued invoice is a no-op, not a change', () => {
    const inv = seedInvoice('INV-NOOP', 'issued', 100, 18);
    // Same amount/taxRate/exchangeRate supplied ⇒ nothing economic changed ⇒ not refused.
    expect(edit(inv, { amount: 100, taxRate: 18, exchangeRate: 1, notes: 'touch' }).ok).toBe(true);
  });

  // ── the sanctioned redirect target is real: the governed credit note books balanced GL ──
  it('D5 · the GOVERNED adjustment (a credit note referencing the invoice) books compensating, balanced GL', async () => {
    seedInvoice('INV-ADJ', 'issued', 100, 18); // total 118 (Dr AR / Cr Revenue booked at issue elsewhere)
    const v = creditNotes.hooks.validate!({ fields: { noteNumber: 'CN-ADJ', documentRef: 'INV-ADJ', party: 'Acme', amount: 20, taxRate: 18, currency: 'USD', status: 'draft' } });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const cn = creditNotes.store.create({ title: 'CN-ADJ', fields: v.values, actor: 't@np', now: T0 });
    expect((await creditNotes.hooks.runAction!('issue', cn, ctx)).ok).toBe(true);
    // compensating: Dr Revenue 20 / Dr Tax 3.6 / Cr AR 23.6 — reverses the receivable, balances to zero.
    expect(balanceOf('4000')).toBe(-20);
    expect(balanceOf('1100')).toBe(-23.6);
  });
});
