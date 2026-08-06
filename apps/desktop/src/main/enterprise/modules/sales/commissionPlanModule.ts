/**
 * Sales → Commission Plans — the commission rule book on the Enterprise Module
 * Framework (W2.5). Configuration records (the Pricing Rules pattern): freely
 * editable, no lifecycle markers, no actions. CRUD, RBAC
 * (`sales:read` / `sales:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC guards in validate: rates stay in (0..100], rep-scoped plans
 * must name their rep. The Commission Statements module consumes the plan book
 * through the pure `commissionPlanFor` precedence (rep-scoped beats all-reps;
 * lowest priority number wins) — that consumption lives there; this module
 * owns only the book.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  COMMISSION_PLANS_MODULE_ID,
  COMMISSION_PLAN_KIND,
  commissionPlanFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a commission plan — drives store, CRUD, and the UI. */
export const COMMISSION_PLAN_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: COMMISSION_PLANS_MODULE_ID,
  title: 'Commission Plans',
  singular: 'Commission Plan',
  plural: 'Commission Plans',
  icon: 'award',
  description:
    'The commission rule book — who earns what percentage of won business; rep-specific plans beat the house plan.',
  group: 'Sales',
  titleField: 'planName',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'planName', label: 'Plan', type: 'text', required: true, placeholder: 'House plan — 5%' },
    {
      key: 'scope',
      label: 'Scope',
      type: 'select',
      required: true,
      default: 'all',
      badge: true,
      filterable: true,
      options: [
        { value: 'all', label: 'All Reps', tone: 'blue' },
        { value: 'rep', label: 'Specific Rep', tone: 'teal' },
      ],
    },
    { key: 'repName', label: 'Rep', type: 'text', placeholder: 'Exact rep name (rep scope)' },
    { key: 'ratePct', label: 'Rate %', type: 'number', required: true, min: 0, max: 100 },
    {
      key: 'active',
      label: 'Active',
      type: 'select',
      required: true,
      default: 'yes',
      badge: true,
      filterable: true,
      options: [
        { value: 'yes', label: 'Active', tone: 'green' },
        { value: 'no', label: 'Inactive', tone: 'neutral' },
      ],
    },
    { key: 'priority', label: 'Priority', type: 'number', min: 1, default: 100, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Commission Plans module — the rule book behind commission statements. */
export function createCommissionPlanModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, COMMISSION_PLANS_MODULE_ID, COMMISSION_PLAN_KIND);
  return defineEnterpriseModule({
    descriptor: COMMISSION_PLAN_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(COMMISSION_PLAN_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        if (Number(result.values.ratePct ?? 0) <= 0) {
          errors.ratePct = 'Rate must be greater than zero.';
        }
        if (str(result.values.scope) === 'rep' && !str(result.values.repName)) {
          errors.repName = 'Rep-scoped plans must name their rep exactly.';
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const plan = commissionPlanFromRecord(record);
        const who = plan.scope === 'rep' ? plan.repName : 'all reps';
        return {
          moduleId: COMMISSION_PLANS_MODULE_ID,
          recordId: record.id,
          headline: `${plan.planName} · ${who} · ${plan.ratePct}% · ${plan.active ? 'active' : 'inactive'}`,
          summary: `Pays ${who} ${plan.ratePct}% of bookings (closed-won opportunity value). Rep-scoped plans beat the house plan; lowest priority number wins ties.`,
          risk: 'low',
          riskReason: plan.active ? 'Active plan — used by new statements.' : 'Inactive — ignored by statements.',
          executiveExplanation:
            'Commission plans are configuration: statements read the book at generation time, so past statements never change when the book does.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
