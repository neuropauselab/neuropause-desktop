/**
 * Finance → Exchange Rates — the effective-dated FX rate register on the
 * Enterprise Module Framework (W6-B1). CRUD, RBAC (`operations:read` /
 * `operations:manage` — the Finance family's certified scopes), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * A record is a dated FX fact (1 `fromCurrency` = `rate` `toCurrency` from
 * `effectiveFrom`). The pure `resolveExchangeRate` / `convertAmount` engine
 * consumes these; this module owns their capture. `Lock` is the W1 marker
 * pattern: a locked rate (a posting has relied on it) is immutable history and
 * corrections become a NEW record with a later effective date — never an edit
 * that rewrites a past conversion.
 *
 * FOUNDATION ONLY: nothing here posts to the ledger; later B-increments apply
 * these rates to documents and revaluation. Electron-free (store paths
 * injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  CURRENCY_PATTERN,
  EXCHANGE_RATES_MODULE_ID,
  EXCHANGE_RATE_KIND,
  currencyPairCode,
  exchangeRateFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Exchange Rates module surfaces. */
export const LOCK_RATE_ACTION = 'lock';

/** The declarative description of an exchange rate — drives store, CRUD, and the UI. */
export const EXCHANGE_RATE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: EXCHANGE_RATES_MODULE_ID,
  title: 'Exchange Rates',
  singular: 'Exchange Rate',
  plural: 'Exchange Rates',
  icon: 'refresh',
  description:
    'Effective-dated FX rates the conversion engine resolves by date — locked rates are immutable, corrections are a new dated record.',
  group: 'Finance',
  titleField: 'pairCode',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: LOCK_RATE_ACTION, label: 'Lock', icon: 'lock' }],
  fields: [
    { key: 'pairCode', label: 'Pair', type: 'text', readOnly: true },
    { key: 'fromCurrency', label: 'From', type: 'text', required: true, placeholder: 'USD' },
    { key: 'toCurrency', label: 'To', type: 'text', required: true, placeholder: 'INR' },
    { key: 'rate', label: 'Rate', type: 'number', required: true, min: 0 },
    { key: 'effectiveFrom', label: 'Effective From', type: 'date', required: true, format: 'date' },
    { key: 'source', label: 'Source', type: 'text', column: false, placeholder: 'RBI reference / manual / provider' },
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
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Exchange Rates module — the rate book the conversion engine reads. */
export function createExchangeRateModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, EXCHANGE_RATES_MODULE_ID, EXCHANGE_RATE_KIND);
  return defineEnterpriseModule({
    descriptor: EXCHANGE_RATE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(EXCHANGE_RATE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.lockedAt)) {
          return {
            ok: false,
            errors: { status: 'This rate is locked — corrections are a NEW record with a later effective date.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const from = str(result.values.fromCurrency).toUpperCase();
        const to = str(result.values.toCurrency).toUpperCase();
        if (!CURRENCY_PATTERN.test(from)) errors.fromCurrency = 'From must be a 3-letter currency code (e.g. USD).';
        if (!CURRENCY_PATTERN.test(to)) errors.toCurrency = 'To must be a 3-letter currency code (e.g. INR).';
        if (from && to && from === to) errors.toCurrency = 'From and To must differ — same-currency conversion is always 1.';
        if (Number(result.values.rate ?? 0) <= 0) errors.rate = 'Rate must be greater than zero.';
        result.values.fromCurrency = from;
        result.values.toCurrency = to;
        result.values.pairCode = currencyPairCode(from, to);
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const r = exchangeRateFromRecord(record);
        return {
          moduleId: EXCHANGE_RATES_MODULE_ID,
          recordId: record.id,
          headline: `${currencyPairCode(r.fromCurrency, r.toCurrency)} · ${r.rate} · from ${r.effectiveFrom}${r.lockedAt ? ' · locked' : ''}`,
          summary:
            `1 ${r.fromCurrency} = ${r.rate} ${r.toCurrency}, effective ${r.effectiveFrom}` +
            (r.source ? ` (source: ${r.source})` : '') +
            `. ${r.lockedAt ? 'Locked — immutable history.' : 'Unlocked — editable until a posting relies on it.'}`,
          risk: r.lockedAt ? 'low' : 'medium',
          riskReason: r.lockedAt
            ? 'Locked rate — past conversions cite it safely.'
            : 'Unlocked rates are still editable — lock before a foreign-currency posting relies on this rate.',
          executiveExplanation:
            'The conversion engine resolves the rate governing a date; rates are dated facts, so a correction is a new record, never an edit that rewrites a past posting.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        if (action !== LOCK_RATE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (str(record.fields.lockedAt)) return { ok: false, error: 'This rate is already locked.' };
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
