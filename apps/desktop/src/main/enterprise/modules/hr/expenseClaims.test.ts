/**
 * HR → FW-3 Expense Claims — the pure engine, the module's guards, the
 * human-in-the-loop decision lifecycle, and the Finance integration proof:
 * approving a claim books a REAL balanced accrual (Dr 5330 / Cr 2260) into
 * the W1 journal through the same seam payroll uses — idempotently.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPLOYEE_EXPENSES_ACCOUNT,
  EXPENSE_CLAIMS_PAYABLE_ACCOUNT,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  expenseAccrualLines,
  expenseEntryNumber,
  normalizeClaimAmount,
} from '@neuropause/shared';
import { createEmployeeModule } from './employeeModule';
import { createExpenseClaimModule, APPROVE_CLAIM_ACTION, REJECT_CLAIM_ACTION } from './expenseClaimModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-06T00:00:00.000Z';

describe('Expense claims engine (pure)', () => {
  it('normalizes amounts: positive 2dp or nothing', () => {
    expect(normalizeClaimAmount(1234.567)).toBe(1234.57);
    expect(normalizeClaimAmount('250')).toBe(250);
    expect(normalizeClaimAmount(0)).toBeNull();
    expect(normalizeClaimAmount(-5)).toBeNull();
    expect(normalizeClaimAmount('abc')).toBeNull();
  });

  it('builds a balanced two-line accrual to the paisa', () => {
    const lines = expenseAccrualLines(999.99);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ account: EMPLOYEE_EXPENSES_ACCOUNT.code, debit: 999.99, credit: 0 });
    expect(lines[1]).toEqual({ account: EXPENSE_CLAIMS_PAYABLE_ACCOUNT.code, debit: 0, credit: 999.99 });
    expect(expenseEntryNumber('EXP-X')).toBe('JE-EXP-EXP-X');
  });
});

describe('Expense Claims module — guards, decisions, and the GL accrual', () => {
  let dir: string;
  let employees: EnterpriseModule;
  let accounts: EnterpriseModule;
  let journal: EnterpriseModule;
  let claims: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-exp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    employees = createEmployeeModule(join(dir, 'employees.json'));
    accounts = createLedgerAccountModule(join(dir, 'accounts.json'));
    journal = createJournalEntryModule(join(dir, 'journal.json'), accounts.store);
    claims = createExpenseClaimModule(join(dir, 'claims.json'), employees.store);
    await Promise.all([employees.store.load(), accounts.store.load(), journal.store.load(), claims.store.load()]);
    ctx = {
      actor: () => 'finance@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) =>
        id === LEDGER_ACCOUNTS_MODULE_ID ? accounts : id === JOURNAL_ENTRIES_MODULE_ID ? journal : null,
      emit: () => undefined,
    } as unknown as EnterpriseModuleActionContext;
    const v = employees.hooks.validate({
      fields: { name: 'Ravi', employeeNumber: 'E7', role: 'Sales', department: 'Field', monthlySalary: 40000 },
    });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    employees.store.create({ title: 'Ravi', fields: v.values, actor: 't', now: T0 });
  });
  afterEach(async () => {
    await Promise.all([employees.store.flush(), accounts.store.flush(), journal.store.flush(), claims.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const employeeId = (): string => employees.store.list()[0].id;
  const createClaim = (over: Record<string, unknown> = {}) => {
    const v = claims.hooks.validate({
      fields: { employee: employeeId(), category: 'travel', expenseDate: '2026-08-05', amount: 1250.5, description: 'Client visit — Ahmedabad', ...over },
    });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return claims.store.create({ title: String(v.values.claimNumber), fields: v.values, actor: 't', now: T0 });
  };

  it('guards: real employee, category, date, positive amount; derives claim number', () => {
    expect(claims.hooks.validate({ fields: { employee: 'ghost', category: 'travel', expenseDate: '2026-08-05', amount: 10, description: 'x' } }).ok).toBe(false);
    expect(claims.hooks.validate({ fields: { employee: employeeId(), category: 'crypto', expenseDate: '2026-08-05', amount: 10, description: 'x' } }).ok).toBe(false);
    expect(claims.hooks.validate({ fields: { employee: employeeId(), category: 'meals', expenseDate: '2026-02-30', amount: 10, description: 'x' } }).ok).toBe(false);
    expect(claims.hooks.validate({ fields: { employee: employeeId(), category: 'meals', expenseDate: '2026-08-05', amount: 0, description: 'x' } }).ok).toBe(false);
    const good = claims.hooks.validate({ fields: { employee: employeeId(), category: 'meals', expenseDate: '2026-08-05', amount: 199.999, description: 'Lunch' } });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(String(good.values.claimNumber)).toContain('EXP-2026-08-05-E7');
      expect(good.values.amount).toBe(200); // normalized 2dp
      expect(good.values.status).toBe('submitted');
    }
  });

  it('APPROVE posts the balanced accrual into the real journal — idempotent, then immutable', async () => {
    const claim = createClaim();
    const res = await claims.hooks.runAction!(APPROVE_CLAIM_ACTION, claims.store.get(claim.id)!, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const decided = claims.store.get(claim.id)!;
    expect(String(decided.fields.status)).toBe('approved');
    const entryNumber = String(decided.fields.journalEntry);
    expect(entryNumber.startsWith('JE-EXP-')).toBe(true);
    // The journal REALLY holds it, balanced.
    const entry = journal.store.list().find((r) => String(r.fields.entryNumber) === entryNumber);
    expect(entry).toBeDefined();
    const lines = JSON.parse(String(entry!.fields.linesJson ?? entry!.fields.lines ?? '[]')) as Array<{ debit: number; credit: number }>;
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    expect(dr).toBeCloseTo(1250.5, 2);
    expect(Math.abs(dr - cr)).toBeLessThan(0.005);
    // Both accounts were ensured.
    const codes = accounts.store.list().map((r) => String(r.fields.code));
    expect(codes).toContain(EMPLOYEE_EXPENSES_ACCOUNT.code);
    expect(codes).toContain(EXPENSE_CLAIMS_PAYABLE_ACCOUNT.code);
    // Deciding again refuses (idempotent at the action level).
    expect((await claims.hooks.runAction!(APPROVE_CLAIM_ACTION, claims.store.get(claim.id)!, ctx)).ok).toBe(false);
    // And a decided claim refuses edits.
    expect(claims.hooks.validate({ fields: { ...decided.fields } }).ok).toBe(false);
  });

  it('REJECT closes the claim with no accrual', async () => {
    const claim = createClaim({ expenseDate: '2026-08-06' });
    const res = await claims.hooks.runAction!(REJECT_CLAIM_ACTION, claims.store.get(claim.id)!, ctx);
    expect(res.ok).toBe(true);
    expect(String(claims.store.get(claim.id)!.fields.status)).toBe('rejected');
    expect(journal.store.list().length).toBe(0);
    expect((await claims.hooks.runAction!(APPROVE_CLAIM_ACTION, claims.store.get(claim.id)!, ctx)).ok).toBe(false);
  });
});
