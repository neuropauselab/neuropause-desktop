/**
 * Mobile M1-03 — the gateway's sealed dispatch, exercised end-to-end against a
 * real "phone" (the companion-protocol client side) with no socket. Locks:
 * pairing binds the phone's key and returns a sealed PairingResponse; an
 * authenticated op round-trips; an unpaired sender is refused; the replay guard
 * rejects a reused sequence; and a signed-out desktop refuses with a typed code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  decodePairingQr,
  fromB64,
  generateIdentityKeyPair,
  seal,
  unseal,
  type CompanionKeyPair,
  type CompanionResponse,
  type PairingResponse,
} from '@neuropause/companion-protocol';
import { CompanionDeviceStore } from './deviceRegistryStore';
import { CompanionGateway, type CompanionGatewayDeps } from './gatewayServer';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const NOW_ISO = '2026-08-07T12:00:00.000Z';
const PORT = 47600;

let dir: string;
let devices: CompanionDeviceStore;
let desktop: CompanionKeyPair;
let phone: CompanionKeyPair;
let signedIn: boolean;
let gateway: CompanionGateway;

beforeEach(async () => {
  dir = join(tmpdir(), `np-gw-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  devices = new CompanionDeviceStore(join(dir, 'companion-devices.json'));
  await devices.load();
  desktop = generateIdentityKeyPair();
  phone = generateIdentityKeyPair();
  signedIn = true;
  const deps: CompanionGatewayDeps = {
    identity: desktop,
    devices,
    isSignedIn: () => signedIn,
    currentMember: () => 'owner@acme.test',
    desktopName: () => 'Test Mac',
    orgName: () => 'Acme',
    // P13C Part 3 — the tenant a paired device belongs to. Named here so these
    // tests pair into a real tenant rather than the null (system-events-only)
    // case, which has its own coverage in companionEgressTenancy.test.ts.
    currentTenantId: () => 'org-acme',
    ops: {
      'session.hello': async (_p, ctx) => ({ deviceId: ctx.device.id, ok: true }),
    },
    now: () => NOW,
  };
  gateway = new CompanionGateway(deps);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Phone side: pair using a freshly minted QR, return the assigned deviceId. */
async function pair(): Promise<string> {
  const qr = decodePairingQr(gateway.mintPairingQr(PORT).qr);
  const envelope = seal({
    body: {
      kind: 'pairing-request',
      token: qr.token,
      device: { name: 'iPhone', platform: 'ios', model: 'iPhone17,1', appVersion: '0.1.0' },
    },
    seq: 0,
    sentAt: NOW_ISO,
    senderKeys: phone,
    recipientPublicKey: fromB64(qr.dpk),
  });
  const result = await gateway.handlePairing(envelope);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('pairing failed');
  const msg = unseal({ envelope: result.envelope, recipientKeys: phone });
  return (msg.body as PairingResponse).deviceId;
}

/** Phone side: seal an RPC request to the desktop. */
function rpc(seq: number, op = 'session.hello') {
  return seal({
    body: { id: `r${seq}`, op },
    seq,
    sentAt: NOW_ISO,
    senderKeys: phone,
    recipientPublicKey: desktop.publicKey,
  });
}

describe('CompanionGateway dispatch', () => {
  it('pairs the phone and binds its key', async () => {
    const deviceId = await pair();
    expect(deviceId).toMatch(/^cd_/);
    expect(devices.activeCount()).toBe(1);
    const record = devices.get(deviceId);
    expect(record?.boundMember).toBe('owner@acme.test');
    expect(record?.name).toBe('iPhone');
  });

  it('round-trips an authenticated op after pairing', async () => {
    const deviceId = await pair();
    const result = await gateway.handleRpc(rpc(0));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('rpc failed');
    const res = unseal({ envelope: result.envelope, recipientKeys: phone })
      .body as CompanionResponse;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ deviceId, ok: true });
  });

  it('refuses an unpaired sender at the HTTP layer', async () => {
    // No pairing — the phone's key is unknown.
    const result = await gateway.handleRpc(rpc(0));
    expect(result).toEqual({ ok: false, httpStatus: 403 });
  });

  it('rejects a replayed sequence with a sealed replay error', async () => {
    await pair();
    expect((await gateway.handleRpc(rpc(0))).ok).toBe(true);
    const replayed = await gateway.handleRpc(rpc(0)); // same seq again
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) throw new Error('unreachable');
    const res = unseal({ envelope: replayed.envelope, recipientKeys: phone })
      .body as CompanionResponse;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('replay');
  });

  it('refuses when the desktop is signed out', async () => {
    await pair();
    signedIn = false;
    const result = await gateway.handleRpc(rpc(0));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const res = unseal({ envelope: result.envelope, recipientKeys: phone })
      .body as CompanionResponse;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not-signed-in');
  });

  it('rejects a bad or expired pairing token', async () => {
    // A well-formed sealed pairing request, but the token was never minted.
    const envelope = seal({
      body: {
        kind: 'pairing-request',
        token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        device: { name: 'iPhone', platform: 'ios', appVersion: '0.1.0' },
      },
      seq: 0,
      sentAt: NOW_ISO,
      senderKeys: phone,
      recipientPublicKey: desktop.publicKey,
    });
    expect(await gateway.handlePairing(envelope)).toEqual({ ok: false, httpStatus: 401 });
    expect(devices.activeCount()).toBe(0);
  });
});
