/**
 * S122 — governed OPERATIONAL RELIABILITY read. A read-only sibling on `platform:command.dispatch`
 * (`QueryReliabilitySummary`) that projects the delivery-reliability posture over the SAME durable
 * command journal — server-resolved principal, RBAC `operations:read`, tenant validated against the
 * principal, bounded/sanitized projection. Proves: real posture from real committed rows, tenant
 * isolation, renderer-claimed-tenant rejected, unauthenticated/unauthorized fail closed, optional
 * objective → error-budget verdict (no verdict without one), and no credential/secret in the output.
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
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s122-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-04T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

/** Commit a real record for `tenantId`, then drive its outbox to the desired terminal state. */
async function seed(tenantId: string, outcome: 'delivered' | 'retryable' | 'pending', error?: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  const aggregateId = `so-${randomUUID()}`;
  await journal.run({
    tenantId,
    idempotencyKey: idem,
    commandId: `cmd-${idem}`,
    commandType: 'CreateSalesOrder',
    correlationId: `corr-${idem}`,
    actor: 'op@np.dev',
    source: 'test',
    execute: async () => ({ ok: true, data: { id: aggregateId }, aggregateId, aggregateType: 'SalesOrder' }),
  });
  // The committed record's id is `tx_<uuid>` (not the run result's commandId); look it up by key.
  const rec = journal.records(tenantId).find((r) => r.idempotencyKey === idem)!;
  const id = rec.id;
  if (outcome === 'delivered') { await journal.markProcessing(id); await journal.markDelivered(id); }
  else if (outcome === 'retryable') { await journal.markProcessing(id); await journal.markRetryable(id, error ?? 'boom'); }
  // 'pending' → leave as committed PENDING
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = principal();
  journal = new DurableCommandJournal(tmp('journal'));
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface Resp { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }
async function call(payload: Record<string, unknown>, idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(def, { operation: 'QueryReliabilitySummary', payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}

describe('S122 · governed operational reliability read', () => {
  it('projects real delivery posture from real committed rows for the authenticated tenant', async () => {
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'retryable', 'ECONNRESET');
    await seed('tenant-A', 'pending');
    const r = await call({ limit: 10 }, 'k1');
    expect(r.ok).toBe(true);
    const totals = r.data!.totals as Record<string, number>;
    expect(totals).toMatchObject({ commands: 3, delivered: 1, retryable: 1, pending: 1 });
    expect(r.data!.successRatio).toBeCloseTo(1 / 3, 10);
    const topErrors = r.data!.topErrors as Array<{ signature: string; count: number }>;
    expect(topErrors.some((e) => e.signature === 'ECONNRESET')).toBe(true);
  });

  it('TENANT ISOLATION — tenant B posture excludes tenant A rows', async () => {
    await seed('tenant-A', 'retryable', 'A-only-error');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    const r = await call({ limit: 10 }, 'k2');
    expect(r.ok).toBe(true);
    expect((r.data!.totals as Record<string, number>).commands).toBe(0);
    expect((r.data!.topErrors as unknown[]).length).toBe(0);
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

  it('NO objective ⇒ no error-budget verdict (no invented SLO policy)', async () => {
    await seed('tenant-A', 'retryable', 'e');
    const r = await call({}, 'k6');
    expect(r.ok).toBe(true);
    expect(r.data!.budget).toBeUndefined();
  });

  it('WITH an objective ⇒ request-based error-budget verdict is returned', async () => {
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'retryable', 'e');
    const r = await call({ objective: 0.99 }, 'k7');
    expect(r.ok).toBe(true);
    const budget = r.data!.budget as Record<string, unknown>;
    expect(budget).toMatchObject({ objective: 0.99, totalRequests: 2, consumedFailures: 1 });
    expect(typeof budget.status).toBe('string');
  });

  it('the projection carries NO credential/secret material', async () => {
    await seed('tenant-A', 'retryable', 'timeout');
    const r = await call({}, 'k8');
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('S123 — the governed read additionally returns a reliability TREND (same read, same tenant)', async () => {
    // Two delivered then two retryable ⇒ recent half degrades vs previous half.
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'retryable', 'boom');
    await seed('tenant-A', 'retryable', 'boom');
    const r = await call({}, 'k9');
    expect(r.ok).toBe(true);
    const trend = r.data!.trend as { comparable: boolean; posture: string; deliveryFailureRate: { direction: string } };
    expect(trend.comparable).toBe(true);
    expect(trend.deliveryFailureRate.direction).toBe('INCREASE');
    expect(trend.posture).toBe('DEGRADING');
  });

  it('S123 — trend is tenant-scoped: tenant B sees no comparison from tenant A rows', async () => {
    await seed('tenant-A', 'delivered');
    await seed('tenant-A', 'retryable', 'boom');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    const r = await call({}, 'k10');
    expect(r.ok).toBe(true);
    expect((r.data!.trend as { comparable: boolean }).comparable).toBe(false);
  });
});
