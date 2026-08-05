/**
 * The process-wide Chart of Accounts module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path). Mirrors the
 * `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { LEDGER_ACCOUNTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createLedgerAccountModule } from './ledgerAccountModule';

export const ledgerAccountModule = createLedgerAccountModule(
  enterpriseModuleStorePath(app.getPath('userData'), LEDGER_ACCOUNTS_MODULE_ID),
);
