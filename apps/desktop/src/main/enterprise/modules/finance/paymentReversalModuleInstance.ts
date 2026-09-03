/**
 * The process-wide Payment Reversals module singleton (ERP Session 61, D4) —
 * binds the Electron-free module to `userData` and injects the customer- and
 * vendor-payment stores so the reversal guards can resolve the original payment
 * (tenant-scoped) and the reconciler can re-open the referenced invoice/bill.
 * Mirrors the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { enterpriseModuleStorePath } from '../../framework';
import { createPaymentReversalModule } from './paymentReversalModule';
import { PAYMENT_REVERSALS_MODULE_ID } from './paymentReconcile';
import { paymentModule } from './paymentModuleInstance';
import { vendorPaymentModule } from './vendorPaymentModuleInstance';

export const paymentReversalModule = createPaymentReversalModule(
  enterpriseModuleStorePath(app.getPath('userData'), PAYMENT_REVERSALS_MODULE_ID),
  paymentModule.store,
  vendorPaymentModule.store,
);
