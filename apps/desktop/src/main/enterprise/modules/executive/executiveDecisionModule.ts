/**
 * Executive Center → Decision Approval — the persisted GOVERNANCE record for a recovery plan. The
 * Decision Engine proposes PENDING recovery plans; an executive materializes one here and drives it
 * through a strict lifecycle — pending → approved / rejected → verified → archived — behind RBAC
 * (executive:read to view, executive:approve to approve/reject, executive:verify to verify). Approval
 * and rejection require a reason; verification RE-RUNS the Manufacturing Digital Twin with the
 * approved recovery applied and stores the resulting verification report. NOTHING touches production:
 * approving or verifying changes only this record's own governance state, and verification runs the
 * Twin on a clone. Every transition flows through the framework's audit + timeline. The AI explains
 * the decision; the human approves.
 */
import type { EnterpriseModuleDescriptor, EnterpriseRecordSummary, PlanningInput, Routing } from '@neuropause/shared';
import {
  EXECUTIVE_DECISIONS_MODULE_ID,
  EXECUTIVE_DECISION_KIND,
  EXECUTIVE_VERIFY,
  buildVerificationReport,
  decisionTransition,
  executiveDecisionFromRecord,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const APPROVE_ACTION = 'approve';
export const REJECT_ACTION = 'reject';
export const VERIFY_ACTION = 'verify';
export const ARCHIVE_ACTION = 'archive';

export const EXECUTIVE_DECISION_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: EXECUTIVE_DECISIONS_MODULE_ID,
  title: 'Executive Decisions',
  singular: 'Decision',
  plural: 'Decisions',
  icon: 'shield',
  description: 'Governance for recovery plans — review, approve, reject, and verify before execution.',
  group: 'Executive',
  titleField: 'title',
  permissions: { read: 'executive:read', write: 'executive:approve' },
  actions: [
    { key: APPROVE_ACTION, label: 'Approve', icon: 'check' },
    { key: REJECT_ACTION, label: 'Reject', icon: 'close' },
    { key: VERIFY_ACTION, label: 'Verify', icon: 'activity' },
    { key: ARCHIVE_ACTION, label: 'Archive', icon: 'archive' },
  ],
  fields: [
    { key: 'decisionId', label: 'Decision ID', type: 'text', column: false, readOnly: true },
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'category', label: 'Category', type: 'text', filterable: true, readOnly: true },
    { key: 'evidence', label: 'Evidence', type: 'textarea', column: false, readOnly: true },
    { key: 'recoveryPlan', label: 'Recovery Plan', type: 'textarea', column: false, readOnly: true },
    { key: 'affectedOrders', label: 'Affected Orders', type: 'text', column: false, readOnly: true },
    { key: 'affectedMachines', label: 'Affected Machines', type: 'text', column: false, readOnly: true },
    { key: 'affectedCustomers', label: 'Affected Customers', type: 'text', column: false, readOnly: true },
    { key: 'affectedRevenue', label: 'Affected Revenue', type: 'number', readOnly: true },
    { key: 'expectedImprovementPct', label: 'Expected Improvement %', type: 'number', readOnly: true },
    { key: 'confidence', label: 'Confidence %', type: 'number', column: false, readOnly: true },
    { key: 'primaryAction', label: 'Primary Action', type: 'text', column: false, readOnly: true },
    { key: 'tradeoffs', label: 'Trade-offs', type: 'textarea', column: false, readOnly: true },
    { key: 'createdBy', label: 'Created By', type: 'text', column: false, readOnly: true },
    { key: 'createdTime', label: 'Created', type: 'text', column: false, readOnly: true },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'pending',
      badge: true,
      filterable: true,
      options: [
        { value: 'pending', label: 'Pending', tone: 'orange' },
        { value: 'approved', label: 'Approved', tone: 'teal' },
        { value: 'rejected', label: 'Rejected', tone: 'neutral' },
        { value: 'verified', label: 'Verified', tone: 'green' },
        { value: 'archived', label: 'Archived', tone: 'neutral' },
      ],
    },
    { key: 'approvalReason', label: 'Approval Reason', type: 'text', column: false },
    { key: 'approvalComments', label: 'Approval Comments', type: 'textarea', column: false },
    { key: 'approvedBy', label: 'Approved By', type: 'text', column: false, readOnly: true },
    { key: 'approvedAt', label: 'Approved At', type: 'text', column: false, readOnly: true },
    { key: 'rejectionReason', label: 'Rejection Reason', type: 'text', column: false },
    { key: 'rejectedBy', label: 'Rejected By', type: 'text', column: false, readOnly: true },
    { key: 'rejectedAt', label: 'Rejected At', type: 'text', column: false, readOnly: true },
    { key: 'verifiedBy', label: 'Verified By', type: 'text', column: false, readOnly: true },
    { key: 'verifiedAt', label: 'Verified At', type: 'text', column: false, readOnly: true },
    { key: 'verificationReport', label: 'Verification Report', type: 'textarea', column: false, readOnly: true },
  ],
};

/** The live planning model provider (read-only) the verification action re-runs the Twin against. */
export type PlanningModelProvider = () => { input: PlanningInput; routings: Routing[] };

export function createExecutiveDecisionModule(storePath: string, planningModel: PlanningModelProvider): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, EXECUTIVE_DECISIONS_MODULE_ID, EXECUTIVE_DECISION_KIND);

  return defineEnterpriseModule({
    descriptor: EXECUTIVE_DECISION_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const d = executiveDecisionFromRecord(record);
        const vr = d.verificationReport;
        const summary =
          `${d.title} (${d.category.replace(/_/g, ' ')}) is ${d.status}. ` +
          `Expected improvement ${d.expectedImprovementPct}%, ${d.affectedRevenue.toLocaleString()} revenue exposed across ${d.affectedOrders.length} order(s).` +
          (vr ? ` Verified: ${vr.recoveryImprovement}% recovered, ${vr.ordersRecovered} order(s) back on time, accuracy ${vr.verificationAccuracy}%.` : '');
        return {
          moduleId: EXECUTIVE_DECISIONS_MODULE_ID,
          recordId: record.id,
          headline: `${d.title} · ${d.status}`,
          summary,
          risk: d.status === 'pending' ? 'medium' : 'low',
          riskReason: d.status === 'pending' ? 'Awaiting executive decision.' : `Decision ${d.status}.`,
          executiveExplanation: `${d.title} is ${d.status}; a human executive approves — nothing executes automatically.`,
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const d = executiveDecisionFromRecord(record);
        const target = decisionTransition(action as never, d.status);
        if (!target) return { ok: false, message: `Cannot ${action} a decision that is ${d.status}.` };
        const actor = ctx.actor() ?? '';
        const now = ctx.now();
        const emitSelf = (rec: ReturnType<typeof store.update>): void => {
          const self = ctx.moduleFor(EXECUTIVE_DECISIONS_MODULE_ID);
          if (self && rec) ctx.emit(self, 'updated', rec);
        };

        if (action === APPROVE_ACTION) {
          if (!d.approvalReason.trim()) return { ok: false, message: 'An approval reason is required before approving.' };
          emitSelf(store.update(record.id, { fields: { status: 'approved', approvedBy: actor, approvedAt: now }, actor, now }));
          return { ok: true, message: `Approved "${d.title}" (pending verification).` };
        }

        if (action === REJECT_ACTION) {
          if (!d.rejectionReason.trim()) return { ok: false, message: 'A rejection reason is required before rejecting.' };
          emitSelf(store.update(record.id, { fields: { status: 'rejected', rejectedBy: actor, rejectedAt: now }, actor, now }));
          return { ok: true, message: `Rejected "${d.title}".` };
        }

        if (action === VERIFY_ACTION) {
          // Verification requires the dedicated scope, then RE-RUNS the Digital Twin (read-only).
          ctx.authorize(EXECUTIVE_VERIFY);
          const model = planningModel();
          const report = buildVerificationReport(model.input, model.routings, d, Date.parse(now));
          emitSelf(
            store.update(record.id, {
              fields: { status: 'verified', verifiedBy: actor, verifiedAt: now, verificationReport: JSON.stringify(report) },
              actor,
              now,
            }),
          );
          return { ok: true, message: `Verified "${d.title}": ${report.recoveryImprovement}% recovery, ${report.ordersRecovered} order(s) recovered (accuracy ${report.verificationAccuracy}%).` };
        }

        if (action === ARCHIVE_ACTION) {
          emitSelf(store.update(record.id, { fields: { status: 'archived' }, actor, now }));
          return { ok: true, message: `Archived "${d.title}".` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
