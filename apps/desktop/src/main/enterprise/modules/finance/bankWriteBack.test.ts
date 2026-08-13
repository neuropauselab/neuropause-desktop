/**
 * Finance → FW-8 Bank-Reconciliation Write-Back — finalizing a bank statement
 * turns its human-reviewed matches into bank EVIDENCE on the payments
 * themselves: matched payments are stamped bankReconciledAt + bankStatementRef,
 * become immutable through the validated edit path, and never compete as match
 * candidates for later statements. Reconcile alone still writes nothing
 * (pre-FW-8 behavior), and a payment already evidenced elsewhere is skipped
 * and said, never restamped.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PAYMENTS_MODULE_ID } from '@neuropause/shared';
import type { EnterpriseEntity } from '@neuropause/shared';
import { createBankStatementModule } from './bankStatementModule';
import { createInvoiceModule } from './invoiceModule';
import { createPaymentModule } from './paymentModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T00:00:00.000Z';

describe('FW-8: finalize writes bank evidence back onto matched payments', () => {
  let dir: string;
  let invoices: EnterpriseModule;
  let payments: EnterpriseModule;
  let bank: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  const mkPayment = (paymentNumber: string, transactionRef: string, amount: number) =>
    payments.store.create({
      title: paymentNumber,
      fields: {
        paymentNumber, invoiceRef: 'INV-1', amount, currency: 'USD', method: 'bank_transfer',
        status: 'cleared', receivedDate: '2026-08-01', transactionRef,
      } as EnterpriseEntity['fields'],
      actor: 't', now: T0,
    });

  const mkStatement = (statementNumber: string, lines: string) => {
    const v = bank.hooks.validate({ fields: { statementNumber, bankAccount: 'HDFC', lines, status: 'imported' } });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return bank.store.create({ title: statementNumber, fields: v.values, actor: 't', now: T0 });
  };
  const paymentByNumber = (n: string) =>
    payments.store.list().find((r) => String(r.fields.paymentNumber) === n)!;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-bwb-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    invoices = createInvoiceModule(join(dir, 'invoices.json'));
    payments = createPaymentModule(join(dir, 'payments.json'), invoices.store);
    bank = createBankStatementModule(join(dir, 'bank.json'), payments.store);
    await Promise.all([invoices.store.load(), payments.store.load(), bank.store.load()]);
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === PAYMENTS_MODULE_ID ? payments : null),
      emit: () => undefined,
    } as unknown as EnterpriseModuleActionContext;
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 25));
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('stamps matched payments at FINALIZE (not at reconcile); unmatched stay untouched; stamped = immutable', async () => {
    mkPayment('PAY-1', 'TXN123', 118);
    mkPayment('PAY-2', 'TXN999', 50); // never on the statement
    const stmt = mkStatement(
      'STMT-1',
      '[{"date":"2026-08-01","description":"NEFT","reference":"TXN123","amount":118},{"date":"2026-08-02","description":"FEE","reference":"","amount":-25}]',
    );
    await bank.hooks.runAction!('reconcile', bank.store.get(stmt.id)!, ctx);
    // Reconcile is a REPORT — no write-back yet (pre-FW-8 behavior preserved).
    expect(String(paymentByNumber('PAY-1').fields.bankReconciledAt ?? '')).toBe('');
    const fin = await bank.hooks.runAction!('finalize', bank.store.get(stmt.id)!, ctx);
    expect(fin.ok).toBe(true);
    expect(fin.message).toContain('1 payment(s) stamped');
    const pay1 = paymentByNumber('PAY-1');
    expect(String(pay1.fields.bankReconciledAt)).toBe(T0);
    expect(String(pay1.fields.bankStatementRef)).toBe('STMT-1');
    expect(String(paymentByNumber('PAY-2').fields.bankReconciledAt ?? '')).toBe(''); // untouched
    // Bank-evidenced payments refuse validated edits.
    const edit = payments.hooks.validate({ fields: { ...pay1.fields, notes: 'rewrite' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('bank-reconciled');
  });

  it('an evidenced payment never competes again; a stale match is skipped and said', async () => {
    mkPayment('PAY-1', 'TXN123', 118);
    const a = mkStatement('STMT-A', '[{"date":"2026-08-01","description":"NEFT","reference":"TXN123","amount":118}]');
    const b = mkStatement('STMT-B', '[{"date":"2026-08-01","description":"NEFT DUP","reference":"TXN123","amount":118}]');
    // Both reconcile while PAY-1 is still unstamped — both match it.
    await bank.hooks.runAction!('reconcile', bank.store.get(a.id)!, ctx);
    await bank.hooks.runAction!('reconcile', bank.store.get(b.id)!, ctx);
    expect(bank.store.get(b.id)!.fields.matchedCount).toBe(1);
    // A finalizes first → PAY-1 is evidenced by STMT-A.
    await bank.hooks.runAction!('finalize', bank.store.get(a.id)!, ctx);
    expect(String(paymentByNumber('PAY-1').fields.bankStatementRef)).toBe('STMT-A');
    // B's stored match is now stale → skipped and stated; the stamp is not overwritten.
    const finB = await bank.hooks.runAction!('finalize', bank.store.get(b.id)!, ctx);
    expect(finB.ok).toBe(true);
    expect(finB.message).toContain('0 payment(s) stamped');
    expect(finB.message).toContain('skipped');
    expect(String(paymentByNumber('PAY-1').fields.bankStatementRef)).toBe('STMT-A');
    // And a FRESH statement can no longer match the evidenced payment at all.
    const c = mkStatement('STMT-C', '[{"date":"2026-08-01","description":"NEFT TRIP","reference":"TXN123","amount":118}]');
    await bank.hooks.runAction!('reconcile', bank.store.get(c.id)!, ctx);
    expect(bank.store.get(c.id)!.fields.matchedCount).toBe(0);
    expect(bank.store.get(c.id)!.fields.unmatchedCount).toBe(1);
  });
});
