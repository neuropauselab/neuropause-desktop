/**
 * The process-wide Journal module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and injects the Chart of
 * Accounts store for line validation, mirroring the Payments ← invoice-store
 * pattern.
 */
import { app } from 'electron';
import { JOURNAL_ENTRIES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { createJournalEntryModule } from './journalEntryModule';

export const journalEntryModule = createJournalEntryModule(
  enterpriseModuleStorePath(app.getPath('userData'), JOURNAL_ENTRIES_MODULE_ID),
  ledgerAccountModule.store,
);
