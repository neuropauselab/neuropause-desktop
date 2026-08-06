/**
 * The process-wide Financial Ratios module singleton — binds the Electron-free
 * module to `userData` and injects the Ledger Accounts + Journal stores the
 * ratio engine reads real posted balances from, mirroring the finance
 * `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { FINANCIAL_RATIOS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { journalEntryModule } from './journalEntryModuleInstance';
import { createFinancialRatiosModule } from './financialRatiosModule';

export const financialRatiosModule = createFinancialRatiosModule(
  enterpriseModuleStorePath(app.getPath('userData'), FINANCIAL_RATIOS_MODULE_ID),
  ledgerAccountModule.store,
  journalEntryModule.store,
);
