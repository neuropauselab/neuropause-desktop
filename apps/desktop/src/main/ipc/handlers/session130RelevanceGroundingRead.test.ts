/**
 * S130 — governed RELEVANCE-RANKED AI evidence grounding. The live-assistant grounding leg passes the
 * user's QUESTION as `relevanceQuery` on the SAME `QueryEvidenceContext` read (server-resolved principal,
 * RBAC `operations:read`, tenant validated). Proves: a relevant question floats matching evidence to the
 * top; a non-matching question NEVER empties the grounding (non-excluding — degrades to recency); the
 * relevance string is NOT a tenant selector (tenant isolation holds); claimed-tenant still rejected;
 * absent `relevanceQuery` ⇒ prior browse behavior. Driven through the REAL `runSecureHandler`.
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

import { type EnterprisePermission, type TenantScope } from '@neuropause/shared';
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
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s130-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let bus: EventBus;
let busTenant: string | null;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-06T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

/** Seed a committed command of a given type (its type becomes part of the grounding text). */
async function seed(tenantId: string, commandType: string, correlationId: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  await journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType,
    correlationId, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: `agg-${randomUUID()}` }, aggregateId: `agg-${randomUUID()}`, aggregateType: 'Doc' }),
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
  return (await runSecureHandler(def, { operation: 'QueryEvidenceContext', payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}
type Ctx = { source: string; text: string; evidence?: Array<{ kind: string; id: string }> };
const ctx = (r: Resp): Ctx[] => (r.data!.context as Ctx[]);

describe('S130 · governed relevance-ranked AI evidence grounding', () => {
  it('a relevant question FLOATS the matching command to the top (relevanceRanked)', async () => {
    // PaySupplierInvoice committed AFTER the sales order ⇒ recency would list it first.
    await seed('tenant-A', 'CreateSalesOrder', 'corr-so');
    await seed('tenant-A', 'PaySupplierInvoice', 'corr-pay');
    const r = await call({ relevanceQuery: 'what happened with my sales order' }, 'k1');
    expect(r.ok).toBe(true);
    expect(r.data!.relevanceRanked).toBe(true);
    const items = ctx(r);
    expect(items.length).toBe(2); // NON-EXCLUDING: both kept
    expect(items[0].text.toLowerCase()).toContain('createsalesorder'); // relevant one leads
  });

  it('a question with NO lexical overlap NEVER empties the grounding (degrades to recency)', async () => {
    await seed('tenant-A', 'CreateSalesOrder', 'corr-1');
    await seed('tenant-A', 'PaySupplierInvoice', 'corr-2');
    const r = await call({ relevanceQuery: 'zzz totally unrelated question tokens' }, 'k2');
    expect(r.ok).toBe(true);
    expect(r.data!.relevanceRanked).toBe(true);
    expect(ctx(r).length).toBe(2); // still present — ranking, not filtering
  });

  it('relevanceQuery is NOT a tenant selector — tenant B gets nothing even when the query matches A', async () => {
    await seed('tenant-A', 'CreateSalesOrder', 'corr-1');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call({ relevanceQuery: 'sales order createsalesorder' }, 'k3');
    expect(r.ok).toBe(true);
    expect(ctx(r)).toEqual([]);
    expect(r.data!.itemCount).toBe(0);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED even with a relevanceQuery', async () => {
    const r = await call({ relevanceQuery: 'sales order' }, 'k4', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('absent relevanceQuery ⇒ prior browse behavior (relevanceRanked=false), unchanged', async () => {
    await seed('tenant-A', 'CreateSalesOrder', 'corr-1');
    const r = await call({ query: '' }, 'k5');
    expect(r.ok).toBe(true);
    expect(r.data!.relevanceRanked).toBe(false);
    expect(ctx(r).length).toBeGreaterThan(0);
  });

  it('an explicit AND-search query still uses AND-search semantics (relevance mode is grounding-only)', async () => {
    await seed('tenant-A', 'CreateSalesOrder', 'corr-1');
    // Passing BOTH — the explicit `query` wins (AND-search), so relevance-rank mode does NOT engage.
    const r = await call({ query: 'CreateSalesOrder', relevanceQuery: 'ignored here' }, 'k6');
    expect(r.ok).toBe(true);
    expect(r.data!.relevanceRanked).toBe(false); // AND-search path, not rank path
    expect(ctx(r).length).toBeGreaterThan(0);
  });

  it('hostile relevanceQuery cannot throw or leak credentials', async () => {
    await seed('tenant-A', 'CreateSalesOrder', 'corr-1');
    const r = await call({ relevanceQuery: '"; DROP TABLE; ${process.exit()} ' + 'x '.repeat(5000) }, 'k7');
    expect(r.ok).toBe(true);
    expect(ctx(r).length).toBeGreaterThan(0); // non-excluding, no throw
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('unauthenticated / unauthorized still fail closed with a relevanceQuery', async () => {
    currentPrincipal = null;
    expect((await call({ relevanceQuery: 'sales' }, 'k8')).error?.code).toBe('UNAUTHENTICATED');
    currentPrincipal = principal({ permissions: [] });
    expect((await call({ relevanceQuery: 'sales' }, 'k9')).error?.code).toBe('UNAUTHORIZED');
  });
});
