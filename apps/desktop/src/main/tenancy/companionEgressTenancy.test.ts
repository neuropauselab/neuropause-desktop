/**
 * P13C Round 8 — `CompanionDeviceStore` gained the tenant boundary it never had:
 * rows carried `boundTenantId` and no read consulted it, while the list channel was
 * PUBLIC. An unbound store now denies every read, so these suites act AS one
 * tenant; cross-tenant behaviour is asserted in tenancy/e2e/round8Tenancy.test.ts.
 */
/**
 * P13C Part 3 — the companion LAN push, per tenant.
 *
 * The audit that produced these tests found `broadcastEvent` subscribing to the
 * entire event bus and pushing every event to every live socket of every paired
 * device. `PlatformEvent` has carried a `tenantId` since Program 13B; this
 * function never read it, and `EventResource` carries record ids and NAMES.
 *
 * It is the webhook defect Part 2a closed, on a different transport and a worse
 * one — the data leaves the machine over a LAN socket to a device that has no
 * tenant selector and no way to know which organization it is being told about.
 *
 * These tests assert at the TRANSPORT, by counting what each device's socket
 * actually received. Asserting on a filter helper would pass while the send
 * loop ignored it, which is the shape of bug that made the original defect
 * survive review.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateIdentityKeyPair, type CompanionKeyPair } from '@neuropause/companion-protocol';
import type { PlatformEvent } from '@neuropause/shared';
import { CompanionDeviceStore, type CompanionDeviceRecord } from '../companion/deviceRegistryStore';
import { CompanionGateway, type CompanionGatewayDeps } from '../companion/gatewayServer';

const NOW_ISO = '2026-08-10T12:00:00.000Z';
const A = 'org-a';
const B = 'org-b';

/** A socket that records every frame written to it. */
interface SpySocket {
  readonly OPEN: number;
  readyState: number;
  sent: string[];
  send: (text: string) => void;
  close: () => void;
}

function spySocket(): SpySocket {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send(text: string) {
      this.sent.push(text);
    },
    close() {
      this.readyState = 3;
    },
  };
}

let dir: string;
let pairingScope: { tenantId: string; workspaceId: string } | null = null;
let devices: CompanionDeviceStore;
let gateway: CompanionGateway;

async function pair(tenantId: string | null, name: string): Promise<CompanionDeviceRecord> {
  const phone: CompanionKeyPair = generateIdentityKeyPair();
  // Act AS the tenant the device is being paired to — see the note on bindScope.
  pairingScope = tenantId === null ? null : { tenantId, workspaceId: '' };
  return devices.register({
    name,
    platform: 'ios',
    model: null,
    publicKeyB64: Buffer.from(phone.publicKey).toString('base64url'),
    boundMember: 'owner@example.test',
    boundTenantId: tenantId,
    now: NOW_ISO,
  });
}

/** Attach a spy socket to a device through the gateway's own registry. */
function attach(device: CompanionDeviceRecord): SpySocket {
  const ws = spySocket();
  const registry = (gateway as unknown as { sockets: Map<string, Set<unknown>> }).sockets;
  const set = registry.get(device.id) ?? new Set<unknown>();
  set.add(ws);
  registry.set(device.id, set);
  return ws;
}

function event(over: Partial<PlatformEvent> = {}): PlatformEvent {
  return {
    id: `e_${randomUUID()}`,
    type: 'enterprise.record_created',
    category: 'enterprise',
    version: 1,
    priority: 'normal',
    timestamp: NOW_ISO,
    source: 'test',
    metadata: {},
    resource: { id: 'rec-1', name: 'NP-A-CONFIDENTIAL-984731' },
    tenantId: A,
    ...over,
  } as PlatformEvent;
}

beforeEach(async () => {
  dir = join(tmpdir(), `np-companion-tenancy-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  /**
   * P13C Round 8 — this suite pairs devices for BOTH tenants, so the scope has to
   * move with the pairing. `register()` now stamps from the resolver rather than
   * from `input.boundTenantId` (a caller-supplied owner is a suggestion, and the
   * finding was that the suggestion was recorded and never read), so `pairingScope`
   * is set by the helper below before each registration.
   */
  devices = new CompanionDeviceStore(join(dir, 'companion-devices.json')).bindScope(
    () => pairingScope,
  );
  await devices.load();
  const deps: CompanionGatewayDeps = {
    identity: generateIdentityKeyPair(),
    devices,
    isSignedIn: () => true,
    currentMember: () => 'owner@example.test',
    currentTenantId: () => A,
    desktopName: () => 'Test Mac',
    orgName: () => 'Alpha',
    ops: {},
    now: () => Date.parse(NOW_ISO),
  };
  gateway = new CompanionGateway(deps);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('an event reaches only the devices of the tenant that owns it', () => {
  it('a tenant A event is pushed to A’s phone and NOT to B’s', async () => {
    const phoneA = attach(await pair(A, 'A phone'));
    const phoneB = attach(await pair(B, 'B phone'));

    gateway.broadcastEvent(event({ tenantId: A }));

    expect(phoneA.sent).toHaveLength(1);
    expect(phoneB.sent).toHaveLength(0);
  });

  it('is symmetric — a tenant B event never reaches A’s phone', async () => {
    const phoneA = attach(await pair(A, 'A phone'));
    const phoneB = attach(await pair(B, 'B phone'));

    gateway.broadcastEvent(event({ tenantId: B }));

    expect(phoneB.sent).toHaveLength(1);
    expect(phoneA.sent).toHaveLength(0);
  });

  /**
   * The frame is sealed to the device, so the assertion above already proves
   * confidentiality. This one proves the WIRE never carried the bytes at all —
   * a filter that sealed-and-dropped would still have put a foreign tenant's
   * ciphertext on B's socket, and "they cannot read it" is a weaker claim than
   * "it was never sent".
   */
  it('puts nothing at all on the foreign device’s socket', async () => {
    const phoneB = attach(await pair(B, 'B phone'));
    gateway.broadcastEvent(event({ tenantId: A, resource: { id: 'r', name: 'SECRET-A' } }));
    expect(phoneB.sent.join('')).toBe('');
  });
});

describe('fail-closed', () => {
  it('an UNOWNED event reaches nobody', async () => {
    const phoneA = attach(await pair(A, 'A phone'));
    const phoneB = attach(await pair(B, 'B phone'));

    gateway.broadcastEvent(event({ tenantId: null }));

    expect(phoneA.sent).toHaveLength(0);
    expect(phoneB.sent).toHaveLength(0);
  });

  /**
   * A device paired before `boundTenantId` existed is NOT adopted into the
   * event's tenant. Adopting it would be "the first tenant to send it something
   * claims it" — a fallback in the same family as `defaultOrg()`.
   */
  it('a LEGACY device with no bound tenant receives no tenant-owned event', async () => {
    const legacy = attach(await pair(null, 'Legacy phone'));
    gateway.broadcastEvent(event({ tenantId: A }));
    expect(legacy.sent).toHaveLength(0);
  });
});

describe('SYSTEM events are the deliberate exception', () => {
  /**
   * `scopeKind: 'system'` is stamped only from a SYSTEM principal, which
   * carries no tenant and therefore cannot have read customer data into its
   * payload. That is what makes broadcasting it safe, and it is why the runtime
   * supervisor's critical alerts still reach every device.
   */
  it('reach every paired device, including a legacy one', async () => {
    const phoneA = attach(await pair(A, 'A phone'));
    const phoneB = attach(await pair(B, 'B phone'));
    const legacy = attach(await pair(null, 'Legacy phone'));

    gateway.broadcastEvent(
      event({
        type: 'runtime.supervisor.critical',
        category: 'runtime',
        scopeKind: 'system',
        tenantId: null,
        resource: { id: 'event-bus', name: 'event-bus' },
      }),
    );

    expect(phoneA.sent).toHaveLength(1);
    expect(phoneB.sent).toHaveLength(1);
    expect(legacy.sent).toHaveLength(1);
  });
});

describe('a revoked device is disconnected regardless of tenant', () => {
  it('closes the socket and forgets it', async () => {
    const device = await pair(A, 'A phone');
    const ws = attach(device);
    await devices.revoke(device.id);

    gateway.broadcastEvent(event({ tenantId: A }));

    expect(ws.sent).toHaveLength(0);
    expect(ws.readyState).toBe(3);
  });
});
