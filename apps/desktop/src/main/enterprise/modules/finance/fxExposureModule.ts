/**
 * Finance → FX Exposure — immutable point-in-time exposure snapshots over the open
 * foreign-currency book (W6-C2). CRUD (generate + read), RBAC (`operations:read` /
 * `operations:manage` — the Finance family's certified scopes), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * CREATING a snapshot generates it: validate reads the injected Invoices + Vendor
 * Bills + Exchange Rates stores (and derives foreign cash/bank balances from the
 * Ledger Accounts + Journal, mirroring the cash revaluation), then runs the pure
 * `deriveFxExposure` as of the report date. It records the netted exposure by
 * currency plus the per-customer (AR) and per-vendor (AP) breakdowns, each marked
 * to the latest registered rate, with the unrealized difference. Read-only: a
 * snapshot books NO journal entries (unlike the revaluation) — it explains the
 * position at risk, it does not change the accounts. A generated snapshot is
 * immutable (the W1 snapshot marker); the snapshot sequence is the exposure trend.
 *
 * Functional currency stays the source of truth; a single-currency book has no
 * foreign positions, so a snapshot is simply empty. Electron-free (store paths
 * injected) for unit testing.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  FxCashPosition,
} from '@neuropause/shared';
import {
  FX_EXPOSURE_MODULE_ID,
  FX_EXPOSURE_KIND,
  FX_FUNCTIONAL_CURRENCY,
  GL_CONTROL_ACCOUNTS,
  deriveFxExposure,
  exchangeRateFromRecord,
  glAccountForeignTotals,
  glAccountFromRecord,
  glJournalEntryFromRecord,
  invoiceFromRecord,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of an FX exposure snapshot — drives store, CRUD, and the UI. */
export const FX_EXPOSURE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FX_EXPOSURE_MODULE_ID,
  title: 'FX Exposure',
  singular: 'FX Exposure',
  plural: 'FX Exposures',
  icon: 'globe',
  description:
    'Immutable point-in-time foreign-currency exposure — open receivables + cash − payables netted by currency and marked to the latest rate, with per-customer and per-vendor breakdowns and the unrealized difference. Read-only: it books no journal entries.',
  group: 'Finance',
  titleField: 'reportNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'reportNumber', label: 'Exposure #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'text', placeholder: 'YYYY-MM-DD — defaults to today' },
    { key: 'functionalCurrency', label: 'Functional Ccy', type: 'text', readOnly: true, column: false },
    { key: 'currencyCount', label: 'Currencies', type: 'number', readOnly: true, default: 0 },
    { key: 'totalFunctionalCurrent', label: 'Exposure (Functional)', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'totalFunctionalBooked', label: 'Booked (Functional)', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'totalUnrealizedDelta', label: 'Unrealized', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'skippedNoRate', label: 'Skipped (no rate)', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'byCurrency', label: 'By Currency', type: 'textarea', readOnly: true, column: false },
    { key: 'byCustomer', label: 'By Customer', type: 'textarea', readOnly: true, column: false },
    { key: 'byVendor', label: 'By Vendor', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'textarea', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
const money = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * Build the FX Exposure module. The Invoices + Vendor Bills + Exchange Rates stores
 * feed the open AR/AP positions and the marking rates; the Ledger Accounts + Journal
 * stores let the snapshot derive foreign cash/bank balances straight from the posted
 * ledger (single source of truth), exactly as the cash revaluation does.
 */
export function createFxExposureModule(
  storePath: string,
  invoiceStore: EnterpriseRecordStore,
  vendorBillStore: EnterpriseRecordStore,
  exchangeRateStore: EnterpriseRecordStore,
  accountStore: EnterpriseRecordStore,
  journalStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FX_EXPOSURE_MODULE_ID, FX_EXPOSURE_KIND);
  return defineEnterpriseModule({
    descriptor: FX_EXPOSURE_DESCRIPTOR,
    store,
    hooks: {
      // Creating a snapshot IS generating it; a generated snapshot is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(FX_EXPOSURE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'FX exposure snapshots are immutable — generate a new snapshot instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(asOfDate)) {
          return { ok: false, errors: { asOfDate: 'As-of date must be a day in YYYY-MM-DD form.' }, values: result.values };
        }

        const rates = exchangeRateStore.list().map(exchangeRateFromRecord);
        const invoices = invoiceStore.list().filter((r) => r.status !== 'deleted').map(invoiceFromRecord);
        const bills = vendorBillStore.list().filter((r) => r.status !== 'deleted').map(vendorBillFromRecord);

        // Derive foreign cash/bank positions from the posted ledger (same test as the
        // cash revaluation: an explicit 'cash' tag, or the seeded control when untagged).
        const posted = journalStore
          .list()
          .filter((r) => r.status !== 'deleted')
          .map(glJournalEntryFromRecord)
          .filter((e) => e.posted);
        const cash: FxCashPosition[] = [];
        for (const rec of accountStore.list()) {
          if (rec.status === 'deleted') continue;
          const account = glAccountFromRecord(rec);
          const tag = str(rec.fields.cashFlowCategory).trim().toLowerCase();
          const isCash = tag === 'cash' || ((tag === '' || tag === 'auto') && account.code === GL_CONTROL_ACCOUNTS.cash.code);
          if (!isCash) continue;
          const currency = (account.currency || FX_FUNCTIONAL_CURRENCY).toUpperCase();
          if (currency === FX_FUNCTIONAL_CURRENCY) continue;
          cash.push({ currency, foreignBalance: glAccountForeignTotals(account.code, posted).balance, functionalBalance: account.balance });
        }

        const exposure = deriveFxExposure({ invoices, bills, cash, rates, asOfDate, functionalCurrency: FX_FUNCTIONAL_CURRENCY });
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;

        result.values.asOfDate = asOfDate;
        result.values.reportNumber = `FXE-${asOfDate}-${priorCount + 1}`;
        result.values.functionalCurrency = exposure.functionalCurrency;
        result.values.currencyCount = exposure.currencyCount;
        result.values.totalFunctionalCurrent = exposure.totalFunctionalCurrent;
        result.values.totalFunctionalBooked = exposure.totalFunctionalBooked;
        result.values.totalUnrealizedDelta = exposure.totalUnrealizedDelta;
        result.values.skippedNoRate = exposure.skippedNoRate;
        result.values.byCurrency = JSON.stringify(exposure.byCurrency);
        result.values.byCustomer = JSON.stringify(exposure.byCustomer);
        result.values.byVendor = JSON.stringify(exposure.byVendor);
        result.values.note =
          exposure.currencyCount === 0
            ? `no open foreign-currency positions as of ${asOfDate} — nothing at risk (single-currency book)`
            : `${exposure.currencyCount} foreign currency/currencies exposed as of ${asOfDate}: functional exposure ${money(exposure.totalFunctionalCurrent)}, ` +
              `unrealized ${exposure.totalUnrealizedDelta >= 0 ? 'gain' : 'loss'} ${money(Math.abs(exposure.totalUnrealizedDelta))} vs booked` +
              (exposure.skippedNoRate > 0 ? `; ${exposure.skippedNoRate} currency/currencies un-marked (no as-of rate)` : '') +
              '.';
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const current = Number(f.totalFunctionalCurrent ?? 0);
        const unrealized = Number(f.totalUnrealizedDelta ?? 0);
        const currencies = Number(f.currencyCount ?? 0);
        const skipped = Number(f.skippedNoRate ?? 0);
        return {
          moduleId: FX_EXPOSURE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.reportNumber)} · exposure ${money(current)} · ${currencies} ccy · unrealized ${money(unrealized)}`,
          summary:
            `As of ${str(f.asOfDate)}: net functional exposure ${money(current)} across ${currencies} foreign currency/currencies, ` +
            `unrealized ${money(unrealized)} vs booked. ${str(f.note)}.`,
          risk: skipped > 0 ? 'medium' : 'low',
          riskReason:
            skipped > 0
              ? 'Some foreign positions had no as-of rate and are shown un-marked — the exposure is understated until rates are added.'
              : 'Every foreign position is marked to a real registered rate; the exposure is complete as of the report date.',
          executiveExplanation:
            'FX exposure is the open foreign-currency position — receivables and cash you will collect, less payables you will pay — netted per currency and valued at today’s rate, so you can see how much of the balance sheet moves if rates move.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
