/**
 * Sales → Pricing Rules — the discount rule book on the Enterprise Module
 * Framework. A descriptor + the framework's record store + hooks; CRUD, RBAC
 * (`sales:read` / `sales:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * Rules are CONFIGURATION records (the Chart-of-Accounts pattern): freely
 * editable, no lifecycle markers, no actions. The DETERMINISTIC guards live in
 * validate: percentages stay in (0..100], fixed discounts stay positive,
 * customer-scoped rules must name their customer, and effective windows must
 * be ordered. The Quotes module consumes the rule book through the pure
 * discount engine (`evaluatePricingRules`) as a policy ceiling — that wiring
 * lives in the Quotes module; this module owns only the rule book itself.
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
  PRICING_RULES_MODULE_ID,
  PRICING_RULE_KIND,
  evaluatePricingRules,
  pricingRuleFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a pricing rule — drives store, CRUD, and the UI. */
export const PRICING_RULE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PRICING_RULES_MODULE_ID,
  title: 'Pricing Rules',
  singular: 'Pricing Rule',
  plural: 'Pricing Rules',
  icon: 'percent',
  description:
    'The discount rule book — volume thresholds, customer pricing, and date-windowed offers; the best applicable rule prices each quote.',
  group: 'Sales',
  titleField: 'ruleName',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'ruleName', label: 'Rule', type: 'text', required: true, placeholder: 'Volume 100k — 5%' },
    {
      key: 'scope',
      label: 'Scope',
      type: 'select',
      required: true,
      default: 'global',
      badge: true,
      filterable: true,
      options: [
        { value: 'global', label: 'Global', tone: 'blue' },
        { value: 'customer', label: 'Customer', tone: 'teal' },
      ],
    },
    { key: 'customerName', label: 'Customer', type: 'text', placeholder: 'Exact customer name (customer scope)' },
    {
      key: 'ruleType',
      label: 'Type',
      type: 'select',
      required: true,
      default: 'percentage',
      badge: true,
      options: [
        { value: 'percentage', label: '% of Subtotal', tone: 'purple' },
        { value: 'fixed', label: 'Fixed Amount', tone: 'neutral' },
      ],
    },
    { key: 'value', label: 'Value', type: 'number', required: true, min: 0 },
    { key: 'minSubtotal', label: 'Min Subtotal', type: 'number', min: 0, format: 'currency' },
    { key: 'effectiveFrom', label: 'From', type: 'date', format: 'date', column: false },
    { key: 'effectiveTo', label: 'To', type: 'date', format: 'date', column: false },
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

/** Build the Pricing Rules module — the rule book behind the discount engine. */
export function createPricingRuleModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PRICING_RULES_MODULE_ID, PRICING_RULE_KIND);
  return defineEnterpriseModule({
    descriptor: PRICING_RULE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PRICING_RULE_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        const ruleType = str(result.values.ruleType);
        const value = Number(result.values.value ?? 0);
        if (value <= 0) {
          errors.value = 'Value must be greater than zero.';
        } else if (ruleType === 'percentage' && value > 100) {
          errors.value = 'A percentage discount cannot exceed 100.';
        }
        if (str(result.values.scope) === 'customer' && !str(result.values.customerName)) {
          errors.customerName = 'Customer-scoped rules must name their customer exactly.';
        }
        const from = str(result.values.effectiveFrom);
        const to = str(result.values.effectiveTo);
        if (from && to && Date.parse(to) < Date.parse(from)) {
          errors.effectiveTo = 'The effective window must end on or after it starts.';
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const rule = pricingRuleFromRecord(record);
        // Demonstrate the rule on a reference context: its own threshold (or 10,000).
        const referenceSubtotal = Math.max(rule.minSubtotal, 10_000);
        const policy = evaluatePricingRules([rule], {
          customer: rule.scope === 'customer' ? rule.customerName : '',
          subtotal: referenceSubtotal,
          issueDate: rule.effectiveFrom ?? null,
        });
        const window =
          rule.effectiveFrom || rule.effectiveTo
            ? ` (${rule.effectiveFrom ?? '…'} → ${rule.effectiveTo ?? '…'})`
            : '';
        const grant =
          rule.ruleType === 'percentage' ? `${rule.value}% of subtotal` : `fixed ${rule.value}`;
        return {
          moduleId: PRICING_RULES_MODULE_ID,
          recordId: record.id,
          headline: `${rule.ruleName} · ${rule.scope} · ${grant} · ${rule.active ? 'active' : 'inactive'}`,
          summary:
            `${rule.scope === 'customer' ? `For ${rule.customerName}` : 'For all customers'}, grants ${grant}` +
            `${rule.minSubtotal > 0 ? ` on subtotals ≥ ${rule.minSubtotal}` : ''}${window}. ` +
            `On a ${referenceSubtotal} subtotal: ${policy.discount} off. Best-rule-wins, no stacking.`,
          risk: rule.active ? 'low' : 'low',
          riskReason: rule.active ? 'Active rule — priced into new quotes.' : 'Inactive — ignored by the engine.',
          executiveExplanation:
            'Pricing rules are the discount POLICY: quotes get the best applicable rule stamped as their policy discount, and any manual discount beyond policy forces approval.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
