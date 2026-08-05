/**
 * The process-wide Receivables Aging module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Invoice store generation reads from, mirroring the Payments ← invoice-store
 * pattern.
 */
import { app } from 'electron';
import { AR_AGING_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { invoiceModule } from './invoiceModuleInstance';
import { createArAgingModule } from './arAgingModule';

export const arAgingModule = createArAgingModule(
  enterpriseModuleStorePath(app.getPath('userData'), AR_AGING_MODULE_ID),
  invoiceModule.store,
);
