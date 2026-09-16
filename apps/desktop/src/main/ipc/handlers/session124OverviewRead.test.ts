/**
 * S124 — governed cross-surface OPERATIONAL OVERVIEW read. A read-only sibling on
 * `platform:command.dispatch` (`QueryOperationalOverview`) that COMPOSES the existing operational-read
 * builders (health + delivery + reliability + reliability-trend + connector-inbound + inbound-trend)
 * over the SAME durable journal + event ring — server-resolved principal, RBAC `operations:read`, tenant
 * validated against the principal. Proves: composed posture from real committed rows, tenant isolation,
 * renderer-claimed-tenant rejected, unauthenticated/unauthorized fail closed, and no credential/secret in
 * the composition. Driven through the REAL `runSecureHandler`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { type EnterprisePermission, type PlatformEventInput, type TenantScope } from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { EventBus } from '../../platform/eventBus';
import { platformBusRef } from '../../platform/platformBusRef';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s124-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let bus: EventBus;
let busTenant: string | null;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-05T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function inbound(connectorId: string, provider: string): PlatformEventInput {
  return {
    type: 'connector.online', category: 'connector', source: 'connectors',
    actor: { kind: 'connector', id: connectorId }, resource: { type: 'connector', id: connectorId, name: null },
    metadata: { connectorId, provider, kind: 'inbound_webhook', receivedAt: 1_700_000_000_000 },
  };
}

async function seed(tenantId: string, outcome: 'delivered' | 'retryable', error?: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  const aggregateId = `so-${randomUUID()}`;
  await journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType: 'CreateSalesOrder',
    correlationId: `corr-${idem}`, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: aggregateId }, aggregateId, aggregateType: 'SalesOrder' }),
  });
  const rec = journal.records(tenantId).find((r) => r.idempotencyKey === idem)!;
  if (outcome === 'delivered') { await journal.markProcessing(rec.id); await journal.markDelivered(rec.id); }
  else { await journal.markProcessing(rec.id); await journal.markRetryable(rec.id, error ?? 'boom'); }
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = principal();
  journal = new DurableCommandJournal(tmp('journal'));
  bus = new EventBus({});
  busTenant = 'tenant-A';
  bus.bindTenant(() => busTenant);
  platformBusRef.current = bus;
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  platformBusRef.current = null;
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface Resp { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }
async function call(idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(def, { operation: 'QueryOperationalOverview', payload: {}, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}

describe('S124 · governed operational overview read', () => {
  it('composes health + reliability + delivery + connector-inbound from real state', async () => {
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'retryable', 'ECONNRESET');
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    const r = await call('k1');
    expect(r.ok).toBe(true);
    expect(r.data!.health).toBeDefined();
    const rel = r.data!.reliability as { available: boolean; value?: { totals: { commands: number } } };
    expect(rel.available).toBe(true);
    expect(rel.value!.totals.commands).toBe(2);
    const del = r.data!.delivery as { available: boolean; value?: { delivered: number; retryable: number } };
    expect(del.value).toMatchObject({ delivered: 1, retryable: 1 });
    const inb = r.data!.connectorInbound as { available: boolean; counts?: { lineage: number } };
    expect(inb.available).toBe(true);
    expect(inb.counts!.lineage).toBe(1);
  });

  it('TENANT ISOLATION — tenant B overview excludes tenant A rows', async () => {
    await seed('tenant-A', 'retryable', 'A-only');
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call('k2');
    expect(r.ok).toBe(true);
    expect((r.data!.reliability as { value?: { totals: { commands: number } } }).value!.totals.commands).toBe(0);
    expect((r.data!.connectorInbound as { counts?: { lineage: number } }).counts!.lineage).toBe(0);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED', async () => {
    const r = await call('k3', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated (no principal) fails closed', async () => {
    currentPrincipal = null;
    const r = await call('k4');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHENTICATED');
  });

  it('without operations:read the read is UNAUTHORIZED', async () => {
    currentPrincipal = principal({ permissions: [] });
    const r = await call('k5');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });

  it('the composed overview carries NO credential/secret material', async () => {
    await seed('tenant-A', 'retryable', 'timeout');
    busTenant = 'tenant-A';
    bus.publish(inbound('slack', 'slack'));
    const r = await call('k6');
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('empty state is honest (zero counts, health present), never fabricated', async () => {
    const r = await call('k7');
    expect(r.ok).toBe(true);
    expect((r.data!.reliability as { value?: { totals: { commands: number } } }).value!.totals.commands).toBe(0);
    expect(r.data!.health).toBeDefined();
  });
});
