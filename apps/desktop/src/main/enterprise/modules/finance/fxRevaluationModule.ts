/**
 * Finance → Unrealized FX Revaluation — immutable period-end revaluation
 * statements that BOOK real, reversing journal entries (W6-B7). CRUD (generate +
 * read), RBAC (`operations:read` / `operations:manage` — the Finance family's
 * certified scopes), audit, timeline, search, offline persistence, and the UI
 * are all inherited.
 *
 * CREATING a revaluation generates it: validate reads the injected Invoices +
 * Exchange Rates + Accounting Periods stores, refuses a CLOSED period (period
 * lock) and a duplicate period, revalues every open foreign-currency receivable
 * at the period-end rate through the pure `deriveReceivableRevaluation`, and
 * stamps the aggregate deltas + a per-document audit trail. The record's
 * `onChange` then posts TWO real journal entries through the certified
 * auto-posting seam: the revaluation (Dr/Cr AR vs 7811) dated the period end,
 * and its exact reversal dated the first day of the next period (IAS 21). A
 * generated statement is immutable (the W1 snapshot marker).
 *
 * Functional currency stays the source of truth; single-currency books never
 * revalue (nothing is denominated in a non-functional currency), so existing
 * behaviour is untouched. Electron-free (store paths injected) for unit testing.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  FX_FUNCTIONAL_CURRENCY,
  FX_REVALUATION_MODULE_ID,
  FX_REVALUATION_KIND,
  GL_CONTROL_ACCOUNTS,
  deriveCashRevaluation,
  derivePayableRevaluation,
  deriveReceivableRevaluation,
  exchangeRateFromRecord,
  glAccountForeignTotals,
  glAccountFromRecord,
  glFxRevaluationEntryNumber,
  glJournalEntryFromRecord,
  glNextPeriodKey,
  glPeriodBounds,
  glPeriodFromRecord,
  invoiceFromRecord,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { handleFxRevaluationChangeForGl } from './glPosting';

/** The declarative description of an FX revaluation — drives store, CRUD, and the UI. */
export const FX_REVALUATION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FX_REVALUATION_MODULE_ID,
  title: 'FX Revaluation',
  singular: 'FX Revaluation',
  plural: 'FX Revaluations',
  icon: 'refresh-cw',
  description:
    'Immutable period-end revaluation of open foreign-currency receivables at the period-end rate — books a real unrealized gain/loss to 7811 that reverses on the first day of the next period (IAS 21).',
  group: 'Finance',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Revaluation #', type: 'text', readOnly: true },
    { key: 'period', label: 'Period', type: 'text', placeholder: 'YYYY-MM — defaults to current month' },
    { key: 'revalDate', label: 'Revalued At', type: 'text', readOnly: true, column: false },
    { key: 'reversalDate', label: 'Reverses On', type: 'text', readOnly: true, column: false },
    { key: 'functionalCurrency', label: 'Functional Ccy', type: 'text', readOnly: true, column: false },
    { key: 'receivableDelta', label: 'AR Adjustment', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'payableDelta', label: 'AP Adjustment', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'cashDelta', label: 'Cash Adjustment', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'unrealizedGainLoss', label: 'Unrealized G/L', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'revaluedCount', label: 'Items Revalued', type: 'number', readOnly: true, default: 0 },
    { key: 'skippedNoRate', label: 'Skipped (no rate)', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'items', label: 'Audit Trail', type: 'textarea', readOnly: true, column: false },
    { key: 'cashItems', label: 'Cash Audit Trail', type: 'textarea', readOnly: true, column: false },
    { key: 'revalEntryNumber', label: 'Revaluation JE', type: 'text', readOnly: true, column: false },
    { key: 'reversalEntryNumber', label: 'Reversal JE', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const money = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Build the FX Revaluation module. The Invoices + Exchange Rates + Accounting
 * Periods stores (and, W6-B9, the Vendor Bills store) are injected so generation
 * revalues the real open receivables AND payables at real registered rates and
 * honours the period lock. `vendorBillStore` is optional so the receivables-only
 * unit tests still construct the module with no payables source.
 */
export function createFxRevaluationModule(
  storePath: string,
  invoiceStore: EnterpriseRecordStore,
  exchangeRateStore: EnterpriseRecordStore,
  accountingPeriodStore: EnterpriseRecordStore,
  vendorBillStore?: EnterpriseRecordStore,
  accountStore?: EnterpriseRecordStore,
  journalStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FX_REVALUATION_MODULE_ID, FX_REVALUATION_KIND);
  return defineEnterpriseModule({
    descriptor: FX_REVALUATION_DESCRIPTOR,
    store,
    hooks: {
      // Creating a revaluation IS generating it; a generated revaluation is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(FX_REVALUATION_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'FX revaluations are immutable snapshots — generate a new revaluation instead.' },
            values: result.values,
          };
        }
        const period = str(result.values.period).trim() || new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
          return { ok: false, errors: { period: 'Period must be a month in YYYY-MM form.' }, values: result.values };
        }
        // Period lock: a closed period cannot be revalued (reopen it first).
        const periodRecord = accountingPeriodStore.list().map(glPeriodFromRecord).find((p) => p.periodKey === period);
        if (periodRecord && periodRecord.closed) {
          return { ok: false, errors: { period: `Period ${period} is closed — reopen it before revaluing.` }, values: result.values };
        }
        // One generated revaluation per period (its entries are idempotent regardless).
        if (store.list().some((r) => str(r.fields.period) === period && str(r.fields.generatedAt))) {
          return { ok: false, errors: { period: `Period ${period} is already revalued — reverse or reopen to redo.` }, values: result.values };
        }

        const revalDate = glPeriodBounds(period).endDate;
        const reversalDate = glPeriodBounds(glNextPeriodKey(period)).startDate;
        const rates = exchangeRateStore.list().map(exchangeRateFromRecord);
        const invoices = invoiceStore.list().filter((r) => r.status !== 'deleted').map(invoiceFromRecord);
        const reval = deriveReceivableRevaluation({ invoices, rates, asOfDate: revalDate, functionalCurrency: FX_FUNCTIONAL_CURRENCY });
        const bills = vendorBillStore
          ? vendorBillStore.list().filter((r) => r.status !== 'deleted').map(vendorBillFromRecord)
          : [];
        const payable = derivePayableRevaluation({ bills, rates, asOfDate: revalDate, functionalCurrency: FX_FUNCTIONAL_CURRENCY });
        // W6-C1: revalue foreign CASH/bank accounts from their own-currency balances,
        // derived straight from the posted ledger (single source of truth). Needs both the
        // accounts + journal stores; without them (receivables-only unit tests) cash is empty.
        const cashAccounts: Array<{ account: string; currency: string; foreignBalance: number; functionalBalance: number }> = [];
        if (accountStore && journalStore) {
          const posted = journalStore
            .list()
            .filter((r) => r.status !== 'deleted')
            .map(glJournalEntryFromRecord)
            .filter((e) => e.posted);
          for (const rec of accountStore.list()) {
            if (rec.status === 'deleted') continue;
            const account = glAccountFromRecord(rec);
            const tag = str(rec.fields.cashFlowCategory).trim().toLowerCase();
            // Cash-account test mirrors the certified cashFlowModule: an explicit 'cash'
            // tag, or the seeded cash control (1000) when untagged/auto.
            const isCash = tag === 'cash' || ((tag === '' || tag === 'auto') && account.code === GL_CONTROL_ACCOUNTS.cash.code);
            if (!isCash) continue;
            const currency = (account.currency || FX_FUNCTIONAL_CURRENCY).toUpperCase();
            if (currency === FX_FUNCTIONAL_CURRENCY) continue; // only foreign cash carries FX exposure
            cashAccounts.push({
              account: account.code,
              currency,
              foreignBalance: glAccountForeignTotals(account.code, posted).balance,
              functionalBalance: account.balance,
            });
          }
        }
        const cash = deriveCashRevaluation({ accounts: cashAccounts, rates, asOfDate: revalDate, functionalCurrency: FX_FUNCTIONAL_CURRENCY });
        const revaluedCount = reval.revaluedCount + payable.revaluedCount + cash.revaluedCount;
        const skippedNoRate = reval.skippedNoRate + payable.skippedNoRate + cash.skippedNoRate;
        const combinedGl = Math.round((reval.unrealizedGainLoss + payable.unrealizedGainLoss + cash.unrealizedGainLoss) * 100) / 100;
        const priorCount = store.list().filter((r) => str(r.fields.period) === period).length;

        result.values.period = period;
        result.values.reportNumber = `FXR-${period}-${priorCount + 1}`;
        result.values.revalDate = revalDate;
        result.values.reversalDate = reversalDate;
        result.values.functionalCurrency = FX_FUNCTIONAL_CURRENCY;
        result.values.receivableDelta = reval.receivableDelta;
        result.values.payableDelta = payable.payableDelta;
        result.values.cashDelta = cash.cashDelta;
        result.values.unrealizedGainLoss = combinedGl;
        result.values.revaluedCount = revaluedCount;
        result.values.skippedNoRate = skippedNoRate;
        result.values.items = JSON.stringify([...reval.items, ...payable.items]);
        result.values.cashItems = JSON.stringify(cash.items);
        result.values.revalEntryNumber = glFxRevaluationEntryNumber(period);
        result.values.reversalEntryNumber = `${glFxRevaluationEntryNumber(period)}-REV`;
        result.values.note =
          revaluedCount === 0
            ? skippedNoRate > 0
              ? `${skippedNoRate} open foreign-currency item(s) had no ${period}-end rate — none revalued; add period-end rates and regenerate`
              : `no open foreign-currency receivables, payables or cash — nothing to revalue for ${period}`
            : `revalued ${reval.revaluedCount} receivable(s) + ${payable.revaluedCount} payable(s) + ${cash.revaluedCount} cash account(s) at the ${period}-end rate; unrealized ` +
              `${combinedGl >= 0 ? 'gain' : 'loss'} ${money(Math.abs(combinedGl))} posts to 7811 and reverses on ${reversalDate}` +
              (skippedNoRate > 0 ? `; ${skippedNoRate} skipped (no ${period}-end rate)` : '') +
              '.';
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      // A generated revaluation books its revaluation + reversing entries through
      // the certified auto-posting seam (a no-op when the GL is not wired).
      onChange: async (event, ctx) => {
        await handleFxRevaluationChangeForGl(event, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const gl = Number(f.unrealizedGainLoss ?? 0);
        const revalued = Number(f.revaluedCount ?? 0);
        const skipped = Number(f.skippedNoRate ?? 0);
        return {
          moduleId: FX_REVALUATION_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · unrealized ${gl >= 0 ? 'gain' : 'loss'} ${money(Math.abs(gl))} · ${revalued} item(s)`,
          summary:
            `Period ${str(f.period)} revalued at ${str(f.revalDate)}: AR adjustment ${money(Number(f.receivableDelta ?? 0))}, ` +
            `unrealized gain/loss ${money(gl)} to 7811, reversing ${str(f.reversalDate)}. ${str(f.note)}.`,
          risk: skipped > 0 ? 'medium' : 'low',
          riskReason:
            skipped > 0
              ? 'Some open FX receivables had no period-end rate and were not revalued — the exposure is understated until rates are added.'
              : 'Every open FX receivable was revalued against a real period-end rate; the entry reverses next period.',
          executiveExplanation:
            'Open foreign-currency receivables are remeasured at the period-end rate; the unrealized difference is booked to a separate P&L account and automatically reversed as the next period opens, so it is never double-counted when the invoice is later paid.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
