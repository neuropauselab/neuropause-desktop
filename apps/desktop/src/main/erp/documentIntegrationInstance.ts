/**
 * The process-wide ERP document integration singleton.
 *
 * Binds the Electron-free adapter to `userData` and — critically — wires
 * `postJournal` to the EXISTING double-entry path (`applyGlDerivedEntries`).
 * The adapter derives balanced lines; the journal module posts them, keeping
 * its balance guard, period-close guard, posted-entry immutability and
 * idempotency-by-entry-number. There is still exactly one accounting engine.
 */
import { app } from 'electron';
import type { GlDerivedEntry } from '@neuropause/shared';
import { join } from 'node:path';
import { applyGlDerivedEntries } from '../enterprise/modules/finance/glPosting';
import { DocumentIntegration } from './documentAdapter';
import { DocumentLineStore } from './documentLines';
import { DOCUMENT_SPECS } from './documentSpecs';
import { ensureStockAccounts } from './stockAccounts';
import { createLogger } from '../logger';

const log = createLogger('erp-documents');

export const documentLineStore = new DocumentLineStore(
  join(app.getPath('userData'), 'erp-document-lines.json'),
);

export const documentIntegration = new DocumentIntegration({
  lines: documentLineStore,
  /**
   * Hand the derived, balanced entry to the real journal. `applyGlDerivedEntries`
   * is a no-op when the GL is not wired (it resolves the journal + accounts
   * modules through `moduleFor`), so this degrades safely rather than throwing
   * inside a module mutation.
   */
  postJournal: async (derivation, ctx) => {
    const entry: GlDerivedEntry = {
      entryNumber: derivation.reference,
      memo: derivation.memo,
      lines: derivation.lines,
      sourceModule: ctx.record.moduleId,
      sourceRef: ctx.record.id,
    };
    // The journal rejects a line whose account is absent from the chart, so the
    // stock/production control accounts are ensured before the first posting.
    await ensureStockAccounts(ctx.actionCtx);
    await applyGlDerivedEntries([entry], ctx.actionCtx);
  },
  audit: (entry) => {
    // Module-level audit already fires through `emitLifecycle`; this records the
    // accounting decision itself, which is otherwise invisible.
    log.info(entry.action, { target: entry.target, summary: entry.summary });
  },
  now: () => new Date().toISOString(),
  actor: () => null,
});

documentIntegration.registerAll(DOCUMENT_SPECS);
log.info('ERP document integration ready', {
  adopted: documentIntegration.adoptedModuleIds().length,
});
