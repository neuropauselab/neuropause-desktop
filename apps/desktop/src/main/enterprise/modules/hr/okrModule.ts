/**
 * HR → OKRs — objectives and key results on the Enterprise Module Framework
 * (FW-11). CRUD, RBAC (`operations:read` / `operations:manage`), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one objective for one OWNER (a live employee — guarded against
 * the injected Employees store) in one QUARTER (strict YYYY-Qn), carrying
 * 1–12 key results as JSON. Progress is derived at validate by the pure
 * engine — capped per KR, equal-weighted overall — so a check-in is just an
 * ordinary edit of an ACTIVE objective whose currents moved. Lifecycle is
 * action-driven: ACTIVATE puts a draft in play, CLOSE ends the quarter and
 * freezes the record (closed objectives are immutable period history).
 *
 * Electron-free (store path + employee store injected), so it unit-tests
 * without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  OKRS_MODULE_ID,
  OKR_KIND,
  okrProgress,
  parseKeyResults,
  parseOkrPeriod,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** Put a drafted objective in play for its quarter. */
export const ACTIVATE_OKR_ACTION = 'activate';
/** End the quarter — freezes the objective with its final progress. */
export const CLOSE_OKR_ACTION = 'close';

/** The declarative description of an objective — drives store, CRUD, and the UI. */
export const OKR_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: OKRS_MODULE_ID,
  title: 'OKRs',
  singular: 'Objective',
  plural: 'OKRs',
  icon: 'target',
  description:
    'Objectives with measurable key results per owner and quarter — progress is derived arithmetic, check-ins are ordinary edits.',
  group: 'HR',
  titleField: 'objective',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: ACTIVATE_OKR_ACTION, label: 'Activate', icon: 'check' },
    { key: CLOSE_OKR_ACTION, label: 'Close Quarter', icon: 'close' },
  ],
  fields: [
    { key: 'objective', label: 'Objective', type: 'text', required: true, placeholder: 'Make onboarding effortless' },
    { key: 'owner', label: 'Owner', type: 'text', required: true, placeholder: 'employee record id' },
    { key: 'ownerName', label: 'Owner Name', type: 'text', readOnly: true },
    { key: 'period', label: 'Quarter', type: 'text', required: true, placeholder: '2026-Q3', filterable: true },
    {
      key: 'keyResults',
      label: 'Key Results (JSON)',
      type: 'textarea',
      required: true,
      column: false,
      help: 'JSON array, 1–12 items: [{"kr":"Ship onboarding v2","target":100,"current":40,"unit":"%"}].',
      placeholder: '[{"kr":"Ship onboarding v2","target":100,"current":0,"unit":"%"}]',
    },
    { key: 'krCount', label: 'KRs', type: 'number', readOnly: true, default: 0 },
    { key: 'progressPct', label: 'Progress %', type: 'number', readOnly: true, default: 0 },
    { key: 'achievedCount', label: 'Achieved', type: 'number', readOnly: true, default: 0, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'draft',
      badge: true,
      filterable: true,
      options: [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'closed', label: 'Closed', tone: 'blue' },
      ],
    },
    { key: 'activatedAt', label: 'Activated At', type: 'text', readOnly: true, column: false },
    { key: 'closedAt', label: 'Closed At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Context, dependencies…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the OKRs module. The Employees store backs the live-owner guard.
 * (Injected, so tests run Electron-free.)
 */
export function createOkrModule(storePath: string, employeeStore: EnterpriseRecordStore): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, OKRS_MODULE_ID, OKR_KIND);
  return defineEnterpriseModule({
    descriptor: OKR_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(OKR_DESCRIPTOR, input);
        if (!result.ok) return result;
        // A closed objective is quarter history — immutable.
        if (str(input.fields?.closedAt)) {
          return {
            ok: false,
            errors: { status: 'This objective is closed — closed quarters are immutable history.' },
            values: result.values,
          };
        }
        if (!parseOkrPeriod(result.values.period)) {
          return {
            ok: false,
            errors: { period: 'Quarter must be YYYY-Qn (e.g. 2026-Q3).' },
            values: result.values,
          };
        }
        const parsed = parseKeyResults(str(result.values.keyResults));
        if (!parsed.ok) {
          return { ok: false, errors: { keyResults: parsed.error }, values: result.values };
        }
        const ownerId = str(result.values.owner).trim();
        const owner = employeeStore.list().find((r) => r.id === ownerId && r.status !== 'deleted');
        if (!owner) {
          return {
            ok: false,
            errors: { owner: 'Owner not found — the objective must reference a real employee record id.' },
            values: result.values,
          };
        }
        if (str(owner.fields.exitedAt)) {
          return {
            ok: false,
            errors: { owner: 'This employee has exited — objectives belong to active employees.' },
            values: result.values,
          };
        }
        // Derived, never typed: normalized KRs, counts, and arithmetic progress.
        const progress = okrProgress(parsed.keyResults);
        result.values.keyResults = JSON.stringify(parsed.keyResults);
        result.values.krCount = parsed.keyResults.length;
        result.values.progressPct = progress.overall;
        result.values.achievedCount = progress.achievedCount;
        result.values.ownerName = str(owner.fields.name);
        // A check-in edits an ACTIVE objective (marker rides the payload);
        // everything else re-enters as a draft. Only actions move the marker.
        result.values.status = str(input.fields?.activatedAt) ? 'active' : 'draft';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const status = str(f.status);
        const progress = Number(f.progressPct ?? 0);
        const offTrack = status === 'active' && progress < 25;
        return {
          moduleId: OKRS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.objective)} · ${str(f.period)} · ${progress}%`,
          summary:
            `${str(f.ownerName) || str(f.owner)} — ${str(f.period)}: ${Number(f.krCount ?? 0)} key result(s), ` +
            `${Number(f.achievedCount ?? 0)} achieved, overall ${progress}%. ` +
            (status === 'closed' ? 'Closed — the quarter is frozen.' : status === 'active' ? 'Active — check-ins update currents.' : 'Draft — activate to start the quarter.'),
          risk: offTrack ? 'medium' : 'low',
          riskReason: offTrack
            ? 'Active objective under 25% — arithmetic, not judgment; review the key results.'
            : 'Progress figures are derived from the key results, never typed.',
          executiveExplanation:
            'Each key result contributes min(current/target, 100%); the objective is their equal-weighted mean — over-achieving one KR never masks another.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const f = record.fields;
        const status = str(f.status);
        if (action === ACTIVATE_OKR_ACTION) {
          if (status !== 'draft') return { ok: false, error: `Only a draft activates — this objective is ${status}.` };
          store.update(record.id, {
            fields: { status: 'active', activatedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Objective active for ${str(f.period)} — check in by editing the key results' currents.` };
        }
        if (action === CLOSE_OKR_ACTION) {
          if (status !== 'active') return { ok: false, error: `Only an active objective closes — this one is ${status}.` };
          store.update(record.id, {
            fields: { status: 'closed', closedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: `Quarter closed at ${Number(f.progressPct ?? 0)}% (${Number(f.achievedCount ?? 0)}/${Number(f.krCount ?? 0)} achieved) — this objective is now immutable history.`,
          };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
