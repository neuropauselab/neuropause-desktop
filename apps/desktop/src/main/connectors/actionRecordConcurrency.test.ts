/**
 * F-P52 — THE EVIDENCE STORE MUST NOT LOSE A ROW TO A CONCURRENT LOAD.
 *
 * ── THE DEFECT THIS FILE WAS WRITTEN AGAINST (it was RED before the fix existed) ──────────────────────────────
 * `ensureLoaded()` read `if (this.loaded) return;` → `await readStoreFile(...)` → `this.records = <parsed>`, with
 * **no in-flight memo**. Two callers arriving while `loaded` is false both performed the read, and **the second
 * assignment overwrote whatever the first had pushed in between.**
 *
 * Worse than an in-memory glitch: `persist()` serialises `this.records`, so once the loser's row is dropped from
 * memory **the next persist writes the truncated set over the file** — the evidence row is gone from disk too.
 *
 * ── WHY THE ASSERTIONS LOOK AT THE STORE AND NEVER AT THE PROMISE ────────────────────────────────────────────
 * **A BEST-EFFORT WRITER THAT SWALLOWS ITS OWN FAILURES CANNOT TELL YOU WHETHER IT WROTE.** `observe` and
 * `observeGovernance` catch internally and resolve either way, so `await` resolving proves only that the call
 * finished — never that a row exists. That is exactly how this defect hid: the emit "succeeded" every time.
 * **Every assertion below reads the store back.**
 *
 * NO EXTERNAL EFFECT: a temp dir and the real store. Nothing is sent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionRecord } from './actionRecord';

const TENANT = 'ws-fp52';
const base = (actionId: string) => ({ connectorId: 'microsoft-entra', accountId: 'acc', actionId, params: { to: ['a@ex.com'] } });
const ctx = { actor: 'user:ops', tenantId: TENANT } as never;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-fp52-'));
  actionRecord.useDirForTests(dir); // leaves the store UNLOADED — the state the race needs
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('F-P52 · concurrent writes against an unloaded store', () => {
  it('THE REPRODUCTION — two writers racing the FIRST load both survive (was 1 of 2 before the memo)', async () => {
    // Both calls begin while `loaded === false`, which is the only window the defect lives in.
    await Promise.all([
      actionRecord.observeGovernance(base('mail.send'), 'NOT_EVALUATED', ctx),
      actionRecord.observeGovernance(base('calendar.create'), 'DENY', ctx),
    ]);

    // OBSERVE THE STORE, NEVER THE PROMISE — both promises resolved even when a row was being dropped.
    const rows = await actionRecord.query({ tenantId: TENANT });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.actionId).sort()).toEqual(['calendar.create', 'mail.send']);
  });

  it('THE PRODUCTION SHAPE — a fire-and-forget write racing a first READ keeps the row', async () => {
    // `connectors/index.ts:641` is `void actionRecord.observe(...)` and the panel counter queries on sync
    // events, so a send racing a first panel refresh is the ordinary interleaving, not an exotic one.
    void actionRecord.observeGovernance(base('mail.send'), 'NOT_EVALUATED', ctx);
    const early = await actionRecord.query({ tenantId: TENANT }); // may legitimately be empty — it raced
    await new Promise((r) => setTimeout(r, 40));
    const settled = await actionRecord.query({ tenantId: TENANT });

    expect(early.length).toBeLessThanOrEqual(1); // the read is allowed to be early; it is NOT allowed to destroy
    expect(settled).toHaveLength(1); // the row must exist once everything has quiesced
  });

  it('DURABILITY — the row reaches DISK, not just memory (a later persist must not truncate it)', async () => {
    await Promise.all([
      actionRecord.observeGovernance(base('mail.send'), 'NOT_EVALUATED', ctx),
      actionRecord.observeGovernance(base('drive.upload'), 'DENY', ctx),
    ]);
    // A third write forces another persist — the step that previously overwrote the file with the truncated set.
    await actionRecord.observeGovernance(base('contacts.update'), 'DENY', ctx);

    const onDisk = JSON.parse(readFileSync(join(dir, 'action-records.json'), 'utf8')) as { records: unknown[] };
    expect(onDisk.records).toHaveLength(3);
  });

  it('A RELOAD AFTER useDirForTests DOES NOT SERVE A STALE MEMO — the new directory is genuinely read', async () => {
    await actionRecord.observeGovernance(base('mail.send'), 'NOT_EVALUATED', ctx);
    expect(await actionRecord.query({ tenantId: TENANT })).toHaveLength(1);

    // Point the store at a DIFFERENT empty directory. A memo that outlived the switch would keep the old rows.
    const other = mkdtempSync(join(tmpdir(), 'np-fp52-other-'));
    try {
      actionRecord.useDirForTests(other);
      expect(await actionRecord.query({ tenantId: TENANT })).toHaveLength(0);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
