/**
 * ERP Session 99 — PROJECTS ECONOMIC CONTROL-PLANE CERTIFICATION.
 *
 * Certifies Projects as a SAFE, governed participant in the canonical Finance/O2C control plane, reusing ONLY
 * the existing customer-invoice module + its governed issue → GL chain — no new engine, no project-specific
 * invoice store, no project-specific GL seam. Projects reaches Finance solely to CREATE a draft invoice.
 *
 * THE ECONOMIC SEAM (source-wins): a billing run's `issueInvoice` action re-derives unbilled billable time and
 * creates a DRAFT invoice in the canonical FINANCE_MODULE_ID ('finance') store — byte-identical to an O2C draft
 * invoice — then freezes the gathered time entries (immutable) and freezes the run (idempotent). Issuing that
 * draft through the canonical invoice `issue` action fires the SAME defined posting the O2C S28/S95 path uses:
 * Dr Accounts Receivable (1100) / Cr Sales Revenue (4000) (+ tax) — exactly once, machine-owned.
 *
 * POLICY-OPEN (NOT invented — DECISION-MEMO-S75, still open): project COST → GL, revenue recognition beyond
 * invoice issue, cost capitalization, labor-cost methodology, budget-variance/write-off. There is no
 * project-cost entity; creating projects/tasks/time entries posts NO journal (safe/non-posting until an invoice
 * is issued). This session proves that boundary is safe; it does not choose any of those accounting rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  CUSTOMERS_MODULE_ID,
  PROJECTS_MODULE_ID,
  PROJECT_TASKS_MODULE_ID,
  TIME_ENTRIES_MODULE_ID,
  BILLING_RUNS_MODULE_ID,
  FINANCE_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  GL_CONTROL_ACCOUNTS,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createProjectModule } from '../../enterprise/modules/projects/projectModule';
import { createProjectTaskModule } from '../../enterprise/modules/projects/projectTaskModule';
import { createTimeEntryModule } from '../../enterprise/modules/projects/timeEntryModule';
import { createBillingRunModule } from '../../enterprise/modules/projects/billingRunModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const AR = GL_CONTROL_ACCOUNTS.accountsReceivable.code; // 1100
const REV = GL_CONTROL_ACCOUNTS.salesRevenue.code; // 4000

interface StorePaths { cust: string; acct: string; jrnl: string; fin: string; proj: string; task: string; time: string; run: string; journal: string; }
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s99p-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { cust: p('cust'), acct: p('acct'), jrnl: p('jrnl'), fin: p('fin'), proj: p('proj'), task: p('task'), time: p('time'), run: p('run'), journal: p('journal') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];
function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'pm@np.dev', now: () => '2026-09-30T12:00:00.000Z',
  };
}
function buildInstallation(paths: StorePaths, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const customers = createCustomerModule(paths.cust);
  const accounts = createLedgerAccountModule(paths.acct);
  const project = createProjectModule(paths.proj, customers.store);
  const time = createTimeEntryModule(paths.time, project.store);
  for (const m of [
    customers, accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    createInvoiceModule(paths.fin),
    project,
    createProjectTaskModule(paths.task, project.store),
    time,
    createBillingRunModule(paths.run, time.store, project.store, customers.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  const journal = new DurableCommandJournal(paths.journal);
  return { registry, handlers: buildModuleHandlers(registry, ctx), journal };
}

let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; idem?: string } = {}): DomainCommand {
  return { commandId: `cmd_${(seq += 1)}`, type, actor: 'pm@np.dev', ...(opts.target ? { target: { id: opts.target } } : {}), payload: {}, correlationId: 'corr_s99', idempotencyKey: opts.idem ?? `${type}_${seq}`, timestamp: '2026-09-30T12:00:00.000Z', source: 'test' };
}
function deps(i = inst, c: EnterpriseModuleContext = ctx): CommandDispatchDeps { return { registry: i.registry, ctx: c, resolveScope: () => scope, journal: i.journal }; }

let paths: StorePaths;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  paths = freshPaths();
  ctx = makeCtx();
  inst = buildInstallation(paths, ctx);
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handler = (i: ReturnType<typeof buildInstallation>, ch: string) => { const d = i.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actIn = (m: string, id: string, a: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
const listIn = (m: string, i = inst) => i.registry.get(m)!.store.list();
const rec = (m: string, id: string, i = inst) => i.registry.get(m)!.store.get(id);
const alive = (m: string, i = inst) => listIn(m, i).filter((r) => r.status !== 'deleted');
function journalLines(i = inst): { account: string; debit: number; credit: number }[] {
  return listIn(JOURNAL_ENTRIES_MODULE_ID, i).flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit', i = inst): number =>
  journalLines(i).filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);

async function seedProjectWithTime(i = inst): Promise<{ projectId: string; runId: string }> {
  const cust = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta Corp' }, i);
  const project = await createIn(PROJECTS_MODULE_ID, { projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: cust.record!.id, billingType: 'time_material' }, i);
  const projectId = project.record!.id;
  // two billable, rated time entries in the period
  await createIn(TIME_ENTRIES_MODULE_ID, { entryNumber: 'TE-1', projectRef: projectId, person: 'Sam', date: '2026-09-10', hours: 10, hourlyRate: 50, billable: 'yes' }, i);
  await createIn(TIME_ENTRIES_MODULE_ID, { entryNumber: 'TE-2', projectRef: projectId, person: 'Sam', date: '2026-09-11', hours: 6, hourlyRate: 50, billable: 'yes' }, i);
  const run = await createIn(BILLING_RUNS_MODULE_ID, { projectRef: projectId, periodFrom: '2026-09-01', periodTo: '2026-09-30', taxRate: 0 }, i);
  expect(run.ok).toBe(true);
  return { projectId, runId: run.record!.id };
}
const draftInvoice = (i = inst) => alive(FINANCE_MODULE_ID, i).find((r) => String(r.fields.status) === 'draft' || String(r.fields.status) === 'issued');

// ─────────────────────── 1 · NON-POSTING BOUNDARY (project/task/time) ───────────────────────
describe('S99 projects — creating projects, tasks and time entries posts NO journal (safe/non-posting)', () => {
  it('the delivery records carry no GL until an invoice is issued', async () => {
    await seedProjectWithTime();
    await createIn(PROJECT_TASKS_MODULE_ID, { taskNumber: 'T-1', projectRef: listIn(PROJECTS_MODULE_ID)[0].id, title: 'Design', status: 'todo' });
    expect(journalLines().length).toBe(0); // no project-cost or project-revenue journal exists
  });
});

// ─────────────────────── 2 · BILLING RUN → DRAFT INVOICE (canonical finance module) ───────────────────────
describe('S99 projects — a billing run creates a DRAFT invoice in the canonical finance module and freezes its time', () => {
  it('issueInvoice gathers billable time into one draft invoice, freezes the entries and the run; a re-issue is refused', async () => {
    const { runId } = await seedProjectWithTime();
    expect((await actIn(BILLING_RUNS_MODULE_ID, runId, 'issueInvoice')).ok).toBe(true);
    const inv = draftInvoice();
    expect(inv).toBeTruthy();
    expect(String(inv!.fields.status)).toBe('draft'); // a DRAFT invoice, not yet posted
    expect(Number(inv!.fields.amount)).toBe(800); // (10 + 6) h × 50
    expect(journalLines().length).toBe(0); // a draft invoice posts NO GL yet
    // every gathered time entry is frozen (invoicedBy set) and immutable
    const entries = listIn(TIME_ENTRIES_MODULE_ID).filter((e) => String(e.fields.person) === 'Sam');
    expect(entries.every((e) => String(e.fields.invoicedBy) === inv!.id)).toBe(true);
    expect((await updateIn(TIME_ENTRIES_MODULE_ID, entries[0].id, { hours: 99 })).ok).toBe(false); // invoiced time is immutable
    // the run itself is frozen — a second issue is refused (idempotent; no second invoice)
    expect((await actIn(BILLING_RUNS_MODULE_ID, runId, 'issueInvoice')).ok).toBe(false);
    expect(alive(FINANCE_MODULE_ID).length).toBe(1);
  });
});

// ─────────────────────── 3 · CANONICAL ISSUE → AR / REVENUE (inherited O2C posting) ───────────────────────
describe('S99 projects — issuing the draft invoice fires the DEFINED Dr AR / Cr Sales Revenue posting exactly once', () => {
  it('the project invoice walks the same governed issue → GL chain as O2C; re-issue is machine-owned and refused', async () => {
    const { runId } = await seedProjectWithTime();
    await actIn(BILLING_RUNS_MODULE_ID, runId, 'issueInvoice');
    const inv = draftInvoice()!;
    // the legacy raw action door is FENCED (S46): issuing must go through the governed command — a control
    expect((await actIn(FINANCE_MODULE_ID, inv.id, 'issue')).ok).toBe(false);
    expect(bal(AR, 'debit')).toBe(0); // still no posting via the refused legacy door
    // issue through the canonical governed IssueCustomerInvoice command (the exact O2C S28/S95 path)
    expect((await dispatchCommand(cmd('IssueCustomerInvoice', { target: inv.id, idem: 'issue:1' }), deps())).ok).toBe(true);
    expect(String(rec(FINANCE_MODULE_ID, inv.id)!.fields.status)).toBe('issued');
    // DEFINED posting: Dr Accounts Receivable 800 / Cr Sales Revenue 800 (taxRate 0)
    expect(bal(AR, 'debit')).toBe(800);
    expect(bal(REV, 'credit')).toBe(800);
    // there is NO separate project cost→GL or revenue-recognition posting — only the canonical AR/revenue
    const otherLines = journalLines().filter((l) => l.account !== AR && l.account !== REV);
    expect(otherLines.length).toBe(0);
    // AR booked exactly once — a replay of the command posts no second entry
    await dispatchCommand(cmd('IssueCustomerInvoice', { target: inv.id, idem: 'issue:1' }), deps());
    expect(bal(AR, 'debit')).toBe(800);
    expect(bal(REV, 'credit')).toBe(800);
  });
});

// ─────────────────────── 4 · SECURITY (tenant / RBAC / AI boundary) ───────────────────────
describe('S99 projects — issuing needs operations authority; tenant isolation; advisory cannot bill or post', () => {
  it('an advisory principal with no operations:manage cannot run a billing run; another tenant sees nothing', async () => {
    const { runId } = await seedProjectWithTime();
    const advisory = makeCtx('operations:manage');
    const advHandlers = buildModuleHandlers(inst.registry, advisory);
    const advAct = advHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleAction)!.handler as (p: unknown) => Promise<unknown>;
    let refused = false;
    try {
      const r = (await advAct({ moduleId: BILLING_RUNS_MODULE_ID, id: runId, action: 'issueInvoice' })) as { ok: boolean };
      refused = r.ok === false;
    } catch { refused = true; }
    expect(refused).toBe(true);
    expect(alive(FINANCE_MODULE_ID).length).toBe(0); // no invoice from the advisory attempt

    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(listIn(PROJECTS_MODULE_ID).length).toBe(0);
    expect(listIn(TIME_ENTRIES_MODULE_ID).length).toBe(0);
    expect(listIn(BILLING_RUNS_MODULE_ID).length).toBe(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  });
});

// ─────────────────────── 5 · RESTART / DURABILITY ───────────────────────
describe('S99 projects — project/task/time/invoice lineage + AR/revenue GL survive a restart; no duplicate billing', () => {
  it('rebuild over the same stores preserves the invoice, its lineage, the frozen entries and the posted GL', async () => {
    const { runId } = await seedProjectWithTime();
    await actIn(BILLING_RUNS_MODULE_ID, runId, 'issueInvoice');
    const inv = draftInvoice()!;
    await dispatchCommand(cmd('IssueCustomerInvoice', { target: inv.id, idem: 'issue:1' }), deps());
    const snap = { invoices: alive(FINANCE_MODULE_ID).length, ar: bal(AR, 'debit'), rev: bal(REV, 'credit'), runStatus: String(rec(BILLING_RUNS_MODULE_ID, runId)!.fields.status), invoiceRef: String(rec(BILLING_RUNS_MODULE_ID, runId)!.fields.invoiceRef) };
    for (const m of [CUSTOMERS_MODULE_ID, FINANCE_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, PROJECTS_MODULE_ID, TIME_ENTRIES_MODULE_ID, BILLING_RUNS_MODULE_ID]) await inst.registry.get(m)!.store.flush();
    const inst2 = buildInstallation(paths, makeCtx());
    for (const m of [CUSTOMERS_MODULE_ID, FINANCE_MODULE_ID, JOURNAL_ENTRIES_MODULE_ID, PROJECTS_MODULE_ID, TIME_ENTRIES_MODULE_ID, BILLING_RUNS_MODULE_ID]) await inst2.registry.get(m)!.store.load();
    expect(alive(FINANCE_MODULE_ID, inst2).length).toBe(snap.invoices);
    expect(bal(AR, 'debit', inst2)).toBe(snap.ar);
    expect(bal(REV, 'credit', inst2)).toBe(snap.rev);
    expect(String(rec(BILLING_RUNS_MODULE_ID, runId, inst2)!.fields.status)).toBe(snap.runStatus); // 'invoiced'
    expect(String(rec(BILLING_RUNS_MODULE_ID, runId, inst2)!.fields.invoiceRef)).toBe(snap.invoiceRef); // lineage survives
    // re-issuing the frozen run after restart is refused → no duplicate billing
    expect((await actIn(BILLING_RUNS_MODULE_ID, runId, 'issueInvoice', inst2)).ok).toBe(false);
    expect(alive(FINANCE_MODULE_ID, inst2).length).toBe(snap.invoices);
  });
});
