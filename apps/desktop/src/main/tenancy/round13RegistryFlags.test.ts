/**
 * P13C ROUND 13 — M-13. A PER-USER PREFERENCE STORED ON A SHARED ROW.
 *
 * `pinned` and `favorite` lived on the install-global `RegistryEntry`, and
 * `registry:setFlags` was PUBLIC — no auth, no permission. So tenant A
 * un-pinning an app un-pinned it for tenant B, from a context that had not
 * signed in.
 *
 * THE FILE CONTRADICTED ITSELF ABOUT THIS, which is why five rounds walked past
 * it: `registry.ts` called the flags *"display flags shared by everyone who uses
 * the install"* in one comment and *"per-user display flags"* in another. Round 9
 * (F4) verified the payload WHITELIST — the mutation can only reach those two
 * fields — and that verification was correct and is untouched. What it never
 * asked was where the write LANDED.
 *
 * The fix follows `usageByTenant`, the pattern this same file already uses for
 * the other per-tenant projection over a shared row. Legacy values are kept as
 * the default rather than migrated: they belonged to no organization, so
 * promoting them to one would invent provenance and dropping them would unpin
 * every app on every existing install.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let dir: string;

vi.mock('electron', () => ({ app: { getPath: () => dir } }));

const { registry } = await import('../registry/registry');
const { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS } = await import('../ipc/runtimeAuthz');
const { IpcChannel } = await import('@neuropause/shared');

const A = 'org-a';
const B = 'org-b';
const C = 'org-c';
let who: string | null = null;
const reg = registry;

async function seed(slug: string): Promise<void> {
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
}

beforeEach(async () => {
  dir = join(tmpdir(), `np-r13-reg-${randomUUID()}`);
  await fs.mkdir(join(dir, 'registry'), { recursive: true });
  reg.bindUsageScope(() => who);
  await reg.load();
  who = null;
  await seed('widget');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
});

describe('a pin belongs to the organization that set it', () => {
  it('A pins; B does not see it pinned', async () => {
    who = A;
    expect((await reg.setFlags('widget', { pinned: true }))?.pinned).toBe(true);
    who = B;
    expect(reg.get('widget')?.pinned).toBe(false);
    who = A;
    expect(reg.get('widget')?.pinned).toBe(true);
  });

  it('B pins independently; A is unchanged', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    await reg.setFlags('widget', { pinned: true, favorite: true });

    who = A;
    expect(reg.get('widget')?.pinned).toBe(true);
    expect(reg.get('widget')?.favorite).toBe(false);
    who = B;
    expect(reg.get('widget')?.favorite).toBe(true);
  });

  it('A UNPINNING does not unpin B — the original finding, exactly', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    await reg.setFlags('widget', { pinned: true });

    who = A;
    await reg.setFlags('widget', { pinned: false });
    expect(reg.get('widget')?.pinned).toBe(false);

    who = B;
    expect(reg.get('widget')?.pinned).toBe(true);
  });

  it('C, who set nothing, sees the default rather than A’s choice', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true, favorite: true });
    who = C;
    expect(reg.get('widget')?.pinned).toBe(false);
    expect(reg.get('widget')?.favorite).toBe(false);
  });

  it('`list` agrees with `get` — one projection, not two', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    expect(reg.list().find((e) => e.slug === 'widget')?.pinned).toBe(false);
    who = A;
    expect(reg.list().find((e) => e.slug === 'widget')?.pinned).toBe(true);
  });
});

describe('legacy flags become the default, and are not destroyed', () => {
  it('a pre-M-13 shared pin shows for every tenant until one overrides it', async () => {
    // The migrated state: a row carrying a shared flag nobody owns.
    await reg.patch('widget', (e) => {
      e.pinned = true;
    });

    for (const scope of [A, B, C]) {
      who = scope;
      expect(reg.get('widget')?.pinned, `${scope} should inherit the legacy default`).toBe(true);
    }

    // A diverges; B and C keep the default.
    who = A;
    await reg.setFlags('widget', { pinned: false });
    expect(reg.get('widget')?.pinned).toBe(false);
    who = B;
    expect(reg.get('widget')?.pinned).toBe(true);
  });
});

describe('the split survives a reload from disk', () => {
  it('A and B keep their independent flags after reopening', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    await reg.setFlags('widget', { favorite: true });

    await reg.load(); // re-read from disk

    who = A;
    expect(reg.get('widget')?.pinned).toBe(true);
    expect(reg.get('widget')?.favorite).toBe(false);
    who = B;
    expect(reg.get('widget')?.pinned).toBe(false);
    expect(reg.get('widget')?.favorite).toBe(true);
  });
});

describe('M-13 must not reopen M-10 through a new field', () => {
  /**
   * `export()` is a spread of `...this.file`. Adding a second per-tenant map is
   * exactly how M-10 happened — one field filtered, another added later and
   * forgotten. The filter ships in the same change as the field.
   */
  it('the export carries only the caller’s flags bucket', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    await reg.setFlags('widget', { favorite: true });

    who = A;
    const bytes = reg.export();
    expect(bytes).not.toContain(B);
    const parsed = JSON.parse(bytes) as { flagsByTenant: Record<string, unknown> };
    expect(Object.keys(parsed.flagsByTenant)).toEqual([A]);
  });

  it('the lossless backup still holds every tenant’s flags', async () => {
    who = A;
    await reg.setFlags('widget', { pinned: true });
    who = B;
    await reg.setFlags('widget', { favorite: true });
    const saved = JSON.parse(await fs.readFile(await reg.backup(), 'utf8')) as {
      flagsByTenant: Record<string, unknown>;
    };
    expect(Object.keys(saved.flagsByTenant).sort()).toEqual([A, B].sort());
  });
});

describe('the channel is no longer an unauthenticated mutation', () => {
  it('registry:setFlags is gated at dashboard:read and is not public', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.RegistrySetFlags]).toBe('dashboard:read');
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistrySetFlags)).toBe(false);
  });

  it('the registry inventory READS stay public — only the write moved', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistryList)).toBe(true);
    expect(PUBLIC_CHANNELS.has(IpcChannel.RegistryGet)).toBe(true);
  });
});
