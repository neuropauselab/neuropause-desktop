/**
 * The process-wide Credit Notes module singleton — binds the Electron-free
 * module to `userData` and injects the Invoice store notes resolve against,
 * mirroring the `*Instance.ts` pattern used across main.
 */
import { app } from 'electron';
import { CREDIT_NOTES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { invoiceModule } from './invoiceModuleInstance';
import { createCreditNoteModule } from './creditNoteModule';

export const creditNoteModule = createCreditNoteModule(
  enterpriseModuleStorePath(app.getPath('userData'), CREDIT_NOTES_MODULE_ID),
  invoiceModule.store,
);
