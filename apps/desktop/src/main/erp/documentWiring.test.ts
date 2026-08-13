/**
 * The ERP document layer, reached the way the renderer reaches it.
 *
 * These tests exist because everything they exercise was already written,
 * already correct, and completely unreachable: the line store, the totals
 * derivation, the approval policy engine and its segregation-of-duties rules
 * were registered against live modules with no IPC channel and no caller. Unit
 * tests passed the whole time. What was missing was the seam, so the seam is
 * what is tested here — through `buildModuleHandlers`, over the real Zod
 * schemas, against real stores on disk.
 *
 * The load-bearing assertions:
 *  - lines can be entered at all, and totals DERIVE from them;
 *  - approval decisions PERSIST (the engine is pure; nothing was keeping them,
 *    so no document could ever reach `approved`);
 *  - segregation of duties actually bites on a real status change;
 *  - a refusal is a HOLD, not a lost error.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DocumentApprovalResult,
  DocumentApprovalView,
  DocumentLinesResult,
  DocumentLinesView,
  EnterpriseModuleMutationResult,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import {
  EnterpriseModuleRegistry,
  EnterpriseRecordStore,
  buildModuleHandlers,
  defineEnterpriseModule,
} from '../enterprise/framework';
import { DocumentIntegration } from './documentAdapter';
import { DocumentLineStore } from './documentLines';
import { ApprovalStore } from './approvalStore';
import { createDocumentBridge } from './documentBridge';
import type { ApprovalPolicy, Approver } from './approvalEngine';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

/**
 * P13C ROUND 5 — approvals are keyed by (tenant, module, document), so this
 * suite names an organization. It tests one tenant's approval flow, exactly as
 * before; cross-tenant behaviour is asserted separately.
 */
const APPROVAL_ORG = { tenantId: 'org-test', workspaceId: 'ws-test' };
const asOrg = (): typeof APPROVAL_ORG => APPROVAL_ORG;

const T0 = '2026-08-09T12:00:00.000Z';

/**
 * A two-step policy over a threshold, with the SoD rule that matters most in
 * practice: whoever raised the request may not approve it.
 */
const POLICY: ApprovalPolicy = {
  id: 'test-spend',
  documentType: 'purchaseOrder',
  steps: [
    { id: 'manager', label: 'Manager approval', roles: ['manager', 'admin'] },
    { id: 'finance', label: 'Finance approval', roles: ['finance'], minAmount: 1000 },
  ],
  sod: ['creator_cannot_approve'],
};

describe('ERP document layer, wired', () => {
  let dir: string;
  let registry: EnterpriseModuleRegistry;
  let approvals: ApprovalStore;
  let lineStore: DocumentLineStore;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;
  let recordId: string;
  let approver: Approver | null;
  let holdsRaised: { reason: string; status: string }[];

  beforeEach(async () => {
    dir = join(tmpdir(), `np-erp-wire-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    holdsRaised = [];
    approver = { userId: 'manager@example.com', roles: ['manager'] };

    lineStore = new DocumentLineStore(join(dir, 'lines.json'));
    approvals = new ApprovalStore(join(dir, 'approvals.json')).bindScope(asOrg);
    await Promise.all([lineStore.load(), approvals.load()]);

    const integration = new DocumentIntegration({
      lines: lineStore,
      postJournal: () => undefined,
      audit: () => undefined,
      now: () => T0,
      actor: () => approver?.userId ?? null,
    });
    integration.register({
      moduleId: 'procurement-orders',
      documentType: 'purchaseOrder',
      editPermission: 'procurement:manage',
      approval: { policy: POLICY, gatedStatuses: ['approved'] },
    });

    registry = new EnterpriseModuleRegistry();
    const module = defineEnterpriseModule({
      descriptor: {
        id: 'procurement-orders',
        title: 'Purchase orders',
        singular: 'Purchase order',
        plural: 'Purchase orders',
        icon: 'package',
        description: 'test',
        titleField: 'reference',
        permissions: { read: 'procurement:read', write: 'procurement:manage' },
        fields: [
          { key: 'reference', label: 'Reference', type: 'text', required: true },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            required: true,
            default: 'draft',
            options: [
              { value: 'draft', label: 'Draft' },
              { value: 'approved', label: 'Approved' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
        ],
      },
      store: new EnterpriseRecordStore(join(dir, 'orders.json'), 'procurement-orders', 'order').bindScope(() => TEST_TENANT_SCOPE),
    });
    registry.register(module);
    await module.store.load();
    recordId = module.store.create({
      title: 'PO-1',
      fields: { reference: 'PO-1', status: 'draft' },
      // The creator — the person SoD must later disqualify.
      actor: 'manager@example.com',
      now: T0,
    }).id;

    const documents = createDocumentBridge({
      integration,
      approvals,
      currentApprover: () => approver,
    });

    const handlers = buildModuleHandlers(registry, {
      authorize: () => undefined,
      audit: () => undefined,
      broadcast: () => undefined,
      actor: () => approver?.userId ?? null,
      now: () => T0,
      documents,
      canEnterStatus: (moduleId, record, status) =>
        integration.canEnterStatus(moduleId, record, status, approvals.forDocument(moduleId, record.id)),
      onApprovalRequired: ({ status, reason }) => {
        holdsRaised.push({ reason, status });
        return { holdId: `hold_${holdsRaised.length}` };
      },
    });
    const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    // EVERY store here writes atomically (tmp file + rename). Flushing only
    // some of them leaves the rest racing the directory removal below, which
    // surfaces as an unhandled ENOENT that fails the whole run while every
    // test still reports green — the same flake this suite's medical-device
    // neighbour had, and the reason it is worth being exhaustive here.
    // `DocumentLineStore` awaits its own write, so it has nothing pending.
    // `ApprovalStore` and `EnterpriseRecordStore` both COALESCE writes behind a
    // queue, so both must be drained or the rename below races the removal —
    // an unhandled ENOENT that fails the run while every test reports green.
    await Promise.all([approvals.flush(), ...registry.list().map((m) => m.store.flush())]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const setLines = (lines: unknown[]): Promise<DocumentLinesResult> =>
    call(IpcChannel.EnterpriseModuleSetLines, {
      moduleId: 'procurement-orders',
      id: recordId,
      lines,
    }) as Promise<DocumentLinesResult>;

  const approvalOf = (): Promise<DocumentApprovalView> =>
    call(IpcChannel.EnterpriseModuleApproval, {
      moduleId: 'procurement-orders',
      id: recordId,
    }) as Promise<DocumentApprovalView>;

  describe('line items', () => {
    it('a document with no lines totals zero — and says it supports lines', async () => {
      const view = (await call(IpcChannel.EnterpriseModuleLines, {
        moduleId: 'procurement-orders',
        id: recordId,
      })) as DocumentLinesView;
      expect(view.supported).toBe(true);
      expect(view.lines).toEqual([]);
      expect(view.totals?.total).toBe(0);
    });

    it('lines can finally be entered, and totals DERIVE from them', async () => {
      const result = await setLines([
        { productId: 'p-1', description: 'Widgets', quantity: 10, unitPrice: 100, taxRatePercent: 18 },
      ]);
      expect(result.ok).toBe(true);
      // 10 x 100 = 1000 net, +18% tax = 1180.
      expect(result.view?.totals?.taxable).toBe(1000);
      expect(result.view?.totals?.tax).toBe(180);
      expect(result.view?.totals?.total).toBe(1180);
      expect(result.view?.lines[0]?.total).toBe(1180);
    });

    it('a discount reduces the tax base, not just the headline', async () => {
      const result = await setLines([
        { productId: 'p-1', description: 'Widgets', quantity: 10, unitPrice: 100, discountPercent: 10, taxRatePercent: 18 },
      ]);
      expect(result.view?.totals?.taxable).toBe(900);
      expect(result.view?.totals?.tax).toBe(162);
    });

    it('an invalid line is refused with a line-numbered reason, and nothing is stored', async () => {
      const result = await setLines([{ productId: 'p-1', description: 'Bad', quantity: -5, unitPrice: 10 }]);
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.lineNo).toBeGreaterThan(0);
      const view = (await call(IpcChannel.EnterpriseModuleLines, {
        moduleId: 'procurement-orders',
        id: recordId,
      })) as DocumentLinesView;
      expect(view.lines).toEqual([]);
    });

    it('a purchase-order line without a product is refused — the engine’s own rule', async () => {
      const result = await setLines([{ description: 'Widgets', quantity: 1, unitPrice: 100 }]);
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.errors.join(' ')).toMatch(/product/i);
    });

    it('a module with no document spec reports unsupported rather than an empty editor', async () => {
      const plain = defineEnterpriseModule({
        descriptor: {
          id: 'crm-customers',
          title: 'Customers',
          singular: 'Customer',
          plural: 'Customers',
          icon: 'user',
          description: 'test',
          titleField: 'name',
          permissions: { read: 'crm:read', write: 'crm:manage' },
          fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
        },
        store: new EnterpriseRecordStore(join(dir, 'cust.json'), 'crm-customers', 'customer').bindScope(() => TEST_TENANT_SCOPE),
      });
      registry.register(plain);
      await plain.store.load();
      const id = plain.store.create({ title: 'Acme', fields: { name: 'Acme' }, now: T0 }).id;
      const view = (await call(IpcChannel.EnterpriseModuleLines, {
        moduleId: 'crm-customers',
        id,
      })) as DocumentLinesView;
      expect(view.supported).toBe(false);
    });
  });

  describe('approval', () => {
    it('reports the policy steps and the amount they are evaluated on', async () => {
      await setLines([{ productId: 'p-1', description: 'Widgets', quantity: 10, unitPrice: 100 }]);
      const view = await approvalOf();
      expect(view.required).toBe(true);
      expect(view.state).toBe('pending');
      expect(view.amount).toBe(1000);
      // The 1000 threshold is met, so BOTH steps apply.
      expect(view.requiredSteps.map((s) => s.id)).toEqual(['manager', 'finance']);
      expect(view.nextStep?.id).toBe('manager');
    });

    it('segregation of duties refuses the creator, and says why in the engine’s words', async () => {
      await setLines([{ productId: 'p-1', description: 'Widgets', quantity: 1, unitPrice: 100 }]);
      // `approver` IS the creator of PO-1.
      const view = await approvalOf();
      expect(view.canDecide).toBe(false);
      expect(view.blockedReason).toBeTruthy();

      const result = (await call(IpcChannel.EnterpriseModuleApprove, {
        moduleId: 'procurement-orders',
        id: recordId,
        stepId: 'manager',
        decision: 'approved',
      })) as DocumentApprovalResult;
      expect(result.ok).toBe(false);
      // Refused decisions leave NO trace of acceptance.
      expect(result.approval?.decisions).toEqual([]);
      expect(result.approval?.state).toBe('pending');
    });

    it('a decision by an eligible approver PERSISTS — the bug that made approval impossible', async () => {
      await setLines([{ productId: 'p-1', description: 'Widgets', quantity: 1, unitPrice: 100 }]);
      approver = { userId: 'other.manager@example.com', roles: ['manager'] };

      const result = (await call(IpcChannel.EnterpriseModuleApprove, {
        moduleId: 'procurement-orders',
        id: recordId,
        stepId: 'manager',
        decision: 'approved',
        note: 'Checked against the quote.',
      })) as DocumentApprovalResult;
      expect(result.ok).toBe(true);

      // Read back through a FRESH store: the engine is pure, so if nothing
      // persisted the next evaluation starts empty and approval is impossible.
      const reopened = new ApprovalStore(join(dir, 'approvals.json')).bindScope(asOrg);
      await approvals.flush();
      await reopened.load();
      const saved = reopened.forDocument('procurement-orders', recordId);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        stepId: 'manager',
        userId: 'other.manager@example.com',
        decision: 'approved',
        note: 'Checked against the quote.',
      });
    });

    it('below the threshold, one approval completes the policy', async () => {
      // 100 < the finance step's 1000 minimum, so only the manager step applies.
      await setLines([{ productId: 'p-1', description: 'Widget', quantity: 1, unitPrice: 100 }]);
      approver = { userId: 'other.manager@example.com', roles: ['manager'] };
      await call(IpcChannel.EnterpriseModuleApprove, {
        moduleId: 'procurement-orders',
        id: recordId,
        stepId: 'manager',
        decision: 'approved',
      });
      const view = await approvalOf();
      expect(view.requiredSteps.map((s) => s.id)).toEqual(['manager']);
      expect(view.state).toBe('approved');
    });
  });

  /**
   * The gate lives on UPDATE, not on `setStatus`.
   *
   * This is the trap the wiring nearly fell into. A document's business status
   * — draft → approved → sent — is a FIELD; `setStatus` only accepts the
   * record lifecycle (active/archived/deleted), and its Zod schema rejects
   * "approved" outright. A gate on that channel would have compiled, read
   * plausibly, and never fired once in production.
   */
  describe('the approval gate on a business status change', () => {
    const moveTo = (status: string): Promise<EnterpriseModuleMutationResult & { holdId?: string }> =>
      call(IpcChannel.EnterpriseModuleUpdate, {
        moduleId: 'procurement-orders',
        id: recordId,
        fields: { reference: 'PO-1', status },
      }) as Promise<EnterpriseModuleMutationResult & { holdId?: string }>;

    it('an ungated status change passes untouched', async () => {
      await setLines([{ productId: 'p-1', description: 'Widgets', quantity: 1, unitPrice: 100 }]);
      const result = await moveTo('cancelled');
      expect(result.ok).toBe(true);
      expect(holdsRaised).toHaveLength(0);
    });

    it('a GATED status is refused, held, and the field does NOT move', async () => {
      await setLines([{ productId: 'p-1', description: 'Widgets', quantity: 1, unitPrice: 100 }]);
      const result = await moveTo('approved');
      expect(result.ok).toBe(false);
      expect(result.holdId).toBeTruthy();
      expect(holdsRaised[0]?.status).toBe('approved');
      expect(holdsRaised[0]?.reason).toMatch(/approval/i);
      // Nothing was written.
      expect(registry.get('procurement-orders')!.store.get(recordId)!.fields.status).not.toBe(
        'approved',
      );
    });

    it('once the policy is satisfied the same change is allowed through', async () => {
      await setLines([{ productId: 'p-1', description: 'Widget', quantity: 1, unitPrice: 100 }]);
      approver = { userId: 'other.manager@example.com', roles: ['manager'] };
      await call(IpcChannel.EnterpriseModuleApprove, {
        moduleId: 'procurement-orders',
        id: recordId,
        stepId: 'manager',
        decision: 'approved',
      });
      expect((await approvalOf()).state).toBe('approved');

      const result = await moveTo('approved');
      expect(result.ok).toBe(true);
      expect(holdsRaised).toHaveLength(0);
      expect(registry.get('procurement-orders')!.store.get(recordId)!.fields.status).toBe('approved');
    });

    it('re-saving an already-approved document does not demand approval again', async () => {
      await setLines([{ productId: 'p-1', description: 'Widget', quantity: 1, unitPrice: 100 }]);
      approver = { userId: 'other.manager@example.com', roles: ['manager'] };
      await call(IpcChannel.EnterpriseModuleApprove, {
        moduleId: 'procurement-orders',
        id: recordId,
        stepId: 'manager',
        decision: 'approved',
      });
      await moveTo('approved');
      holdsRaised = [];
      // Same status, different edit: only a CHANGE is gated.
      const again = (await call(IpcChannel.EnterpriseModuleUpdate, {
        moduleId: 'procurement-orders',
        id: recordId,
        fields: { reference: 'PO-1-rev', status: 'approved' },
      })) as EnterpriseModuleMutationResult;
      expect(again.ok).toBe(true);
      expect(holdsRaised).toHaveLength(0);
    });
  });
});
