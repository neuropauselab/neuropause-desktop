/**
 * The process-wide Cash Flow Statement module singleton — binds the Electron-free
 * module to `userData` and injects the Ledger Accounts + Journal stores the
 * direct-method engine reads the chart's cash-flow tags and real posted balances
 * from, mirroring the finance `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { CASH_FLOW_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { journalEntryModule } from './journalEntryModuleInstance';
import { createCashFlowModule } from './cashFlowModule';

export const cashFlowModule = createCashFlowModule(
  enterpriseModuleStorePath(app.getPath('userData'), CASH_FLOW_MODULE_ID),
  ledgerAccountModule.store,
  journalEntryModule.store,
);
