/**
 * Phase 6 — ERP document adapter: the seam that adopts the engines into the
 * LIVE modules without duplicating logic 104 times.
 *
 * The engines (line items, totals, three-way match, posting rules, approval,
 * SoD) are complete and tested. This is how a real module opts into them:
 * it declares a `DocumentSpec`, and `attach()` composes the behaviour onto the
 * module's EXISTING `hooks.onChange` — it never replaces it. Finance's GL
 * posting, Procurement's budget/contract gates and Sales' inventory reservation
 * all keep running exactly as before.
 *
 * Three safety properties make central adoption viable:
 *
 *   1. **A module with no spec is returned untouched.** `attach()` is a no-op,
 *      so it can be applied across the whole registry without risk.
 *   2. **Totals are DERIVED at read, never written back.** The codebase's own
 *      idiom (project progress from tasks, SLA breach at read). Nothing mutates
 *      a record from inside its own change hook, so there is no lifecycle loop
 *      to guard against.
 *   3. **Posting is DERIVED here and applied by the existing journal module.**
 *      The adapter hands balanced lines to an injected `postJournal`; it does
 *      not write to the ledger itself. One accounting engine, one balance guard.
 *
 * Idempotency: every derivation carries a deterministic `reference`, and the
 * adapter refuses to re-post a reference it has already emitted in this session
 * — a re-fired lifecycle event cannot double-post.
 */
import type { EnterpriseEntity, EnterprisePermission } from '@neuropause/shared';
import type { EnterpriseModuleLifecycleAction } from '@neuropause/shared';
import type {
  EnterpriseModule,
  EnterpriseModuleActionContext,
} from '../enterprise/framework/enterpriseModule';
import { computeDocumentTotals } from './documentLines';
import type {
  DocumentLineStore,
  DocumentLine,
  DocumentTotals,
  LineDocumentType,
  LineInput,
} from './documentLines';
import type { PostingDerivation } from './postingRules';
import {
  applyDecision,
  evaluateApproval,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalStatus,
  type Approver,
} from './approvalEngine';

/** Context handed to a spec's posting derivation. */
export interface PostingContext {
  record: EnterpriseEntity;
  lines: DocumentLine[];
  totals: DocumentTotals;
  action: EnterpriseModuleLifecycleAction;
  /**
   * The module action context, threaded through so `postJournal` can reach the
   * EXISTING general-ledger path (`applyGlDerivedEntries` needs `moduleFor` to
   * resolve the journal + ledger-account modules). Without this the adapter
   * would have to own ledger writes — which it must not.
   */
  actionCtx: EnterpriseModuleActionContext;
}

export interface DocumentSpec {
  /** The REAL live module id, e.g. `procurement-orders`. */
  moduleId: string;
  /** Which line semantics apply. Drives per-document validation. */
  documentType: LineDocumentType;
  /**
   * Record statuses that trigger accounting. Returning `null` means "nothing to
   * post for this transition" — silence, not an error.
   */
  postOn?: Record<string, (ctx: PostingContext) => PostingDerivation | null>;
  /** Approval policy, and the record field carrying the amount under threshold. */
  approval?: {
    policy: ApprovalPolicy;
    /** Field on the record holding the approval amount; falls back to line totals. */
    amountField?: string;
    /** Statuses that may not be entered without a satisfied approval. */
    gatedStatuses: readonly string[];
  };
  /** Permission required to edit this document's lines. */
  editPermission?: EnterprisePermission;
}

export interface DocumentAdapterDeps {
  lines: DocumentLineStore;
  /**
   * Apply balanced journal lines through the EXISTING journal module. Injected
   * so the adapter never owns ledger writes.
   */
  postJournal: (derivation: PostingDerivation, ctx: PostingContext) => void | Promise<void>;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  now: () => string;
  actor: () => string | null;
  /** Resolve the approver's roles/department for approval + SoD evaluation. */
  approverFor?: (userId: string) => Approver | null;
}

export interface DocumentTotalsView extends DocumentTotals {
  moduleId: string;
  documentId: string;
  documentType: LineDocumentType;
}

export class DocumentIntegration {
  private readonly specs = new Map<string, DocumentSpec>();
  /** References already posted — the idempotency guard. */
  private readonly posted = new Set<string>();
  private readonly postingLog: { reference: string; moduleId: string; recordId: string; at: string }[] = [];
  private readonly refusals: { reference: string; reason: string; at: string }[] = [];

  constructor(private readonly deps: DocumentAdapterDeps) {}

  register(spec: DocumentSpec): void {
    this.specs.set(spec.moduleId, spec);
  }

  registerAll(specs: readonly DocumentSpec[]): void {
    for (const s of specs) this.register(s);
  }

  specFor(moduleId: string): DocumentSpec | null {
    return this.specs.get(moduleId) ?? null;
  }

  /** Modules that have opted into document behaviour. */
  adoptedModuleIds(): string[] {
    return [...this.specs.keys()].sort();
  }

  // ── Lines ────────────────────────────────────────────────────────────────

  linesFor(moduleId: string, documentId: string): DocumentLine[] {
    const spec = this.specs.get(moduleId);
    if (!spec) return [];
    return this.deps.lines.forDocument(spec.documentType, documentId);
  }

  /** Totals DERIVED from lines. Never stored on the record. */
  totalsFor(moduleId: string, documentId: string): DocumentTotalsView | null {
    const spec = this.specs.get(moduleId);
    if (!spec) return null;
    const lines = this.deps.lines.forDocument(spec.documentType, documentId);
    return {
      ...computeDocumentTotals(lines),
      moduleId,
      documentId,
      documentType: spec.documentType,
    };
  }

  async setLines(
    moduleId: string,
    documentId: string,
    inputs: readonly LineInput[],
  ): Promise<{ ok: boolean; errors: { lineNo: number; errors: string[] }[]; totals: DocumentTotalsView | null }> {
    const spec = this.specs.get(moduleId);
    if (!spec) {
      return { ok: false, errors: [{ lineNo: 0, errors: [`Module "${moduleId}" is not a line-item document.`] }], totals: null };
    }
    const res = await this.deps.lines.setLines(spec.documentType, documentId, inputs, {
      actor: this.deps.actor(),
      now: this.deps.now(),
    });
    if (res.ok) {
      this.deps.audit({
        action: `document.${moduleId}.lines`,
        target: documentId,
        summary: `Set ${res.lines.length} line(s) on ${spec.documentType} ${documentId}.`,
      });
    }
    return { ok: res.ok, errors: res.errors, totals: res.ok ? this.totalsFor(moduleId, documentId) : null };
  }

  // ── Approval ─────────────────────────────────────────────────────────────

  /** Amount an approval policy is evaluated against: record field, else line totals. */
  private amountOf(spec: DocumentSpec, record: EnterpriseEntity): number {
    const field = spec.approval?.amountField;
    if (field) {
      const raw = record.fields[field];
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    }
    return this.totalsFor(spec.moduleId, record.id)?.total ?? 0;
  }

  /**
   * The amount an approval policy is evaluated against, exposed so the UI can
   * show the figure that actually drives the thresholds. A screen that
   * displays a different number from the one the policy used is how a person
   * ends up believing a step was skipped.
   */
  approvalAmountFor(moduleId: string, record: EnterpriseEntity): number {
    const spec = this.specs.get(moduleId);
    return spec ? this.amountOf(spec, record) : 0;
  }

  approvalStatus(moduleId: string, record: EnterpriseEntity, approvals: ApprovalRequest['approvals'] = []): ApprovalStatus | null {
    const spec = this.specs.get(moduleId);
    if (!spec?.approval) return null;
    return evaluateApproval(spec.approval.policy, this.buildRequest(spec, record, approvals));
  }

  private buildRequest(spec: DocumentSpec, record: EnterpriseEntity, approvals: ApprovalRequest['approvals']): ApprovalRequest {
    const dept = record.fields.department;
    return {
      documentType: spec.documentType,
      documentId: record.id,
      amount: this.amountOf(spec, record),
      // `record.createdBy` is where EnterpriseRecordStore actually writes the
      // author. This previously read `record.fields.createdBy` — a field no
      // module declares — so it was always '' and every creator-based SoD rule
      // silently passed. The metadata fallback stays for imported records,
      // which carry their original author there.
      createdBy: String(record.createdBy ?? record.metadata.createdBy ?? ''),
      ...(typeof dept === 'string' ? { department: dept } : {}),
      approvals,
    };
  }

  /**
   * Record an approval decision, enforcing role eligibility AND segregation of
   * duties. Refuses — recording nothing — when the approver is disqualified.
   */
  approve(
    moduleId: string,
    record: EnterpriseEntity,
    stepId: string,
    approver: Approver,
    decision: 'approved' | 'rejected',
    existing: ApprovalRequest['approvals'] = [],
    note?: string,
  ): { ok: boolean; status: ApprovalStatus | null; error: string | null; approvals: ApprovalRequest['approvals'] } {
    const spec = this.specs.get(moduleId);
    if (!spec?.approval) return { ok: false, status: null, error: 'This document does not require approval.', approvals: existing };

    const request = this.buildRequest(spec, record, existing);
    const step = spec.approval.policy.steps.find((s) => s.id === stepId);
    if (!step) return { ok: false, status: evaluateApproval(spec.approval.policy, request), error: `Unknown approval step "${stepId}".`, approvals: existing };

    const result = applyDecision(spec.approval.policy, request, step, approver, decision, this.deps.now(), note);
    if (!result.ok) {
      this.deps.audit({
        action: `document.${moduleId}.approval.refused`,
        target: record.id,
        summary: `Approval by ${approver.userId} refused: ${result.error ?? 'ineligible'}`,
      });
      return { ok: false, status: result.status, error: result.error, approvals: existing };
    }
    this.deps.audit({
      action: `document.${moduleId}.approval.${decision}`,
      target: record.id,
      summary: `${approver.userId} ${decision} step "${step.label}" on ${record.title}.`,
    });
    return { ok: true, status: result.status, error: null, approvals: result.request.approvals };
  }

  /** Is this record allowed to enter `status` given its approval policy? */
  canEnterStatus(moduleId: string, record: EnterpriseEntity, status: string, approvals: ApprovalRequest['approvals'] = []): { allowed: boolean; reason: string | null } {
    const spec = this.specs.get(moduleId);
    if (!spec?.approval) return { allowed: true, reason: null };
    if (!spec.approval.gatedStatuses.includes(status)) return { allowed: true, reason: null };
    const st = evaluateApproval(spec.approval.policy, this.buildRequest(spec, record, approvals));
    if (st.state === 'approved') return { allowed: true, reason: null };
    return {
      allowed: false,
      reason: `"${status}" requires approval — currently ${st.state}${st.nextStep ? ` (awaiting ${st.nextStep.label})` : ''}.`,
    };
  }

  // ── Posting ──────────────────────────────────────────────────────────────

  /**
   * Compose document behaviour onto a live module.
   * A module with no registered spec is returned UNCHANGED — this is what makes
   * blanket adoption across the registry safe.
   */
  attach(module: EnterpriseModule): EnterpriseModule {
    const spec = this.specs.get(module.descriptor.id);
    if (!spec) return module;

    const original = module.hooks.onChange;
    const handle = this.handleChange.bind(this);

    return {
      ...module,
      hooks: {
        ...module.hooks,
        onChange: async (event, ctx): Promise<void> => {
          // The module's own reconciliation runs FIRST and unchanged.
          await original?.(event, ctx);
          await handle(spec, event, ctx);
        },
      },
    };
  }

  private async handleChange(
    spec: DocumentSpec,
    event: { action: EnterpriseModuleLifecycleAction; record: EnterpriseEntity },
    actionCtx: EnterpriseModuleActionContext,
  ): Promise<void> {
    if (!spec.postOn) return;
    // Accounting is driven by state, not by every edit.
    if (event.action !== 'status_changed' && event.action !== 'created') return;

    const status = String(event.record.status ?? '');
    const derive = spec.postOn[status];
    if (!derive) return;

    const lines = this.deps.lines.forDocument(spec.documentType, event.record.id);
    const ctx: PostingContext = {
      record: event.record,
      lines,
      totals: computeDocumentTotals(lines),
      action: event.action,
      actionCtx,
    };

    let derivation: PostingDerivation | null;
    try {
      derivation = derive(ctx);
    } catch (err) {
      this.refusals.push({ reference: `${spec.moduleId}:${event.record.id}`, reason: (err as Error).message, at: this.deps.now() });
      this.deps.audit({
        action: `document.${spec.moduleId}.posting.error`,
        target: event.record.id,
        summary: `Posting derivation failed: ${(err as Error).message}`,
      });
      return;
    }
    if (derivation === null) return;

    if (!derivation.ok) {
      // A rule that cannot compute a defensible number posts NOTHING and says why.
      this.refusals.push({ reference: derivation.reference, reason: derivation.refusedReason ?? 'refused', at: this.deps.now() });
      this.deps.audit({
        action: `document.${spec.moduleId}.posting.refused`,
        target: event.record.id,
        summary: `No entry posted for ${derivation.reference}: ${derivation.refusedReason ?? 'refused'}`,
      });
      return;
    }

    if (this.posted.has(derivation.reference)) {
      // Deterministic reference already emitted — a re-fired event must not double-post.
      return;
    }

    await this.deps.postJournal(derivation, ctx);
    this.posted.add(derivation.reference);
    this.postingLog.push({
      reference: derivation.reference,
      moduleId: spec.moduleId,
      recordId: event.record.id,
      at: this.deps.now(),
    });
    this.deps.audit({
      action: `document.${spec.moduleId}.posted`,
      target: event.record.id,
      summary: `${derivation.memo} (${derivation.reference})`,
    });
  }

  /** Everything posted through the adapter this session. */
  postings(): readonly { reference: string; moduleId: string; recordId: string; at: string }[] {
    return this.postingLog;
  }

  /** Derivations that refused, with the reason — visible, never silent. */
  refusedPostings(): readonly { reference: string; reason: string; at: string }[] {
    return this.refusals;
  }

  hasPosted(reference: string): boolean {
    return this.posted.has(reference);
  }
}
