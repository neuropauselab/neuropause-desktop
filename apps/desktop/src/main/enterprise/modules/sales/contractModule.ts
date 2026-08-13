/**
 * Sales → Contracts — commercial agreements on the Enterprise Module
 * Framework, closing the CRM → Sales chain
 * (Opportunity → Quote → Order → CONTRACT → the W1 revenue documents). A
 * descriptor + the framework's record store + hooks; CRUD, RBAC
 * (`sales:read` / `sales:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC lifecycle (the W1 marker pattern):
 *   • Stored `status` is marker-derived and read-only: draft until `Activate`
 *     stamps `activatedAt`, terminated when `Terminate` stamps `terminatedAt`.
 *     Once activated the record is immutable by edit (validate refuses on the
 *     merged markers) — active agreements change only through the audited
 *     actions.
 *   • Expiry is TIME-DERIVED at read (expiring/expired against the end date),
 *     never stored, so it can never go stale.
 *   • `Renew` drafts a SUCCESSOR contract — same commercial terms, term
 *     starting the day the old one ends (calendar-exact month math with
 *     month-end clamping) — cross-linked both ways (`renewedFromRef` /
 *     `renewedToRef`), created as a DRAFT deliberately: renewal terms deserve
 *     review before activation. One renewal per contract.
 *   • `customerRef` must resolve against the injected Customers store;
 *     `opportunityRef` (optional) against the injected Opportunities store.
 *
 * Contracts never post to the General Ledger — contract value is commercial;
 * revenue enters the books only via the W1 invoice/payment chain.
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
  CONTRACTS_MODULE_ID,
  CONTRACT_KIND,
  contractDatesError,
  contractFromRecord,
  contractRenewalDates,
  contractRuntimeState,
  assessContractHealth,
  contractSummaryFallback,
  deriveRecordTitle,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the Contracts module surfaces. */
export const ACTIVATE_CONTRACT_ACTION = 'activate';
export const TERMINATE_CONTRACT_ACTION = 'terminate';
export const RENEW_CONTRACT_ACTION = 'renew';

/** The declarative description of a contract — drives store, CRUD, and the UI. */
export const CONTRACT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CONTRACTS_MODULE_ID,
  title: 'Contracts',
  singular: 'Contract',
  plural: 'Contracts',
  icon: 'file-text',
  description:
    'Commercial agreements with a marker-driven lifecycle — activate, terminate, and renew into a linked successor term.',
  group: 'Sales',
  titleField: 'contractNumber',
  permissions: { read: 'sales:read', write: 'sales:manage' },
  actions: [
    { key: ACTIVATE_CONTRACT_ACTION, label: 'Activate', icon: 'check' },
    { key: TERMINATE_CONTRACT_ACTION, label: 'Terminate', icon: 'x' },
    { key: RENEW_CONTRACT_ACTION, label: 'Renew', icon: 'arrow-right' },
  ],
  fields: [
    { key: 'contractNumber', label: 'Contract #', type: 'text', required: true, placeholder: 'CTR-0001' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Annual services agreement' },
    { key: 'customerRef', label: 'Customer', type: 'text', required: true, placeholder: 'Customer id' },
    { key: 'opportunityRef', label: 'Opportunity', type: 'text', column: false, placeholder: 'Opportunity id (optional)' },
    { key: 'contractValue', label: 'Contract Value', type: 'number', required: true, min: 0, format: 'currency' },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      required: true,
      default: 'USD',
      column: false,
      options: [
        { value: 'USD', label: 'USD' },
        { value: 'EUR', label: 'EUR' },
        { value: 'GBP', label: 'GBP' },
        { value: 'INR', label: 'INR' },
      ],
    },
    { key: 'startDate', label: 'Starts', type: 'date', required: true, format: 'date' },
    { key: 'endDate', label: 'Ends', type: 'date', required: true, format: 'date' },
    {
      key: 'autoRenew',
      label: 'Auto-Renew',
      type: 'select',
      default: 'no',
      column: false,
      options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ],
    },
    { key: 'renewalTermMonths', label: 'Renewal Term (months)', type: 'number', min: 0, column: false },
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
        { value: 'terminated', label: 'Terminated', tone: 'pink' },
      ],
    },
    { key: 'activatedAt', label: 'Activated At', type: 'text', readOnly: true, column: false },
    { key: 'terminatedAt', label: 'Terminated At', type: 'text', readOnly: true, column: false },
    { key: 'terminationReason', label: 'Termination Reason', type: 'text', column: false },
    { key: 'renewedFromRef', label: 'Renewed From', type: 'text', readOnly: true, column: false },
    { key: 'renewedToRef', label: 'Renewed To', type: 'text', readOnly: true, column: false },
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
 * Build the Contracts module. The Customers + Opportunities stores are
 * injected so the ref guards can resolve links (the W2 injection pattern).
 */
export function createContractModule(
  storePath: string,
  customerStore?: EnterpriseRecordStore,
  opportunityStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CONTRACTS_MODULE_ID, CONTRACT_KIND);

  const resolves = (refStore: EnterpriseRecordStore | undefined, ref: string): boolean => {
    if (!refStore) return true; // store not injected → the guard stands down gracefully
    const record = refStore.get(ref);
    return Boolean(record && record.status !== 'deleted');
  };

  return defineEnterpriseModule({
    descriptor: CONTRACT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CONTRACT_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Immutability: the framework validates the MERGED field set on update,
        // so a live/terminated contract carries its marker here — agreements
        // in force change only through the audited actions.
        if (str(input.fields?.terminatedAt)) {
          return {
            ok: false,
            errors: { status: 'This contract is terminated — terminated contracts are immutable history.' },
            values: result.values,
          };
        }
        if (str(input.fields?.activatedAt)) {
          return {
            ok: false,
            errors: { status: 'This contract is active — active agreements change only through Terminate or Renew.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        if (Number(result.values.contractValue ?? 0) <= 0) {
          errors.contractValue = 'Contract value must be greater than zero.';
        }
        const datesError = contractDatesError(str(result.values.startDate), str(result.values.endDate));
        if (datesError) errors.endDate = datesError;
        const customerRef = str(result.values.customerRef);
        if (customerRef && !resolves(customerStore, customerRef)) {
          errors.customerRef = `No customer with id "${customerRef}" was found.`;
        }
        const opportunityRef = str(result.values.opportunityRef);
        if (opportunityRef && !resolves(opportunityStore, opportunityRef)) {
          errors.opportunityRef = `No opportunity with id "${opportunityRef}" was found.`;
        }
        // Marker-derived, forge-proof: validate only ever passes for drafts.
        result.values.status = 'draft';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const contract = contractFromRecord(record);
        const nowMs = Date.now();
        const health = assessContractHealth(contract, nowMs);
        const fallback = contractSummaryFallback(contract, health, nowMs);
        return {
          moduleId: CONTRACTS_MODULE_ID,
          recordId: record.id,
          headline: `${contract.contractNumber} · ${contractRuntimeState(contract, nowMs)} · ${money(contract.contractValue)} · ends ${contract.endDate ?? '—'}`,
          summary: fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: fallback.executiveExplanation,
          grounded: false,
          model: 'none',
        };
      },
      // Lifecycle transitions stamp markers through the store directly (the W1
      // pattern) — validate's refusal guards EDITS, not these audited actions.
      runAction: async (action, record, actionCtx) => {
        const contract = contractFromRecord(record);
        if (action === ACTIVATE_CONTRACT_ACTION) {
          if (contract.terminatedAt) return { ok: false, error: 'Terminated contracts cannot be reactivated.' };
          if (contract.activatedAt) return { ok: false, error: 'This contract is already active.' };
          store.update(record.id, {
            fields: { activatedAt: actionCtx.now(), status: 'active' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `Active — ${money(contract.contractValue)} contracted through ${contract.endDate ?? '—'}.` };
        }
        if (action === TERMINATE_CONTRACT_ACTION) {
          if (contract.terminatedAt) return { ok: false, error: 'This contract is already terminated.' };
          if (!contract.activatedAt) {
            return { ok: false, error: 'Only active contracts terminate — edit or delete a draft instead.' };
          }
          store.update(record.id, {
            fields: { terminatedAt: actionCtx.now(), status: 'terminated' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const reasonNote = contract.terminationReason ? '' : ' Record a termination reason for the audit trail.';
          return { ok: true, message: `Terminated.${reasonNote}` };
        }
        if (action === RENEW_CONTRACT_ACTION) {
          if (contract.terminatedAt) return { ok: false, error: 'Terminated contracts cannot be renewed.' };
          if (!contract.activatedAt) return { ok: false, error: 'Activate the contract before renewing it.' };
          if (contract.renewedToRef) return { ok: false, error: 'A renewal has already been drafted for this contract.' };
          const self = actionCtx.moduleFor(CONTRACTS_MODULE_ID);
          if (!self) return { ok: false, error: 'The Contracts module is not available for renewal.' };
          const dates = contractRenewalDates(contract);
          if (!dates) return { ok: false, error: 'This contract has no end date to renew from.' };
          // Deterministic successor: same commercial terms, next term, `-R` suffix.
          const successorFields = {
            contractNumber: `${contract.contractNumber}-R`,
            title: contract.title,
            customerRef: contract.customerRef,
            opportunityRef: contract.opportunityRef,
            contractValue: contract.contractValue,
            currency: contract.currency,
            startDate: dates.startDate,
            endDate: dates.endDate,
            autoRenew: contract.autoRenew ? 'yes' : 'no',
            renewalTermMonths: contract.renewalTermMonths,
            renewedFromRef: record.id,
          };
          const validation = self.hooks.validate({ fields: successorFields });
          if (!validation.ok) {
            const first = Object.values(validation.errors)[0] ?? 'invalid renewal input';
            return { ok: false, error: `Renewal draft failed: ${first}` };
          }
          const successor = self.store.create({
            title: deriveRecordTitle(CONTRACT_DESCRIPTOR, validation.values),
            fields: validation.values,
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          actionCtx.emit(self, 'created', successor);
          const updated = store.update(record.id, {
            fields: { renewedToRef: successor.id },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (updated) actionCtx.emit(self, 'updated', updated);
          return {
            ok: true,
            message: `Renewal drafted: ${successorFields.contractNumber} (${dates.startDate} → ${dates.endDate}). Activate it to take effect.`,
          };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
