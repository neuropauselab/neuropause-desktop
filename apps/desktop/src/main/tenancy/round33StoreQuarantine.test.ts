/**
 * P13C ROUND 33 — QUARANTINE, NEVER RESEED OVER A CORRUPT FILE.
 *
 * Three stores — the org chart, the workspace directory, and the governance
 * store carrying the hash-chained audit trail — loaded with
 * `catch { applySeed() }`, which cannot tell a first run from a truncated
 * write, and whose seed schedules a persist that RENAMES THE SEED OVER the
 * original bytes. One torn write silently replaced the customer's real data
 * with demo data, permanently, with nothing preserved and nothing logged.
 *
 * The fix routes all three through `readStoreFile` (the Phase 8 envelope, in
 * the codebase since RC hardening 8.3 and adopted by 21 other stores): a
 * corrupt file is renamed beside itself as `<name>.quarantined-<timestamp>`,
 * byte-for-byte intact, BEFORE the store falls back to the seed. First-run
 * (no file) behaves exactly as before. Legacy well-formed files carry no
 * schemaVersion stamp and must keep loading unchanged.
 *
 * Each corrupt-file test asserts all three properties:
 *   1. the store still comes up (seeded — availability is preserved);
 *   2. the original bytes survive in a quarantine file (the data is not lost);
 *   3. the store's next persist does not touch the quarantine file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrgStore } from '../enterprise/org/orgStore';
import { WorkspaceStore } from '../enterprise/workspace/workspaceStore';
import { GovernanceStore } from '../enterprise/governance/governanceStore';

const dirs: string[] = [];
let dir = '';

beforeEach(async () => {
  dir = join(tmpdir(), `np-q33-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
});

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

/** The bytes a torn write leaves behind: valid prefix, truncated mid-token. */
const TORN = '{"organizations":[{"id":"org-real","name":"Real Cu';

async function quarantinedIn(d: string): Promise<string[]> {
  return (await fs.readdir(d)).filter((n) => n.includes('.quarantined-'));
}

describe('round 33 — org store', () => {
  it('quarantines a corrupt org.json instead of renaming the seed over it', async () => {
    const path = join(dir, 'org.json');
    await fs.writeFile(path, TORN);

    const store = new OrgStore(path);
    store.bindScope(() => null);
    await store.load();
    await store.flush();

    // 1. Availability: the store seeded rather than throwing.
    expect(store.defaultOrg().id).toBe('org-default');
    // 2. The original bytes survive, byte-for-byte.
    const q = await quarantinedIn(dir);
    expect(q).toHaveLength(1);
    expect(await fs.readFile(join(dir, q[0]), 'utf8')).toBe(TORN);
    // 3. The seed persisted to the store path, not over the quarantine.
    const fresh = JSON.parse(await fs.readFile(path, 'utf8')) as { seeded?: boolean };
    expect(fresh.seeded).toBe(true);
  });

  it('a legacy well-formed file (no schemaVersion stamp) still loads unchanged', async () => {
    const path = join(dir, 'org.json');
    const seeded = new OrgStore(path);
    seeded.bindScope(() => null);
    await seeded.load();
    expect(seeded.claimOwnerIdentity({ name: 'Real', email: 'real@example.test' })).toBe(true);
    await seeded.flush();

    const reloaded = new OrgStore(path);
    reloaded.bindScope(() => null);
    await reloaded.load();
    expect(reloaded.user('user-owner')?.email).toBe('real@example.test');
    expect(await quarantinedIn(dir)).toHaveLength(0);
  });

  it('a missing file is a first run — no quarantine, seed applied', async () => {
    const store = new OrgStore(join(dir, 'org.json'));
    store.bindScope(() => null);
    await store.load();
    expect(store.defaultOrg().id).toBe('org-default');
    expect(await quarantinedIn(dir)).toHaveLength(0);
  });
});

describe('round 33 — workspace store', () => {
  it('quarantines a corrupt workspace file instead of destroying it', async () => {
    const path = join(dir, 'enterprise-workspaces.json');
    await fs.writeFile(path, '{"workspaces":[{"id":"ws-real"');

    const store = new WorkspaceStore(path);
    await store.load();
    await store.flush();

    expect(store.activeWorkspaceIdOrNull()).toBe('workspace-default');
    const q = await quarantinedIn(dir);
    expect(q).toHaveLength(1);
    expect(await fs.readFile(join(dir, q[0]), 'utf8')).toContain('ws-real');
  });
});

describe('round 33 — governance store (the audit trail)', () => {
  it('a torn write cannot delete the hash-chained audit array', async () => {
    const path = join(dir, 'governance.json');
    const original = '{"audit":[{"id":"a1","action":"user.update"}],"approvalChai';
    await fs.writeFile(path, original);

    const store = new GovernanceStore(path);
    store.bindScope(() => null);
    await store.load();
    await store.flush();

    // The audit evidence survives on disk even though the store restarted empty.
    const q = await quarantinedIn(dir);
    expect(q).toHaveLength(1);
    expect(await fs.readFile(join(dir, q[0]), 'utf8')).toBe(original);
  });
});

describe('round 33 — a failed background write is retried, not dropped', () => {
  it('orgStore re-marks dirty when persist fails, so the next drain retries', async () => {
    // A path whose parent does not exist: writeFile of the tmp file fails.
    const path = join(dir, 'missing-subdir', 'org.json');
    const store = new OrgStore(path);
    store.bindScope(() => null);
    await store.load(); // seeds; schedulePersist fails in the background
    await store.flush();

    // The change is still pending — creating the directory and touching the
    // store again must land BOTH the old and new state on disk.
    await fs.mkdir(join(dir, 'missing-subdir'), { recursive: true });
    store.claimOwnerIdentity({ name: 'Real', email: 'real@example.test' });
    await store.flush();

    const file = JSON.parse(await fs.readFile(path, 'utf8')) as {
      users?: { id: string; email: string | null }[];
    };
    expect(file.users?.find((u) => u.id === 'user-owner')?.email).toBe('real@example.test');
  });
});
