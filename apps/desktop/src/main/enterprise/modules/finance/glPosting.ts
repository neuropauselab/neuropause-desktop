/**
 * Finance → GL auto-posting glue — the seam that turns commercial record
 * changes (invoice issued/cancelled, payment cleared/voided) into REAL journal
 * entries through the existing modules, with no new architecture:
 *
 *   - decisions are pure + idempotent (`glDecide*Postings` in @neuropause/shared),
 *     keyed by deterministic entry numbers, so a re-fired lifecycle event never
 *     double-posts;
 *   - entries are created as DRAFTS through the Journal module's own validate
 *     hook, then posted through its own `post` action — so every guard, audit
 *     entry, timeline event, broadcast, and account reconciliation applies
 *     exactly as if a human had done it;
 *   - control accounts (Cash / AR / Tax Payable / Sales Revenue) are seeded ONLY
 *     into an EMPTY Chart of Accounts; a customized chart is never overwritten —
 *     when a control code is missing, auto-posting PAUSES for that record (the
 *     journal refuses lines it cannot resolve, so nothing partial is written)
 *     and retries on the next lifecycle event once the chart resolves;
 *   - everything no-ops gracefully when the GL modules are not registered
 *     (tests that wire only invoice+payment stay valid).
 */
import type { EnterpriseEntity } from '@neuropause/shared';
import {
  FINANCE_MODULE_ID,
  FX_GAINLOSS_ACCOUNT,
  FX_UNREALIZED_ACCOUNT,
  GL_ASSET_CONTROL_ACCOUNTS,
  GL_CONTROL_ACCOUNTS,
  GL_PAYABLE_CONTROL_ACCOUNTS,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  VENDOR_BILLS_MODULE_ID,
  calculateInvoiceAmount,
  calculateTaxAmount,
  realizedPayableFxLines,
  realizedReceivableFxLines,
  reverseFxLines,
  unrealizedRevaluationLines,
  glBillEntryNumber,
  glBillExpectedLines,
  glDecideAdjustment,
  glDecideInvoicePostings,
  glDecidePaymentPostings,
  glInvoiceEntryNumber,
  glInvoiceExpectedLines,
  glJournalEntryFromRecord,
  glPaymentEntryNumber,
  glVendorPaymentEntryNumber,
  invoiceFromRecord,
  paymentFromRecord,
  vendorBillFromRecord,
  vendorPaymentFromRecord,
  type GlDerivedEntry,
  type GlJournalLine,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Seed the four control accounts — only when the chart is completely empty. */
async function seedControlAccountsIfEmpty(
  accounts: EnterpriseModule,
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  await accounts.store.load();
  if (accounts.store.count() > 0) return;
  for (const control of [
    ...Object.values(GL_CONTROL_ACCOUNTS),
    ...Object.values(GL_PAYABLE_CONTROL_ACCOUNTS),
    ...Object.values(GL_ASSET_CONTROL_ACCOUNTS),
  ]) {
    const v = accounts.hooks.validate({
      fields: { code: control.code, name: control.name, class: control.accountClass, currency: 'USD' },
    });
    if (!v.ok) continue; // descriptor drift — never seed garbage
    const record = accounts.store.create({
      title: control.code,
      fields: v.values,
      actor: 'system:gl-seed',
      now: ctx.now(),
    });
    ctx.emit(accounts, 'created', record);
  }
}

/**
 * Ensure the FX Gain/Loss P&L account exists before a realized-FX entry posts
 * (W6-B4). `seedControlAccountsIfEmpty` only seeds an EMPTY chart, so a foreign
 * settlement in a live chart lazily ensures 7810 here — mirroring the payroll
 * account-ensure pattern (validated via the module, `class` = the account type).
 */
async function ensureFxAccount(ctx: EnterpriseModuleActionContext): Promise<void> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return;
  await accounts.store.load();
  if (accounts.store.list().some((r) => str(r.fields.code) === FX_GAINLOSS_ACCOUNT.code)) return;
  const v = accounts.hooks.validate({
    fields: { code: FX_GAINLOSS_ACCOUNT.code, name: FX_GAINLOSS_ACCOUNT.name, class: FX_GAINLOSS_ACCOUNT.type, currency: 'USD' },
  });
  if (!v.ok) return;
  const record = accounts.store.create({
    title: FX_GAINLOSS_ACCOUNT.code,
    fields: v.values,
    actor: 'system:gl-fx',
    now: ctx.now(),
  });
  ctx.emit(accounts, 'created', record);
}

/**
 * Ensure the UNREALIZED FX Gain/Loss P&L account (7811) exists before a
 * period-end revaluation posts (W6-B7) — the same lazy-ensure as the realized
 * 7810 account, kept separate so revaluation and its reversal never touch the
 * realized ledger.
 */
async function ensureUnrealizedFxAccount(ctx: EnterpriseModuleActionContext): Promise<void> {
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!accounts) return;
  await accounts.store.load();
  if (accounts.store.list().some((r) => str(r.fields.code) === FX_UNREALIZED_ACCOUNT.code)) return;
  const v = accounts.hooks.validate({
    fields: { code: FX_UNREALIZED_ACCOUNT.code, name: FX_UNREALIZED_ACCOUNT.name, class: FX_UNREALIZED_ACCOUNT.type, currency: 'USD' },
  });
  if (!v.ok) return;
  const record = accounts.store.create({
    title: FX_UNREALIZED_ACCOUNT.code,
    fields: v.values,
    actor: 'system:gl-fx-unrealized',
    now: ctx.now(),
  });
  ctx.emit(accounts, 'created', record);
}

/**
 * Create the derived entries as drafts and post each through the Journal
 * module's own action, so every guard, audit entry, timeline event, broadcast,
 * and account reconciliation applies exactly as if a human had done it. A
 * derived entry whose lines cannot validate (missing control account in a
 * customized chart) is skipped — recorded nowhere, retried on the next event.
 */
export async function applyGlDerivedEntries(
  entries: readonly GlDerivedEntry[],
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  if (entries.length === 0) return;
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  const accounts = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
  if (!journal || !accounts || !journal.hooks.runAction) return; // GL not wired — no-op
  await journal.store.load();
  await seedControlAccountsIfEmpty(accounts, ctx);
  for (const derived of entries) {
    const exists = journal.store
      .list()
      .some((r) => str(r.fields.entryNumber) === derived.entryNumber);
    if (exists) continue; // idempotency backstop (decisions already exclude these)
    const validated = journal.hooks.validate({
      fields: {
        entryNumber: derived.entryNumber,
        memo: derived.memo,
        entryDate: derived.entryDate ?? ctx.now().slice(0, 10),
        lines: JSON.stringify(derived.lines),
        status: 'draft',
        sourceModule: derived.sourceModule,
        sourceRef: derived.sourceRef,
      },
    });
    if (!validated.ok) continue; // unresolvable lines — nothing to record yet
    const draft = journal.store.create({
      title: derived.entryNumber,
      fields: validated.values,
      actor: 'system:gl-posting',
      now: ctx.now(),
    });
    ctx.emit(journal, 'created', draft);
    await journal.hooks.runAction('post', draft, ctx);
  }
}

/** The journal's current entries — numbers plus parsed lines (loaded). */
async function existingJournal(
  ctx: EnterpriseModuleActionContext,
): Promise<{ numbers: Set<string>; entries: { entryNumber: string; lines: GlJournalLine[] }[] }> {
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journal) return { numbers: new Set(), entries: [] };
  await journal.store.load();
  const entries = journal.store
    .list()
    .map((r) => {
      const view = glJournalEntryFromRecord(r);
      return { entryNumber: view.entryNumber, lines: view.lines };
    })
    .filter((e) => e.entryNumber.length > 0);
  return { numbers: new Set(entries.map((e) => e.entryNumber)), entries };
}

/**
 * Shared revocation + drift logic: on revocation, one cumulative `-REV` entry
 * mirrors EVERYTHING booked for the record (base + adjustments — never a stale
 * base-only mirror); while live, a delta `-ADJn` entry brings the books to the
 * record's current amounts. Both idempotent, both balanced by construction.
 */
function decideLifecycle(input: {
  live: boolean;
  revoked: boolean;
  baseEntryNumber: string;
  memoSubject: string;
  revokedReason: string;
  baseDecisions: GlDerivedEntry[];
  expectedLines: GlJournalLine[];
  journal: { numbers: Set<string>; entries: { entryNumber: string; lines: GlJournalLine[] }[] };
  sourceModule: string;
  sourceRef: string;
}): GlDerivedEntry[] {
  const { baseEntryNumber: base, journal } = input;
  if (input.revoked) {
    if (!journal.numbers.has(base) || journal.numbers.has(`${base}-REV`)) return [];
    return glDecideAdjustment({
      baseEntryNumber: base,
      memoSubject: input.memoSubject,
      expectedLines: [],
      existingEntries: journal.entries,
      sourceModule: input.sourceModule,
      sourceRef: input.sourceRef,
      entryNumber: `${base}-REV`,
      memo: `${input.revokedReason} — reversal of ${base}`,
    });
  }
  if (!input.live) return [];
  return [
    ...input.baseDecisions,
    ...glDecideAdjustment({
      baseEntryNumber: base,
      memoSubject: input.memoSubject,
      expectedLines: input.expectedLines,
      existingEntries: journal.entries,
      sourceModule: input.sourceModule,
      sourceRef: input.sourceRef,
    }),
  ];
}

/** Invoice lifecycle → derived GL work. Wired as the invoice module's onChange. */
export async function handleInvoiceChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journalModule = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journalModule) return; // GL not wired — no-op
  const invoice = invoiceFromRecord(event.record);
  const number = invoice.number.trim();
  const total = calculateInvoiceAmount(invoice);
  if (!number || total <= 0) return;
  // W6-B2 multi-currency: the GL always posts the FUNCTIONAL amount. Each
  // component is converted at the invoice's rate (default 1 → functional ==
  // original, so single-currency posting is byte-identical). Component-wise
  // rounding keeps Dr == Cr.
  const rate = invoice.exchangeRate > 0 ? invoice.exchangeRate : 1;
  const fxSubtotal = Math.round(Math.max(0, invoice.amount) * rate);
  const fxTax = Math.round(calculateTaxAmount(invoice) * rate);
  const fxTotal = fxSubtotal + fxTax;
  const deleted = event.record.status === 'deleted';
  const revoked = deleted || invoice.status === 'cancelled';
  const journal = await existingJournal(ctx);
  const decisions = decideLifecycle({
    live: !revoked && invoice.status !== 'draft',
    revoked,
    baseEntryNumber: glInvoiceEntryNumber(number),
    memoSubject: `Invoice ${number}`,
    revokedReason: deleted ? `Invoice ${number} deleted` : `Invoice ${number} cancelled`,
    baseDecisions: glDecideInvoicePostings({
      invoiceId: event.record.id,
      invoiceNumber: number,
      status: invoice.status,
      subtotal: fxSubtotal,
      taxAmount: fxTax,
      total: fxTotal,
      deleted,
      existingEntryNumbers: journal.numbers,
      sourceModule: event.record.moduleId,
    }),
    expectedLines: glInvoiceExpectedLines(fxSubtotal, fxTax, fxTotal),
    journal,
    sourceModule: event.record.moduleId,
    sourceRef: event.record.id,
  });
  await applyGlDerivedEntries(decisions, ctx);
}

/**
 * Vendor-bill lifecycle → derived GL work. Two independent legs, each with the
 * same idempotent base/adjust/reverse machinery: APPROVAL books
 * Dr Operating Expense (+ Dr GST Input Credit) / Cr Accounts Payable, and
 * SETTLEMENT books Dr Accounts Payable / Cr Cash. Cancellation or deletion
 * reverses whichever legs were booked, cumulatively.
 */
export async function handleVendorBillChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journalModule = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journalModule) return; // GL not wired — no-op
  const bill = vendorBillFromRecord(event.record);
  const number = bill.billNumber;
  if (!number || bill.total <= 0) return;
  const deleted = event.record.status === 'deleted';
  const revoked = deleted || bill.status === 'cancelled';
  const journal = await existingJournal(ctx);
  const revokedReason = deleted ? `Bill ${number} deleted` : `Bill ${number} cancelled`;

  const leg = (input: {
    live: boolean;
    base: string;
    memo: string;
    expected: GlJournalLine[];
  }): GlDerivedEntry[] =>
    decideLifecycle({
      live: input.live,
      revoked,
      baseEntryNumber: input.base,
      memoSubject: `Bill ${number}`,
      revokedReason,
      baseDecisions:
        input.live && !journal.numbers.has(input.base)
          ? [
              {
                entryNumber: input.base,
                memo: input.memo,
                lines: input.expected,
                sourceModule: event.record.moduleId,
                sourceRef: event.record.id,
              },
            ]
          : [],
      expectedLines: input.expected,
      journal,
      sourceModule: event.record.moduleId,
      sourceRef: event.record.id,
    });

  // W6-B8 multi-currency: the GL posts the FUNCTIONAL amount. Rate default 1 →
  // functional == original (single-currency byte-identical); component-wise
  // rounding keeps Dr == Cr, mirroring the invoice.
  const rate = bill.exchangeRate > 0 ? bill.exchangeRate : 1;
  const fxSubtotal = rate === 1 ? bill.amount : Math.round(bill.amount * rate);
  const fxTax = rate === 1 ? bill.taxAmount : Math.round(bill.taxAmount * rate);
  const fxTotal = rate === 1 ? bill.total : fxSubtotal + fxTax;
  // Since W1.11, SETTLEMENT is booked by Vendor Payments (JE-VPAY-*, one entry
  // per payment, partial-capable) — the bill carries only the approval leg.
  const decisions = leg({
    live: bill.status === 'approved' || bill.status === 'paid',
    base: glBillEntryNumber(number),
    memo: `Bill ${number} approved`,
    expected: glBillExpectedLines(fxSubtotal, fxTax, fxTotal),
  });
  await applyGlDerivedEntries(decisions, ctx);
}

/**
 * Vendor-payment lifecycle → derived GL work. A CLEARED payment books
 * Dr Accounts Payable / Cr Cash for ITS amount (partial settlements each carry
 * their own entry); void or deletion reverses; amount edits book ADJ deltas —
 * the same idempotent machinery as every other flow.
 */
export async function handleVendorPaymentChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journalModule = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journalModule) return; // GL not wired — no-op
  const payment = vendorPaymentFromRecord(event.record);
  const number = payment.paymentNumber;
  if (!number || payment.amount <= 0) return;
  const deleted = event.record.status === 'deleted';
  const revoked = deleted || payment.status === 'void';
  const journal = await existingJournal(ctx);
  const base = glVendorPaymentEntryNumber(number);
  // W6-B8 multi-currency settlement: clear AP in FUNCTIONAL at the bill's booking
  // rate, pay Cash in functional at the settlement rate, and book the realized
  // exchange difference to P&L. Single currency (both rates 1) → functionalSettled
  // === functionalBooked → the classic two-line entry, byte-identical.
  const billModule = ctx.moduleFor(VENDOR_BILLS_MODULE_ID);
  let bookingRate = 1;
  if (billModule) {
    await billModule.store.load();
    const billRecord =
      billModule.store.get(payment.billRef) ??
      billModule.store.list().find((r) => str(r.fields.billNumber) === payment.billRef) ??
      null;
    if (billRecord && billRecord.status !== 'deleted') bookingRate = vendorBillFromRecord(billRecord).exchangeRate;
  }
  const settlementRate = payment.exchangeRate > 0 ? payment.exchangeRate : 1;
  const functionalSettled = Math.round(payment.amount * settlementRate);
  const functionalBooked = Math.round(payment.amount * bookingRate);
  const expected = realizedPayableFxLines({
    functionalSettled,
    functionalBooked,
    cashCode: GL_CONTROL_ACCOUNTS.cash.code,
    payableCode: GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code,
    fxCode: FX_GAINLOSS_ACCOUNT.code,
  });
  if (expected.length > 2) await ensureFxAccount(ctx); // realized FX difference → 7810 must exist
  const decisions = decideLifecycle({
    live: !revoked && payment.status === 'cleared',
    revoked,
    baseEntryNumber: base,
    memoSubject: `Vendor payment ${number}`,
    revokedReason: deleted ? `Vendor payment ${number} deleted` : `Vendor payment ${number} voided`,
    baseDecisions:
      !revoked && payment.status === 'cleared' && !journal.numbers.has(base)
        ? [
            {
              entryNumber: base,
              memo: `Vendor payment ${number} cleared — bill ${payment.billRef}`,
              lines: expected,
              sourceModule: event.record.moduleId,
              sourceRef: event.record.id,
            },
          ]
        : [],
    expectedLines: expected,
    journal,
    sourceModule: event.record.moduleId,
    sourceRef: event.record.id,
  });
  await applyGlDerivedEntries(decisions, ctx);
}

/** Payment lifecycle → derived GL work. Called from the payment module's onChange. */
export async function handlePaymentChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journalModule = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journalModule) return; // GL not wired — no-op
  const payment = paymentFromRecord(event.record);
  const number = payment.paymentNumber.trim();
  if (!number || payment.amount <= 0) return;
  // W6-B4 multi-currency settlement: clear AR in FUNCTIONAL at the invoice's
  // booking rate, receive Cash in functional at the settlement rate, and book
  // the realized exchange difference to P&L. Single currency (both rates 1) →
  // functionalSettled === functionalBooked → the classic two-line entry, so
  // existing behavior is byte-identical.
  const finance = ctx.moduleFor(FINANCE_MODULE_ID);
  let bookingRate = 1;
  if (finance) {
    await finance.store.load();
    const invRecord =
      finance.store.get(payment.invoiceRef) ??
      finance.store.list().find((r) => str(r.fields.number) === payment.invoiceRef) ??
      null;
    if (invRecord && invRecord.status !== 'deleted') bookingRate = invoiceFromRecord(invRecord).exchangeRate;
  }
  const settlementRate = payment.exchangeRate > 0 ? payment.exchangeRate : 1;
  const functionalSettled = Math.round(payment.amount * settlementRate);
  const functionalBooked = Math.round(payment.amount * bookingRate);
  const fxLines = realizedReceivableFxLines({
    functionalSettled,
    functionalBooked,
    cashCode: GL_CONTROL_ACCOUNTS.cash.code,
    receivableCode: GL_CONTROL_ACCOUNTS.accountsReceivable.code,
    fxCode: FX_GAINLOSS_ACCOUNT.code,
  });
  if (fxLines.length > 2) await ensureFxAccount(ctx); // realized FX difference → 7810 must exist
  const deleted = event.record.status === 'deleted';
  const revoked = deleted || payment.status === 'void';
  const journal = await existingJournal(ctx);
  const decisions = decideLifecycle({
    live: !revoked && payment.status === 'cleared',
    revoked,
    baseEntryNumber: glPaymentEntryNumber(number),
    memoSubject: `Payment ${number}`,
    revokedReason: deleted ? `Payment ${number} deleted` : `Payment ${number} voided`,
    baseDecisions: glDecidePaymentPostings({
      paymentId: event.record.id,
      paymentNumber: number,
      status: payment.status,
      amount: payment.amount,
      deleted,
      existingEntryNumbers: journal.numbers,
      sourceModule: event.record.moduleId,
      lines: fxLines,
    }),
    expectedLines: fxLines,
    journal,
    sourceModule: event.record.moduleId,
    sourceRef: event.record.id,
  });
  await applyGlDerivedEntries(decisions, ctx);
}

/**
 * FX revaluation lifecycle → derived GL work (W6-B7). A generated revaluation
 * record posts TWO real journal entries through the same idempotent seam: the
 * period-end revaluation (Dr/Cr AR vs 7811) dated the period end, and its exact
 * reversal dated the first day of the next period — so the unrealized difference
 * is recognised at close and unwound as the next period opens (IAS 21). The
 * record's stored deltas drive the lines; deterministic entry numbers mean a
 * re-fired change never double-posts. A zero-exposure revaluation posts nothing.
 */
export async function handleFxRevaluationChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journalModule = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journalModule) return; // GL not wired — no-op
  if (event.record.status === 'deleted') return; // immutable snapshot — no auto-reversal in this increment
  const f = event.record.fields;
  const revalLines = unrealizedRevaluationLines({
    receivableDelta: Number(f.receivableDelta ?? 0),
    payableDelta: Number(f.payableDelta ?? 0),
    receivableCode: GL_CONTROL_ACCOUNTS.accountsReceivable.code,
    payableCode: GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code,
    fxCode: FX_UNREALIZED_ACCOUNT.code,
  });
  if (revalLines.length === 0) return; // no FX exposure — nothing to post
  await ensureUnrealizedFxAccount(ctx);
  const period = str(f.period);
  const entries: GlDerivedEntry[] = [
    {
      entryNumber: str(f.revalEntryNumber),
      memo: `Unrealized FX revaluation ${period}`,
      entryDate: str(f.revalDate),
      lines: revalLines,
      sourceModule: event.record.moduleId,
      sourceRef: event.record.id,
    },
    {
      entryNumber: str(f.reversalEntryNumber),
      memo: `Reversal of unrealized FX revaluation ${period}`,
      entryDate: str(f.reversalDate),
      lines: reverseFxLines(revalLines),
      sourceModule: event.record.moduleId,
      sourceRef: event.record.id,
    },
  ];
  await applyGlDerivedEntries(entries, ctx);
}
