/**
 * Finance → Treasury Positions — the liquidity register on the Enterprise
 * Module Framework (FW-12, the charter's last named Finance item). CRUD, RBAC
 * (`operations:read` / `operations:manage`), audit, timeline, search, offline
 * persistence, and the UI are all inherited.
 *
 * One record = one named cash-position statement. Every figure is DERIVED by
 * the pure engine from stores other certified modules own — cash/bank account
 * balances (the cash-flow statement's own selection rule), open customer
 * invoices' outstanding, approved vendor bills' outstanding — and stamped by
 * the REFRESH action, never typed. Re-refreshing updates the same statement
 * in place (the audit trail records each refresh). The chart of accounts is
 * required; if the invoice or vendor-bill module is unavailable the refresh
 * SAYS which side was counted as zero rather than silently pretending.
 *
 * Electron-free (store path injected; source modules resolve from the action
 * context at runtime), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  FINANCE_MODULE_ID,
  LEDGER_ACCOUNTS_MODULE_ID,
  TREASURY_POSITIONS_MODULE_ID,
  TREASURY_POSITION_KIND,
  VENDOR_BILLS_MODULE_ID,
  deriveTreasuryPosition,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** Recompute every derived figure from the live books. */
export const REFRESH_TREASURY_ACTION = 'refresh';

/** The declarative description of a treasury position — drives store, CRUD, and the UI. */
export const TREASURY_POSITION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TREASURY_POSITIONS_MODULE_ID,
  title: 'Treasury Positions',
  singular: 'Treasury Position',
  plural: 'Treasury Positions',
  icon: 'database',
  description:
    'Derived cash positions — cash/bank balances + open receivables − approved payables, refreshed from the books, never typed.',
  group: 'Finance',
  titleField: 'name',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: REFRESH_TREASURY_ACTION, label: 'Refresh', icon: 'refresh' }],
  fields: [
    { key: 'name', label: 'Statement', type: 'text', required: true, placeholder: 'August cash position' },
    { key: 'asOfDate', label: 'As Of', type: 'text', readOnly: true },
    { key: 'cashBalance', label: 'Cash', type: 'number', readOnly: true, default: 0, format: 'currency' },
    { key: 'receivablesOutstanding', label: 'Receivables', type: 'number', readOnly: true, default: 0, format: 'currency' },
    { key: 'payablesOutstanding', label: 'Payables', type: 'number', readOnly: true, default: 0, format: 'currency' },
    { key: 'netPosition', label: 'Net Position', type: 'number', readOnly: true, default: 0, format: 'currency' },
    { key: 'openInvoiceCount', label: 'Open Invoices', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'openBillCount', label: 'Open Bills', type: 'number', readOnly: true, default: 0, column: false },
    { key: 'cashBreakdown', label: 'Cash Accounts (JSON)', type: 'textarea', readOnly: true, column: false },
    { key: 'refreshedAt', label: 'Refreshed At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Build the Treasury Positions module. (Injected path — Electron-free tests.) */
export function createTreasuryPositionModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TREASURY_POSITIONS_MODULE_ID, TREASURY_POSITION_KIND);
  return defineEnterpriseModule({
    descriptor: TREASURY_POSITION_DESCRIPTOR,
    store,
    hooks: {
      validate: (input) => validateEnterpriseRecordInput(TREASURY_POSITION_DESCRIPTOR, input),
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const refreshed = str(f.refreshedAt);
        const net = num(f.netPosition);
        return {
          moduleId: TREASURY_POSITIONS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.name)} · net ${net.toLocaleString('en-US')}`,
          summary: refreshed
            ? `As of ${str(f.asOfDate)}: cash ${num(f.cashBalance).toLocaleString('en-US')} + receivables ${num(f.receivablesOutstanding).toLocaleString('en-US')} (${num(f.openInvoiceCount)} invoice(s)) − payables ${num(f.payablesOutstanding).toLocaleString('en-US')} (${num(f.openBillCount)} bill(s)) = ${net.toLocaleString('en-US')}.`
            : 'Not refreshed yet — every figure is derived from the books, never typed. Run Refresh.',
          risk: refreshed && net < 0 ? 'medium' : 'low',
          riskReason:
            refreshed && net < 0
              ? 'Approved payables exceed cash plus open receivables — arithmetic, not judgment.'
              : 'A derived statement; the books it reads are the source of truth.',
          executiveExplanation:
            'Cash uses the cash-flow statement’s own account selection; receivables are open invoices’ outstanding; payables are approved bills’ outstanding. Net = cash + AR − AP.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== REFRESH_TREASURY_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        const accountsModule = actionCtx.moduleFor(LEDGER_ACCOUNTS_MODULE_ID);
        if (!accountsModule) {
          return { ok: false, error: 'The Chart of Accounts is not available — a cash position needs the ledger.' };
        }
        const invoicesModule = actionCtx.moduleFor(FINANCE_MODULE_ID);
        const billsModule = actionCtx.moduleFor(VENDOR_BILLS_MODULE_ID);
        await accountsModule.store.load();
        if (invoicesModule) await invoicesModule.store.load();
        if (billsModule) await billsModule.store.load();
        const position = deriveTreasuryPosition({
          accounts: accountsModule.store.list(),
          invoices: invoicesModule ? invoicesModule.store.list() : [],
          vendorBills: billsModule ? billsModule.store.list() : [],
        });
        const missing = [
          ...(invoicesModule ? [] : ['invoices unavailable — receivables counted as 0']),
          ...(billsModule ? [] : ['vendor bills unavailable — payables counted as 0']),
        ];
        store.update(record.id, {
          fields: {
            asOfDate: actionCtx.now().slice(0, 10),
            cashBalance: position.cashBalance,
            receivablesOutstanding: position.receivablesOutstanding,
            payablesOutstanding: position.payablesOutstanding,
            netPosition: position.netPosition,
            openInvoiceCount: position.openInvoiceCount,
            openBillCount: position.openBillCount,
            cashBreakdown: JSON.stringify(position.cashAccounts),
            refreshedAt: actionCtx.now(),
          },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message:
            `Position refreshed: cash ${position.cashBalance.toLocaleString('en-US')} (${position.cashAccounts.length} account(s)) ` +
            `+ receivables ${position.receivablesOutstanding.toLocaleString('en-US')} (${position.openInvoiceCount}) ` +
            `− payables ${position.payablesOutstanding.toLocaleString('en-US')} (${position.openBillCount}) ` +
            `= net ${position.netPosition.toLocaleString('en-US')}.` +
            (missing.length > 0 ? ` NOTE: ${missing.join('; ')}.` : ''),
        };
      },
    },
  });
}
