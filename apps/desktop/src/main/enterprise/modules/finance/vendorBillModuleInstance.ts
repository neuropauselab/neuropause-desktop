/**
 * The process-wide Vendor Bills module singleton — binds the Electron-free
 * module to `userData`, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { VENDOR_BILLS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createVendorBillModule } from './vendorBillModule';

export const vendorBillModule = createVendorBillModule(
  enterpriseModuleStorePath(app.getPath('userData'), VENDOR_BILLS_MODULE_ID),
);
