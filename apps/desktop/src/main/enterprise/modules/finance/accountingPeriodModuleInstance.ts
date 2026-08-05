/**
 * The process-wide Accounting Periods module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path). Mirrors the
 * `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { ACCOUNTING_PERIODS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createAccountingPeriodModule } from './accountingPeriodModule';

export const accountingPeriodModule = createAccountingPeriodModule(
  enterpriseModuleStorePath(app.getPath('userData'), ACCOUNTING_PERIODS_MODULE_ID),
);
