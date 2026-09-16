/**
 * SEAM-B.8 — the journal-post evidence observer (Electron-free so the REAL
 * evidence path is testable against the real ActionRecord store, §2 #17).
 *
 * One durable evidence row per governed post attempt; settled terminals attach
 * immediately via `recordVerification` (D-16 vocabulary; the store enforces
 * monotonicity). Best-effort by contract: the CALLER wraps this — a failure
 * here is the observer's evidence gap, never the post's (§2 #19 / FG-5 shape).
 *
 * F-P45 (carried, not fixed here): the evidence store's `tenantId` key HOLDS A
 * WORKSPACE ID — this writer conforms to the store's recorded convention.
 * Reconciler safety (measured): `awaitingVerification` requires
 * `actionId === 'mail.send'` (readBackReconciler.ts:184), so `journal.post`
 * rows are structurally invisible to the M365 Graph reconciler.
 */
import { JOURNAL_ENTRIES_MODULE_ID } from '@neuropause/shared';
import { actionRecord } from '../../../connectors/actionRecord';
import type { GovernedSendResult } from '../../../cst/sendTransition';
import type { JournalPostOutcomeEvent } from './journalEntryModule';

/** Self-disclosing non-connector namespace — cannot collide with real connector ids. */
export const JOURNAL_EVIDENCE_CONNECTOR_ID = 'enterprise:finance-journal-entries';

export async function recordJournalPostEvidence(ev: JournalPostOutcomeEvent): Promise<void> {
  // The observer's `result` parameter is typed for the send path; it reads only
  // `semanticOutcome` + defensive `outcome.{transitionId,verdict,executed}` +
  // `requestId` — this cast is DECLARED, not hidden (the X3-audited shape).
  const resultForObserver = {
    semanticOutcome: ev.result.semanticOutcome,
    requestId: ev.result.requestId,
    outcome: ev.result.outcome,
  } as unknown as GovernedSendResult;
  await actionRecord.observe(
    {
      connectorId: JOURNAL_EVIDENCE_CONNECTOR_ID,
      accountId: JOURNAL_ENTRIES_MODULE_ID,
      actionId: 'journal.post',
      params: { entryId: ev.entryId, entryNumber: ev.entryNumber, expectedRev: ev.expectedRev },
    },
    resultForObserver,
    { actor: ev.actor, tenantId: ev.workspaceId },
  );
  const sem = ev.result.semanticOutcome;
  if (sem === 'VERIFIED_SUCCESS' || sem === 'VERIFIED_FAILURE') {
    await actionRecord.recordVerification(ev.workspaceId, ev.result.transitionId, {
      terminal: sem,
      internetMessageId: null,
      at: new Date().toISOString(),
      // The durable row's own stamped instant when this attempt's write won —
      // read from the written row, never re-clocked (NP-015).
      effectTime: sem === 'VERIFIED_SUCCESS' ? ev.postedAt : null,
      provenance: {
        source: 'journalPostTransition',
        method: 'in-kernel post-state re-read (postedAt set ∧ rev === expected+1)',
        oracle: 'enterpriseRecordStore:finance-journal-entries',
      },
    });
  }
}
