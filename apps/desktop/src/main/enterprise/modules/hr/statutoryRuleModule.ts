/**
 * HR → Statutory Rules — effective-dated Indian statutory rule sets on the
 * Enterprise Module Framework (W6-A2). CRUD, RBAC (`operations:read` /
 * `operations:manage` — the HR family's certified scopes), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * "Never hardcode rates" lands here STRUCTURALLY: the payroll engine resolves
 * the rule set governing a period from THESE records (latest effectiveFrom on
 * or before the period start) and refuses to process when none resolves. The
 * verified FY 2026-27 values ship as DESCRIPTOR DEFAULTS — creating a record
 * with untouched fields yields the sourced seed through the ordinary,
 * validated, audited create path; nothing writes silently. `Lock` is the W1
 * marker pattern: a locked rule set (one payroll has relied on it) is
 * immutable history — corrections are a NEW record with a later
 * effectiveFrom, exactly how statutory law itself changes.
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
  DEFAULT_STATUTORY_RULE_SET,
  STATUTORY_RULES_MODULE_ID,
  STATUTORY_RULE_KIND,
  calculateAnnualTds,
  parseEsiRules,
  parsePfRules,
  parsePtRules,
  parseTdsRules,
  statutoryRuleSetFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Statutory Rules module surfaces. */
export const LOCK_RULE_SET_ACTION = 'lock';

/** The declarative description of a statutory rule set — drives store, CRUD, and the UI. */
export const STATUTORY_RULE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: STATUTORY_RULES_MODULE_ID,
  title: 'Statutory Rules',
  singular: 'Statutory Rule Set',
  plural: 'Statutory Rules',
  icon: 'shield',
  description:
    'Effective-dated PF/ESI/PT/TDS rule tables the payroll engine resolves by period — verified seed as defaults, locked sets immutable.',
  group: 'HR',
  titleField: 'ruleSetCode',
  // Reuses the certified operations scopes (the HR family precedent).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: LOCK_RULE_SET_ACTION, label: 'Lock', icon: 'lock' }],
  fields: [
    { key: 'ruleSetCode', label: 'Code', type: 'text', required: true, default: DEFAULT_STATUTORY_RULE_SET.ruleSetCode, placeholder: 'IN-FY2026-27' },
    { key: 'effectiveFrom', label: 'Effective From', type: 'date', required: true, format: 'date', default: DEFAULT_STATUTORY_RULE_SET.effectiveFrom },
    { key: 'pfJson', label: 'PF Rules', type: 'textarea', column: false, default: DEFAULT_STATUTORY_RULE_SET.pfJson },
    { key: 'esiJson', label: 'ESI Rules', type: 'textarea', column: false, default: DEFAULT_STATUTORY_RULE_SET.esiJson },
    { key: 'ptJson', label: 'Professional Tax Rules', type: 'textarea', column: false, default: DEFAULT_STATUTORY_RULE_SET.ptJson },
    { key: 'tdsJson', label: 'TDS Rules', type: 'textarea', column: false, default: DEFAULT_STATUTORY_RULE_SET.tdsJson },
    { key: 'sourceNote', label: 'Source', type: 'textarea', column: false, default: DEFAULT_STATUTORY_RULE_SET.sourceNote },
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
        { value: 'locked', label: 'Locked', tone: 'neutral' },
      ],
    },
    { key: 'lockedAt', label: 'Locked At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function money(value: number): string {
  // Locale pinned — deterministic across machines (the W1 Finance convention).
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Build the Statutory Rules module — the rule book the payroll engine reads. */
export function createStatutoryRuleModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, STATUTORY_RULES_MODULE_ID, STATUTORY_RULE_KIND);
  return defineEnterpriseModule({
    descriptor: STATUTORY_RULE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(STATUTORY_RULE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.lockedAt)) {
          return {
            ok: false,
            errors: { status: 'This rule set is locked — corrections are a NEW record with a later effective date.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const pf = parsePfRules(result.values.pfJson);
        if (pf.errors.length > 0) errors.pfJson = pf.errors.join(' ');
        const esi = parseEsiRules(result.values.esiJson);
        if (esi.errors.length > 0) errors.esiJson = esi.errors.join(' ');
        const pt = parsePtRules(result.values.ptJson);
        if (pt.errors.length > 0) errors.ptJson = pt.errors.join(' ');
        const tds = parseTdsRules(result.values.tdsJson);
        if (tds.errors.length > 0) errors.tdsJson = tds.errors.join(' ');
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const parsed = statutoryRuleSetFromRecord(record);
        if (!parsed.ruleSet) {
          return {
            moduleId: STATUTORY_RULES_MODULE_ID,
            recordId: record.id,
            headline: `${str(record.fields.ruleSetCode) || record.title} · UNPARSEABLE`,
            summary: `This rule set fails to parse (${parsed.errors.length} problem(s)) — payroll processing will REFUSE it rather than compute zeros: ${parsed.errors.slice(0, 3).join(' ')}`,
            risk: 'high',
            riskReason: 'An unparseable statutory table blocks payroll — by design, never silently.',
            executiveExplanation: 'Statutory rules are data, not code; broken data refuses loudly instead of paying wrong amounts.',
            grounded: false,
            model: 'none',
          };
        }
        const rs = parsed.ruleSet;
        // Derived FROM the table (never a constant): the income the rebate zeroes out.
        const taxFree = calculateAnnualTds(rs.tds, rs.tds.rebateIncomeLimit + rs.tds.standardDeduction);
        const states = rs.pt.map((p) => p.state).join(', ');
        return {
          moduleId: STATUTORY_RULES_MODULE_ID,
          recordId: record.id,
          headline: `${rs.ruleSetCode} · effective ${rs.effectiveFrom} · ${rs.lockedAt ? 'locked' : 'active'}`,
          summary:
            `PF ${rs.pf.employeeRatePct}% employee / ${rs.pf.employerTotalRatePct}% employer (EPS ${rs.pf.employerEpsRatePct}% on ceiling ${money(rs.pf.wageCeilingMonthly)}); ` +
            `ESI ${rs.esi.employeeRatePct}%/${rs.esi.employerRatePct}% to gross ${money(rs.esi.grossCeilingMonthly)}; ` +
            `PT states: ${states}; TDS ${rs.tds.slabs.length} slab(s), salary to ${money(rs.tds.rebateIncomeLimit + rs.tds.standardDeduction)} yields ${money(taxFree.annualTax)} tax (rebate-derived). ` +
            `${str(record.fields.sourceNote) ? 'Sources recorded on the record.' : 'No source note — add provenance.'}`,
          risk: rs.lockedAt ? 'low' : 'medium',
          riskReason: rs.lockedAt
            ? 'Locked — immutable history; payroll runs cite it safely.'
            : 'Unlocked rule sets are still editable — lock before the first payroll run relies on it.',
          executiveExplanation:
            'The payroll engine reads THESE tables by effective date and refuses to run without one — rates are never hardcoded in formulas.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== LOCK_RULE_SET_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (str(record.fields.lockedAt)) return { ok: false, error: 'This rule set is already locked.' };
        const parsed = statutoryRuleSetFromRecord(record);
        if (!parsed.ruleSet) {
          return { ok: false, error: `Cannot lock an unparseable rule set — fix it first: ${parsed.errors[0] ?? ''}` };
        }
        store.update(record.id, {
          fields: { lockedAt: actionCtx.now(), status: 'locked' },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return { ok: true, message: 'Locked — immutable history; corrections are a new record with a later effective date.' };
      },
    },
  });
}
