/**
 * ERP Session 36 — PRODUCTION BACKUP / RECOVERY INTEGRITY for the governed command spine.
 *
 * The S18 durable command journal (`platform-command-journal.json`) and the S31 delivered-event sink
 * (`platform-delivered-events.json`) were persisted but OUTSIDE the store-path registry, so backup AND
 * pre-migration rollback silently excluded the ENTIRE governed ERP command spine (idempotency + domain
 * events + outbox delivery state). S36 registers both in the ONE registry the existing sha256-manifest
 * BackupManager already consumes — no new engine, no new policy, no invented quiesce.
 *
 * These tests drive the REAL BackupManager + REAL DurableCommandJournal + REAL DeliveredEventLog + REAL
 * S31 relay against isolated TEMP directories (never real production data). They prove an actual
 * backup → integrity-validate → simulate loss → restore-into-isolated-env → reload → EXACT match
 * round-trip, plus corruption/failure injection and S33 concurrency compatibility.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { BackupManager } from './backupManager';
import { DOMAIN_FILES } from '../storage/storePaths';
import { DurableCommandJournal } from '../platform/command/durableCommandJournal';
import { DeliveredEventLog } from '../platform/command/deliveredEventLog';
import { dispatchOutbox, type OutboxConsumer } from '../platform/command/outboxDispatcher';

const JOURNAL_FILE = 'platform-command-journal.json';
const SINK_FILE = 'platform-delivered-events.json';

let root: string;
let dataDir: string;
let backupsDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'np-s36-'));
  dataDir = join(root, 'data');
  backupsDir = join(root, 'backups');
  await fs.mkdir(dataDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function manager(dir = dataDir, now = () => 1_700_000_000_000): BackupManager {
  return new BackupManager({
    dataDir: dir,
    backupsDir,
    appVersion: '1.0.0',
    dataVersion: () => 1,
    now,
    restoreBoundary: { boundary: 'ALL_TENANTS_AT_ONCE', declaredBy: 'session36BackupRecovery.test.ts' },
  });
}

/** Commit a real governed command through the durable journal (real idempotency + event + outbox). */
const commit = (journal: DurableCommandJournal, tenantId: string, key: string, orderId: string) =>
  journal.run({
    tenantId, idempotencyKey: key, commandId: `cmd-${key}`, commandType: 'CreateSalesOrder',
    correlationId: `corr-${key}`, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: orderId }, aggregateId: orderId, aggregateType: 'SalesOrder' }),
  });

const deliverOk = (sink: DeliveredEventLog): OutboxConsumer => (event) => sink.record(event);
const deliverFail: OutboxConsumer = () => { throw new Error('downstream sink unreachable (injected)'); };

/** Build representative durable state: one DELIVERED, one RETRYABLE, one PENDING command. */
async function seedState(): Promise<{ journal: DurableCommandJournal; sink: DeliveredEventLog }> {
  const journal = new DurableCommandJournal(join(dataDir, JOURNAL_FILE));
  const sink = new DeliveredEventLog(join(dataDir, SINK_FILE));
  await commit(journal, 'tenant-A', 'k1', 'SO-1');
  await dispatchOutbox(journal, deliverOk(sink)); // k1 -> DELIVERED, sink=1
  await commit(journal, 'tenant-A', 'k2', 'SO-2');
  await dispatchOutbox(journal, deliverFail); // k2 -> RETRYABLE (attempts>=1, lastError)
  await commit(journal, 'tenant-A', 'k3', 'SO-3'); // k3 -> PENDING (never drained)
  return { journal, sink };
}

const norm = (recs: readonly unknown[]): string =>
  JSON.stringify([...recs].sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1)));

// ===========================================================================
// Registry coverage — the gap this session closes (reproduce-first)
// ===========================================================================

describe('S36 · store-path registry now covers the governed command spine', () => {
  it('both platform durable stores are registered under the business domain (were absent)', () => {
    expect(DOMAIN_FILES.business).toContain(JOURNAL_FILE);
    expect(DOMAIN_FILES.business).toContain(SINK_FILE);
  });

  it('a backup CAPTURES the journal + delivered sink (before S36 they were never captured)', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    const val = await manager().validate(info.id);
    expect(val.valid).toBe(true);
    // both files are present in the archive manifest
    const manifestRaw = await fs.readFile(join(backupsDir, info.id, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as { entries: { relativePath: string }[] };
    const paths = manifest.entries.map((e) => e.relativePath);
    expect(paths).toContain(JOURNAL_FILE);
    expect(paths).toContain(SINK_FILE);
  });
});

// ===========================================================================
// §5 / §7J — the round-trip: capture -> loss -> restore into ISOLATED env -> exact
// ===========================================================================

describe('S36 · recovery round-trip (isolated environment, exact match)', () => {
  it('recovers the exact journal + outbox + delivered state into a fresh isolated data dir', async () => {
    const { journal, sink } = await seedState();
    // Authoritative pre-backup snapshot.
    const recordsBefore = norm(journal.records('tenant-A'));
    const pendingBefore = journal.pendingOutbox('tenant-A').length; // k2 RETRYABLE + k3 PENDING = 2
    const deliveredBefore = sink.count('tenant-A'); // 1
    expect(pendingBefore).toBe(2);
    expect(deliveredBefore).toBe(1);

    const info = await manager().create('manual', ['business']);
    expect((await manager().validate(info.id)).valid).toBe(true);

    // Simulate LOSS: restore into a SEPARATE, empty recovery data dir (isolated env).
    const recoveryDir = join(root, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });
    const res = await manager(recoveryDir, () => 1_700_000_100_000).restore(info.id, ['business']);
    expect(res.ok).toBe(true);
    expect(res.requiresRestart).toBe(true);

    // Reload fresh stores from the RECOVERED files and compare to the authoritative snapshot.
    const rj = new DurableCommandJournal(join(recoveryDir, JOURNAL_FILE));
    await rj.load();
    const rs = new DeliveredEventLog(join(recoveryDir, SINK_FILE));
    await rs.reload();
    expect(norm(rj.records('tenant-A'))).toBe(recordsBefore); // byte-exact records incl. outbox state
    expect(rj.pendingOutbox('tenant-A').length).toBe(pendingBefore);
    expect(rs.count('tenant-A')).toBe(deliveredBefore);
    // spot-check the mix survived: k2 RETRYABLE with a real error, k1 DELIVERED, k3 PENDING
    const byOrder = (o: string) => rj.records('tenant-A').find((r) => r.event.aggregateId === o)!;
    expect(byOrder('SO-1').outbox.status).toBe('DELIVERED');
    expect(byOrder('SO-2').outbox.status).toBe('RETRYABLE');
    expect(byOrder('SO-2').outbox.lastError).toContain('downstream sink unreachable');
    expect(byOrder('SO-3').outbox.status).toBe('PENDING');
  });
});

// ===========================================================================
// §6 — cross-store consistency (journal + sink recovered as a coherent pair)
// ===========================================================================

describe('S36 · cross-store consistency boundary', () => {
  it('journal DELIVERED rows and the delivered-event sink are recovered as a coherent pair', async () => {
    const { journal, sink } = await seedState();
    const deliveredOrders = journal
      .records('tenant-A')
      .filter((r) => r.outbox.status === 'DELIVERED')
      .map((r) => r.event.eventId);
    const info = await manager().create('manual', ['business']);
    const recoveryDir = join(root, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });
    await manager(recoveryDir, () => 1_700_000_100_000).restore(info.id, ['business']);
    const rs = new DeliveredEventLog(join(recoveryDir, SINK_FILE));
    await rs.reload();
    const sinkIds = rs.delivered('tenant-A').map((d) => d.id);
    // every journal-DELIVERED event has its downstream confirmation row (no impossible state)
    for (const evId of deliveredOrders) expect(sinkIds).toContain(evId);
    expect(rs.count('tenant-A')).toBe(sink.count('tenant-A'));
  });
});

// ===========================================================================
// §7 — corruption / failure injection (do NOT weaken validation to pass)
// ===========================================================================

describe('S36 · corruption + failure injection', () => {
  it('A — a valid backup passes integrity validation', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    expect((await manager().validate(info.id)).valid).toBe(true);
  });

  it('B — a TRUNCATED archived store is rejected (sha256 mismatch)', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    await fs.writeFile(join(backupsDir, info.id, 'data', JOURNAL_FILE), '{"records":[{"id":"tx'); // truncated JSON
    const val = await manager().validate(info.id);
    expect(val.valid).toBe(false);
    expect(val.mismatched).toContain(JOURNAL_FILE);
  });

  it('C/D — MODIFIED archived content fails integrity and a restore REFUSES', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    await fs.writeFile(join(backupsDir, info.id, 'data', SINK_FILE), '{"records":[{"id":"tampered"}]}');
    expect((await manager().validate(info.id)).valid).toBe(false);
    const recoveryDir = join(root, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });
    const res = await manager(recoveryDir).restore(info.id, ['business']);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/integrity/i);
  });

  it('E — a MISSING required store in the archive is rejected', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    await fs.rm(join(backupsDir, info.id, 'data', JOURNAL_FILE));
    const val = await manager().validate(info.id);
    expect(val.valid).toBe(false);
    expect(val.missing).toContain(JOURNAL_FILE);
  });

  it('F — a MISSING manifest is rejected (restore aborts)', async () => {
    await seedState();
    const info = await manager().create('manual', ['business']);
    await fs.rm(join(backupsDir, info.id, 'manifest.json'));
    const recoveryDir = join(root, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });
    const res = await manager(recoveryDir).restore(info.id, ['business']);
    expect(res.ok).toBe(false);
  });

  it('G — a FAILED (refused) restore leaves the canonical data untouched', async () => {
    const { journal } = await seedState();
    const info = await manager().create('manual', ['business']);
    // tamper the archive so restore refuses on integrity
    await fs.writeFile(join(backupsDir, info.id, 'data', JOURNAL_FILE), '{"records":[]}');
    const canonicalBefore = await fs.readFile(join(dataDir, JOURNAL_FILE), 'utf8');
    const res = await manager().restore(info.id, ['business']); // restore over the SAME dataDir
    expect(res.ok).toBe(false);
    const canonicalAfter = await fs.readFile(join(dataDir, JOURNAL_FILE), 'utf8');
    expect(canonicalAfter).toBe(canonicalBefore); // pre-flight refuses before any write
    // and the canonical store still reloads to its real state
    await journal.reload();
    expect(journal.records('tenant-A').length).toBe(3);
  });

  it('H — after a backup, a RESTART reloads the original canonical state (backup is read-only)', async () => {
    const { journal } = await seedState();
    const before = await fs.readFile(join(dataDir, JOURNAL_FILE), 'utf8');
    await manager().create('manual', ['business']);
    const after = await fs.readFile(join(dataDir, JOURNAL_FILE), 'utf8');
    expect(after).toBe(before); // create() never mutates canonical files
    await journal.reload();
    expect(journal.records('tenant-A').length).toBe(3);
    expect(journal.pendingOutbox('tenant-A').length).toBe(2);
  });
});

// ===========================================================================
// §7I / §10 — concurrent reads/writes during backup (S33 compatibility)
// ===========================================================================

describe('S36 · concurrency (S33 atomic-write compatibility)', () => {
  it('I — concurrent journal READS during a backup never corrupt or block the backup', async () => {
    const { journal } = await seedState();
    const [info] = await Promise.all([
      manager().create('manual', ['business']),
      ...Array.from({ length: 8 }, () => Promise.resolve(journal.records('tenant-A').length)),
    ]);
    expect((await manager().validate(info.id)).valid).toBe(true);
  });

  it('§10 — concurrent WRITES during a backup: the archive captures COMPLETE JSON, no records lost', async () => {
    const { journal } = await seedState();
    // Interleave live commits with a backup. DurableJsonStore writes atomically (tmp+rename, S33), so
    // copyFile always sees a whole file — never partial JSON — and no committed record is lost.
    const writes = Promise.all([
      commit(journal, 'tenant-A', 'c1', 'SO-C1'),
      commit(journal, 'tenant-A', 'c2', 'SO-C2'),
      commit(journal, 'tenant-A', 'c3', 'SO-C3'),
    ]);
    const [info] = await Promise.all([manager().create('manual', ['business']), writes]);
    // the archived journal file is always parseable (no torn write captured)
    const archived = await fs.readFile(join(backupsDir, info.id, 'data', JOURNAL_FILE), 'utf8');
    expect(() => JSON.parse(archived)).not.toThrow();
    // S33 no-loss: the canonical store, reloaded, holds all 6 records (3 seed + 3 concurrent)
    await journal.reload();
    expect(journal.records('tenant-A').length).toBe(6);
  });
});
