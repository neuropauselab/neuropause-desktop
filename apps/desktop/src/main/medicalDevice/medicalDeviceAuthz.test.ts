/**
 * Medical Device Pack — the authorization lock.
 *
 * `runtimeAuthz.test.ts` exempts the whole `md:` namespace from its channel
 * accounting on the promise that this file checks it more strictly. That
 * promise is kept here: every `md:` channel is asserted to exist, to require
 * authentication, and to carry the EXACT scope it should — not merely "some
 * permission".
 *
 * The distinction matters because this namespace carries writes. A read-only
 * cluster can be accounted for by prefix; a namespace where one channel splits
 * a batch cannot. The specific failure this guards against is a write channel
 * that ships declaring a read scope, which is invisible in review and grants
 * every reader the right to change a batch.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ALL_ENTERPRISE_PERMISSIONS,
  IpcChannel,
  RUNTIME_INVOKABLE_CHANNELS,
  type EnterprisePermission,
  type IpcChannelName,
} from '@neuropause/shared';
import { buildMedicalDeviceHandlers, LOT_NOT_CONFIGURED, type MedicalDeviceDeps } from './index';

const EXPECTED: Record<string, EnterprisePermission> = {
  'md:pack': 'medicalDevice:product.read',
  'md:product.search': 'medicalDevice:product.read',
  'md:product.get': 'medicalDevice:product.read',
  'md:lot.list': 'medicalDevice:lot.read',
  'md:lot.get': 'medicalDevice:lot.read',
  'md:lot.create': 'medicalDevice:lot.write',
  'md:lot.transition': 'medicalDevice:lot.write',
  'md:lot.split': 'medicalDevice:lot.write',
  'md:lot.merge': 'medicalDevice:lot.write',
  'md:lot.consume': 'medicalDevice:lot.write',
  'md:lot.move': 'medicalDevice:lot.write',
  'md:lot.ship': 'medicalDevice:lot.write',
  'md:trace.forward': 'medicalDevice:traceability.read',
  'md:trace.backward': 'medicalDevice:traceability.read',
};

/** Enough of the dependency surface to build the handler definitions. */
const deps = (): MedicalDeviceDeps =>
  ({
    products: { store: { load: vi.fn(), list: () => [], get: () => null } },
    lots: { store: { load: vi.fn(), list: () => [], get: () => null } },
    edges: { count: () => 0, around: () => [], forTenant: () => [] },
    lotService: { allLots: async () => [] },
    traceService: {},
    tenantId: () => 'default',
    authorize: vi.fn(),
    auditEntries: () => [],
  }) as unknown as MedicalDeviceDeps;

describe('Medical Device channel authorization', () => {
  const handlers = buildMedicalDeviceHandlers(deps());
  const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));

  it('registers exactly the declared md: channels — no more, no fewer', () => {
    expect([...byChannel.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('every md: channel in the invokable allowlist has a handler', () => {
    const declared = RUNTIME_INVOKABLE_CHANNELS.filter((c: IpcChannelName) => c.startsWith('md:'));
    for (const channel of declared) expect(byChannel.has(channel), channel).toBe(true);
  });

  it('every handler requires authentication and carries its exact scope', () => {
    for (const [channel, permission] of Object.entries(EXPECTED)) {
      const handler = byChannel.get(channel);
      expect(handler, channel).toBeDefined();
      expect(handler?.requireAuth, `${channel} must require auth`).toBe(true);
      expect(handler?.permission, `${channel} scope`).toBe(permission);
    }
  });

  it('every scope used is a real enterprise permission', () => {
    const valid = new Set<string>(ALL_ENTERPRISE_PERMISSIONS);
    for (const handler of handlers) expect(valid.has(handler.permission as string)).toBe(true);
  });

  it('no read scope is used to gate a write, and no write is left on a read scope', () => {
    const writeChannels = [
      IpcChannel.MedicalDeviceLotCreate,
      IpcChannel.MedicalDeviceLotTransition,
      IpcChannel.MedicalDeviceLotSplit,
      IpcChannel.MedicalDeviceLotMerge,
      IpcChannel.MedicalDeviceLotConsume,
      IpcChannel.MedicalDeviceLotMove,
      IpcChannel.MedicalDeviceLotShip,
    ];
    for (const channel of writeChannels) {
      const handler = byChannel.get(channel);
      expect(handler?.permission, channel).toBe('medicalDevice:lot.write');
      expect(handler?.audit, `${channel} must be audited`).toBe(true);
    }
    const readChannels = [
      IpcChannel.MedicalDevicePack,
      IpcChannel.MedicalDeviceProductSearch,
      IpcChannel.MedicalDeviceProductGet,
      IpcChannel.MedicalDeviceLotList,
      IpcChannel.MedicalDeviceLotGet,
      IpcChannel.MedicalDeviceTraceForward,
      IpcChannel.MedicalDeviceTraceBackward,
    ];
    for (const channel of readChannels) {
      expect(String(byChannel.get(channel)?.permission)).toContain('.read');
    }
  });

  it('answering "where did this go?" needs no right to change anything', () => {
    // Support, quality and regulatory staff must be able to ask, without being
    // able to release, block or consume a batch as a side effect of the grant.
    for (const channel of [IpcChannel.MedicalDeviceTraceForward, IpcChannel.MedicalDeviceTraceBackward]) {
      expect(byChannel.get(channel)?.permission).toBe('medicalDevice:traceability.read');
    }
  });
});

describe('Honest absence', () => {
  it('the lot detail states which surfaces do not exist, rather than showing an empty panel', () => {
    // An empty "Quality" panel reads as "this lot has no quality history", which
    // is a different and far more dangerous claim than "this build has no
    // quality module".
    const sections = LOT_NOT_CONFIGURED.map((n) => n.section);
    expect(sections).toContain('Quality status');
    expect(sections).toContain('Documents');
    for (const entry of LOT_NOT_CONFIGURED) {
      expect(entry.reason).toContain('Not yet configured');
    }
  });
});
