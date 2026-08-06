/**
 * Sales → Revenue Forecast — immutable pipeline-forecast snapshots on the
 * Enterprise Module Framework (W2.6), the Aging pattern applied to the future:
 * CREATING a forecast generates it. The validate hook walks the injected
 * Opportunities store through the pure `deriveRevenueForecast` engine — month
 * by month over the horizon, open deals contribute their deterministic
 * weighted value at their expected close month, won deals contribute their
 * full amount at their close month, and unscheduled open deals land in a
 * VISIBLE outside bucket. CRUD, RBAC (`sales:read` / `sales:manage`), audit,
 * timeline, search, offline persistence, and the entire list/detail/form UI
 * are all inherited.
 *
 * Forecasts are IMMUTABLE (the `generatedAt` marker refuses edits) and never
 * superseded — a sequence of snapshots is how forecast accuracy gets audited
 * later. A forecast never posts to the General Ledger: weighted pipeline is an
 * expectation, not revenue.
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
  REVENUE_FORECAST_MODULE_ID,
  REVENUE_FORECAST_KIND,
  deriveRevenueForecast,
  opportunityFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a revenue forecast — drives store, CRUD, and the UI. */
export const REVENUE_FORECAST_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: REVENUE_FORECAST_MODULE_ID,
  title: 'Revenue Forecast',
  singular: 'Revenue Forecast',
  plural: 'Revenue Forecasts',
  icon: 'chart',
  description:
    'Immutable pipeline forecasts — weighted open deals by expected close month plus booked wins, generated on create.',
  group: 'Sales',
  titleField: 'forecastNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  fields: [
    { key: 'forecastNumber', label: 'Forecast #', type: 'text', readOnly: true },
    { key: 'asOfDate', label: 'As Of', type: 'date', format: 'date', placeholder: 'Defaults to today' },
    { key: 'horizonMonths', label: 'Horizon (months)', type: 'number', min: 1, max: 12, default: 3 },
    { key: 'pipelineWeighted', label: 'Weighted Pipeline', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'bookedInHorizon', label: 'Booked', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'outsideWeighted', label: 'Outside Horizon', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'openDeals', label: 'Open Deals', type: 'number', readOnly: true, default: 0 },
    { key: 'rows', label: 'Months', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Revenue Forecast module. The Opportunities store is injected so
 * generation reads the real pipeline (the W1 snapshot pattern).
 */
export function createRevenueForecastModule(
  storePath: string,
  opportunityStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, REVENUE_FORECAST_MODULE_ID, REVENUE_FORECAST_KIND);
  return defineEnterpriseModule({
    descriptor: REVENUE_FORECAST_DESCRIPTOR,
    store,
    hooks: {
      // Creating a forecast IS generating it; a generated forecast is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(REVENUE_FORECAST_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Revenue forecasts are immutable snapshots — generate a new forecast instead.' },
            values: result.values,
          };
        }
        const asOfDate = str(result.values.asOfDate).trim() || new Date().toISOString().slice(0, 10);
        if (!Number.isFinite(Date.parse(asOfDate))) {
          return {
            ok: false,
            errors: { asOfDate: 'As-of must be a valid date (YYYY-MM-DD).' },
            values: result.values,
          };
        }
        const horizonMonths = Number(result.values.horizonMonths ?? 3) || 3;
        const forecast = deriveRevenueForecast(
          opportunityStore.list().map(opportunityFromRecord),
          asOfDate,
          horizonMonths,
        );
        const priorCount = store.list().filter((r) => str(r.fields.asOfDate) === asOfDate).length;
        result.values.asOfDate = asOfDate;
        result.values.forecastNumber = `RF-${asOfDate}-${priorCount + 1}`;
        result.values.pipelineWeighted = forecast.pipelineWeighted;
        result.values.bookedInHorizon = forecast.bookedInHorizon;
        result.values.outsideWeighted = forecast.outsideWeighted;
        result.values.openDeals = forecast.openDeals;
        result.values.rows = JSON.stringify(forecast.rows);
        result.values.note =
          forecast.openDeals === 0 && forecast.bookedInHorizon === 0
            ? `no open pipeline or bookings at ${asOfDate} — the forecast is empty, not fabricated`
            : `weighted pipeline over ${horizonMonths} month(s) from ${asOfDate}` +
              (forecast.outsideCount > 0
                ? `; ${forecast.outsideCount} open deal(s) worth ${forecast.outsideWeighted} weighted sit outside the horizon (missing or distant expected close)`
                : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const outside = Number(f.outsideWeighted ?? 0);
        return {
          moduleId: REVENUE_FORECAST_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.forecastNumber)} · weighted ${Number(f.pipelineWeighted ?? 0).toLocaleString('en-US')} · booked ${Number(f.bookedInHorizon ?? 0).toLocaleString('en-US')}`,
          summary: `As of ${str(f.asOfDate)}: ${Number(f.pipelineWeighted ?? 0).toLocaleString('en-US')} weighted pipeline and ${Number(f.bookedInHorizon ?? 0).toLocaleString('en-US')} booked across the horizon, ${Number(f.openDeals ?? 0)} open deal(s). ${str(f.note)}.`,
          risk: outside > 0 ? 'medium' : 'low',
          riskReason:
            outside > 0
              ? 'Weighted pipeline sits outside the horizon — schedule expected close dates to make it forecastable.'
              : 'All open pipeline is scheduled inside the horizon.',
          executiveExplanation:
            'Forecasts are immutable snapshots of the opportunity pipeline — weighted expectation by close month plus booked wins; comparing snapshots over time audits forecast accuracy.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
