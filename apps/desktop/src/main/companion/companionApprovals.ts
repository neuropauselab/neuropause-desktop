/**
 * Companion approvals (Mobile M1-05) — the cross-module "waiting on you" inbox
 * and the config that drives acting on it. This is a curated, high-stakes
 * surface, so the sources are an EXPLICIT table (module id + which statuses are
 * pending + the approve/reject action keys + any reason field the module
 * requires), not a heuristic. Every approve/reject key is validated against the
 * module's own declared actions at build time, so a drifted config fails
 * SAFE — the action simply isn't offered — rather than dispatching a bad action.
 *
 * The aggregator is pure (config + module summaries + records → items); the
 * write path (approvals.act) resolves an action here and dispatches it through
 * the same secure handler pipeline as the desktop, so RBAC, audit, and the
 * modules' own guards (budget/contract gates, reason-required) all apply and
 * their refusals surface to the phone as typed errors.
 */
import type {
  CompanionApprovalField,
  CompanionApprovalItem,
  EnterpriseEntity,
  EnterpriseModuleSummary,
} from '@neuropause/shared';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

interface ApprovalActionConfig {
  action: string;
  reasonField: string | null;
  reasonRequired: boolean;
}

export interface ApprovalSource {
  moduleId: string;
  /** `status` field values that mean "awaiting a decision". */
  pending: string[];
  /** Field keys shown as the item's details (resolved to labels via the descriptor). */
  summaryFields: string[];
  approve: ApprovalActionConfig | null;
  reject: ApprovalActionConfig | null;
}

const approveOnly = (
  reasonField: string | null = null,
  reasonRequired = false,
): ApprovalActionConfig => ({
  action: 'approve',
  reasonField,
  reasonRequired,
});
const rejectAction = (
  reasonField: string | null = null,
  reasonRequired = false,
): ApprovalActionConfig => ({
  action: 'reject',
  reasonField,
  reasonRequired,
});

/**
 * The approval-carrying modules the phone surfaces. Module ids + status values +
 * action keys were verified against each module descriptor. hr-candidate is a
 * recruitment PIPELINE (applied→…→hired), not a yes/no approval, so it is out.
 */
export const APPROVAL_SOURCES: ApprovalSource[] = [
  {
    moduleId: 'hr-leave-requests',
    pending: ['pending'],
    summaryFields: ['employeeName', 'kind', 'fromDate', 'toDate'],
    approve: approveOnly(),
    reject: rejectAction(),
  },
  {
    moduleId: 'hr-expense-claims',
    pending: ['submitted'],
    summaryFields: ['employeeName', 'amount', 'description'],
    approve: approveOnly(),
    reject: rejectAction(),
  },
  {
    moduleId: 'finance-vendor-bills',
    pending: ['draft'],
    summaryFields: ['vendor', 'total'],
    approve: approveOnly(),
    reject: null, // module uses "cancel", not reject
  },
  {
    moduleId: 'procurement-requests',
    pending: ['draft', 'pending'],
    summaryFields: ['department', 'product', 'quantity'],
    approve: approveOnly(),
    reject: null,
  },
  {
    moduleId: 'procurement-orders',
    pending: ['draft'],
    summaryFields: ['supplier', 'total'],
    approve: approveOnly(),
    reject: null,
  },
  {
    moduleId: 'executive-decisions',
    pending: ['pending'],
    summaryFields: ['category'],
    approve: approveOnly('approvalReason', true), // module refuses approve without a reason
    reject: rejectAction('rejectionReason', true), // …and refuses reject without one
  },
  {
    moduleId: 'manufacturing-schedule-proposals',
    pending: ['proposed'],
    summaryFields: ['product'],
    approve: approveOnly(),
    reject: rejectAction('rejectionReason'),
  },
  {
    moduleId: 'warehouse-transfers',
    pending: ['draft'],
    summaryFields: ['product', 'quantity', 'fromWarehouse', 'toWarehouse'],
    approve: approveOnly(),
    reject: null,
  },
];

/** Resolve a phone-requested action against the source table (or null if unknown). */
export function resolveApprovalAction(
  moduleId: string,
  action: string,
): { kind: 'approve' | 'reject'; reasonField: string | null } | null {
  const src = APPROVAL_SOURCES.find((s) => s.moduleId === moduleId);
  if (!src) return null;
  if (src.approve && src.approve.action === action) {
    return { kind: 'approve', reasonField: src.approve.reasonField };
  }
  if (src.reject && src.reject.action === action) {
    return { kind: 'reject', reasonField: src.reject.reasonField };
  }
  return null;
}

/** Build the phone's approvals inbox from live module summaries + records. */
export function buildApprovalInbox(
  sources: ApprovalSource[],
  summariesById: Map<string, EnterpriseModuleSummary>,
  recordsById: Map<string, EnterpriseEntity[]>,
): CompanionApprovalItem[] {
  const items: CompanionApprovalItem[] = [];
  for (const src of sources) {
    const summary = summariesById.get(src.moduleId);
    if (!summary) continue; // module not registered — skip (fail safe)
    const fields = summary.fields ?? [];
    const statusField = fields.find((f) => f.key === 'status' && f.type === 'select');
    const declared = new Set((summary.actions ?? []).map((a) => a.key));
    // Only offer an action the module actually declares.
    const approve = src.approve && declared.has(src.approve.action) ? src.approve : null;
    const reject = src.reject && declared.has(src.reject.action) ? src.reject : null;

    for (const r of recordsById.get(src.moduleId) ?? []) {
      if (r.status === 'deleted') continue;
      const status = str(r.fields.status);
      if (!src.pending.includes(status)) continue;
      const opt = statusField?.options?.find((o) => o.value === status);
      const detail = src.summaryFields
        .map((key): CompanionApprovalField | null => {
          const def = fields.find((f) => f.key === key);
          const value = r.fields[key];
          if (!def || value === null || value === undefined || value === '') return null;
          return { label: def.label, value: String(value) };
        })
        .filter((x): x is CompanionApprovalField => x !== null);
      items.push({
        moduleId: src.moduleId,
        moduleTitle: summary.title,
        id: r.id,
        title: r.title,
        status,
        statusLabel: opt?.label ?? status,
        statusTone: opt?.tone ?? null,
        fields: detail,
        createdAt: r.createdAt,
        approve: approve ? { ...approve } : null,
        reject: reject ? { ...reject } : null,
      });
    }
  }
  // Oldest-waiting first — the longest-pending decisions rise to the top.
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
