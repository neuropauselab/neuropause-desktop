/**
 * The process-wide Finance module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and the shared AI engine.
 * Mirrors the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createInvoiceModule } from './invoiceModule';
import { runInvoiceAi } from './invoiceAi';
import { FINANCE_MODULE_ID } from '@neuropause/shared';

export const invoiceModule = createInvoiceModule(
  enterpriseModuleStorePath(app.getPath('userData'), FINANCE_MODULE_ID),
  (invoice, risk) => runInvoiceAi(aiEngine, invoice, risk),
);
