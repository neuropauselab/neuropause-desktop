/**
 * S125 — governed operational EVIDENCE SEARCH read. A read-only sibling on `platform:command.dispatch`
 * (`QueryEvidenceSearch`) that runs a deterministic lexical/filter search over the SAME per-tenant
 * committed-command history + verified inbound lineage — server-resolved principal, RBAC
 * `operations:read`, tenant validated against the principal, bounded/sanitized projection. Proves:
 * real evidence is searchable, tenant isolation, renderer-claimed-tenant rejected, unauthenticated +
 * unauthorized fail closed, bounded results, credential-free, and hostile query containment. Driven
 * through the REAL `runSecureHandler`.
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
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s125-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
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

async function seedCommand(tenantId: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  const aggregateId = `so-${randomUUID()}`;
  await journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType: 'CreateSalesOrder',
    correlationId: `corr-${idem}`, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: aggregateId }, aggregateId, aggregateType: 'SalesOrder' }),
  });
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
  return (await runSecureHandler(def, { operation: 'QueryEvidenceSearch', payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}
type Hit = { kind: string; id: string; connectorId: string | null };
const hits = (r: Resp): Hit[] => (r.data!.hits as Hit[]);

describe('S125 · governed evidence search read', () => {
  it('searches real committed commands + verified inbound lineage for the authenticated tenant', async () => {
    await seedCommand('tenant-A');
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    const r = await call({ query: '' }, 'k1');
    expect(r.ok).toBe(true);
    const kinds = new Set(hits(r).map((h) => h.kind));
    expect(kinds.has('command')).toBe(true);
    expect(kinds.has('inbound')).toBe(true);
    const filtered = await call({ query: 'github' }, 'k1b');
    expect(hits(filtered).every((h) => h.kind === 'inbound')).toBe(true);
  });

  it('TENANT ISOLATION — tenant B cannot search tenant A evidence', async () => {
    await seedCommand('tenant-A');
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github'));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call({ query: '' }, 'k2');
    expect(r.ok).toBe(true);
    expect(hits(r)).toEqual([]);
    expect((r.data!.counts as { total: number }).total).toBe(0);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED', async () => {
    const r = await call({ query: '' }, 'k3', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated fails closed', async () => {
    currentPrincipal = null;
    const r = await call({ query: '' }, 'k4');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHENTICATED');
  });

  it('without operations:read the search is UNAUTHORIZED', async () => {
    currentPrincipal = principal({ permissions: [] });
    const r = await call({ query: '' }, 'k5');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });

  it('results are bounded by the requested limit', async () => {
    for (let i = 0; i < 8; i++) await seedCommand('tenant-A');
    const r = await call({ query: '', limit: 3 }, 'k6');
    expect(hits(r).length).toBe(3);
    expect(r.data!.bounded).toBe(true);
  });

  it('the search result carries NO credential/secret/raw payload material', async () => {
    await seedCommand('tenant-A');
    busTenant = 'tenant-A';
    bus.publish(inbound('slack', 'slack'));
    const r = await call({ query: '' }, 'k7');
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('a hostile query cannot escape the projection (honest empty, no error)', async () => {
    await seedCommand('tenant-A');
    const r = await call({ query: "'; DROP TABLE--  <script>alert(1)</script>  zzzznomatch" }, 'k8');
    expect(r.ok).toBe(true);
    expect(hits(r)).toEqual([]);
  });

  it('honest empty state when there is no evidence', async () => {
    const r = await call({ query: '' }, 'k9');
    expect(r.ok).toBe(true);
    expect((r.data!.counts as { total: number }).total).toBe(0);
    expect(hits(r)).toEqual([]);
  });
});
