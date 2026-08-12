/**
 * P13C ROUND 11 — M-6 / M-9. THE COMPANION FIXES THAT SHIPPED WITHOUT A TEST.
 *
 * Both fixes were already in the working tree when this round opened, in
 * `deviceRegistryStore.ts` and `gatewayServer.ts`, carrying full reasoning in
 * their comments and NO REGRESSION TEST ANYWHERE. By this program's own
 * standard that is not a closed finding: an unproven guard is indistinguishable
 * from a guard that never bites, and the next refactor deletes it silently.
 * These are the tests.
 *
 * M-6 — `activeCount()` walked every device row on the install with no `mine()`
 * and no `scopeOrDeny()`, while `list`/`get`/`mine` had all been scoped in
 * Round 8 and `CompanionDevices` taken off the public allowlist for exactly that
 * reason. The row list was locked and a COUNT OF THE SAME ROWS was left open, on
 * a channel with no auth: it reaches the renderer through
 * `CompanionStatusDto.deviceCount` and the `announce()` broadcast. A count that
 * rises while you pair nothing says another organization just paired a phone.
 *
 * M-9 — a pairing QR is a CAPABILITY minted under one organization and redeemed
 * up to five minutes later. `register()` stamped the owner from the LIVE
 * resolver at redeem time, so a code that printed "Alpha" bound the phone into
 * Beta if the desktop user switched inside the window. The authorized owner is
 * part of the capability, not of the moment it is spent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { CompanionDeviceStore } from '../companion/deviceRegistryStore';

let dir: string;
let file: string;
let who: TenantScope | null = null;
let store: CompanionDeviceStore;

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-c', workspaceId: 'ws-c' };

beforeEach(async () => {
  dir = join(tmpdir(), `np-r11-companion-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  file = join(dir, 'companion-devices.json');
  store = new CompanionDeviceStore(file).bindScope(() => who);
  await store.load();
  who = null;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Pair `n` devices while `scope` is active. */
async function pairAs(scope: TenantScope | null, n: number, tag: string): Promise<void> {
  who = scope;
  for (let i = 0; i < n; i += 1) {
    await store.register({
      name: `${tag}-${i}`,
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: `PK-${tag}-${i}`,
      boundMember: `${tag}@example.test`,
      boundTenantId: null,
      now: '2026-08-12T00:00:00.000Z',
    });
  }
  who = null;
}

describe('M-6 — a device COUNT is one organization’s, like the rows it counts', () => {
  it('A counts 2, B counts 3, C counts 4 — never the install total of 9', async () => {
    await pairAs(A, 2, 'a');
    await pairAs(B, 3, 'b');
    await pairAs(C, 4, 'c');

    who = A;
    expect(store.activeCount()).toBe(2);
    who = B;
    expect(store.activeCount()).toBe(3);
    who = C;
    expect(store.activeCount()).toBe(4);
  });

  it('the count agrees with the row list it counts — one boundary, not two', async () => {
    await pairAs(A, 2, 'a');
    await pairAs(B, 3, 'b');
    for (const scope of [A, B]) {
      who = scope;
      expect(store.activeCount()).toBe(store.list().length);
    }
  });

  it('an unresolved scope counts NOTHING, never everything', async () => {
    await pairAs(A, 2, 'a');
    await pairAs(B, 3, 'b');
    who = null;
    // The honest answer to "whose devices are these" with no organization
    // active is none of them — matching `mine`, which denies on no scope.
    expect(store.activeCount()).toBe(0);
  });

  it('revoking A’s device does not change B’s count', async () => {
    await pairAs(A, 2, 'a');
    await pairAs(B, 3, 'b');
    who = A;
    const [first] = store.list();
    expect(await store.revoke(first!.id)).toBe(true);
    expect(store.activeCount()).toBe(1);
    who = B;
    expect(store.activeCount()).toBe(3);
  });
});

describe('M-9 — the pairing owner is the one that AUTHORIZED it', () => {
  it('a QR minted under A binds to A even though B is active at redeem', async () => {
    // The desktop user switched organizations inside the five-minute window.
    who = B;
    const device = await store.register({
      name: 'phone',
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: 'PK-minted',
      boundMember: 'a@example.test',
      boundTenantId: null,
      // Captured by `mintPairingQr` when `companion:pairingQr` (org:manage) ran.
      mintedTenantId: A.tenantId,
      now: '2026-08-12T00:00:00.000Z',
    });
    expect(device.boundTenantId).toBe('org-a');

    // And it is genuinely A's row: B cannot see it, A can.
    who = B;
    expect(store.list().some((d) => d.id === device.id)).toBe(false);
    who = A;
    expect(store.list().some((d) => d.id === device.id)).toBe(true);
  });

  it('a QR minted with NO organization pairs an unowned device, not B’s', async () => {
    // `null` is a real answer, not "fall through to the resolver": a QR that
    // authorized nothing must not adopt whoever is on screen at redeem.
    who = B;
    const device = await store.register({
      name: 'phone',
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: 'PK-null-mint',
      boundMember: 'x@example.test',
      boundTenantId: null,
      mintedTenantId: null,
      now: '2026-08-12T00:00:00.000Z',
    });
    expect(device.boundTenantId).toBeNull();
    who = B;
    expect(store.list().some((d) => d.id === device.id)).toBe(false);
  });

  it('with NO minted owner the Round 8 behaviour is unchanged — resolver wins', async () => {
    // The regression risk of this fix is that it becomes a caller-supplied
    // owner. Absent the field, the live resolver still decides.
    who = B;
    const device = await store.register({
      name: 'phone',
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: 'PK-no-mint',
      boundMember: 'b@example.test',
      boundTenantId: null,
      now: '2026-08-12T00:00:00.000Z',
    });
    expect(device.boundTenantId).toBe('org-b');
  });

  it('a caller-supplied boundTenantId still cannot override the resolver', async () => {
    // Round 8's rule, re-asserted: the payload does not get to name the owner.
    who = B;
    const device = await store.register({
      name: 'phone',
      platform: 'ios',
      model: 'iPhone17,1',
      publicKeyB64: 'PK-spoof',
      boundMember: 'evil@example.test',
      boundTenantId: A.tenantId, // spoofed
      now: '2026-08-12T00:00:00.000Z',
    });
    expect(device.boundTenantId).toBe('org-b');
  });
});
