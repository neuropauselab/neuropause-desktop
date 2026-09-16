/**
 * SEAM-B.10 / GATE-R.4 §31/§66 — READ-BACK OF RUNTIME-PERSISTED EVIDENCE,
 * from a SEPARATE PROCESS, through a FRESH reader.
 *
 * Env-gated (the liveProviderVerification.test.ts `describe.runIf` precedent):
 * point NP_B10_PROFILE_DIR at a temp profile produced by
 * `e2e/journalRuntime.e2e.cjs` (the alternate-build Electron run). The chain
 * this file completes is WRITE (real Electron process) → PROCESS BOUNDARY →
 * FRESH READER (this vitest process) → RECONSTRUCTION → FINAL STATUS — the
 * terminal comes from persisted bytes, never from the app's memory.
 *
 * The evidence key is 'workspace-default' — the fresh local profile's seeded
 * workspace id, which is what the writer records per F-P45.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createActionRecordReader } from '../connectors/actionRecord';
import { awaitingVerification } from './readBackReconciler';
import { readBackFromDisk } from './readBack';

const DIR = process.env.NP_B10_PROFILE_DIR ?? '';
const WS = 'workspace-default';

describe.runIf(DIR !== '')('SEAM-B.10 · runtime evidence read-back (fresh reader over the runtime profile)', () => {
  it('reconstructs VERIFIED_SUCCESS from the persisted bytes of the real Electron run — and no non-success attempt carries a success terminal', async () => {
    const rows = await createActionRecordReader(DIR).query({ tenantId: WS });
    const journal = rows.filter((r) => r.actionId === 'journal.post');
    expect(journal.length).toBeGreaterThan(0);

    const successes = journal.filter((r) => r.outcome === 'VERIFIED_SUCCESS');
    expect(successes.length).toBeGreaterThan(0);
    for (const s of successes) {
      // §64 — the B.9 per-attempt transition id, runtime-proven: entry:rev prefix + <ms>-<seq> attempt suffix.
      expect(s.transitionId).toMatch(/^journal-post:.+:\d+:\d+-\d+$/);
      expect(s.verification?.terminal).toBe('VERIFIED_SUCCESS');
      expect(s.verification?.provenance?.oracle).toBe('enterpriseRecordStore:finance-journal-entries');
      const report = await readBackFromDisk(DIR, WS, { transitionId: s.transitionId });
      expect(report.matches).toBe(1);
      expect(report.rows[0].finalStatus).toBe('VERIFIED_SUCCESS');
    }

    // The B.9 contamination class stays dead at runtime: a refused/stale/lost
    // attempt must never wear the success terminal.
    for (const r of journal.filter((x) => x.outcome !== 'VERIFIED_SUCCESS')) {
      expect(r.verification?.terminal ?? null).not.toBe('VERIFIED_SUCCESS');
    }

    // Journal rows are invisible to the M365 reconciler — the REAL predicate,
    // over rows the RUNNING app's reconciler service actually ticked across.
    for (const r of rows) expect(awaitingVerification(r)).toBe(false);
  });

  it('the durable stores live inside the runtime profile: idempotency DONE intents + the journal store file', () => {
    const idem = join(DIR, 'journal-post-transitions.json');
    expect(existsSync(idem)).toBe(true);
    const parsed = JSON.parse(readFileSync(idem, 'utf8')) as { records: Record<string, { state: string }> };
    expect(Object.values(parsed.records).map((r) => r.state)).toContain('DONE');

    const store = join(DIR, 'enterprise-module-finance-journal-entries.json');
    expect(existsSync(store)).toBe(true);
    // Profile-agnostic (B.10 profiles carry JE-B10-*, B.13 packaged profiles JE-B13-*):
    // the probe entries share the JE-B prefix, and a governed post stamps postedAt.
    const bytes = readFileSync(store, 'utf8');
    expect(bytes).toContain('"entryNumber":"JE-B');
    expect(bytes).toContain('"postedAt":"');
  });
});

describe.runIf(DIR === '')('SEAM-B.10 · runtime evidence read-back (gated off)', () => {
  it('runs only when NP_B10_PROFILE_DIR points at a captured runtime profile', () => {
    expect(DIR).toBe('');
  });
});
