/**
 * The process-wide Budget Variance module singleton — binds the Electron-free module to
 * `userData` and injects the Budget masters + Journal + Chart-of-Accounts stores the register
 * derives from, mirroring `budgetModuleInstance` exactly.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { budgetModule } from './budgetModuleInstance';
import { journalEntryModule } from './journalEntryModuleInstance';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { createBudgetVarianceModule, BUDGET_VARIANCE_MODULE_ID } from './budgetVarianceModule';

export const budgetVarianceModule = createBudgetVarianceModule(
  enterpriseModuleStorePath(app.getPath('userData'), BUDGET_VARIANCE_MODULE_ID),
  budgetModule.store,
  journalEntryModule.store,
  ledgerAccountModule.store,
);
