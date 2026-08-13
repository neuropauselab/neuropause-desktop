/**
 * The process-wide Bank Statements module singleton — binds the Electron-free
 * module to `userData` and injects the Payment store reconciliation matches
 * against, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { BANK_STATEMENTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { paymentModule } from './paymentModuleInstance';
import { createBankStatementModule } from './bankStatementModule';

export const bankStatementModule = createBankStatementModule(
  enterpriseModuleStorePath(app.getPath('userData'), BANK_STATEMENTS_MODULE_ID),
  paymentModule.store,
);
