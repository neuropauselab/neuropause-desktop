/**
 * CRM → Campaigns — marketing campaigns on the Enterprise Module Framework
 * (W5.1), in the CRM family because attribution IS CRM machinery: every lead
 * already carries a `campaign` field, and this module's summary computes live
 * attribution against the injected Leads store by that exact name. CRUD, RBAC
 * (`crm:read` / `crm:manage`), audit, timeline, search, offline persistence,
 * and the UI are all inherited.
 *
 * Attribution is computed at READ (leads keep arriving) — lead counts, open
 * pipeline, won/lost, cost-per-lead (null when no leads, never fabricated).
 * `Archive` is the W1 marker pattern; archived campaigns are immutable
 * history but their attribution keeps reading live (history with living
 * numbers, stated).
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  CAMPAIGNS_MODULE_ID,
  CAMPAIGN_KIND,
  campaignFromRecord,
  deriveCampaignAttribution,
  leadFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Campaigns module surfaces. */
export const ARCHIVE_CAMPAIGN_ACTION = 'archive';

/** The declarative description of a campaign — drives store, CRUD, and the UI. */
export const CAMPAIGN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CAMPAIGNS_MODULE_ID,
  title: 'Campaigns',
  singular: 'Campaign',
  plural: 'Campaigns',
  icon: 'megaphone',
  description:
    'Marketing campaigns with live lead attribution — leads match by their existing campaign field, cost-per-lead never fabricated.',
  group: 'CRM',
  titleField: 'campaignName',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  actions: [{ key: ARCHIVE_CAMPAIGN_ACTION, label: 'Archive', icon: 'close' }],
  fields: [
    { key: 'campaignName', label: 'Campaign', type: 'text', required: true, placeholder: 'Diwali outreach 2026' },
    {
      key: 'channel',
      label: 'Channel',
      type: 'select',
      required: true,
      default: 'email',
      badge: true,
      filterable: true,
      options: [
        { value: 'email', label: 'Email', tone: 'blue' },
        { value: 'social', label: 'Social', tone: 'teal' },
        { value: 'event', label: 'Event', tone: 'purple' },
        { value: 'web', label: 'Web', tone: 'orange' },
        { value: 'other', label: 'Other', tone: 'neutral' },
      ],
    },
    { key: 'budget', label: 'Budget', type: 'number', min: 0, format: 'currency' },
    { key: 'startDate', label: 'Starts', type: 'date', format: 'date', column: false },
    { key: 'endDate', label: 'Ends', type: 'date', format: 'date' },
    { key: 'owner', label: 'Owner', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'archived', label: 'Archived', tone: 'neutral' },
      ],
    },
    { key: 'archivedAt', label: 'Archived At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function money(value: number): string {
  // Locale pinned — deterministic across machines (the W1 Finance convention).
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Build the Campaigns module. The Leads store is injected so attribution
 * reads the live lead set by exact campaign name.
 */
export function createCampaignModule(
  storePath: string,
  leadStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CAMPAIGNS_MODULE_ID, CAMPAIGN_KIND);
  return defineEnterpriseModule({
    descriptor: CAMPAIGN_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CAMPAIGN_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.archivedAt)) {
          return {
            ok: false,
            errors: { status: 'This campaign is archived — archived campaigns are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const startDate = str(result.values.startDate);
        const endDate = str(result.values.endDate);
        if (startDate && endDate && Date.parse(endDate) < Date.parse(startDate)) {
          errors.endDate = 'The campaign must end on or after it starts.';
        }
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const campaign = campaignFromRecord(record);
        const attribution = deriveCampaignAttribution(
          leadStore ? leadStore.list().map(leadFromRecord) : [],
          campaign.campaignName,
          campaign.budget,
        );
        const cpl = attribution.costPerLead === null ? 'no leads yet' : `${money(attribution.costPerLead)}/lead`;
        return {
          moduleId: CAMPAIGNS_MODULE_ID,
          recordId: record.id,
          headline: `${campaign.campaignName} · ${campaign.channel} · ${attribution.leads} lead(s) · ${cpl}`,
          summary:
            `${attribution.leads} lead(s) matched by exact campaign name: ${attribution.openLeads} open (${money(attribution.openPipelineValue)} pipeline), ` +
            `${attribution.won} won (${money(attribution.wonValue)}), ${attribution.lost} lost` +
            (attribution.winRate === null ? '; nothing closed yet' : `; win rate ${attribution.winRate}%`) +
            `. Budget ${money(campaign.budget)} — ${cpl}. Attribution reads the live lead set.`,
          risk: attribution.leads === 0 && !campaign.archivedAt ? 'medium' : 'low',
          riskReason:
            attribution.leads === 0 && !campaign.archivedAt
              ? 'An active campaign with zero attributed leads is spending without evidence.'
              : 'Attribution is live and exact-name matched.',
          executiveExplanation:
            'Campaigns measure themselves against the lead machinery that already exists — cost per lead and win rate are derived, never typed in.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const campaign = campaignFromRecord(record);
        if (action !== ARCHIVE_CAMPAIGN_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (campaign.archivedAt) return { ok: false, error: 'This campaign is already archived.' };
        store.update(record.id, {
          fields: { archivedAt: actionCtx.now(), status: 'archived' },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return { ok: true, message: 'Archived — attribution keeps reading live (history with living numbers).' };
      },
    },
  });
}
