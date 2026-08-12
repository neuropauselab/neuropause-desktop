/**
 * P13C ROUND 12 — M-10. THE EXPORT CONTRADICTED ITSELF.
 *
 * Round 9 (F20) established that per-app launch counters are cross-tenant
 * activity data: how many times each organization launched each app, and when.
 * It removed them from `registry:list` by making `toDto` read the CALLER'S
 * bucket out of `usageByTenant` instead of the row's own accumulation.
 *
 * `export()` was fixed in the same round — but only halfway. It filtered
 * `usageByTenant` to the caller's key and then spread `...this.file` for
 * everything else, so the RAW `entries` rows went out untouched. `RegistryEntry`
 * still carries `launchCount`, `lastLaunchedAt` and `usage` as the install-wide
 * total. The one field the function withheld, another field disclosed.
 *
 * Round 11 gated the channel (`cloud:operate`), which bounded WHO could reach
 * it. It did not touch the bytes. This closes the bytes.
 *
 * AND IT FIXES A DATA-LOSS PATH ON THE WAY. `backup()` called `export()`, so a
 * backup kept only the taker's usage bucket and silently discarded every other
 * organization's launch history — and `restore()` is `import(raw, {merge:false})`,
 * which writes that loss back as fact. Splitting `serializeAll()` (lossless,
 * backup) from `export()` (authorized view) is what makes narrowing the export
 * safe; without the split, tightening the export would have deepened the loss.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let dir: string;

vi.mock('electron', () => ({
  app: { getPath: () => dir },
}));

const { registry } = await import('../registry/registry');

const A = 'org-a';
const B = 'org-b';
const C = 'org-c';

let who: string | null = null;
const reg = registry;

beforeEach(async () => {
  dir = join(tmpdir(), `np-r12-reg-${randomUUID()}`);
  await fs.mkdir(join(dir, 'registry'), { recursive: true });
  // The singleton, bound through its real API — `bindUsageScope` is the seam
  // `recordLaunch` and `export` both read.
  reg.bindUsageScope(() => who);
  await reg.load();
  who = null;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Install one app, then record `n` launches as `tenant`. */
async function seed(slug: string, launchesBy: Array<[string, number]>): Promise<void> {
  who = null;
  await reg.upsert({
    slug,
    name: `App ${slug}`,
    appType: 'web',
    installedVersion: '1.0.0',
    channel: 'stable',
    installLocation: null,
    packageHash: null,
    signatureKeyId: null,
    hasSignature: false,
    previousVersion: null,
    previousPackageHash: null,
    grantedPermissions: [],
    permissionGrants: [],
    launchCount: 0,
    lastLaunchedAt: null,
    installedAt: new Date().toISOString(),
    lastUpdatedAt: null,
    runtimeStatus: 'stopped',
    healthStatus: 'unknown',
    diskUsageBytes: null,
    pinned: false,
    favorite: false,
    config: {},
    usage: { launches: 0, totalActiveMs: 0, lastSessionAt: null },
  } as never);
  for (const [tenant, n] of launchesBy) {
    who = tenant;
    for (let i = 0; i < n; i += 1) await reg.recordLaunch(slug);
  }
  who = null;
}

describe('the export carries the CALLER’s counters, never the install total', () => {
  it('A exporting sees A’s 3 launches, not the install-wide 3+7+11', async () => {
    await seed('alpha-app', [[A, 3], [B, 7], [C, 11]]);

    who = A;
    const parsed = JSON.parse(reg.export()) as {
      entries: Record<string, { launchCount: number; usage: { launches: number } }>;
      usageByTenant: Record<string, unknown>;
    };

    const row = parsed.entries['alpha-app']!;
    // THE FINDING, as one number. The raw row held 21.
    expect(row.launchCount).toBe(3);
    expect(row.usage.launches).toBe(3);

    // And the map half stays filtered, as Round 9 established.
    expect(Object.keys(parsed.usageByTenant)).toEqual([A]);
  });

  it('B and C each see only their own, from the same install', async () => {
    await seed('alpha-app', [[A, 3], [B, 7], [C, 11]]);

    who = B;
    expect(
      (JSON.parse(reg.export()) as { entries: Record<string, { launchCount: number }> })
        .entries['alpha-app']!.launchCount,
    ).toBe(7);

    who = C;
    expect(
      (JSON.parse(reg.export()) as { entries: Record<string, { launchCount: number }> })
        .entries['alpha-app']!.launchCount,
    ).toBe(11);
  });

  it('the export bytes contain no other tenant’s id anywhere', async () => {
    await seed('alpha-app', [[A, 3], [B, 7], [C, 11]]);
    who = A;
    const bytes = reg.export();
    // The blunt check: a string search over the whole payload.
    expect(bytes).not.toContain(B);
    expect(bytes).not.toContain(C);
  });

  it('an unresolved caller exports zeroed counters, not the aggregate', async () => {
    await seed('alpha-app', [[A, 3], [B, 7]]);
    who = null;
    const row = (JSON.parse(reg.export()) as { entries: Record<string, { launchCount: number }> })
      .entries['alpha-app']!;
    expect(row.launchCount).toBe(0);
  });

  it('install metadata SURVIVES — the fix is a boundary, not redaction', async () => {
    // Scrubbing everything would make a re-import lossy and would be hiding
    // data rather than closing a leak. Only the tenant-derived fields move.
    await seed('alpha-app', [[A, 3]]);
    who = A;
    const row = (JSON.parse(reg.export()) as {
      entries: Record<string, { slug: string; name: string; installedAt: string }>;
    }).entries['alpha-app']!;
    expect(row.slug).toBe('alpha-app');
    expect(row.name).toBe('App alpha-app');
    expect(row.installedAt).toBeTruthy();
  });
});

describe('the backup stays LOSSLESS — the data-loss path this fix closes', () => {
  it('a backup taken by A still contains B’s and C’s counters', async () => {
    await seed('alpha-app', [[A, 3], [B, 7], [C, 11]]);

    who = A;
    const path = await reg.backup();
    const saved = JSON.parse(await fs.readFile(path, 'utf8')) as {
      entries: Record<string, { launchCount: number }>;
      usageByTenant: Record<string, Record<string, { launchCount: number }>>;
    };

    // Every organization's bucket survives — restore() is merge:false, so a
    // scrubbed backup would have written the loss back as fact.
    expect(Object.keys(saved.usageByTenant).sort()).toEqual([A, B, C].sort());
    expect(saved.usageByTenant[B]!['alpha-app']!.launchCount).toBe(7);
    expect(saved.usageByTenant[C]!['alpha-app']!.launchCount).toBe(11);
    // The row's own counter is NOT the live meter: since Round 9 (F20)
    // `recordLaunch` writes only to `usageByTenant`, so on a post-F20 install
    // the row stays at whatever it was migrated with. Asserted so the next
    // reader does not mistake 0 for a lost count.
    expect(saved.entries['alpha-app']!.launchCount).toBe(0);
  });

  /**
   * THE ACTUAL LEAK SHAPE, exercised directly.
   *
   * `recordLaunch` has written only to `usageByTenant` since F20, so a row's
   * `launchCount` is non-zero ONLY on an install migrated from a pre-F20
   * `registry.json` — where it holds the install-wide accumulation frozen at
   * migration. That is the data M-10 exported: historical, not live, and no
   * less cross-tenant for being historical. The fix is worth having precisely
   * because every long-lived install has it and no test could see it.
   */
  it('a MIGRATED legacy row’s install-wide counter is scrubbed from the export', async () => {
    await seed('legacy-app', [[A, 3]]);
    // Simulate the migrated state: a row carrying the pre-F20 aggregate.
    await reg.patch('legacy-app', (e) => {
      e.launchCount = 4242;
      e.lastLaunchedAt = '2025-01-01T00:00:00.000Z';
      e.usage = { launches: 4242, totalActiveMs: 999_999, lastSessionAt: '2025-01-01T00:00:00.000Z' };
    });

    who = A;
    const row = (JSON.parse(reg.export()) as {
      entries: Record<string, { launchCount: number; lastLaunchedAt: string | null; usage: { launches: number; totalActiveMs: number } }>;
    }).entries['legacy-app']!;

    // A's own three, not the migrated 4242.
    expect(row.launchCount).toBe(3);
    expect(row.usage.launches).toBe(3);
    expect(row.usage.totalActiveMs).toBe(0);
    expect(row.lastLaunchedAt).not.toBe('2025-01-01T00:00:00.000Z');
    expect(reg.export()).not.toContain('4242');

    // …and the lossless backup still carries it, so nothing is destroyed.
    expect(await fs.readFile(await reg.backup(), 'utf8')).toContain('4242');
  });

  it('backup and export are genuinely different bytes', async () => {
    await seed('alpha-app', [[A, 3], [B, 7]]);
    who = A;
    const exported = reg.export();
    const backedUp = await fs.readFile(await reg.backup(), 'utf8');
    expect(exported).not.toBe(backedUp);
    expect(backedUp).toContain(B);
    expect(exported).not.toContain(B);
  });
});
