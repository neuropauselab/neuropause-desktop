/**
 * Executive Center → Execution Proposals — the persisted record of a controlled decision hand-off. A
 * verified executive decision creates ONE proposal here (via the handoff link), routed to the single
 * responsible module with an inert draft attached. This module drives the proposal's confirmation
 * lifecycle — draft → pending confirmation → accepted / rejected / cancelled — behind RBAC
 * (executive:read to view, executive:execute to act). Accepting a proposal changes ONLY this record's
 * state: it authorizes the responsible team to run the inert draft through the domain module that owns
 * execution authority; it never runs production itself. Rejection requires a reason. Every transition
 * flows through the framework's audit + timeline. The AI explains the proposal; a human confirms.
 * Nothing here executes automatically — Manufacturing / Inventory / Maintenance / Procurement remain
 * the execution authorities.
 */
import type { EnterpriseModuleDescriptor, EnterpriseRecordSummary } from '@neuropause/shared';
import {
  EXECUTION_PROPOSALS_MODULE_ID,
  EXECUTION_PROPOSAL_KIND,
  PROPOSAL_TYPE_LABEL,
  executionProposalFromRecord,
  proposalTransition,
} from '@neuropause/shared';
import { EnterpriseRecordStore, defineEnterpriseModule, type EnterpriseModule } from '../../framework';

export const SUBMIT_ACTION = 'submit';
export const ACCEPT_ACTION = 'accept';
export const REJECT_ACTION = 'reject';
export const CANCEL_ACTION = 'cancel';

export const EXECUTION_PROPOSAL_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: EXECUTION_PROPOSALS_MODULE_ID,
  title: 'Execution Proposals',
  singular: 'Proposal',
  plural: 'Proposals',
  icon: 'arrow-right',
  description: 'Controlled hand-off of a verified decision to the one responsible module — human-confirmed, never automatic.',
  group: 'Executive',
  titleField: 'proposalNumber',
  permissions: { read: 'executive:read', write: 'executive:execute' },
  actions: [
    { key: SUBMIT_ACTION, label: 'Submit for Confirmation', icon: 'arrow-right' },
    { key: ACCEPT_ACTION, label: 'Accept', icon: 'check' },
    { key: REJECT_ACTION, label: 'Reject', icon: 'close' },
    { key: CANCEL_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'proposalNumber', label: 'Proposal #', type: 'text', required: true, placeholder: 'PROP-0001' },
    { key: 'sourceDecisionId', label: 'Source Decision', type: 'text', column: false, readOnly: true },
    { key: 'decisionTitle', label: 'Decision', type: 'text', readOnly: true },
    { key: 'decisionCategory', label: 'Category', type: 'text', column: false, filterable: true, readOnly: true },
    {
      key: 'proposalType',
      label: 'Type',
      type: 'select',
      badge: true,
      filterable: true,
      readOnly: true,
      default: 'production_schedule',
      options: [
        { value: 'production_schedule', label: 'Production Schedule', tone: 'blue' },
        { value: 'purchase_request', label: 'Purchase Request', tone: 'purple' },
        { value: 'inventory_reallocation', label: 'Inventory Reallocation', tone: 'teal' },
        { value: 'maintenance', label: 'Maintenance', tone: 'orange' },
        { value: 'workforce', label: 'Workforce', tone: 'neutral' },
        { value: 'routing', label: 'Routing', tone: 'blue' },
        { value: 'capacity', label: 'Capacity', tone: 'purple' },
      ],
    },
    { key: 'targetModule', label: 'Responsible Module', type: 'text', readOnly: true },
    { key: 'targetRecord', label: 'Draft Record', type: 'text', column: false, readOnly: true },
    { key: 'reason', label: 'Reason', type: 'textarea', column: false, readOnly: true },
    { key: 'evidence', label: 'Evidence', type: 'textarea', column: false, readOnly: true },
    { key: 'expectedImprovementPct', label: 'Expected Improvement %', type: 'number', readOnly: true },
    { key: 'risk', label: 'Risk', type: 'text', column: false, readOnly: true },
    { key: 'primaryAction', label: 'Primary Action', type: 'text', column: false, readOnly: true },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      badge: true,
      filterable: true,
      default: 'medium',
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'orange' },
        { value: 'critical', label: 'Critical', tone: 'pink' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'pending_confirmation', label: 'Pending Confirmation', tone: 'orange' },
        { value: 'accepted', label: 'Accepted', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'pink' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'createdBy', label: 'Created By', type: 'text', column: false, readOnly: true },
    { key: 'createdTime', label: 'Created', type: 'text', column: false, readOnly: true },
    { key: 'confirmedBy', label: 'Confirmed By', type: 'text', column: false, readOnly: true },
    { key: 'confirmedAt', label: 'Confirmed At', type: 'text', column: false, readOnly: true },
    { key: 'rejectionReason', label: 'Rejection Reason', type: 'text', column: false },
    { key: 'rejectedBy', label: 'Rejected By', type: 'text', column: false, readOnly: true },
    { key: 'rejectedAt', label: 'Rejected At', type: 'text', column: false, readOnly: true },
  ],
};

export function createExecutionProposalModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, EXECUTION_PROPOSALS_MODULE_ID, EXECUTION_PROPOSAL_KIND);

  return defineEnterpriseModule({
    descriptor: EXECUTION_PROPOSAL_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const p = executionProposalFromRecord(record);
        const type = PROPOSAL_TYPE_LABEL[p.proposalType];
        const state = p.status.replace(/_/g, ' ');
        return {
          moduleId: EXECUTION_PROPOSALS_MODULE_ID,
          recordId: record.id,
          headline: `${p.proposalNumber} · ${type} · ${state}`,
          summary:
            `${p.proposalNumber} (${type}) is ${state}, routed to ${p.targetModule || '—'} from decision "${p.decisionTitle}". ` +
            `Expected improvement ${p.expectedImprovementPct}%. Nothing executes until a human confirms and the responsible team runs the draft.`,
          risk: p.status === 'pending_confirmation' ? 'medium' : 'low',
          riskReason: p.status === 'pending_confirmation' ? 'Awaiting human confirmation.' : `Proposal ${state}.`,
          executiveExplanation: `${p.proposalNumber} proposes a ${type} change for ${p.targetModule || 'the responsible module'}; a human confirms and the domain team executes — nothing automatic.`,
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, ctx) => {
        const p = executionProposalFromRecord(record);
        const target = proposalTransition(action as never, p.status);
        if (!target) return { ok: false, message: `Cannot ${action} a proposal that is ${p.status.replace(/_/g, ' ')}.` };
        const actor = ctx.actor() ?? '';
        const now = ctx.now();
        const emitSelf = (rec: ReturnType<typeof store.update>): void => {
          const self = ctx.moduleFor(EXECUTION_PROPOSALS_MODULE_ID);
          if (self && rec) ctx.emit(self, 'updated', rec);
        };

        if (action === REJECT_ACTION) {
          if (!p.rejectionReason.trim()) return { ok: false, message: 'A rejection reason is required before rejecting a proposal.' };
          emitSelf(store.update(record.id, { fields: { status: 'rejected', rejectedBy: actor, rejectedAt: now }, actor, now }));
          return { ok: true, message: `Rejected proposal ${p.proposalNumber}. Nothing was executed.` };
        }

        if (action === ACCEPT_ACTION) {
          emitSelf(store.update(record.id, { fields: { status: 'accepted', confirmedBy: actor, confirmedAt: now }, actor, now }));
          return { ok: true, message: `Accepted proposal ${p.proposalNumber}. ${p.targetModule || 'The responsible team'} may now execute the draft — nothing has run yet.` };
        }

        // submit (draft → pending confirmation) / cancel — plain, guarded status transitions.
        emitSelf(store.update(record.id, { fields: { status: target }, actor, now }));
        return { ok: true, message: `Proposal ${p.proposalNumber} ${target.replace(/_/g, ' ')}.` };
      },
    },
  });
}
