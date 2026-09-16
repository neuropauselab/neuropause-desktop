/**
 * S120 — governed connector inbound-event LINEAGE read. A read-only sibling on `platform:command.dispatch`
 * (`QueryInboundLineage`) that projects the S119 lineage over the ONE live EventBus ring — server-resolved
 * principal, RBAC `operations:read`, tenant validated against the principal, bounded/sanitized projection.
 * Proves: tenant isolation, renderer-claimed-tenant rejected, unauthenticated/unauthorized fail closed, and
 * no credential/secret in the projection. Driven through the REAL `runSecureHandler`.
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
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s120-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let bus: EventBus;
let busTenant: string | null;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-04T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function inbound(connectorId: string, provider: string): PlatformEventInput {
  return {
    type: 'connector.online', category: 'connector', source: 'connectors',
    actor: { kind: 'connector', id: connectorId }, resource: { type: 'connector', id: connectorId, name: null },
    metadata: { connectorId, provider, kind: 'inbound_webhook', receivedAt: 1_700_000_000_000 },
  };
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
async function call(payload: Record<string, unknown>, idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(def, { operation: 'QueryInboundLineage', payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}
type Row = Record<string, unknown>;
const lineage = (r: Resp): Row[] => (r.data!.lineage as Row[]);

describe('S120 · governed inbound-event lineage read', () => {
  it('projects verified inbound webhooks for the authenticated tenant', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    const r = await call({ limit: 10 }, 'k1');
    expect(r.ok).toBe(true);
    expect(lineage(r).map((x) => x.connectorId)).toEqual(['github']);
    expect(lineage(r)[0]).toMatchObject({ provider: 'github', verifiedSource: 'github', tenantId: 'tenant-A', dedupeRef: null, credentialsPresent: false });
  });

  it('TENANT ISOLATION — tenant B cannot read tenant A’s lineage', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    // switch the authenticated principal + bus to tenant B
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call({ limit: 10 }, 'k2');
    expect(r.ok).toBe(true);
    expect(lineage(r)).toEqual([]); // A's delivery invisible to B
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED', async () => {
    const r = await call({}, 'k3', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated (no principal) fails closed', async () => {
    currentPrincipal = null;
    const r = await call({}, 'k4');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHENTICATED');
  });

  it('without operations:read the read is UNAUTHORIZED', async () => {
    currentPrincipal = principal({ permissions: [] });
    const r = await call({}, 'k5');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });

  it('the projection carries NO credential/secret material', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('slack', 'slack'));
    const r = await call({}, 'k6');
    const blob = JSON.stringify(r.data!.lineage).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'header', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('no bound bus ⇒ honest empty lineage (fail-closed, not an error)', async () => {
    platformBusRef.current = null;
    const r = await call({}, 'k7');
    expect(r.ok).toBe(true);
    expect(lineage(r)).toEqual([]);
  });

  it('S123 — the governed read additionally returns a tenant-scoped inbound TREND', async () => {
    busTenant = 'tenant-A';
    // two older github deliveries, then two newer slack deliveries (slack is NEW in the recent half).
    bus.publish(inbound('github', 'github'));
    bus.publish(inbound('github', 'github'));
    bus.publish(inbound('slack', 'slack'));
    bus.publish(inbound('slack', 'slack'));
    const r = await call({}, 'k8');
    expect(r.ok).toBe(true);
    const trend = r.data!.trend as { comparable: boolean; newConnectors: string[]; quietConnectors: string[] };
    expect(trend.comparable).toBe(true);
    // github delivered only in the older window; slack only in the newer window.
    expect(trend.newConnectors).toContain('slack');
    expect(trend.quietConnectors).toContain('github');
  });

  it('S123 — inbound trend is tenant-scoped (tenant B sees no comparison from A rows)', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    bus.publish(inbound('github', 'github'));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call({}, 'k9');
    expect(r.ok).toBe(true);
    expect((r.data!.trend as { comparable: boolean }).comparable).toBe(false);
  });
});
