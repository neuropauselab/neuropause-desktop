/**
 * The process-wide Vendor Payments module singleton — binds the Electron-free
 * module to `userData` and injects the Vendor Bills store guards + the
 * reconciler read from, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { VENDOR_PAYMENTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { vendorBillModule } from './vendorBillModuleInstance';
import { createVendorPaymentModule } from './vendorPaymentModule';

export const vendorPaymentModule = createVendorPaymentModule(
  enterpriseModuleStorePath(app.getPath('userData'), VENDOR_PAYMENTS_MODULE_ID),
  vendorBillModule.store,
);
