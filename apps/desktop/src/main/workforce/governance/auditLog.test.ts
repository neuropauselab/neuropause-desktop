import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkforceAuditEntry } from '@neuropause/shared';
import { AuditLog } from './auditLog';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

/**
 * REP conversion (Workstream 10 — audit integrity): the governance audit log was
 * labeled "append-only, never removed" but silently trimmed past a cap and had no
 * tamper-evidence. It is now a SHA-256 hash chain, checkpointed across rotation,
 * with explicit dropped/total counters and a verifyIntegrity() check. These tests
 * prove: the chain verifies; mutation/deletion is detected; rotation is honest and
 * still verifiable; and legacy files upgrade in place.
 */

function tempPath(): string {
  // A per-call UUID, not pid+counter: pids recycle, so a crashed earlier run
  // (or a sibling worker) could leave a file this test would then LOAD —
  // reporting 20 entries after recording 10. The assertions are untouched;
  // only the collision-prone path scheme changes (matching governance.test.ts).
  return join(tmpdir(), `np-audit-test-${randomUUID()}.json`);
}

function entry(i: number, over: Partial<WorkforceAuditEntry> = {}): WorkforceAuditEntry {
  return {
    id: `entry-${i}`,
    at: `2026-07-24T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    workerId: `worker-${i % 3}`,
    workerRole: 'founder',
    skillId: `skill-${i}`,
    requestId: `req-${i}`,
    decision: 'allow',
    risk: 'low',
    summary: `decision ${i}`,
    ...over,
  };
}

describe('AuditLog — tamper-evident hash chain (REP Workstream 10)', () => {
  const paths: string[] = [];
  beforeEach(() => paths.length === 0);
  afterEach(async () => {
    for (const p of paths.splice(0)) {
      await fs.rm(p, { force: true }).catch(() => undefined);
      await fs.rm(`${p}.tmp`, { force: true }).catch(() => undefined);
    }
  });
  function newLog(opts?: { maxEntries?: number }): { log: AuditLog; path: string } {
    const path = tempPath();
    paths.push(path);
    return { log: new AuditLog(path, opts).bindScope(() => TEST_TENANT_SCOPE), path };
  }

  it('records entries and verifies the chain', async () => {
    const { log } = newLog();
    await log.load();
    for (let i = 0; i < 10; i++) log.record(entry(i));
    expect(log.size()).toBe(10);
    expect(log.totalRecorded()).toBe(10);
    const r = log.verifyIntegrity();
    expect(r.ok).toBe(true);
    expect(r.retained).toBe(10);
    expect(r.dropped).toBe(0);
  });

  it('persists and reloads with the chain intact', async () => {
    const { log, path } = newLog();
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    await reopened.load();
    expect(reopened.size()).toBe(5);
    expect(reopened.verifyIntegrity().ok).toBe(true);
    expect(reopened.page().entries[0].id).toBe('entry-4'); // newest first
  });

  it('DETECTS a mutated entry after reload (tamper-evidence)', async () => {
    const { log, path } = newLog();
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    // Tamper: flip a summary in the persisted file, keep integrity.head.
    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.entries[2].summary = 'FORGED';
    await fs.writeFile(path, JSON.stringify(raw));

    let violated = false;
    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    reopened.on('integrity-violation', () => (violated = true));
    await reopened.load();
    expect(reopened.verifyIntegrity().ok).toBe(false);
    expect(violated).toBe(true);
  });

  it('DETECTS a deleted entry after reload', async () => {
    const { log, path } = newLog();
    await log.load();
    for (let i = 0; i < 5; i++) log.record(entry(i));
    await log.flush();

    const raw = JSON.parse(await fs.readFile(path, 'utf8'));
    raw.entries.splice(1, 1); // remove one entry, keep the recorded head
    await fs.writeFile(path, JSON.stringify(raw));

    const reopened = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    await reopened.load();
    expect(reopened.verifyIntegrity().ok).toBe(false);
  });

  it('bounds retention honestly and still verifies across rotation', async () => {
    const { log } = newLog({ maxEntries: 3 });
    await log.load();
    for (let i = 0; i < 8; i++) log.record(entry(i));
    expect(log.size()).toBe(3); // retained window
    expect(log.totalRecorded()).toBe(8); // nothing silently lost
    const r = log.verifyIntegrity();
    expect(r.ok).toBe(true); // chain checkpointed across the 5 drops
    expect(r.dropped).toBe(5);
    expect(r.retained).toBe(3);
    // The retained window is the newest 3.
    expect(log.page().entries.map((e) => e.id)).toEqual(['entry-7', 'entry-6', 'entry-5']);
  });

  it('rotation survives a persist/reload round-trip', async () => {
    const { log, path } = newLog({ maxEntries: 3 });
    await log.load();
    for (let i = 0; i < 8; i++) log.record(entry(i));
    await log.flush();

    const reopened = new AuditLog(path, { maxEntries: 3 }).bindScope(() => TEST_TENANT_SCOPE);
    await reopened.load();
    expect(reopened.verifyIntegrity().ok).toBe(true);
    expect(reopened.totalRecorded()).toBe(8);
    expect(reopened.size()).toBe(3);
  });

  it('upgrades a legacy (unchained) file in place', async () => {
    const { path } = newLog();
    // Legacy format: entries only, no integrity block.
    await fs.writeFile(path, JSON.stringify({ entries: [entry(1), entry(2), entry(3)] }));

    const log = new AuditLog(path).bindScope(() => TEST_TENANT_SCOPE);
    await log.load();
    /**
     * P13C Round 2 — a LEGACY file's entries carry no owner.
     *
     * `size()` is tenant-facing, so the three upgraded rows are visible to
     * nobody: shown to no tenant, retained in the chain, and counted as
     * unresolved. That is the same rule every other pre-boundary store follows,
     * and it is why the count here is 0 rather than 3.
     */
    expect(log.size()).toBe(0);
    expect(log.ownershipCounts()).toEqual({ total: 3, assigned: 0, unresolved: 3 });
    /**
     * The INTEGRITY claim is unchanged and deliberately install-wide: it is a
     * statement about the chain, not about anyone's records. A per-tenant
     * integrity check would be a weaker claim, and the upgrade must still
     * verify across every retained entry.
     */
    expect(log.verifyIntegrity().ok).toBe(true); // chain rebuilt from the entries
    await log.flush();

    const rewritten = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(rewritten.integrity?.algo).toBe('sha256-chain-v1');
    expect(rewritten.integrity?.totalAppended).toBe(3);
  });
});
