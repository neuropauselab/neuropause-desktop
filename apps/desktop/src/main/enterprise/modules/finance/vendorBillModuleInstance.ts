/**
 * The process-wide Vendor Bills module singleton — binds the Electron-free
 * module to `userData`, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { VENDOR_BILLS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { createVendorBillModule } from './vendorBillModule';
// Phase 9 — the source-PO guard reads the real Purchase Orders register (FW-5 cross-family precedent).
import { purchaseOrderModule } from '../procurement/procurementInstances';

export const vendorBillModule = createVendorBillModule(
  enterpriseModuleStorePath(app.getPath('userData'), VENDOR_BILLS_MODULE_ID),
  purchaseOrderModule.store,
);
