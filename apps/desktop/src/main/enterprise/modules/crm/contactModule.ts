/**
 * CRM → Contacts — the second ERP module on the Enterprise Module Framework, and
 * a copy of the Finance blueprint: a descriptor + the framework's record store +
 * one `summarize` hook. CRUD, RBAC (`crm:read` / `crm:manage`), audit, timeline
 * events, search, offline persistence, and the entire list/detail/form UI are all
 * inherited from the foundation — nothing is re-implemented.
 *
 * Electron-free (store path + AI runner are injected), so it unit-tests without
 * the app runtime.
 */
import type {
  ContactHealth,
  CrmContact,
  EnterpriseModuleDescriptor,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  CONTACT_KIND,
  CRM_MODULE_ID,
  assessContactHealth,
  contactFromRecord,
  contactStatusLabel,
  contactSummaryFallback,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a contact — drives store, CRUD, and the UI. */
export const CONTACT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CRM_MODULE_ID,
  title: 'CRM',
  singular: 'Contact',
  plural: 'Contacts',
  icon: 'user',
  description: 'Track relationships across leads, prospects, customers and partners.',
  group: 'CRM',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Ada Lovelace' },
    { key: 'company', label: 'Company', type: 'text', placeholder: 'Acme Inc.' },
    { key: 'email', label: 'Email', type: 'text', placeholder: 'ada@acme.com' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'lead',
      badge: true,
      filterable: true,
      options: [
        { value: 'lead', label: 'Lead', tone: 'neutral' },
        { value: 'prospect', label: 'Prospect', tone: 'blue' },
        { value: 'customer', label: 'Customer', tone: 'green' },
        { value: 'partner', label: 'Partner', tone: 'purple' },
        { value: 'inactive', label: 'Inactive', tone: 'orange' },
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      default: 'medium',
      badge: true,
      filterable: true,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'pink' },
      ],
    },
    { key: 'assignedTo', label: 'Assigned To', type: 'text', placeholder: 'owner@company.com' },
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
    { key: 'phone', label: 'Phone', type: 'text', column: false },
    { key: 'mobile', label: 'Mobile', type: 'text', column: false },
    { key: 'address', label: 'Address', type: 'text', column: false },
    { key: 'city', label: 'City', type: 'text', column: false },
    { key: 'state', label: 'State', type: 'text', column: false },
    { key: 'country', label: 'Country', type: 'text', column: false },
    { key: 'gstNumber', label: 'GST Number', type: 'text', column: false },
    { key: 'industry', label: 'Industry', type: 'text', column: false },
    { key: 'website', label: 'Website', type: 'text', column: false },
    { key: 'sourceLead', label: 'Source Lead', type: 'text', column: false, readOnly: true },
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

/** The AI narrative half of a summary; the health band stays deterministic. */
export interface ContactAiNarrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

/** Injected AI runner (bound to the real AI engine in the instance file). */
export type ContactAiRunner = (
  contact: CrmContact,
  health: ContactHealth,
) => Promise<ContactAiNarrative | null>;

/**
 * Build the CRM module. The AI runner is optional: without it (or when no model
 * is configured) the summary uses the deterministic fallback, so the feature
 * works fully offline and in tests.
 */
export function createContactModule(
  storePath: string,
  aiRunner?: ContactAiRunner,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CRM_MODULE_ID, CONTACT_KIND);
  return defineEnterpriseModule({
    descriptor: CONTACT_DESCRIPTOR,
    store,
    hooks: {
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const contact = contactFromRecord(record);
        const health = assessContactHealth(contact, Date.now());
        const ai = aiRunner ? await aiRunner(contact, health).catch(() => null) : null;
        const fallback = contactSummaryFallback(contact, health);
        const company = contact.company ? ` · ${contact.company}` : '';
        return {
          moduleId: CRM_MODULE_ID,
          recordId: record.id,
          headline: `${contact.name}${company} · ${contactStatusLabel(contact.status)}`,
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
