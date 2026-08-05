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
  GL_CONTROL_ACCOUNTS,
  JOURNAL_ENTRIES_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  calculateInvoiceAmount,
  calculateTaxAmount,
  invoiceFromRecord,
  paymentFromRecord,
  type GlDerivedEntry,
  glDecideInvoicePostings,
  glDecidePaymentPostings,
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
  for (const control of Object.values(GL_CONTROL_ACCOUNTS)) {
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
 * Create the derived entries as drafts and post each through the Journal
 * module's own action, so every guard, audit entry, timeline event, broadcast,
 * and account reconciliation applies exactly as if a human had done it. A
 * derived entry whose lines cannot validate (missing control account in a
 * customized chart) is skipped — recorded nowhere, retried on the next event.
 */
async function applyDerivedEntries(
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
        entryDate: ctx.now().slice(0, 10),
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

/** The set of auto-entry numbers already in the journal (loaded). */
async function existingEntryNumbers(ctx: EnterpriseModuleActionContext): Promise<Set<string>> {
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journal) return new Set();
  await journal.store.load();
  return new Set(journal.store.list().map((r) => str(r.fields.entryNumber)).filter(Boolean));
}

/** Invoice lifecycle → derived GL work. Wired as the invoice module's onChange. */
export async function handleInvoiceChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journal) return; // GL not wired — no-op
  const invoice = invoiceFromRecord(event.record);
  const decisions = glDecideInvoicePostings({
    invoiceId: event.record.id,
    invoiceNumber: invoice.number,
    status: invoice.status,
    subtotal: invoice.amount,
    taxAmount: calculateTaxAmount(invoice),
    total: calculateInvoiceAmount(invoice),
    deleted: event.record.status === 'deleted',
    existingEntryNumbers: await existingEntryNumbers(ctx),
    sourceModule: event.record.moduleId,
  });
  await applyDerivedEntries(decisions, ctx);
}

/** Payment lifecycle → derived GL work. Called from the payment module's onChange. */
export async function handlePaymentChangeForGl(
  event: { record: EnterpriseEntity },
  ctx: EnterpriseModuleActionContext,
): Promise<void> {
  const journal = ctx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
  if (!journal) return; // GL not wired — no-op
  const payment = paymentFromRecord(event.record);
  const decisions = glDecidePaymentPostings({
    paymentId: event.record.id,
    paymentNumber: payment.paymentNumber,
    status: payment.status,
    amount: payment.amount,
    deleted: event.record.status === 'deleted',
    existingEntryNumbers: await existingEntryNumbers(ctx),
    sourceModule: event.record.moduleId,
  });
  await applyDerivedEntries(decisions, ctx);
}
