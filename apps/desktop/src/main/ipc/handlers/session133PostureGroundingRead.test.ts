/**
 * S133 — governed AI operational-POSTURE grounding. The live-assistant grounding leg opts in
 * (`includePosture:true`) on the SAME `QueryEvidenceContext` read; the aggregate reliability posture is
 * prepended to the grounding context (server-resolved principal, RBAC `operations:read`, tenant validated).
 * Proves: posture appears + is credential-free + definitional; absent flag ⇒ prior behavior (no posture);
 * tenant isolation (posture is over the caller's tenant only); claimed-tenant rejected; total bounded.
 * Driven through the REAL `runSecureHandler`.
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
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s133-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let bus: EventBus;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-06T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

async function seed(tenantId: string, commandType: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  await journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType,
    correlationId: `corr-${randomUUID()}`, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: `agg-${randomUUID()}` }, aggregateId: `agg-${randomUUID()}`, aggregateType: 'Doc' }),
  });
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = principal();
  journal = new DurableCommandJournal(tmp('journal'));
  bus = new EventBus({});
  bus.bindTenant(() => scope.tenantId);
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
const posture = (r: Resp): Ctx[] => ctx(r).filter((i) => i.evidence?.[0]?.kind === 'operational-posture');

describe('S133 · governed AI operational-posture grounding', () => {
  it('includePosture prepends an aggregate posture item derived from the tenant journal', async () => {
    await seed('tenant-A', 'CreateSalesOrder');
    await seed('tenant-A', 'CreateSalesOrder');
    const r = await call({ includePosture: true }, 'k1');
    expect(r.ok).toBe(true);
    expect(r.data!.postureIncluded).toBe(true);
    const p = posture(r);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p[0].text).toContain('governed command(s)');
    // posture leads the grounding (most general "state of operations" signal)
    expect(ctx(r)[0].evidence?.[0]?.kind).toBe('operational-posture');
  });

  it('absent includePosture ⇒ NO posture (existing read behavior unchanged)', async () => {
    await seed('tenant-A', 'CreateSalesOrder');
    const r = await call({ query: '' }, 'k2');
    expect(r.ok).toBe(true);
    expect(r.data!.postureIncluded).toBe(false);
    expect(posture(r)).toEqual([]);
  });

  it('TENANT ISOLATION — posture reflects only the caller tenant; tenant B sees none of tenant A', async () => {
    await seed('tenant-A', 'CreateSalesOrder');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    const r = await call({ includePosture: true }, 'k3');
    expect(r.ok).toBe(true);
    // tenant B has no commands ⇒ honest empty posture (never tenant A's numbers)
    expect(posture(r)).toEqual([]);
    expect(r.data!.postureIncluded).toBe(false);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED with includePosture', async () => {
    const r = await call({ includePosture: true }, 'k4', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated / unauthorized still fail closed with includePosture', async () => {
    currentPrincipal = null;
    expect((await call({ includePosture: true }, 'k5')).error?.code).toBe('UNAUTHENTICATED');
    currentPrincipal = principal({ permissions: [] });
    expect((await call({ includePosture: true }, 'k6')).error?.code).toBe('UNAUTHORIZED');
  });

  it('grounding stays bounded and credential-free with posture included', async () => {
    for (let i = 0; i < 30; i++) await seed('tenant-A', 'CreateSalesOrder');
    const r = await call({ includePosture: true, limit: 5 }, 'k7');
    expect(ctx(r).length).toBeLessThanOrEqual(5); // posture prefix takes from the same budget
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
