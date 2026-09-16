/**
 * S126 — governed EVIDENCE TRACE read. A read-only sibling on `platform:command.dispatch`
 * (`QueryEvidenceTrace`) that composes the SAME per-tenant committed-command + delivered-event records
 * carrying an EXACT correlationId — server-resolved principal, RBAC `operations:read`, tenant validated.
 * Proves: real command + delivered evidence traced, chronological ordering, tenant isolation,
 * claimed-tenant rejected, unauthenticated + unauthorized fail closed, honest no-correlation state,
 * bounded, credential-free, hostile id contained. Driven through the REAL `runSecureHandler`.
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
import { DeliveredEventLog } from '../../platform/command/deliveredEventLog';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s126-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let deliveredLog: DeliveredEventLog;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return { authorize: () => undefined, audit: () => undefined, publish: () => undefined, broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-05T12:00:00.000Z' };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

async function seedCommand(tenantId: string, correlationId: string): Promise<void> {
  const idem = `k-${randomUUID()}`;
  const aggregateId = `so-${randomUUID()}`;
  await journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType: 'CreateSalesOrder',
    correlationId, actor: 'op@np.dev', source: 'test',
    execute: async () => ({ ok: true, data: { id: aggregateId }, aggregateId, aggregateType: 'SalesOrder' }),
  });
}
async function seedDelivered(tenantId: string, correlationId: string): Promise<void> {
  await deliveredLog.record({
    eventId: `ev-${randomUUID()}`, tenantId, type: 'sales.order.created', aggregateId: 'so-x',
    aggregateType: 'SalesOrder', correlationId, at: '2026-09-05T00:00:05.000Z',
  } as never);
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = principal();
  journal = new DurableCommandJournal(tmp('journal'));
  deliveredLog = new DeliveredEventLog(tmp('delivered'));
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  def = buildPlatformCommandDispatchDef({ registry, journal, deliveredLog, audit: () => undefined, resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface Resp { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }
async function call(payload: Record<string, unknown>, idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(def, { operation: 'QueryEvidenceTrace', payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}
type Entry = { source: string; id: string };
const entries = (r: Resp): Entry[] => (r.data!.entries as Entry[]);

describe('S126 · governed evidence trace read', () => {
  it('composes a chronological command + delivered-event trace for an exact correlationId', async () => {
    await seedCommand('tenant-A', 'corr-XYZ');
    await seedDelivered('tenant-A', 'corr-XYZ');
    await seedCommand('tenant-A', 'corr-OTHER'); // unrelated
    const r = await call({ correlationId: 'corr-XYZ' }, 'k1');
    expect(r.ok).toBe(true);
    expect(r.data!.found).toBe(true);
    const sources = entries(r).map((e) => e.source);
    expect(sources).toContain('command-journal');
    expect(sources).toContain('delivered-events');
    expect((r.data!.counts as { total: number }).total).toBe(2); // only the corr-XYZ command + its delivery
    // chronological: command committed (now) then delivered (…05 or now) — command first by construction
    expect(sources[0]).toBe('command-journal');
  });

  it('TENANT ISOLATION — tenant B cannot trace tenant A correlation', async () => {
    await seedCommand('tenant-A', 'corr-A');
    await seedDelivered('tenant-A', 'corr-A');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    const r = await call({ correlationId: 'corr-A' }, 'k2');
    expect(r.ok).toBe(true);
    expect(r.data!.found).toBe(false);
    expect(entries(r)).toEqual([]);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED', async () => {
    const r = await call({ correlationId: 'corr-A' }, 'k3', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated fails closed', async () => {
    currentPrincipal = null;
    const r = await call({ correlationId: 'corr-A' }, 'k4');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHENTICATED');
  });

  it('without operations:read the trace is UNAUTHORIZED', async () => {
    currentPrincipal = principal({ permissions: [] });
    const r = await call({ correlationId: 'corr-A' }, 'k5');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });

  it('blank correlationId ⇒ honest no-identifier state (found:false + note)', async () => {
    await seedCommand('tenant-A', 'corr-A');
    const r = await call({ correlationId: '   ' }, 'k6');
    expect(r.ok).toBe(true);
    expect(r.data!.found).toBe(false);
    expect(typeof r.data!.note).toBe('string');
  });

  it('non-matching correlationId ⇒ found:false, empty (no fuzzy inference)', async () => {
    await seedCommand('tenant-A', 'corr-A');
    const r = await call({ correlationId: 'corr-NOPE' }, 'k7');
    expect(r.ok).toBe(true);
    expect(r.data!.found).toBe(false);
    expect(entries(r)).toEqual([]);
  });

  it('the trace carries NO credential/secret/raw payload material + declares inbound not correlatable', async () => {
    await seedCommand('tenant-A', 'corr-A');
    await seedDelivered('tenant-A', 'corr-A');
    const r = await call({ correlationId: 'corr-A' }, 'k8');
    expect(r.data!.inboundCorrelatable).toBe(false);
    const blob = JSON.stringify(r.data).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload', 'rawbody']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('a hostile correlationId is an opaque exact key — matches nothing, no throw', async () => {
    await seedCommand('tenant-A', 'corr-A');
    const r = await call({ correlationId: "'; DROP TABLE--" }, 'k9');
    expect(r.ok).toBe(true);
    expect(r.data!.found).toBe(false);
  });

  it('the trace is bounded by the requested limit', async () => {
    for (let i = 0; i < 6; i++) await seedCommand('tenant-A', 'corr-BIG');
    const r = await call({ correlationId: 'corr-BIG', limit: 2 }, 'k10');
    expect(entries(r).length).toBe(2);
    expect(r.data!.bounded).toBe(true);
    expect((r.data!.counts as { command: number }).command).toBe(6);
  });

  it('S127 — a command trace entry carries canonical delivery posture joined by its txId', async () => {
    await seedCommand('tenant-A', 'corr-DEL');
    const r = await call({ correlationId: 'corr-DEL' }, 'k11');
    expect(r.ok).toBe(true);
    const cmdEntry = (entries(r) as unknown as Array<{ source: string; delivery: { state: string; linked: boolean } }>)
      .find((e) => e.source === 'command-journal')!;
    // a just-committed command has never been drained → canonical PENDING, linked by exact txId.
    expect(cmdEntry.delivery).toMatchObject({ state: 'PENDING', linked: true });
  });
});
