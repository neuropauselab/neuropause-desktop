/**
 * ERP Session 20 — governed workflow / approval runtime + procurement integration.
 *
 * A submitted Purchase Request requires a durable approval before it may become a
 * Purchase Order: submit → evaluate (REQUIRES_APPROVAL) → durable PENDING approval
 * → (authorized approver) decide → dispatch ApprovePurchaseRequest through the
 * command bus → PR approved → convert allowed. Rejection dispatches
 * RejectPurchaseRequest. The workflow never mutates ERP state directly; it reuses
 * the Session 17/18 command bus, durable journal (event + outbox) and audit sink.
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
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { dispatchCommand } from '../command/commandBus';
import { DurableCommandJournal } from '../command/durableCommandJournal';
import type { DomainCommand, DomainCommandType } from '../command/domainCommand';
import type { Principal } from '../application/requestContext';
import { ApprovalInstanceStore } from './approvalInstanceStore';
import { decideApproval, evaluateWorkflow, requestApprovalFor, type WorkflowDeps } from './workflowRuntime';

const NOW = '2026-09-01T12:00:00.000Z';
const FULL: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'operations:read', 'operations:manage'];
const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s20-${t}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: { tenantId: string; workspaceId: string };
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let approvals: ApprovalInstanceStore;
let audit: { action: string; target: string }[];

function ctxFor(p: Principal): EnterpriseModuleContext {
  return {
    authorize: (perm) => { if (!p.permissions.includes(perm)) throw new Error('unauthorized'); },
    audit: (e) => audit.push(e),
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    actor: () => p.actor,
    now: () => NOW,
  };
}
const principal = (over: Partial<Principal> = {}): Principal => ({ actor: 'buyer@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: FULL, ...over });
let seq = 0;
function mkCmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string }, p: Principal): DomainCommand {
  return { commandId: `cmd_${(seq += 1)}`, type, tenantId: p.tenantId, actor: p.actor, ...(opts.target ? { target: { id: opts.target } } : {}), payload: opts.payload ?? {}, correlationId: 'corr-1', idempotencyKey: opts.idem ?? `idem_${type}_${seq}`, timestamp: NOW, source: 'test' };
}
const dispatch = (cmd: DomainCommand, p: Principal) => dispatchCommand(cmd, { registry, ctx: ctxFor(p), resolveScope: () => ({ tenantId: p.tenantId, workspaceId: p.workspaceId ?? '' }), journal });
const wfDeps = (): WorkflowDeps => ({ approvals, registry, journal, audit: (e) => audit.push(e), now: () => NOW });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseRequestModule(tmp('pr')),
    createPurchaseOrderModule(tmp('po')),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  journal = new DurableCommandJournal(tmp('journal'));
  approvals = new ApprovalInstanceStore(tmp('approvals'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  await approvals.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const prStatus = (id: string) => String(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.get(id)?.fields.status);
const poCount = () => registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list().length;
const prLines = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);

async function submitPR(p: Principal, tag: string): Promise<string> {
  const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: `PR-${tag}`, lines: prLines }, idem: `cr-${tag}` }, p), p);
  const prId = String(c.data!.id);
  await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: `sub-${tag}` }, p), p);
  return prId;
}

// ===========================================================================
// WORKFLOW EVALUATION + durable approval + no-bypass
// ===========================================================================

describe('S20 · workflow evaluation + durable approval instance', () => {
  it('a submitted PR REQUIRES_APPROVAL and creates a durable PENDING approval', async () => {
    const p = principal();
    const prId = await submitPR(p, 'req');
    const { decision, approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    expect(decision.kind).toBe('REQUIRES_APPROVAL');
    expect(approval!.status).toBe('PENDING');
    expect(approvals.get(p.tenantId, approval!.id)!.status).toBe('PENDING'); // durable
    expect(audit.some((a) => a.action === 'approval.requested')).toBe(true);
  });

  it('a pending PR cannot convert to a PO (no bypass)', async () => {
    const p = principal();
    const prId = await submitPR(p, 'pend');
    await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-pend' }, p), p);
    expect(conv.ok).toBe(false);
    expect(poCount()).toBe(0);
  });

  it('APPROVED → the gated command runs → PR approved → convert succeeds', async () => {
    const p = principal();
    const prId = await submitPR(p, 'ok');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    const d = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    expect(d.ok).toBe(true);
    expect(d.approval!.status).toBe('APPROVED');
    expect(prStatus(prId)).toBe('approved'); // the domain command approved it
    expect(audit.some((a) => a.action === 'approval.approved')).toBe(true);
    // durable domain event via the journal (reused, not duplicated)
    expect(journal.ofType(p.tenantId, 'PurchaseRequestApproved')).toHaveLength(1);
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-ok' }, p), p);
    expect(conv.ok).toBe(true);
    expect(poCount()).toBe(1);
  });

  it('REJECTED → PR rejected → convert denied', async () => {
    const p = principal();
    const prId = await submitPR(p, 'rej');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    const d = await decideApproval({ approvalId: approval!.id, decision: 'REJECT', approver: p, correlationId: 'corr-1' }, wfDeps());
    expect(d.ok).toBe(true);
    expect(prStatus(prId)).toBe('rejected');
    expect(journal.ofType(p.tenantId, 'PurchaseRequestRejected')).toHaveLength(1);
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-rej' }, p), p);
    expect(conv.ok).toBe(false);
    expect(poCount()).toBe(0);
  });
});

// ===========================================================================
// AUTHORIZATION + TENANT ISOLATION
// ===========================================================================

describe('S20 · authorization + tenant isolation', () => {
  it('an unauthorized approver is denied and the approval stays PENDING', async () => {
    const p = principal();
    const prId = await submitPR(p, 'authz');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    const viewer = principal({ actor: 'viewer@np.dev', permissions: ['procurement:read'] }); // no manage
    const d = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: viewer, correlationId: 'corr-1' }, wfDeps());
    expect(d.ok).toBe(false);
    expect(d.error).toBe('UNAUTHORIZED');
    expect(approvals.get(p.tenantId, approval!.id)!.status).toBe('PENDING'); // no transition
    expect(prStatus(prId)).not.toBe('approved');
  });

  it('an approver in tenant B cannot decide tenant A’s approval', async () => {
    const pa = principal();
    const prId = await submitPR(pa, 'iso');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: pa, correlationId: 'corr-1' }, wfDeps());
    const pb: Principal = { actor: 'b@np.dev', tenantId: 'tenant-B', workspaceId: 'ws-B', permissions: FULL };
    const d = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: pb, correlationId: 'corr-1' }, wfDeps());
    expect(d.ok).toBe(false);
    expect(d.error).toBe('NOT_FOUND'); // A's approval is invisible to B
    expect(approvals.get(pa.tenantId, approval!.id)!.status).toBe('PENDING');
  });
});

// ===========================================================================
// IDEMPOTENCY + CONCURRENCY
// ===========================================================================

describe('S20 · approval idempotency + concurrency', () => {
  it('approve twice → one transition, one command, one economic effect', async () => {
    const p = principal();
    const prId = await submitPR(p, 'idem');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    const d1 = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    const d2 = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    expect(d1.ok && d2.ok).toBe(true);
    expect(d2.replayed).toBe(true);
    expect(approvals.list(p.tenantId).filter((a) => a.status === 'APPROVED')).toHaveLength(1);
    expect(journal.ofType(p.tenantId, 'PurchaseRequestApproved')).toHaveLength(1); // one economic effect
    expect(audit.filter((a) => a.action === 'approval.approved')).toHaveLength(1); // fresh audit once
  });

  it('approve after reject is a deterministic conflict', async () => {
    const p = principal();
    const prId = await submitPR(p, 'conf');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    expect((await decideApproval({ approvalId: approval!.id, decision: 'REJECT', approver: p, correlationId: 'corr-1' }, wfDeps())).ok).toBe(true);
    const after = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    expect(after.ok).toBe(false);
    expect(after.error).toBe('CONFLICT');
  });

  it('100 concurrent approvals → exactly one terminal transition + one effect', async () => {
    const p = principal();
    const prId = await submitPR(p, 'conc');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    await Promise.all(Array.from({ length: 100 }, () => decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps())));
    expect(approvals.list(p.tenantId).filter((a) => a.status === 'APPROVED')).toHaveLength(1);
    expect(journal.ofType(p.tenantId, 'PurchaseRequestApproved')).toHaveLength(1);
    expect(prStatus(prId)).toBe('approved');
  });
});

// ===========================================================================
// FAILURE / RESTART
// ===========================================================================

describe('S20 · durability across restart', () => {
  it('the approval and its decision survive a process restart; a re-decide is idempotent', async () => {
    const p = principal();
    const prId = await submitPR(p, 'restart');
    const { approval } = await requestApprovalFor({ targetId: prId, requester: p, correlationId: 'corr-1' }, wfDeps());
    await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    await approvals.reload(); // simulate restart
    await journal.reload();
    expect(approvals.get(p.tenantId, approval!.id)!.status).toBe('APPROVED'); // decision survived
    const again = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: p, correlationId: 'corr-1' }, wfDeps());
    expect(again.replayed).toBe(true); // idempotent after restart
    expect(journal.ofType(p.tenantId, 'PurchaseRequestApproved')).toHaveLength(1);
  });
});

// ===========================================================================
// AI GOVERNANCE + ELECTRON INDEPENDENCE
// ===========================================================================

describe('S20 · AI governance + client independence', () => {
  it('an AI principal without decide authority cannot approve (no self-approval, no bypass)', async () => {
    const human = principal();
    const prId = await submitPR(human, 'ai');
    const ai: Principal = { actor: 'agent:np', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: ['procurement:read'] }; // read-only agent
    const { approval } = await requestApprovalFor({ targetId: prId, requester: ai, correlationId: 'corr-1' }, wfDeps());
    const d = await decideApproval({ approvalId: approval!.id, decision: 'APPROVE', approver: ai, correlationId: 'corr-1' }, wfDeps());
    expect(d.ok).toBe(false);
    expect(d.error).toBe('UNAUTHORIZED'); // the AI cannot approve — authorization denies it
    expect(prStatus(prId)).not.toBe('approved');
  });

  it('the workflow + command + persistence + application layers import no Electron / React / IPC', async () => {
    const roots = [__dirname, join(__dirname, '../command'), join(__dirname, '../persistence'), join(__dirname, '../application')];
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const ent of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) await walk(p);
        else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) files.push(p);
      }
    };
    for (const r of roots) await walk(r);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = await fs.readFile(f, 'utf8');
      expect(src, `${f} must not import electron`).not.toMatch(/from ['"]electron['"]/);
      expect(src, `${f} must not import react`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${f} must not import ipcMain/BrowserWindow`).not.toMatch(/ipcMain|BrowserWindow/);
    }
  });

  it('policy evaluation is pure and transport-neutral (no approval for non-gated operations)', () => {
    expect(evaluateWorkflow({ operation: 'SubmitPurchaseRequest', targetModule: 'procurement-requests', tenantId: 't', actor: 'a' }).kind).toBe('REQUIRES_APPROVAL');
    expect(evaluateWorkflow({ operation: 'CreatePurchaseRequest', tenantId: 't', actor: 'a' }).kind).toBe('ALLOW');
  });
});
