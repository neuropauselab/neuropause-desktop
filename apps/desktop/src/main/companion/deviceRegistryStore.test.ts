/**
 * P13C Round 8 — `CompanionDeviceStore` gained the tenant boundary it never had:
 * rows carried `boundTenantId` and no read consulted it, while the list channel was
 * PUBLIC. An unbound store now denies every read, so these suites act AS one
 * tenant; cross-tenant behaviour is asserted in tenancy/e2e/round8Tenancy.test.ts.
 */
/**
 * Mobile M1-03 — companion device registry. Locks the envelope contract
 * (corrupt file quarantined, not reset), settings persistence, re-pair-replaces
 * semantics, tombstone revocation, and the replay high-water mark.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CompanionDeviceStore,
  DEFAULT_COMPANION_PORT,
  toCompanionDeviceDto,
} from './deviceRegistryStore';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = join(tmpdir(), `np-companion-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  file = join(dir, 'companion-devices.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const REG = {
  name: 'iPhone',
  platform: 'ios' as const,
  model: 'iPhone17,1',
  publicKeyB64: 'PK-1',
  boundMember: 'a@b.com',
  now: '2026-08-07T00:00:00.000Z',
};

describe('CompanionDeviceStore', () => {
  it('registers, lists, revokes, and counts active devices', async () => {
    const store = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await store.load();
    expect(store.isEnabled()).toBe(false);
    expect(store.getPort()).toBe(DEFAULT_COMPANION_PORT);

    const d = await store.register(REG);
    expect(store.activeCount()).toBe(1);
    expect(store.activeByPublicKey('PK-1')?.id).toBe(d.id);
    expect(toCompanionDeviceDto(d).revoked).toBe(false);

    expect(await store.revoke(d.id)).toBe(true);
    expect(store.activeCount()).toBe(0);
    expect(store.activeByPublicKey('PK-1')).toBeNull();
    expect(await store.revoke(d.id)).toBe(false); // idempotent
  });

  it('re-pairing the same key replaces the record and preserves createdAt', async () => {
    const store = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await store.load();
    const first = await store.register(REG);
    const second = await store.register({
      ...REG,
      name: 'iPhone renamed',
      now: '2026-08-08T00:00:00.000Z',
    });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe('iPhone renamed');
    expect(store.activeCount()).toBe(1);
  });

  it('persists enabled + devices across reload', async () => {
    const a = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await a.load();
    await a.setEnabled(true);
    await a.register(REG);
    const b = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await b.load();
    expect(b.isEnabled()).toBe(true);
    expect(b.activeCount()).toBe(1);
  });

  it('quarantines a corrupt file instead of resetting', async () => {
    await fs.writeFile(file, '{ not json');
    const store = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await store.load();
    expect(store.quarantinedTo).not.toBeNull();
    const entries = await fs.readdir(dir);
    expect(entries.some((n) => n.includes('.quarantined-'))).toBe(true);
  });

  it('advances the replay high-water mark on touch and ignores regressions', async () => {
    const store = new CompanionDeviceStore(file).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
    await store.load();
    const d = await store.register(REG);
    await store.touch(d.id, 5, '2026-08-07T01:00:00.000Z');
    expect(store.get(d.id)?.lastSeq).toBe(5);
    await store.touch(d.id, 3, '2026-08-07T02:00:00.000Z'); // lower seq ignored
    expect(store.get(d.id)?.lastSeq).toBe(5);
  });
});
