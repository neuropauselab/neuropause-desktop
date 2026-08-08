/**
 * Mobile M1-08 — the phone sealed client, exercised end-to-end against a
 * SIMULATED desktop (companion-protocol seal/unseal, no sockets, no RN). Locks:
 * pairing pins the desktop key and stores the session, an rpc round-trips, a
 * refusal surfaces as an error, rpc-before-pairing throws, and a persisted
 * private key restores the same identity. Runs via the root vitest.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANION_PROTOCOL_VERSION,
  decodePairingQr,
  encodePairingQr,
  generateIdentityKeyPair,
  generatePairingToken,
  seal,
  toB64,
  unseal,
  type CompanionKeyPair,
} from '@neuropause/companion-protocol';
import { CompanionClient, deviceKeysFromB64, type CompanionTransport } from './sealedClient';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const DEVICE = { name: 'iPhone', platform: 'ios' as const, appVersion: '0.1.0' };

/** A simulated desktop gateway: unseals the request, seals a canned reply. */
function fakeDesktop(desktop: CompanionKeyPair = generateIdentityKeyPair()) {
  let respSeq = 0;
  const transport: CompanionTransport = {
    async postSealed(_host, _port, path, envelope) {
      const opened = unseal({ envelope, recipientKeys: desktop });
      const back = (body: unknown) =>
        seal({
          body,
          seq: respSeq++,
          sentAt: '2026-08-07T12:00:00.000Z',
          senderKeys: desktop,
          recipientPublicKey: opened.senderPublicKey,
        });
      if (path === '/pair') {
        return back({
          kind: 'pairing-response',
          deviceId: 'cd_test',
          desktopName: 'Test Mac',
          orgName: 'Acme',
          protocolVersion: COMPANION_PROTOCOL_VERSION,
        });
      }
      const req = opened.body as { id: string; op: string; params?: unknown };
      if (req.op === 'boom')
        return back({ id: req.id, ok: false, error: { code: 'invalid', message: 'nope' } });
      return back({ id: req.id, ok: true, result: { echoed: req.op, params: req.params } });
    },
  };
  return { desktop, transport };
}

function qrFor(desktop: CompanionKeyPair) {
  const { tokenB64 } = generatePairingToken();
  return decodePairingQr(
    encodePairingQr({
      v: COMPANION_PROTOCOL_VERSION,
      host: '10.0.0.2',
      port: 47600,
      name: 'Test Mac',
      org: 'Acme',
      dpk: toB64(desktop.publicKey),
      token: tokenB64,
      exp: '2026-08-07T12:05:00.000Z',
    }),
  );
}

describe('CompanionClient', () => {
  it('pairs, stores the session, and round-trips an rpc', async () => {
    const { desktop, transport } = fakeDesktop();
    const { keys } = deviceKeysFromB64(null);
    const client = new CompanionClient(keys, transport, () => NOW);
    const session = await client.pair(qrFor(desktop), DEVICE);
    expect(session.deviceId).toBe('cd_test');
    expect(session.desktopPublicKeyB64).toBe(toB64(desktop.publicKey));
    expect(client.currentSession()?.deviceId).toBe('cd_test');
    expect(await client.rpc('dashboard.snapshot', { x: 1 })).toEqual({
      echoed: 'dashboard.snapshot',
      params: { x: 1 },
    });
  });

  it('surfaces a refusal as an error', async () => {
    const { desktop, transport } = fakeDesktop();
    const client = new CompanionClient(deviceKeysFromB64(null).keys, transport, () => NOW);
    await client.pair(qrFor(desktop), DEVICE);
    await expect(client.rpc('boom')).rejects.toThrow('nope');
  });

  it('refuses rpc before pairing', async () => {
    const client = new CompanionClient(
      deviceKeysFromB64(null).keys,
      fakeDesktop().transport,
      () => NOW,
    );
    await expect(client.rpc('x')).rejects.toThrow('Not paired');
  });

  it('restores the same identity from a persisted private key', () => {
    const first = deviceKeysFromB64(null);
    const restored = deviceKeysFromB64(first.privB64);
    expect(toB64(restored.keys.publicKey)).toBe(toB64(first.keys.publicKey));
  });

  it('seals a WS hello the desktop authenticates, and opens sealed event frames', async () => {
    const desktop = generateIdentityKeyPair();
    const { keys } = deviceKeysFromB64(null);
    const client = new CompanionClient(keys, fakeDesktop(desktop).transport, () => NOW);
    await client.pair(qrFor(desktop), DEVICE);

    // The desktop authenticates the socket by our SENDER key (the body is ignored).
    const hello = client.sealHello();
    const openedHello = unseal({ envelope: hello, recipientKeys: desktop });
    expect(toB64(openedHello.senderPublicKey)).toBe(toB64(keys.publicKey));

    // The desktop seals an event frame back to us; the client opens it.
    const eventEnvelope = seal({
      body: {
        kind: 'event',
        type: 'enterprise.record.updated',
        at: '2026-08-07T12:00:00.000Z',
        data: { resource: 'inv-1' },
      },
      seq: 99,
      sentAt: '2026-08-07T12:00:00.000Z',
      senderKeys: desktop,
      recipientPublicKey: openedHello.senderPublicKey,
    });
    const frame = client.openEvent(eventEnvelope);
    expect(frame.type).toBe('enterprise.record.updated');
    expect(frame.data).toEqual({ resource: 'inv-1' });
  });

  it('rejects an event frame not sealed by the paired desktop', async () => {
    const desktop = generateIdentityKeyPair();
    const impostor = generateIdentityKeyPair();
    const { keys } = deviceKeysFromB64(null);
    const client = new CompanionClient(keys, fakeDesktop(desktop).transport, () => NOW);
    await client.pair(qrFor(desktop), DEVICE);
    const forged = seal({
      body: { kind: 'event', type: 'x', at: '2026-08-07T12:00:00.000Z', data: {} },
      seq: 0,
      sentAt: '2026-08-07T12:00:00.000Z',
      senderKeys: impostor,
      recipientPublicKey: keys.publicKey,
    });
    expect(() => client.openEvent(forged)).toThrow();
  });
});
