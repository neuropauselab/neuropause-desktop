/**
 * CRM → Opportunities — the qualified-deal pipeline on the Enterprise Module
 * Framework, sitting between Leads and Quotes in the ERP flow
 * (Lead → Opportunity → Quote → Order → Invoice → Payment). A descriptor + the
 * framework's record store + hooks; CRUD, RBAC (`crm:read` / `crm:manage`),
 * audit, timeline, search, offline persistence, and the entire list/detail/form
 * UI are all inherited — nothing re-implemented.
 *
 * DETERMINISTIC pipeline discipline:
 *   • `probability` is clamped by stage (closed pinned to 100/0; open 0..100
 *     with the stage baseline as default) and `weightedValue` is stamped
 *     read-only on every write — business logic, never user input.
 *   • Stages only move forward through the `Advance Stage` action (which
 *     re-baselines probability); the closed stages are UNREACHABLE by edit and
 *     only stamped by `Mark Won` / `Mark Lost`, which set the `closedAt`
 *     marker — after which the record is immutable history (validate refuses).
 *   • Lead wiring (the existing machinery, never duplicated): `sourceLeadRef`
 *     must resolve against the injected Leads store, creation snapshots
 *     account/amount/owner from the lead and lifts a brand-new lead to
 *     `qualified`, and closing syncs the lead to `won`/`lost` — each time
 *     re-stamping the lead's deterministic `leadScore` via the same
 *     `calculateLeadScore` the Leads module itself uses.
 *   • `quoteRef` must resolve against the injected Quotes store (by id or
 *     quote number) — the forward link the Quotes module's free-text
 *     `opportunity` field anticipated.
 *
 * Opportunities are PRE-REVENUE: they never post to the General Ledger. Revenue
 * enters the books only via the W1 Quote → Order → Invoice → Payment chain.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseEntity,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
  LeadStage,
} from '@neuropause/shared';
import {
  LEADS_MODULE_ID,
  OPPORTUNITIES_MODULE_ID,
  OPPORTUNITY_KIND,
  OPPORTUNITY_STAGE_PROBABILITY,
  assessOpportunityHealth,
  calculateLeadScore,
  clampOpportunityProbability,
  leadFromRecord,
  nextOpportunityStage,
  opportunityFromRecord,
  opportunityStageLabel,
  opportunitySummaryFallback,
  opportunityWeightedValue,
  validateEnterpriseRecordInput,
  type OpportunityStage,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';

/** The descriptor action keys the Opportunities module surfaces. */
export const ADVANCE_STAGE_ACTION = 'advanceStage';
export const MARK_WON_ACTION = 'markWon';
export const MARK_LOST_ACTION = 'markLost';

/** The declarative description of an opportunity — drives store, CRUD, and the UI. */
export const OPPORTUNITY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: OPPORTUNITIES_MODULE_ID,
  title: 'Opportunities',
  singular: 'Opportunity',
  plural: 'Opportunities',
  icon: 'target',
  description:
    'Work qualified deals through the pipeline — stage-baselined probability, weighted value, and won/lost sync back to the source lead.',
  group: 'CRM',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  actions: [
    { key: ADVANCE_STAGE_ACTION, label: 'Advance Stage', icon: 'arrow-right' },
    { key: MARK_WON_ACTION, label: 'Mark Won', icon: 'check' },
    { key: MARK_LOST_ACTION, label: 'Mark Lost', icon: 'x' },
  ],
  fields: [
    { key: 'name', label: 'Opportunity', type: 'text', required: true, placeholder: 'Acme expansion' },
    { key: 'account', label: 'Account', type: 'text', placeholder: 'Acme Inc.' },
    { key: 'sourceLeadRef', label: 'Source Lead', type: 'text', column: false, placeholder: 'Lead id (optional)' },
    { key: 'quoteRef', label: 'Quote', type: 'text', column: false, placeholder: 'Quote number or id (optional)' },
    { key: 'amount', label: 'Deal Value', type: 'number', required: true, min: 0, format: 'currency' },
    {
      key: 'stage',
      label: 'Stage',
      type: 'select',
      required: true,
      default: 'prospecting',
      badge: true,
      filterable: true,
      options: [
        { value: 'prospecting', label: 'Prospecting', tone: 'neutral' },
        { value: 'qualification', label: 'Qualification', tone: 'blue' },
        { value: 'proposal', label: 'Proposal', tone: 'teal' },
        { value: 'negotiation', label: 'Negotiation', tone: 'purple' },
        { value: 'closed-won', label: 'Closed Won', tone: 'green' },
        { value: 'closed-lost', label: 'Closed Lost', tone: 'pink' },
      ],
    },
    { key: 'probability', label: 'Probability %', type: 'number', min: 0, max: 100 },
    { key: 'weightedValue', label: 'Weighted Value', type: 'number', readOnly: true, format: 'currency' },
    { key: 'expectedCloseDate', label: 'Expected Close', type: 'date', format: 'date', column: false },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    { key: 'closedAt', label: 'Closed At', type: 'text', readOnly: true, column: false },
    {
      key: 'outcome',
      label: 'Outcome',
      type: 'select',
      readOnly: true,
      badge: true,
      column: false,
      options: [
        { value: 'won', label: 'Won', tone: 'green' },
        { value: 'lost', label: 'Lost', tone: 'pink' },
      ],
    },
    { key: 'lostReason', label: 'Lost Reason', type: 'text', column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Resolve a quote by record id or by its quote number (the payments-module rule). */
function findQuote(quoteStore: EnterpriseRecordStore, ref: string): EnterpriseEntity | null {
  if (!ref) return null;
  const byId = quoteStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return quoteStore.list().find((r) => str(r.fields.quoteNumber) === ref) ?? null;
}

/**
 * Build the Opportunities module. The Leads + Quotes stores are injected so the
 * deterministic guards can resolve `sourceLeadRef` / `quoteRef` (the same
 * injection pattern Vendor Payments uses for bills).
 */
export function createOpportunityModule(
  storePath: string,
  leadStore?: EnterpriseRecordStore,
  quoteStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, OPPORTUNITIES_MODULE_ID, OPPORTUNITY_KIND);

  /**
   * Sync the source lead's stage (+ its deterministic `leadScore`, recomputed
   * with the Leads module's own scorer) when the opportunity's state implies
   * it. No-ops gracefully when the lead or the Leads module is unavailable.
   * Returns a message fragment for the action result ('' when nothing synced).
   */
  async function syncSourceLead(
    ref: string,
    stage: Extract<LeadStage, 'qualified' | 'won' | 'lost'>,
    ctx: EnterpriseModuleActionContext,
    onlyFromNew: boolean,
  ): Promise<string> {
    if (!ref) return '';
    const leadsModule = ctx.moduleFor(LEADS_MODULE_ID);
    if (!leadsModule) return '';
    await leadsModule.store.load();
    const leadRecord = leadsModule.store.get(ref);
    if (!leadRecord || leadRecord.status === 'deleted') return '';
    const lead = leadFromRecord(leadRecord);
    if (lead.stage === stage) return '';
    if (onlyFromNew && lead.stage !== 'new') return ''; // lift brand-new leads only; never regress progress
    const leadScore = calculateLeadScore({
      stage,
      dealValue: lead.dealValue,
      priority: lead.priority,
      source: lead.source,
    });
    const updated = leadsModule.store.update(leadRecord.id, {
      fields: { stage, leadScore },
      actor: ctx.actor(),
      now: ctx.now(),
    });
    if (updated) ctx.emit(leadsModule, 'updated', updated);
    return ` Source lead marked ${stage}.`;
  }

  return defineEnterpriseModule({
    descriptor: OPPORTUNITY_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(OPPORTUNITY_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Immutability: the framework validates the MERGED field set on update,
        // so a closed record carries its marker here — closed deals are history.
        if (str(input.fields?.closedAt)) {
          return {
            ok: false,
            errors: { closedAt: 'This opportunity is closed — closed opportunities are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const stage = str(result.values.stage) as OpportunityStage;
        if (stage === 'closed-won' || stage === 'closed-lost') {
          errors.stage = 'Close with the Mark Won / Mark Lost actions — the closed stages cannot be set by edit.';
        }

        // Lead linkage: must resolve, and creation snapshots the lead's context
        // into any fields the user left blank (account, value, owner, close date).
        const leadRef = str(result.values.sourceLeadRef);
        if (leadRef && leadStore) {
          const leadRecord = leadStore.get(leadRef);
          if (!leadRecord || leadRecord.status === 'deleted') {
            errors.sourceLeadRef = `No lead with id "${leadRef}" was found.`;
          } else {
            const lead = leadFromRecord(leadRecord);
            if (!str(result.values.account)) result.values.account = lead.company || lead.name;
            if (Number(result.values.amount ?? 0) <= 0 && lead.dealValue > 0) {
              result.values.amount = lead.dealValue;
            }
            if (!str(result.values.assignedTo)) result.values.assignedTo = lead.assignedTo;
            if (!str(result.values.expectedCloseDate) && lead.expectedCloseDate) {
              result.values.expectedCloseDate = lead.expectedCloseDate;
            }
          }
        }

        const quoteRef = str(result.values.quoteRef);
        if (quoteRef && quoteStore && !findQuote(quoteStore, quoteRef)) {
          errors.quoteRef = `No quote "${quoteRef}" was found.`;
        }

        const amount = Number(result.values.amount ?? 0);
        if (amount <= 0) errors.amount = 'Deal value must be greater than zero.';

        // Deterministic stamps: probability clamped by stage, weighted value exact.
        const probability = clampOpportunityProbability(stage, result.values.probability);
        result.values.probability = probability;
        result.values.weightedValue = opportunityWeightedValue(amount, probability);

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // Creation from a lead lifts a brand-new lead to `qualified` — an
      // opportunity existing IS the qualification signal. Never regresses.
      onChange: async (event, ctx) => {
        if (event.action !== 'created') return;
        const opp = opportunityFromRecord(event.record);
        await syncSourceLead(opp.sourceLeadRef, 'qualified', ctx, true);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const opp = opportunityFromRecord(record);
        const health = assessOpportunityHealth(opp, Date.now());
        const fallback = opportunitySummaryFallback(opp, health);
        return {
          moduleId: OPPORTUNITIES_MODULE_ID,
          recordId: record.id,
          headline: `${opp.name} · ${opportunityStageLabel(opp.stage)} · ${money(opp.amount)} · ${opp.probability}%`,
          summary: fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: fallback.executiveExplanation,
          grounded: false,
          model: 'none',
        };
      },
      // Stage progression + closure. Actions write through `store.update`
      // directly (the W1 marker pattern) — validate's closed-stage refusal
      // guards EDITS, not these audited transitions.
      runAction: async (action, record, actionCtx) => {
        const opp = opportunityFromRecord(record);
        if (opp.closedAt) {
          return { ok: false, error: 'This opportunity is already closed — closed opportunities are immutable.' };
        }
        if (action === ADVANCE_STAGE_ACTION) {
          const next = nextOpportunityStage(opp.stage);
          if (!next) {
            return { ok: false, error: 'Negotiation is the last open stage — close with Mark Won or Mark Lost.' };
          }
          const probability = OPPORTUNITY_STAGE_PROBABILITY[next];
          store.update(record.id, {
            fields: {
              stage: next,
              probability,
              weightedValue: opportunityWeightedValue(opp.amount, probability),
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: `Advanced to ${opportunityStageLabel(next)} — probability re-baselined to ${probability}%.`,
          };
        }
        if (action === MARK_WON_ACTION) {
          store.update(record.id, {
            fields: {
              stage: 'closed-won',
              outcome: 'won',
              closedAt: actionCtx.now(),
              probability: 100,
              weightedValue: opportunityWeightedValue(opp.amount, 100),
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const leadNote = await syncSourceLead(opp.sourceLeadRef, 'won', actionCtx, false);
          return {
            ok: true,
            message: `Won — ${money(opp.amount)} ready for the quote → order → invoice chain.${leadNote}`,
          };
        }
        if (action === MARK_LOST_ACTION) {
          store.update(record.id, {
            fields: {
              stage: 'closed-lost',
              outcome: 'lost',
              closedAt: actionCtx.now(),
              probability: 0,
              weightedValue: 0,
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const leadNote = await syncSourceLead(opp.sourceLeadRef, 'lost', actionCtx, false);
          const reasonNote = opp.lostReason ? '' : ' Record a lost reason for the post-mortem.';
          return { ok: true, message: `Marked lost.${leadNote}${reasonNote}` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
