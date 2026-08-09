/**
 * Finance → Journal — the General Ledger's double-entry journal, on the
 * Enterprise Module Framework like every other module: a descriptor + the
 * framework's record store + a `validate` hook + `post`/`reverse` record actions
 * + an `onChange` reconciler + a deterministic `summarize`. CRUD, RBAC
 * (`operations:read` / `operations:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * The POSTING ENGINE rule is the ErpCore rule (packages/business/src/erp.ts),
 * enforced at the module layer via the shared GL logic: a posting is rejected
 * unless cents-rounded debits === credits, and every line must resolve to
 * exactly one Chart-of-Accounts record. Journal records are the SOURCE OF
 * TRUTH; on every change the `onChange` hook re-derives the referenced
 * accounts' debit/credit totals and balances from the POSTED ledger (no
 * duplicated state, drift-free by construction). Posted entries are immutable —
 * corrections happen by posting a reversing entry (`reverse` creates the
 * mirrored draft). DETERMINISTIC throughout; the AI only explains.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  GlJournalLine,
} from '@neuropause/shared';
import {
  ACCOUNTING_PERIODS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  JOURNAL_ENTRY_KIND,
  LEDGER_ACCOUNTS_MODULE_ID,
  formatGlAmount,
  glAccountBalance,
  glAccountFromRecord,
  glAccountLedgerTotals,
  glDateInClosedPeriod,
  glJournalEntryFromRecord,
  glJournalSummaryFallback,
  glJournalTotals,
  glPeriodFromRecord,
  glPeriodKeyForDate,
  isBalancedGlJournal,
  parseGlJournalLines,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';

/** The declarative description of a journal entry — drives store, CRUD, and the UI. */
export const JOURNAL_ENTRY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: JOURNAL_ENTRIES_MODULE_ID,
  title: 'Journal',
  singular: 'Journal Entry',
  plural: 'Journal Entries',
  icon: 'database',
  description: 'Double-entry journal — post balanced entries against the Chart of Accounts.',
  group: 'Finance',
  titleField: 'entryNumber',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'post', label: 'Post', icon: 'upload' },
    { key: 'reverse', label: 'Reverse', icon: 'refresh' },
  ],
  fields: [
    { key: 'entryNumber', label: 'Entry #', type: 'text', required: true, placeholder: 'JE-0001' },
    { key: 'memo', label: 'Memo', type: 'text', placeholder: 'What this entry records' },
    { key: 'entryDate', label: 'Date', type: 'date', format: 'date' },
    {
      key: 'lines',
      label: 'Lines (JSON)',
      type: 'textarea',
      required: true,
      column: false,
      help: 'JSON array: [{"account":"1000","debit":100,"credit":0},{"account":"4000","debit":0,"credit":100}]',
      placeholder: '[{"account":"1000","debit":100,"credit":0}]',
    },
    { key: 'totalDebits', label: 'Debits', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalCredits', label: 'Credits', type: 'number', readOnly: true, format: 'currency', default: 0 },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'posted', label: 'Posted', tone: 'green' },
      ],
    },
    { key: 'postedAt', label: 'Posted At', type: 'text', readOnly: true, column: false },
    { key: 'sourceModule', label: 'Source Module', type: 'text', readOnly: true, column: false },
    { key: 'sourceRef', label: 'Source Ref', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Non-deleted accounts holding a code (the journal's foreign key). */
function accountsForCode(accountStore: EnterpriseRecordStore, code: string): EnterpriseEntity[] {
  return accountStore.list().filter((r) => str(r.fields.code).trim() === code);
}

/**
 * Resolve every line's account code against the Chart of Accounts. Returns the
 * error map (empty when all resolve to exactly one account each).
 */
function resolveLineAccounts(
  accountStore: EnterpriseRecordStore,
  lines: readonly GlJournalLine[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].account;
    const holders = accountsForCode(accountStore, code);
    if (holders.length === 0) {
      errors.lines = `Line ${i + 1}: no ledger account has code "${code}".`;
      break;
    }
    if (holders.length > 1) {
      errors.lines = `Line ${i + 1}: account code "${code}" is ambiguous (${holders.length} accounts share it) — fix the Chart of Accounts first.`;
      break;
    }
  }
  return errors;
}

/**
 * Build the Journal module. `accountStore` is injected so line validation can
 * resolve account codes (same pattern as Payments ← invoice store). The
 * `onChange` reconciler re-derives account totals from the posted ledger.
 */
export function createJournalEntryModule(
  storePath: string,
  accountStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, JOURNAL_ENTRIES_MODULE_ID, JOURNAL_ENTRY_KIND);

  /** Every posted, non-deleted entry — the ledger the balances derive from. */
  function postedLedger() {
    return store
      .list()
      .map(glJournalEntryFromRecord)
      .filter((e) => e.posted);
  }

  /**
   * Re-derive debit/credit totals + balance for every account the ledger (or
   * this change) touches, and persist them through the accounts module so the
   * update is audited and broadcast like any other change. Full recompute —
   * idempotent, so a reversal, delete, or repost can never leave drift.
   */
  async function reconcileAccounts(
    touchedCodes: readonly string[],
    ctx: EnterpriseModuleActionContext,
  ): Promise<void> {
    const accountsModule = ctx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
    if (!accountsModule) return;
    await accountsModule.store.load();
    const ledger = postedLedger();
    const codes = new Set<string>(touchedCodes);
    for (const e of ledger) for (const l of e.lines) codes.add(l.account);
    for (const code of codes) {
      const holders = accountsForCode(accountsModule.store, code);
      if (holders.length !== 1) continue; // unresolved/ambiguous codes never receive totals
      const record = holders[0];
      const account = glAccountFromRecord(record);
      const totals = glAccountLedgerTotals(code, ledger);
      const balance = glAccountBalance(account.normalBalance, totals.debitTotal, totals.creditTotal);
      const unchanged =
        account.debitTotal === totals.debitTotal &&
        account.creditTotal === totals.creditTotal &&
        account.balance === balance;
      if (unchanged) continue;
      const updated = accountsModule.store.update(record.id, {
        fields: { debitTotal: totals.debitTotal, creditTotal: totals.creditTotal, balance },
        actor: ctx.actor(),
        now: ctx.now(),
      });
      if (updated) ctx.emit(accountsModule, 'updated', updated);
    }
  }

  return defineEnterpriseModule({
    descriptor: JOURNAL_ENTRY_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic guards: parseable lines, every code resolves to exactly one
      // account, totals stamped, status derived (posted ⇔ postedAt), and posted
      // entries immutable. Balance is NOT required on a draft — posting enforces
      // it (kernel parity: entries may exist unbalanced; `post` rejects them).
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(JOURNAL_ENTRY_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};

        // postedAt is stamped exclusively by the `post` action (which bypasses
        // this hook by design). Reaching validate WITH a postedAt therefore means
        // an edit of a posted entry (or a forged create) — both are refused.
        if (str(result.values.postedAt)) {
          return {
            ok: false,
            errors: { _: 'Posted entries are immutable — post a reversing entry instead.' },
            values: result.values,
          };
        }
        result.values.status = 'draft'; // derived, never user-forged

        const parsed = parseGlJournalLines(str(result.values.lines));
        if (!parsed.ok) {
          errors.lines = parsed.error;
        } else {
          Object.assign(errors, resolveLineAccounts(accountStore, parsed.lines));
          const totals = glJournalTotals(parsed.lines);
          result.values.totalDebits = totals.debits;
          result.values.totalCredits = totals.credits;
          result.values.lines = JSON.stringify(parsed.lines);
        }

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // Reconcile on every lifecycle change: create/update keep drafts out of the
      // ledger (recompute is a no-op unless posted entries changed), and a delete
      // or reversal of a posted entry re-derives every touched account.
      onChange: async (event, ctx) => {
        const entry = glJournalEntryFromRecord(event.record);
        await reconcileAccounts(entry.lines.map((l) => l.account), ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const entry = glJournalEntryFromRecord(record);
        const fallback = glJournalSummaryFallback(entry);
        const balanced = isBalancedGlJournal({ debits: entry.totalDebits, credits: entry.totalCredits });
        return {
          moduleId: JOURNAL_ENTRIES_MODULE_ID,
          recordId: record.id,
          headline: `${entry.entryNumber} · ${entry.posted ? 'Posted' : 'Draft'} · ${formatGlAmount(entry.totalDebits, 'Dr')} / ${formatGlAmount(entry.totalCredits, 'Cr')}`,
          summary: fallback.summary,
          risk: balanced ? 'low' : 'medium',
          riskReason: balanced
            ? 'Debits equal credits.'
            : 'Debits do not equal credits — this entry cannot be posted until balanced.',
          executiveExplanation: fallback.executiveExplanation,
          grounded: false,
          model: 'none',
        };
      },
      // Lifecycle actions — post / reverse. Each applies a real, guarded
      // deterministic transition; illegal transitions return a message, never a
      // write (the invoice-module convention).
      runAction: async (action, record, actionCtx) => {
        const entry = glJournalEntryFromRecord(record);

        if (action === 'post') {
          if (entry.posted) return { ok: false, message: `${entry.entryNumber} is already posted.` };
          const parsed = parseGlJournalLines(str(record.fields.lines));
          if (!parsed.ok) return { ok: false, error: parsed.error };
          const accountsModule = actionCtx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
          if (!accountsModule) return { ok: false, error: 'Chart of Accounts is unavailable.' };
          await accountsModule.store.load();
          const unresolved = resolveLineAccounts(accountsModule.store, parsed.lines);
          if (unresolved.lines) return { ok: false, error: unresolved.lines };
          const totals = glJournalTotals(parsed.lines);
          if (!isBalancedGlJournal(totals)) {
            // The ErpCore rejection, verbatim semantics.
            return {
              ok: false,
              message: `Unbalanced entry: debits ${totals.debits} != credits ${totals.credits}.`,
            };
          }
          // Close guard: the booked date (entryDate, stamped to today when empty)
          // must not fall in a CLOSED accounting period. A month with no period
          // record is auto-created OPEN so the guard is visible, never implicit.
          const bookedDate = str(record.fields.entryDate) || actionCtx.now().slice(0, 10);
          const periodsModule = actionCtx.moduleFor(ACCOUNTING_PERIODS_MODULE_ID);
          if (periodsModule) {
            await periodsModule.store.load();
            const periods = periodsModule.store.list().map(glPeriodFromRecord);
            if (glDateInClosedPeriod(bookedDate, periods)) {
              // A closed period is a POLICY conflict, not a validation error:
              // no privilege makes it correct to post into a closed month.
              // Declaring it as such raises a durable hold rather than an
              // error string that vanishes with the dialog.
              const periodKey = glPeriodKeyForDate(bookedDate);
              return {
                ok: false,
                message: `Period ${periodKey} is closed — reopen it or move the entry date.`,
                policy: {
                  name: 'the accounting period close',
                  facts: [
                    `Entry ${record.title} is dated ${bookedDate}, which falls in ${periodKey}.`,
                    `Period ${periodKey} is closed.`,
                  ],
                  resolution: `Move the entry into an open period, or have finance reopen ${periodKey}.`,
                },
              };
            }
            const key = glPeriodKeyForDate(bookedDate);
            if (key && !periods.some((p) => p.periodKey === key)) {
              const v = periodsModule.hooks.validate({ fields: { periodKey: key } });
              if (v.ok) {
                const createdPeriod = periodsModule.store.create({
                  title: key,
                  fields: v.values,
                  actor: 'system:gl-periods',
                  now: actionCtx.now(),
                });
                actionCtx.emit(periodsModule, 'created', createdPeriod);
              }
            }
          }
          const updated = store.update(record.id, {
            fields: {
              postedAt: actionCtx.now(),
              entryDate: bookedDate,
              status: 'posted',
              totalDebits: totals.debits,
              totalCredits: totals.credits,
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Journal entry not found.' };
          const self = actionCtx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
          if (self) actionCtx.emit(self, 'updated', updated);
          await reconcileAccounts(parsed.lines.map((l) => l.account), actionCtx);
          return { ok: true, message: `Journal entry ${entry.entryNumber} posted (balanced ${totals.debits}).` };
        }

        if (action === 'reverse') {
          if (!entry.posted) {
            return { ok: false, message: 'Only a posted entry can be reversed — edit the draft instead.' };
          }
          const reversalNumber = `${entry.entryNumber}-REV`;
          const exists = store
            .list()
            .some((r) => str(r.fields.entryNumber) === reversalNumber);
          if (exists) {
            return { ok: false, message: `${reversalNumber} already exists — post or delete it first.` };
          }
          const mirrored = entry.lines.map((l) => ({
            account: l.account,
            debit: l.credit,
            credit: l.debit,
            ...(l.memo ? { memo: l.memo } : {}),
          }));
          const totals = glJournalTotals(mirrored);
          const created = store.create({
            title: reversalNumber,
            fields: {
              entryNumber: reversalNumber,
              memo: `Reversal of ${entry.entryNumber}${entry.memo ? ` — ${entry.memo}` : ''}`,
              entryDate: actionCtx.now().slice(0, 10),
              lines: JSON.stringify(mirrored),
              totalDebits: totals.debits,
              totalCredits: totals.credits,
              status: 'draft',
              postedAt: '',
              sourceModule: JOURNAL_ENTRIES_MODULE_ID,
              sourceRef: record.id,
              notes: '',
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const self = actionCtx.moduleFor(JOURNAL_ENTRIES_MODULE_ID);
          if (self) actionCtx.emit(self, 'created', created);
          return {
            ok: true,
            message: `Reversal ${reversalNumber} drafted — review and post it to take effect.`,
          };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
