/**
 * The process-wide Tax Reports module singleton — binds the Electron-free
 * module to `userData` (via the framework's canonical path) and injects the
 * Journal + Invoice stores generation reads from, mirroring the Payments ←
 * invoice-store pattern.
 */
import { app } from 'electron';
import { TAX_REPORTS_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { journalEntryModule } from './journalEntryModuleInstance';
import { invoiceModule } from './invoiceModuleInstance';
import { createTaxReportModule } from './taxReportModule';

export const taxReportModule = createTaxReportModule(
  enterpriseModuleStorePath(app.getPath('userData'), TAX_REPORTS_MODULE_ID),
  journalEntryModule.store,
  invoiceModule.store,
);
