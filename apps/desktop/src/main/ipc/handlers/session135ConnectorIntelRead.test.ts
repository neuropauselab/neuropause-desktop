/**
 * S135 — governed CONNECTOR INBOUND INTELLIGENCE. The per-connector merge (count · latest · trend ·
 * NEW/QUIET/ACTIVE state · correlatable · dedupeRef) is an additive field on the EXISTING
 * `QueryInboundLineage` read, and an opt-in grounding prefix on `QueryEvidenceContext` — both over the ONE
 * live EventBus ring, server-resolved principal, RBAC `operations:read`, tenant validated. Proves: the
 * intelligence appears; tenant isolation (tenant B never sees A); claimed-tenant rejected; unauth/unauthorized
 * fail closed; credential-free; AI grounding carries only the sanitized descriptive projection. REAL
 * `runSecureHandler`.
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
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s135-${tag}-${randomUUID()}.json`); paths.push(p); return p; };
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

function inbound(connectorId: string, provider: string, receivedAt: number): PlatformEventInput {
  return {
    type: 'connector.online', category: 'connector', source: 'connectors',
    actor: { kind: 'connector', id: connectorId }, resource: { type: 'connector', id: connectorId, name: null },
    metadata: { connectorId, provider, kind: 'inbound_webhook', receivedAt },
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
async function call(operation: string, payload: Record<string, unknown>, idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(def, { operation, payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as Resp;
}
interface Intel { connectorId: string; provider: string; events: number; state: string; correlatable: boolean; dedupeRefStatus: string }
const intel = (r: Resp): Intel[] => (r.data!.intelligence as Intel[]);

describe('S135 · governed connector inbound intelligence', () => {
  it('QueryInboundLineage returns per-connector intelligence (count/state/correlatable/dedupe)', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github', 100));
    bus.publish(inbound('github', 'github', 200));
    bus.publish(inbound('slack', 'slack', 300));
    const r = await call('QueryInboundLineage', {}, 'k1');
    expect(r.ok).toBe(true);
    const list = intel(r);
    const gh = list.find((c) => c.connectorId === 'github')!;
    expect(gh.events).toBe(2);
    expect(gh.correlatable).toBe(false);
    expect(gh.dedupeRefStatus).toBe('absent');
    expect(['NEW', 'QUIET', 'ACTIVE']).toContain(gh.state);
  });

  it('TENANT ISOLATION — tenant B sees none of tenant A intelligence', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github', 100));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = principal();
    busTenant = 'tenant-B';
    const r = await call('QueryInboundLineage', {}, 'k2');
    expect(r.ok).toBe(true);
    expect(intel(r)).toEqual([]);
  });

  it('a renderer-claimed tenant that mismatches the principal is REJECTED', async () => {
    const r = await call('QueryInboundLineage', {}, 'k3', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('unauthenticated / unauthorized fail closed', async () => {
    currentPrincipal = null;
    expect((await call('QueryInboundLineage', {}, 'k4')).error?.code).toBe('UNAUTHENTICATED');
    currentPrincipal = principal({ permissions: [] });
    expect((await call('QueryInboundLineage', {}, 'k5')).error?.code).toBe('UNAUTHORIZED');
  });

  it('intelligence carries NO credential/secret/payload material', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github', 100));
    const r = await call('QueryInboundLineage', {}, 'k6');
    const blob = JSON.stringify(r.data!.intelligence).toLowerCase();
    for (const forbidden of ['secret', 'token', 'signature', 'authorization', 'payload', 'rawbody', 'credential']) {
      expect(blob).not.toContain(forbidden);
    }
  });

  it('AI grounding: includeConnectorIntel prepends sanitized connector-inbound items (opt-in)', async () => {
    busTenant = 'tenant-A';
    bus.publish(inbound('github', 'github', 100));
    bus.publish(inbound('github', 'github', 200));
    const on = await call('QueryEvidenceContext', { includeConnectorIntel: true }, 'k7');
    expect(on.ok).toBe(true);
    expect(on.data!.connectorIntelIncluded).toBe(true);
    const items = on.data!.context as Array<{ text: string; evidence?: Array<{ kind: string; id: string }> }>;
    const ci = items.filter((i) => i.evidence?.[0]?.kind === 'connector-intelligence');
    expect(ci.length).toBeGreaterThanOrEqual(1);
    expect(ci[0].text).toContain('github');
    expect(ci[0].text).toContain('not correlatable');
    const blob = JSON.stringify(items).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'payload']) expect(blob).not.toContain(forbidden);

    // absent flag ⇒ no connector-intelligence prefix (existing read behavior unchanged)
    const off = await call('QueryEvidenceContext', { query: '' }, 'k8');
    expect(off.data!.connectorIntelIncluded).toBe(false);
    expect((off.data!.context as Array<{ evidence?: Array<{ kind: string }> }>).some((i) => i.evidence?.[0]?.kind === 'connector-intelligence')).toBe(false);
  });
});
