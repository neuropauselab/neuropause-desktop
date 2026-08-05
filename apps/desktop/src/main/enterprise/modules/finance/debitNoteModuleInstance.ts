/**
 * The process-wide Debit Notes module singleton — binds the Electron-free
 * module to `userData` and injects the Vendor Bills store notes resolve
 * against, mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { DEBIT_NOTES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { vendorBillModule } from './vendorBillModuleInstance';
import { createDebitNoteModule } from './debitNoteModule';

export const debitNoteModule = createDebitNoteModule(
  enterpriseModuleStorePath(app.getPath('userData'), DEBIT_NOTES_MODULE_ID),
  vendorBillModule.store,
);
