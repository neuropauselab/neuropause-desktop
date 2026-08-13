/**
 * The process-wide Payables Aging module singleton — binds the Electron-free
 * module to `userData` and injects the Vendor Bills store generation reads
 * from, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { AP_AGING_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { vendorBillModule } from './vendorBillModuleInstance';
import { createApAgingModule } from './apAgingModule';

export const apAgingModule = createApAgingModule(
  enterpriseModuleStorePath(app.getPath('userData'), AP_AGING_MODULE_ID),
  vendorBillModule.store,
);
