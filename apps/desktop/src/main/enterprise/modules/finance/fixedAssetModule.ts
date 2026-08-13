/**
 * Finance → Fixed Assets — the asset register on the Enterprise Module
 * Framework: a descriptor + the framework's record store + a `validate` hook +
 * `capitalize`/`postDepreciation`/`dispose` actions + a deterministic
 * `summarize`. CRUD, RBAC (`operations:read` / `operations:manage`), audit,
 * timeline, search, offline persistence, and the entire list/detail/form UI
 * are all inherited.
 *
 * DETERMINISTIC: both schedules — straight-line and (FW-9) declining balance
 * at a declared annual rate — are arithmetic with an exact total
 * (`depreciationSchedule` dispatches on the asset's own method, defaulting
 * straight-line for assets that never chose); `status` derives from
 * action-stamped markers and a
 * CAPITALIZED asset's financial fields are immutable through the validated
 * path (dispose it or leave it — a mutated schedule would corrupt the books).
 * Every action books real journal entries through the shared auto-posting
 * seam, idempotent by entry number: capitalization (Dr Fixed Assets/Cr Cash —
 * bill-financed acquisition arrives with vendor payments), one entry per
 * depreciation month (Dr Depreciation Expense/Cr Accumulated Depreciation),
 * and disposal with the EXACT gain or loss. Statements integrate with no new
 * code — the control accounts flow into the existing balance/statement math.
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
  FIXED_ASSETS_MODULE_ID,
  FIXED_ASSET_KIND,
  depreciationSchedule,
  faCapEntryNumber,
  faCapitalizationLines,
  faDepEntryNumber,
  faDepreciationLines,
  faDisposalEntryNumber,
  faDisposalLines,
  fixedAssetFromRecord,
  nextDepreciation,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { applyGlDerivedEntries } from './glPosting';

/** The declarative description of a fixed asset — drives store, CRUD, and the UI. */
export const FIXED_ASSET_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: FIXED_ASSETS_MODULE_ID,
  title: 'Fixed Assets',
  singular: 'Fixed Asset',
  plural: 'Fixed Assets',
  icon: 'database',
  description: 'Asset register — capitalization, monthly depreciation (straight-line or declining balance), and disposal, all booked in the journal.',
  group: 'Finance',
  titleField: 'assetNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'capitalize', label: 'Capitalize', icon: 'upload' },
    { key: 'postDepreciation', label: 'Post Depreciation', icon: 'download' },
    { key: 'dispose', label: 'Dispose', icon: 'close' },
  ],
  fields: [
    { key: 'assetNumber', label: 'Asset #', type: 'text', required: true, placeholder: 'FA-0001' },
    { key: 'assetName', label: 'Asset', type: 'text', required: true, placeholder: 'CNC Machine' },
    { key: 'category', label: 'Category', type: 'text', column: false, placeholder: 'Machinery' },
    { key: 'acquisitionCost', label: 'Cost', type: 'number', required: true, min: 0, format: 'currency' },
    { key: 'acquisitionDate', label: 'Acquired', type: 'date', required: true, format: 'date' },
    { key: 'usefulLifeMonths', label: 'Life (months)', type: 'number', required: true, min: 1, column: false },
    { key: 'salvageValue', label: 'Salvage', type: 'number', min: 0, default: 0, format: 'currency', column: false },
    {
      // FW-9 (ADDITIVE): the depreciation method — assets that never chose one
      // are straight-line, byte-identically as before.
      key: 'depreciationMethod',
      label: 'Method',
      type: 'select',
      default: 'straight_line',
      column: false,
      options: [
        { value: 'straight_line', label: 'Straight Line' },
        { value: 'declining_balance', label: 'Declining Balance' },
      ],
    },
    {
      key: 'decliningRatePct',
      label: 'DB Rate (%/year)',
      type: 'number',
      min: 0,
      default: 0,
      column: false,
      help: 'Declining balance only: annual rate applied to the month-start book value (e.g. 40).',
    },
    { key: 'accumulatedDepreciation', label: 'Accum. Depr.', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'bookValue', label: 'Book Value', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'depreciatedThroughPeriod', label: 'Depreciated Through', type: 'text', readOnly: true, column: false },
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
        { value: 'capitalized', label: 'Capitalized', tone: 'green' },
        { value: 'disposed', label: 'Disposed', tone: 'orange' },
      ],
    },
    { key: 'disposalProceeds', label: 'Disposal Proceeds', type: 'number', min: 0, default: 0, format: 'currency', column: false },
    { key: 'disposalDate', label: 'Disposed', type: 'date', format: 'date', readOnly: true, column: false },
    { key: 'capitalizedAt', label: 'Capitalized At', type: 'text', readOnly: true, column: false },
    { key: 'disposedAt', label: 'Disposed At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Fixed Assets module. */
export function createFixedAssetModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, FIXED_ASSETS_MODULE_ID, FIXED_ASSET_KIND);
  return defineEnterpriseModule({
    descriptor: FIXED_ASSET_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(FIXED_ASSET_DESCRIPTOR, input);
        if (!result.ok) return result;

        // A capitalized asset's schedule is booked — edits would corrupt the
        // books. Dispose it or leave it; disposal itself is an action.
        if (str(result.values.capitalizedAt)) {
          return {
            ok: false,
            errors: { _: 'Capitalized assets are immutable — use Post Depreciation or Dispose.' },
            values: result.values,
          };
        }

        const errors: Record<string, string> = {};
        const cost = Number(result.values.acquisitionCost ?? 0);
        const life = Number(result.values.usefulLifeMonths ?? 0);
        const salvage = Number(result.values.salvageValue ?? 0);
        if (cost <= 0) errors.acquisitionCost = 'Cost must be greater than zero.';
        if (life < 1 || !Number.isInteger(life)) errors.usefulLifeMonths = 'Life must be a whole number of months (≥ 1).';
        if (salvage < 0) errors.salvageValue = 'Salvage cannot be negative.';
        if (salvage >= cost && cost > 0) errors.salvageValue = 'Salvage must be below the acquisition cost.';
        // FW-9: declining balance is meaningless without a real rate — refuse
        // instead of silently depreciating nothing until the final-month sweep.
        if (str(result.values.depreciationMethod) === 'declining_balance') {
          const rate = Number(result.values.decliningRatePct ?? 0);
          if (rate <= 0 || rate > 100) {
            errors.decliningRatePct = 'Declining balance needs an annual rate between 0 (exclusive) and 100 (e.g. 40).';
          }
        }

        result.values.status = 'draft'; // derived, never user-forged
        result.values.accumulatedDepreciation = 0;
        result.values.bookValue = cost;
        result.values.depreciatedThroughPeriod = '';

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const asset = fixedAssetFromRecord(record);
        // FW-9: the asset's own method decides the schedule the summary explains.
        const schedule = depreciationSchedule(asset);
        const depreciable = schedule.reduce((s, m) => s + m, 0);
        const pct = depreciable === 0 ? 0 : Math.round((asset.accumulatedDepreciation / depreciable) * 100);
        const next = nextDepreciation(asset);
        return {
          moduleId: FIXED_ASSETS_MODULE_ID,
          recordId: record.id,
          headline: `${asset.assetNumber} · ${asset.status} · book ${asset.bookValue.toLocaleString('en-US')}`,
          summary:
            asset.status === 'draft'
              ? `${asset.assetName}: not capitalized yet — cost ${asset.acquisitionCost.toLocaleString('en-US')} over ${asset.usefulLifeMonths} months.`
              : asset.status === 'disposed'
                ? `${asset.assetName}: disposed ${asset.disposalDate} for ${asset.disposalProceeds.toLocaleString('en-US')}.`
                : `${asset.assetName}: ${pct}% depreciated (${asset.accumulatedDepreciation.toLocaleString('en-US')} of ${depreciable.toLocaleString('en-US')}); ${next.ok ? `next month ${next.periodKey} books ${next.amount.toLocaleString('en-US')}` : next.reason}`,
          risk: 'low',
          riskReason: 'Depreciation is a fixed arithmetic schedule.',
          executiveExplanation:
            'Every figure is booked: capitalization, each depreciation month, and disposal each derive an idempotent journal entry; book value is cost minus booked accumulated depreciation, never an estimate.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const asset = fixedAssetFromRecord(record);
        const self = actionCtx.moduleFor(FIXED_ASSETS_MODULE_ID);

        if (action === 'capitalize') {
          if (asset.status !== 'draft') return { ok: false, message: `Cannot capitalize a ${asset.status} asset.` };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: faCapEntryNumber(asset.assetNumber),
                memo: `Asset ${asset.assetNumber} capitalized — ${asset.assetName}`,
                lines: faCapitalizationLines(asset.acquisitionCost),
                sourceModule: FIXED_ASSETS_MODULE_ID,
                sourceRef: record.id,
              },
            ],
            actionCtx,
          );
          const updated = store.update(record.id, {
            fields: { capitalizedAt: actionCtx.now(), status: 'capitalized' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Asset not found.' };
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Asset ${asset.assetNumber} capitalized — ${asset.acquisitionCost.toLocaleString('en-US')} booked.` };
        }

        if (action === 'postDepreciation') {
          const next = nextDepreciation(asset);
          if (!next.ok) return { ok: false, message: next.reason };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: faDepEntryNumber(asset.assetNumber, next.periodKey),
                memo: `Depreciation ${next.periodKey} — ${asset.assetNumber} ${asset.assetName}`,
                lines: faDepreciationLines(next.amount),
                sourceModule: FIXED_ASSETS_MODULE_ID,
                sourceRef: record.id,
              },
            ],
            actionCtx,
          );
          const accumulated = Math.round((asset.accumulatedDepreciation + next.amount) * 100) / 100;
          const updated = store.update(record.id, {
            fields: {
              accumulatedDepreciation: accumulated,
              bookValue: Math.round((asset.acquisitionCost - accumulated) * 100) / 100,
              depreciatedThroughPeriod: next.periodKey,
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Asset not found.' };
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Depreciation ${next.periodKey} posted: ${next.amount.toLocaleString('en-US')}.` };
        }

        if (action === 'dispose') {
          if (asset.status !== 'capitalized') return { ok: false, message: `Cannot dispose a ${asset.status} asset.` };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: faDisposalEntryNumber(asset.assetNumber),
                memo: `Asset ${asset.assetNumber} disposed — proceeds ${asset.disposalProceeds.toLocaleString('en-US')}`,
                lines: faDisposalLines({
                  acquisitionCost: asset.acquisitionCost,
                  accumulatedDepreciation: asset.accumulatedDepreciation,
                  proceeds: asset.disposalProceeds,
                }),
                sourceModule: FIXED_ASSETS_MODULE_ID,
                sourceRef: record.id,
              },
            ],
            actionCtx,
          );
          const updated = store.update(record.id, {
            fields: {
              disposedAt: actionCtx.now(),
              disposalDate: actionCtx.now().slice(0, 10),
              status: 'disposed',
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Asset not found.' };
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Asset ${asset.assetNumber} disposed — gain/loss booked exactly.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
