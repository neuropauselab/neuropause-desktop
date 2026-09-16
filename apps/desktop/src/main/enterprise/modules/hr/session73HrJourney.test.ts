/**
 * ERP S73 Gate 3 — HR WHOLE-USER JOURNEY (non-policy-blocked lifecycle) through the
 * real HR modules + framework governance.
 *
 *   Employee (onboard) → Leave request → approve → Expense claim → SoD-guarded approval
 *   (creator≠approver, the DEFINED S57 control) → Employee exit (offboard).
 *
 * PAYROLL POST + GENERATE PAYSLIPS + SALARY DISBURSE are DELIBERATELY NOT driven here:
 * their approval authority (executor≠approver SoD, threshold, decider role, disbursement
 * GL) is UNDEFINED (D8) and STOPPED per S73 §9 — see DECISION-MEMO-S60-APPROVAL-CONTROL-
 * PLANE.md. Nothing about payroll authority is invented in this gate.
 *
 * Proves the HR lifecycle actions run through the real module handlers with tenancy +
 * audit + the segregation-of-duties enforcement, no invented HR policy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPLOYEES_MODULE_ID,
  LEAVE_MODULE_ID,
  EXPENSE_CLAIMS_MODULE_ID,
  type EnterpriseEntity,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../framework/moduleRegistry';
import { resolveTenantScope } from '../../../tenancy/backgroundPrincipal';
import { createEmployeeModule } from './employeeModule';
import { createLeaveModule } from './leaveModule';
import { createExpenseClaimModule } from './expenseClaimModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';

const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s73hr-${t}-${randomUUID()}.json`); paths.push(p); return p; };
let scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let audit: { action: string; target: string; summary: string }[];
let currentActor = 'alice@np.dev';

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => currentActor, now: () => '2026-09-03T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; audit = []; currentActor = 'alice@np.dev';
  registry = new EnterpriseModuleRegistry();
  const emp = createEmployeeModule(tmp('emp'));
  const accounts = createLedgerAccountModule(tmp('accounts'));
  for (const m of [
    emp,
    createLeaveModule(tmp('leave'), emp.store),
    createExpenseClaimModule(tmp('exp'), emp.store),
    accounts,
    createJournalEntryModule(tmp('journal'), accounts.store),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const create = (moduleId: string, fields: Record<string, unknown>) =>
  H('enterprise:module.create')({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const act = (moduleId: string, id: string, action: string) =>
  H('enterprise:module.action')({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const get = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id)!;

describe('S73 · HR whole-user journey (non-policy-blocked lifecycle)', () => {
  it('EMPLOYEE onboard → exit (offboard) is governed', async () => {
    const e = await create(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-1', name: 'Grace Hopper', role: 'Engineer', joinDate: '2026-01-01', monthlySalary: 9000 });
    expect(e.ok, JSON.stringify(e.errors)).toBe(true);
    const exit = await act(EMPLOYEES_MODULE_ID, e.record!.id, 'exit');
    expect(exit.ok, exit.error || exit.message).toBe(true);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('LEAVE request → approve is governed (against a real employee)', async () => {
    const e = await create(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-2', name: 'Ada B', joinDate: '2026-01-01', monthlySalary: 8000 });
    const lv = await create(LEAVE_MODULE_ID, { requestNumber: 'LV-1', employee: e.record!.id, kind: 'casual', fromDate: '2026-08-10', toDate: '2026-08-12', days: 3, reason: 'personal' });
    expect(lv.ok, JSON.stringify(lv.errors)).toBe(true);
    currentActor = 'manager@np.dev';
    const ap = await act(LEAVE_MODULE_ID, lv.record!.id, 'approve');
    expect(ap.ok, ap.error || ap.message).toBe(true);
    expect(String(get(LEAVE_MODULE_ID, lv.record!.id).fields.status)).toBe('approved');
  });

  it('EXPENSE claim → SoD: the creator cannot approve their own; another operator can', async () => {
    const e = await create(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-3', name: 'Kay', joinDate: '2026-01-01', monthlySalary: 7000 });
    currentActor = 'alice@np.dev';
    const claim = await create(EXPENSE_CLAIMS_MODULE_ID, { claimNumber: 'EXP-1', employee: e.record!.id, category: 'travel', expenseDate: '2026-08-01', amount: 250, description: 'taxi', status: 'submitted' });
    expect(claim.ok, JSON.stringify(claim.errors)).toBe(true);
    // creator == approver → REFUSED (segregation of duties, the DEFINED S57 control)
    const selfApprove = await act(EXPENSE_CLAIMS_MODULE_ID, claim.record!.id, 'approve');
    expect(selfApprove.ok).toBe(false);
    expect(String(selfApprove.message || selfApprove.error)).toMatch(/segregation of duties|cannot be approved by its own creator/i);
    // a different operator approves → OK
    currentActor = 'bob@np.dev';
    const approve = await act(EXPENSE_CLAIMS_MODULE_ID, claim.record!.id, 'approve');
    expect(approve.ok, approve.error || approve.message).toBe(true);
    expect(String(get(EXPENSE_CLAIMS_MODULE_ID, claim.record!.id).fields.status)).toBe('approved');
  });

  it('TENANT isolation: a leave request in tenant-B is invisible in tenant-A', async () => {
    const eA = await create(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-A', name: 'A', joinDate: '2026-01-01', monthlySalary: 5000 });
    expect(eA.ok).toBe(true);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const empB = registry.get(EMPLOYEES_MODULE_ID)!.store;
    await create(EMPLOYEES_MODULE_ID, { employeeNumber: 'EMP-B', name: 'B', joinDate: '2026-01-01', monthlySalary: 5000 });
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(empB.list().filter((r) => r.status !== 'deleted').find((r) => r.fields.employeeNumber === 'EMP-B')).toBeUndefined();
  });
});
