/**
 * NeuroPause Platform — durable approval-instance store (ERP Session 20).
 *
 * The workflow's own durable state, on the SAME durable primitive as the Session
 * 18 journal (`DurableJsonStore`, atomic file writes, survives restart). It is
 * NOT the ERP document-posting `ApprovalStore` (erp/approvalStore.ts) — that is a
 * different concern (per-document posting-approval steps). This holds the
 * PENDING → APPROVED / REJECTED lifecycle the platform workflow needs, tenant-keyed
 * on every record.
 *
 * The store OWNS: idempotent creation (one open approval per gated target),
 * idempotent + single-flight decision (a repeat decision replays, a contrary one
 * conflicts), and tenant-scoped reads (a foreign approval is invisible → NOT_FOUND).
 * It does NOT authorize and it does NOT dispatch — the runtime does both, keeping
 * the layers separate (§9).
 */
import { randomUUID } from 'node:crypto';
import { DurableJsonStore } from '../persistence/durableJsonStore';
import type { ApprovalInstance, ApprovalStatus } from './workflowContract';

export interface DecideOutcome {
  ok: boolean;
  approval?: ApprovalInstance;
  error?: 'NOT_FOUND' | 'CONFLICT';
  replayed?: boolean;
}

export class ApprovalInstanceStore {
  private readonly store: DurableJsonStore<ApprovalInstance>;
  private readonly inflight = new Map<string, Promise<DecideOutcome>>();

  constructor(filePath: string) {
    this.store = new DurableJsonStore<ApprovalInstance>(filePath);
  }
  async load(): Promise<void> {
    await this.store.load();
  }
  async reload(): Promise<void> {
    await this.store.reload();
  }
  async destroy(): Promise<void> {
    this.inflight.clear();
    await this.store.destroy();
  }

  /** Tenant-scoped read: a foreign approval is invisible. */
  get(tenantId: string, id: string): ApprovalInstance | undefined {
    const rec = this.store.get(id);
    return rec && rec.tenantId === tenantId ? rec : undefined;
  }

  /** Every approval for one tenant (never cross-tenant). */
  list(tenantId: string): ApprovalInstance[] {
    return this.store.all().filter((a) => a.tenantId === tenantId);
  }

  private openFor(tenantId: string, targetModule: string, targetId: string, gatedCommand: string): ApprovalInstance | undefined {
    return this.store
      .all()
      .find((a) => a.tenantId === tenantId && a.targetModule === targetModule && a.targetId === targetId && a.gatedCommand === gatedCommand && a.status === 'PENDING');
  }

  /**
   * Create a PENDING approval, idempotently: a second request for the same open
   * (tenant, target, gated command) returns the existing one — one approval per
   * gated action, durable, survives restart.
   */
  async requestApproval(input: {
    tenantId: string;
    workspaceId?: string;
    targetModule: string;
    targetId: string;
    gatedCommand: string;
    requester: string;
    correlationId: string;
    now: string;
  }): Promise<ApprovalInstance> {
    await this.store.load();
    const existing = this.openFor(input.tenantId, input.targetModule, input.targetId, input.gatedCommand);
    if (existing) return existing;
    const approval: ApprovalInstance = {
      id: `apr_${randomUUID()}`,
      tenantId: input.tenantId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      targetModule: input.targetModule,
      targetId: input.targetId,
      gatedCommand: input.gatedCommand,
      requester: input.requester,
      status: 'PENDING',
      createdAt: input.now,
      correlationId: input.correlationId,
    };
    await this.store.put(approval);
    return approval;
  }

  /**
   * Transition an approval to APPROVED / REJECTED, idempotently and single-flight.
   * A repeat of the SAME decision replays; a CONTRARY decision (approve after
   * reject, or vice versa) is a CONFLICT; a foreign-tenant approval is NOT_FOUND.
   * Authorization + the domain command are the runtime's job, performed BEFORE
   * this is called.
   */
  async decide(input: { tenantId: string; approvalId: string; decision: 'APPROVE' | 'REJECT'; approver: string; now: string }): Promise<DecideOutcome> {
    await this.store.load();
    const target: ApprovalStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const cur = this.get(input.tenantId, input.approvalId);
    if (!cur) return { ok: false, error: 'NOT_FOUND' };
    if (cur.status === target) return { ok: true, approval: cur, replayed: true };
    if (cur.status !== 'PENDING') return { ok: false, error: 'CONFLICT' };

    const k = `${input.tenantId}::${input.approvalId}`;
    const running = this.inflight.get(k);
    if (running) return running;
    const promise = (async (): Promise<DecideOutcome> => {
      const again = this.get(input.tenantId, input.approvalId);
      if (!again) return { ok: false, error: 'NOT_FOUND' };
      if (again.status === target) return { ok: true, approval: again, replayed: true };
      if (again.status !== 'PENDING') return { ok: false, error: 'CONFLICT' };
      const decided: ApprovalInstance = { ...again, status: target, approver: input.approver, decidedAt: input.now };
      await this.store.put(decided); // atomic durable transition
      return { ok: true, approval: decided };
    })();
    this.inflight.set(k, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(k);
    }
  }
}
