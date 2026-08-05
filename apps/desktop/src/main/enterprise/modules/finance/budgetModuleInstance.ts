/**
 * The process-wide Budgets module singleton — binds the Electron-free module
 * to `userData` and injects the Journal + Chart-of-Accounts stores actuals
 * derive from, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { BUDGETS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { journalEntryModule } from './journalEntryModuleInstance';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { createBudgetModule } from './budgetModule';

export const budgetModule = createBudgetModule(
  enterpriseModuleStorePath(app.getPath('userData'), BUDGETS_MODULE_ID),
  journalEntryModule.store,
  ledgerAccountModule.store,
);
