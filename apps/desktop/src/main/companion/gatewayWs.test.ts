/**
 * P13C Round 8 — `CompanionDeviceStore` gained the tenant boundary it never had:
 * rows carried `boundTenantId` and no read consulted it, while the list channel was
 * PUBLIC. An unbound store now denies every read, so these suites act AS one
 * tenant; cross-tenant behaviour is asserted in tenancy/e2e/round8Tenancy.test.ts.
 */
/**
 * Mobile M1-06b — the realtime WS layer's socket-free core: a paired device is
 * authenticated from a sealed hello (garbage + unpaired senders rejected), and
 * an event frame is sealed such that only the device can open it. The ws glue
 * (upgrade handling, connection registry) is thin and exercised at runtime.
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
  type CompanionEventFrame,
  type CompanionKeyPair,
} from '@neuropause/companion-protocol';
import { CompanionDeviceStore, type CompanionDeviceRecord } from './deviceRegistryStore';
import { CompanionGateway, type CompanionGatewayDeps } from './gatewayServer';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const NOW_ISO = '2026-08-07T12:00:00.000Z';

let dir: string;
let devices: CompanionDeviceStore;
let desktop: CompanionKeyPair;
let phone: CompanionKeyPair;
let gateway: CompanionGateway;
let device: CompanionDeviceRecord;

beforeEach(async () => {
  dir = join(tmpdir(), `np-gw-ws-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  devices = new CompanionDeviceStore(join(dir, 'companion-devices.json')).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: '' }));
  await devices.load();
  desktop = generateIdentityKeyPair();
  phone = generateIdentityKeyPair();
  const deps: CompanionGatewayDeps = {
    identity: desktop,
    devices,
    isSignedIn: () => true,
    currentMember: () => 'owner@acme.test',
    desktopName: () => 'Test Mac',
    orgName: () => 'Acme',
    // P13C Part 3 — the tenant a paired device belongs to. Named here so these
    // tests pair into a real tenant rather than the null (system-events-only)
    // case, which has its own coverage in companionEgressTenancy.test.ts.
    currentTenantId: () => 'org-acme',
    ops: {},
    now: () => NOW,
  };
  gateway = new CompanionGateway(deps);
  const qr = decodePairingQr(gateway.mintPairingQr(47600).qr);
  const env = seal({
    body: {
      kind: 'pairing-request',
      token: qr.token,
      device: { name: 'iPhone', platform: 'ios', appVersion: '0.1.0' },
    },
    seq: 0,
    sentAt: NOW_ISO,
    senderKeys: phone,
    recipientPublicKey: fromB64(qr.dpk),
  });
  const res = await gateway.handlePairing(env);
  if (!res.ok) throw new Error('pairing failed');
  device = devices.list()[0];
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function hello(keys: CompanionKeyPair = phone) {
  return seal({
    body: { hello: true },
    seq: 0,
    sentAt: NOW_ISO,
    senderKeys: keys,
    recipientPublicKey: desktop.publicKey,
  });
}

describe('CompanionGateway realtime', () => {
  it('authenticates a paired device from a sealed hello', () => {
    expect(gateway.authenticateWsFrame(hello())?.id).toBe(device.id);
  });

  it('rejects garbage and unpaired senders', () => {
    expect(gateway.authenticateWsFrame({ not: 'an envelope' })).toBeNull();
    expect(gateway.authenticateWsFrame(hello(generateIdentityKeyPair()))).toBeNull();
  });

  it('rejects a revoked device', async () => {
    await devices.revoke(device.id);
    expect(gateway.authenticateWsFrame(hello())).toBeNull();
  });

  it('seals an event frame only the device can open', () => {
    const sealed = gateway.encodeEventFrame(device, 'enterprise.record.updated', NOW_ISO, {
      resource: { id: 'rec_1' },
    });
    const opened = unseal({
      envelope: sealed,
      recipientKeys: phone,
      expectedSenderPublicKey: desktop.publicKey,
    });
    const frame = opened.body as CompanionEventFrame;
    expect(frame.kind).toBe('event');
    expect(frame.type).toBe('enterprise.record.updated');
    expect(frame.at).toBe(NOW_ISO);
    expect(frame.data).toEqual({ resource: { id: 'rec_1' } });
  });
});
