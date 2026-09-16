/**
 * ERP S75 — PROJECTS WHOLE-USER JOURNEY through the real projects + time-entry + billing +
 * finance-invoice + CRM-customer modules.
 *
 *   CRM Customer → Project (customerRef resolves the real customer) → Tasks (board) →
 *   Time entries (billable, rated) → move task to done → Billing Run (issueInvoice →
 *   a REAL draft invoice via the Finance module + time entries frozen + run closed) →
 *   complete the Project (freezes: closed projects refuse new tasks / edits / re-close).
 *
 * The per-capability proofs (project/task guards + closure freeze; billing-run engine;
 * issue → real draft invoice + entry freeze + one-invoice-per-run) already live in
 * projects.test.ts / projectBilling.test.ts; this pin proves the SAME modules end-to-end as
 * one user journey through the secure handlers and adds cross-tenant isolation.
 *
 * ACCOUNTING BOUNDARY: the billing run produces a DRAFT customer invoice; that invoice's
 * GL/AR posting is the already-certified customer-invoice issue chain (S28), separate from
 * Projects. Project-cost capitalization, revenue recognition, and cost→GL are NOT implemented
 * and are UNDEFINED policy — NOT driven here, NOT invented. See
 * DECISION-MEMO-S75-PROJECT-COST-REVENUE-ACCOUNTING.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { resolveTenantScope } from '../../../tenancy/backgroundPrincipal';
import { createCustomerModule } from '../crm/customerModule';
import { createInvoiceModule } from '../finance/invoiceModule';
import { createProjectModule } from './projectModule';
import { createProjectTaskModule } from './projectTaskModule';
import { createTimeEntryModule } from './timeEntryModule';
import { createBillingRunModule } from './billingRunModule';

const PROJECTS = 'projects-projects';
const TASKS = 'projects-tasks';
const TIME = 'projects-time-entries';
const RUNS = 'projects-billing-runs';
const CUSTOMERS = 'crm-customers';
const FINANCE = 'finance';

const T0 = '2026-09-03T00:00:00.000Z';
const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s75-${t}-${randomUUID()}.json`); paths.push(p); return p; };
let scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
let authorized: EnterprisePermission[] = [];
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

function moduleCtx() {
  return {
    authorize: (p: EnterprisePermission) => authorized.push(p),
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined,
    actor: () => 'pm@np.dev', now: () => T0,
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; authorized = [];
  registry = new EnterpriseModuleRegistry();
  const customers = createCustomerModule(tmp('cust'));
  const projects = createProjectModule(tmp('prj'), customers.store);
  const entries = createTimeEntryModule(tmp('te'), projects.store);
  for (const m of [
    customers,
    projects,
    createProjectTaskModule(tmp('task'), projects.store),
    entries,
    createInvoiceModule(tmp('inv')), // registered under FINANCE_MODULE_ID ('finance')
    createBillingRunModule(tmp('run'), entries.store, projects.store, customers.store),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const create = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const act = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const getRec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id) as EnterpriseEntity;
const listOf = (moduleId: string) => H(IpcChannel.EnterpriseModuleList)({ moduleId }) as Promise<EnterpriseEntity[]>;

describe('S75 · Projects whole-user journey', () => {
  it('customer → project → tasks → time → billing run (real draft invoice + entries frozen) → close', async () => {
    // CRM customer (cross-module, tenant-scoped reference)
    const cust = await create(CUSTOMERS, { name: 'Analytical Engines' });
    expect(cust.ok, JSON.stringify(cust.errors)).toBe(true);
    // Project linked to the real customer (customerRef resolves against the customer store)
    const prj = await create(PROJECTS, { projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: cust.record!.id, billingType: 'time_material' });
    expect(prj.ok, JSON.stringify(prj.errors)).toBe(true);
    const prjId = prj.record!.id;
    // A project referencing a non-existent customer is refused (cross-module ref guard)
    expect((await create(PROJECTS, { projectNumber: 'PRJ-X', name: 'Ghost', customerRef: 'ghost-id' })).ok).toBe(false);

    // Tasks on the board
    const t1 = await create(TASKS, { taskNumber: 'TSK-1', projectRef: prjId, title: 'Design', status: 'todo' });
    expect(t1.ok, JSON.stringify(t1.errors)).toBe(true);
    // A task referencing a ghost project is refused
    expect((await create(TASKS, { taskNumber: 'TSK-G', projectRef: 'ghost', title: 'x', status: 'todo' })).ok).toBe(false);
    // Execute: move a task across the board
    expect((await update(TASKS, t1.record!.id, { status: 'done' })).ok).toBe(true);

    // Billable, rated time
    authorized = [];
    const te1 = await create(TIME, { entryNumber: 'TE-1', projectRef: prjId, person: 'kinjal', date: '2026-08-03', hours: 4, hourlyRate: 50, billable: 'yes' });
    const te2 = await create(TIME, { entryNumber: 'TE-2', projectRef: prjId, person: 'dishant', date: '2026-08-04', hours: 2, hourlyRate: 60, billable: 'yes' });
    expect(te1.ok && te2.ok, JSON.stringify(te1.errors ?? te2.errors)).toBe(true);
    expect(authorized).toContain('operations:manage');

    // Billing run → issue a REAL draft invoice (via the Finance module), freeze the entries, close the run
    const run = await create(RUNS, { projectRef: prjId, periodFrom: '2026-08-01', periodTo: '2026-08-31', taxRate: 18 });
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    // preview computed the amount deterministically: 4×50 + 2×60 = 320
    expect(Number(getRec(RUNS, run.record!.id).fields.totalAmount)).toBe(320);
    expect((await act(RUNS, run.record!.id, 'issueInvoice')).ok).toBe(true);
    const closedRun = getRec(RUNS, run.record!.id);
    expect(String(closedRun.fields.status)).toBe('invoiced');
    const invoices = await listOf(FINANCE);
    const invoice = invoices.find((i) => String(i.fields.number) === 'INV-BR-PRJ-1-1')!;
    expect(invoice).toBeDefined();
    expect(Number(invoice.fields.amount)).toBe(320);
    expect(String(invoice.fields.status)).toBe('draft'); // walks the certified S28 issue→GL chain from here
    // Time entries frozen: stamped invoicedBy + immutable
    expect(String(getRec(TIME, te1.record!.id).fields.invoicedBy)).toBe(invoice.id);
    expect((await update(TIME, te1.record!.id, { hours: 99 })).ok).toBe(false);
    // IDEMPOTENT: one invoice per run — a re-issue is refused, no second invoice
    expect((await act(RUNS, run.record!.id, 'issueInvoice')).ok).toBe(false);
    expect((await listOf(FINANCE)).filter((i) => String(i.fields.number) === 'INV-BR-PRJ-1-1')).toHaveLength(1);

    // Complete the project → freezes (immutable history)
    expect((await act(PROJECTS, prjId, 'complete')).ok).toBe(true);
    expect(String(getRec(PROJECTS, prjId).fields.status)).toBe('completed');
    // ILLEGAL: a closed project refuses new tasks, edits, and re-close
    expect((await create(TASKS, { taskNumber: 'TSK-LATE', projectRef: prjId, title: 'Late', status: 'todo' })).ok).toBe(false);
    expect((await update(PROJECTS, prjId, { budget: 1 })).ok).toBe(false);
    expect((await act(PROJECTS, prjId, 'cancel')).ok).toBe(false);
  });
});

describe('S75 · Projects tenant isolation', () => {
  it('a project created in tenant-B is invisible in tenant-A', async () => {
    await create(PROJECTS, { projectNumber: 'PRJ-A', name: 'A' });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await create(PROJECTS, { projectNumber: 'PRJ-B', name: 'B' });
    const inB = (await listOf(PROJECTS)).map((r) => String(r.fields.projectNumber));
    expect(inB).toContain('PRJ-B');
    expect(inB).not.toContain('PRJ-A');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const inA = (await listOf(PROJECTS)).map((r) => String(r.fields.projectNumber));
    expect(inA).toContain('PRJ-A');
    expect(inA).not.toContain('PRJ-B');
  });
});
