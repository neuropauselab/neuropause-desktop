/**
 * Module 7 — Banking Platform. Bank accounts, an in-process ledger, cash position, reconciliation,
 * treasury, and payment instructions across rails (SWIFT / ACH / SEPA / UPI / card / open-banking).
 * Cash position and reconciliation are real in-process computations; a payment instruction is only
 * ever 'prepared' — NO money moves. Real transfers and settlement are REGULATED-EXTERNAL.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import { REGULATED_NOTE } from './types';
import { PAYMENT_RAILS, type PaymentRail } from './constants';

export interface BankAccount {
  id: string;
  name: string;
  currency: string;
}
export interface LedgerEntry {
  accountId: string;
  amount: number;
  kind: 'credit' | 'debit';
  memo: string;
  at: number;
}
export interface PaymentInstruction {
  id: string;
  fromAccountId: string;
  toReference: string;
  amount: number;
  rail: PaymentRail;
  status: 'prepared'; // never 'settled'
  evidence: 'regulated-external';
  note: string;
}
export interface Reconciliation {
  accountId: string;
  matched: number;
  unmatchedBook: number;
  unmatchedStatement: number;
  reconciled: boolean;
}

export class BankingRuntime {
  private readonly accountsMap = new Map<string, BankAccount>();
  private readonly ledger: LedgerEntry[] = [];
  private readonly instructionsMap = new Map<string, PaymentInstruction>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async registerAccount(input: { name: string; currency?: string }): Promise<BankAccount> {
    const a: BankAccount = { id: randomId('bank'), name: input.name, currency: input.currency ?? 'USD' };
    this.accountsMap.set(a.id, a);
    await this.governance.record({ actor: 'system', domain: 'banking', operation: 'account.register', targetId: a.id, evidence: 'live-verified' });
    return a;
  }
  /** Record an in-process ledger entry (a book record — NOT a real bank movement). */
  async recordEntry(input: { accountId: string; amount: number; kind: 'credit' | 'debit'; memo: string }): Promise<LedgerEntry> {
    const e: LedgerEntry = { accountId: input.accountId, amount: input.amount, kind: input.kind, memo: input.memo, at: this.clock.now() };
    this.ledger.push(e);
    return e;
  }
  /** Real in-process cash position per account from the book ledger. */
  cashPosition(accountId: string): number {
    return this.ledger.filter((e) => e.accountId === accountId).reduce((s, e) => s + (e.kind === 'credit' ? e.amount : -e.amount), 0);
  }
  /** Prepare (never settle) a payment instruction. No money moves. */
  async instruct(input: { fromAccountId: string; toReference: string; amount: number; rail: PaymentRail }): Promise<PaymentInstruction> {
    if (!PAYMENT_RAILS.includes(input.rail)) throw new Error(`unknown payment rail: ${input.rail}`);
    const pi: PaymentInstruction = { id: randomId('pi'), fromAccountId: input.fromAccountId, toReference: input.toReference, amount: input.amount, rail: input.rail, status: 'prepared', evidence: 'regulated-external', note: `${input.rail} instruction prepared — ${REGULATED_NOTE}` };
    this.instructionsMap.set(pi.id, pi);
    await this.governance.record({ actor: 'system', domain: 'banking', operation: `instruct.${input.rail}`, targetId: pi.id, evidence: 'regulated-external', detail: pi.note });
    return pi;
  }
  /** Real in-process reconciliation of a bank statement against the book ledger. */
  reconcile(accountId: string, statementAmounts: number[]): Reconciliation {
    const book = this.ledger.filter((e) => e.accountId === accountId).map((e) => (e.kind === 'credit' ? e.amount : -e.amount));
    const stmt = [...statementAmounts];
    let matched = 0;
    for (const b of book) {
      const idx = stmt.indexOf(b);
      if (idx >= 0) { matched++; stmt.splice(idx, 1); }
    }
    const unmatchedBook = book.length - matched;
    return { accountId, matched, unmatchedBook, unmatchedStatement: stmt.length, reconciled: unmatchedBook === 0 && stmt.length === 0 };
  }

  accounts(): BankAccount[] { return [...this.accountsMap.values()]; }
  instructions(): PaymentInstruction[] { return [...this.instructionsMap.values()]; }
  rails(): readonly PaymentRail[] { return PAYMENT_RAILS; }
  count(): number { return this.accountsMap.size; }
}
