/**
 * The process-wide Journal module singleton — binds the Electron-free module to
 * `userData` (via the framework's canonical path) and injects the Chart of
 * Accounts store for line validation, mirroring the Payments ← invoice-store
 * pattern.
 *
 * SEAM-B.8 — this is also where journal-post GOVERNANCE gets its durable limbs:
 *  - a `DurableIdempotencyStore` (frozen cst/ class CONSUMED, never modified —
 *    a second instance over its own file, the `m365-governed-actions.json`
 *    convention) so a replayed post survives process restart;
 *  - the ActionRecord evidence observer (`recordJournalPostEvidence`, kept
 *    Electron-free in its own module so the real evidence path is pinned).
 */
import { app } from 'electron';
import { join } from 'node:path';
import { JOURNAL_ENTRIES_MODULE_ID } from '@neuropause/shared';
import { enterpriseModuleStorePath } from '../../framework';
import { DurableIdempotencyStore } from '../../../cst/durableIdempotencyStore';
import { ledgerAccountModule } from './ledgerAccountModuleInstance';
import { createJournalEntryModule } from './journalEntryModule';
import { createJournalPostPorts } from './journalPostTransition';
import { recordJournalPostEvidence } from './journalPostEvidence';

export const journalEntryModule = createJournalEntryModule(
  enterpriseModuleStorePath(app.getPath('userData'), JOURNAL_ENTRIES_MODULE_ID),
  ledgerAccountModule.store,
  {
    ports: createJournalPostPorts(
      new DurableIdempotencyStore(join(app.getPath('userData'), 'journal-post-transitions.json')),
    ),
    onOutcome: recordJournalPostEvidence,
  },
);
