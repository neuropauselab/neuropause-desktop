/**
 * CRM → Leads — the third ERP module on the Enterprise Module Framework, and the
 * same blueprint again: a descriptor + the framework's record store + a
 * `summarize` hook. CRUD, RBAC (`crm:read` / `crm:manage`), audit, timeline
 * events, search, pagination, offline persistence, and the entire list/detail/
 * form UI are all inherited — nothing re-implemented.
 *
 * The only lead-specific twist is a `validate` hook that stamps the DETERMINISTIC
 * `leadScore` (via `calculateLeadScore`) onto every record, so the score is a
 * read-only, always-current field — business logic, never AI, never user input.
 *
 * Electron-free (store path + AI runner injected), so it unit-tests without the
 * app runtime.
 */
import type {
  CrmLead,
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  LeadHealth,
  LeadPriority,
  LeadStage,
} from '@neuropause/shared';
import {
  LEADS_MODULE_ID,
  LEAD_KIND,
  assessLeadHealth,
  calculateLeadScore,
  estimateConversionProbability,
  leadFromRecord,
  leadStageLabel,
  leadSummaryFallback,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a lead — drives store, CRUD, and the UI. */
export const LEAD_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: LEADS_MODULE_ID,
  title: 'Leads',
  singular: 'Lead',
  plural: 'Leads',
  icon: 'bolt',
  description: 'Track the sales pipeline from new lead to won, with AI scoring.',
  group: 'CRM',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Lead Name', type: 'text', required: true, placeholder: 'Acme renewal' },
    { key: 'company', label: 'Company', type: 'text', placeholder: 'Acme Inc.' },
    { key: 'contactPerson', label: 'Contact Person', type: 'text', column: false },
    { key: 'email', label: 'Email', type: 'text', column: false },
    { key: 'phone', label: 'Phone', type: 'text', column: false },
    {
      key: 'dealValue',
      label: 'Est. Deal Value',
      type: 'number',
      min: 0,
      format: 'currency',
    },
    {
      key: 'stage',
      label: 'Stage',
      type: 'select',
      required: true,
      default: 'new',
      badge: true,
      filterable: true,
      options: [
        { value: 'new', label: 'New', tone: 'neutral' },
        { value: 'qualified', label: 'Qualified', tone: 'blue' },
        { value: 'proposal', label: 'Proposal', tone: 'teal' },
        { value: 'negotiation', label: 'Negotiation', tone: 'purple' },
        { value: 'won', label: 'Won', tone: 'green' },
        { value: 'lost', label: 'Lost', tone: 'pink' },
        { value: 'archived', label: 'Archived', tone: 'orange' },
      ],
    },
    { key: 'leadScore', label: 'Score', type: 'number', readOnly: true },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      default: 'medium',
      badge: true,
      filterable: true,
      column: false,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'pink' },
      ],
    },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      column: false,
      filterable: true,
      options: [
        { value: 'website', label: 'Website' },
        { value: 'referral', label: 'Referral' },
        { value: 'outreach', label: 'Outreach' },
        { value: 'event', label: 'Event' },
        { value: 'partner', label: 'Partner' },
        { value: 'other', label: 'Other' },
      ],
    },
    { key: 'campaign', label: 'Campaign', type: 'text', column: false },
    { key: 'industry', label: 'Industry', type: 'text', column: false },
    {
      key: 'expectedCloseDate',
      label: 'Expected Close',
      type: 'date',
      format: 'date',
      column: false,
    },
    { key: 'convertedContact', label: 'Converted Contact', type: 'text', column: false },
    { key: 'convertedCustomer', label: 'Converted Customer', type: 'text', column: false },
    { key: 'lostReason', label: 'Lost Reason', type: 'text', column: false },
    { key: 'tags', label: 'Tags', type: 'text', column: false, placeholder: 'comma, separated' },
    {
      key: 'notes',
      label: 'Notes',
      type: 'textarea',
      column: false,
      placeholder: 'Optional notes…',
    },
  ],
};

/** The AI narrative half of a summary; score/probability/health stay deterministic. */
export interface LeadAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

/** Deterministic signals handed to the AI to explain (never to override). */
export interface LeadSignals {
  score: number;
  probability: number;
  health: LeadHealth;
}

export type LeadAiRunner = (lead: CrmLead, signals: LeadSignals) => Promise<LeadAiNarrative | null>;

function money(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Build the Leads module. `leadScore` is stamped deterministically by the
 * validate hook on every write. The AI runner is optional (offline → fallback).
 */
export function createLeadModule(storePath: string, aiRunner?: LeadAiRunner): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, LEADS_MODULE_ID, LEAD_KIND);
  return defineEnterpriseModule({
    descriptor: LEAD_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic, read-only lead score — computed from the record's own
      // fields, so it is always current and never user-editable or AI-set.
      validate: (input: EnterpriseRecordInput) => {
        const result = validateEnterpriseRecordInput(LEAD_DESCRIPTOR, input);
        if (result.ok) {
          result.values.leadScore = calculateLeadScore({
            stage: (result.values.stage as LeadStage) ?? 'new',
            dealValue: typeof result.values.dealValue === 'number' ? result.values.dealValue : 0,
            priority: (result.values.priority as LeadPriority) ?? 'medium',
            source: String(result.values.source ?? ''),
          });
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const lead = leadFromRecord(record);
        const now = Date.now();
        const score = calculateLeadScore(lead);
        const probability = estimateConversionProbability(lead, now);
        const health = assessLeadHealth(lead, now);
        const ai = aiRunner
          ? await aiRunner(lead, { score, probability, health }).catch(() => null)
          : null;
        const fallback = leadSummaryFallback(lead, score, probability, health);
        return {
          moduleId: LEADS_MODULE_ID,
          recordId: record.id,
          headline: `${lead.name} · ${leadStageLabel(lead.stage)} · ${money(lead.dealValue)} · ${score}/100`,
          summary: ai?.summary?.trim() || fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: ai?.executiveExplanation?.trim() || fallback.executiveExplanation,
          grounded: Boolean(ai?.grounded),
          model: ai?.model ?? 'none',
        };
      },
    },
  });
}
