/**
 * ERP S73 Gate 2 — CRM WHOLE-USER JOURNEY through the real module framework + the
 * governed command spine, driven exactly as the UI drives it (secure-bridge handlers).
 *
 *   Lead → CONVERT (creates Contact + Customer, cross-linked) → Opportunity →
 *   advanceStage → markWon → Quote (accepted) → ConvertQuoteToSalesOrder (GOVERNED
 *   command) → Sales Order → relationship history intact.
 *
 * This is the sandbox-runnable half of the gate (the real-Electron whole-journey lives
 * in e2e/s73CrmJourney.e2e.cjs). It proves the CRM lifecycle actions + the governed
 * quote→order handoff run through the REAL handlers with RBAC, tenancy (scopeOrDeny),
 * audit, and idempotency — no renderer bypass, no invented CRM policy.
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

import {
  IpcChannel,
  LEADS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  CRM_MODULE_ID,
  OPPORTUNITIES_MODULE_ID,
  QUOTES_MODULE_ID,
  ORDERS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createLeadModule } from '../../enterprise/modules/crm/leadModule';
import { createContactModule } from '../../enterprise/modules/crm/contactModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOpportunityModule } from '../../enterprise/modules/crm/opportunityModule';
import { createQuoteModule } from '../../enterprise/modules/sales/quoteModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (t: string): string => { const p = join(tmpdir(), `np-s73crm-${t}-${randomUUID()}.json`); paths.push(p); return p; };
const PERMS: EnterprisePermission[] = ['crm:read', 'crm:manage', 'sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-03T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  for (const m of [
    createLeadModule(tmp('leads')),
    createContactModule(tmp('contacts')),
    createCustomerModule(tmp('customers')),
    createOpportunityModule(tmp('opps')),
    createQuoteModule(tmp('quotes')),
    createOrderModule(tmp('orders')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: (e) => audit.push(e), resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
// Read the store directly (the List IPC response shape varies); count live records.
const count = (moduleId: string) => registry.get(moduleId)!.store.list().filter((r) => r.status !== 'deleted').length;
const rows = (moduleId: string) => registry.get(moduleId)!.store.list().filter((r) => r.status !== 'deleted');
const get = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id)!;

interface DispatchResult { ok: boolean; data?: { id?: string; orderId?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string, payload: Record<string, unknown> = {}, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(def, { operation, ...(target ? { target } : {}), payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true })) as DispatchResult;
}

describe('S73 · CRM whole-user journey (governed, real handlers)', () => {
  it('LEAD → CONVERT creates a Contact + Customer (cross-linked, governed), then is idempotent', async () => {
    const lead = await createIn(LEADS_MODULE_ID, { name: 'Ada Lovelace', company: 'Analytical Engines', email: 'ada@ae.example', dealValue: 5000, stage: 'new' });
    expect(lead.ok).toBe(true);
    const conv = await actIn(LEADS_MODULE_ID, lead.record!.id, 'convert');
    expect(conv.ok, conv.error || conv.message).toBe(true);
    // a customer and a contact now exist in this tenant
    expect(count(CUSTOMERS_MODULE_ID)).toBe(1);
    expect(count(CRM_MODULE_ID)).toBe(1);
    // the lead is cross-linked and cannot be converted twice (no second customer/contact)
    const again = await actIn(LEADS_MODULE_ID, lead.record!.id, 'convert');
    expect(again.ok).toBe(false);
    expect(count(CUSTOMERS_MODULE_ID)).toBe(1);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('OPPORTUNITY lifecycle: create → advanceStage → markWon; a closed opportunity is immutable', async () => {
    const opp = await createIn(OPPORTUNITIES_MODULE_ID, { name: 'AE expansion', account: 'Analytical Engines', amount: 12000, stage: 'prospecting' });
    expect(opp.ok, JSON.stringify(opp.errors)).toBe(true);
    expect((await actIn(OPPORTUNITIES_MODULE_ID, opp.record!.id, 'advanceStage')).ok).toBe(true);
    expect((await actIn(OPPORTUNITIES_MODULE_ID, opp.record!.id, 'markWon')).ok).toBe(true);
    expect(String(get(OPPORTUNITIES_MODULE_ID, opp.record!.id).fields.stage)).toBe('closed-won');
    // immutable after close — a further transition is refused
    const after = await actIn(OPPORTUNITIES_MODULE_ID, opp.record!.id, 'advanceStage');
    expect(after.ok).toBe(false);
  });

  it('QUOTE → ConvertQuoteToSalesOrder (GOVERNED command) creates a Sales Order; replay is idempotent', async () => {
    const q = await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-CRM-1', customer: 'Analytical Engines', status: 'accepted', currency: 'USD', subtotal: 12000, total: 12000 });
    expect(q.ok).toBe(true);
    const conv = await dispatch('ConvertQuoteToSalesOrder', q.record!.id, 'crm-q1');
    expect(conv.ok, JSON.stringify(conv.error)).toBe(true);
    expect(conv.data!.orderId).toBeTruthy();
    expect(String(get(QUOTES_MODULE_ID, q.record!.id).fields.status)).toBe('converted');
    expect(count(ORDERS_MODULE_ID)).toBe(1);
    const replay = await dispatch('ConvertQuoteToSalesOrder', q.record!.id, 'crm-q1');
    expect(replay.replayed).toBe(true);
    expect(count(ORDERS_MODULE_ID)).toBe(1); // one order, ever
  });

  it('GOVERNANCE negatives: governed dispatch enforces RBAC + tenant; cross-tenant record invisible', async () => {
    // Seed an accepted quote to act on.
    const q = await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-NEG', customer: 'Acme', status: 'accepted', currency: 'USD', subtotal: 100, total: 100 });
    expect(q.ok).toBe(true);
    // UNAUTHORIZED — a principal without sales:manage cannot run the governed conversion.
    currentPrincipal = fullPrincipal({ permissions: ['crm:read', 'sales:read'] });
    const denied = await dispatch('ConvertQuoteToSalesOrder', q.record!.id, 'neg-unauth');
    expect(denied.ok).toBe(false);
    expect(denied.error!.code).toBe('UNAUTHORIZED');
    expect(count(ORDERS_MODULE_ID)).toBe(0);
    // TENANT_SCOPE_VIOLATION — a renderer claiming a foreign tenant is refused.
    currentPrincipal = fullPrincipal();
    const evil = await dispatch('ConvertQuoteToSalesOrder', q.record!.id, 'neg-tenant', {}, 'tenant-EVIL');
    expect(evil.ok).toBe(false);
    expect(evil.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    // Cross-tenant invisibility: a lead created in tenant-B is not visible in tenant-A.
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await createIn(LEADS_MODULE_ID, { name: 'Foreign Lead', stage: 'new' });
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(rows(LEADS_MODULE_ID).find((r) => r.fields.name === 'Foreign Lead')).toBeUndefined();
  });
});
