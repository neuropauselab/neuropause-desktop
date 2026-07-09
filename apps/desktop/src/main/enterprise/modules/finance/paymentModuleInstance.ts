/**
 * The process-wide Payments module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path), the shared AI engine, and the
 * Invoices module's store (so its create-time guards can read the referenced
 * invoice + reconcile it). Mirrors the `*Instance.ts` pattern.
 */
import { app } from 'electron';
import { PAYMENTS_MODULE_ID } from '@neuropause/shared';
import { aiEngine } from '../../../ai/engineInstance';
import { enterpriseModuleStorePath } from '../../framework';
import { createPaymentModule } from './paymentModule';
import { runPaymentAi } from './paymentAi';
import { invoiceModule } from './invoiceModuleInstance';

export const paymentModule = createPaymentModule(
  enterpriseModuleStorePath(app.getPath('userData'), PAYMENTS_MODULE_ID),
  invoiceModule.store,
  (payment) => runPaymentAi(aiEngine, payment),
);
