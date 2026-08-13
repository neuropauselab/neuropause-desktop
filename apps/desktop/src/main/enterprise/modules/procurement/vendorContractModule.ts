/**
 * Procurement → Vendor Contracts — dated commercial agreements with suppliers
 * on the Enterprise Module Framework (FW-7). CRUD, RBAC (`procurement:read` /
 * `procurement:manage`), audit, timeline, search, offline persistence, and the
 * UI are all inherited.
 *
 * One record = one agreement with one supplier: validity window, value,
 * payment terms, renewal notice period. The record lifecycle is human-driven —
 * a DRAFT is negotiable, ACTIVATE puts it in force, TERMINATE ends it early
 * and is final. Whether the window is OPEN on a given day is time-derived by
 * the pure engine, never stored. Purchase orders that name a contract are
 * gated on it at approval (see purchaseOrderModule — the FW-5 budget-gate
 * pattern, fail-closed on anything not live-active-open-same-supplier).
 *
 * Guards: unique live contract number, a REAL live supplier (the name is
 * snapshotted for the PO gate's text match), strict rollover-rejecting dates
 * with end ≥ start, and a 0–365-day renewal notice. Terminated contracts are
 * immutable history.
 *
 * Electron-free (store path + supplier store injected), so it unit-tests
 * without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  VENDOR_CONTRACTS_MODULE_ID,
  VENDOR_CONTRACT_KIND,
  contractDaysRemaining,
  contractWindowState,
  parseContractDate,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** Put a negotiated draft in force. */
export const ACTIVATE_CONTRACT_ACTION = 'activate';
/** End an active contract early — final. */
export const TERMINATE_CONTRACT_ACTION = 'terminate';

/** The declarative description of a vendor contract — drives store, CRUD, and the UI. */
export const VENDOR_CONTRACT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: VENDOR_CONTRACTS_MODULE_ID,
  title: 'Vendor Contracts',
  singular: 'Vendor Contract',
  plural: 'Vendor Contracts',
  icon: 'doc',
  description:
    'Dated agreements with suppliers — validity windows, values, and renewal notice; open contracts can gate purchase-order approval.',
  group: 'Procurement',
  titleField: 'contractNumber',
  permissions: { read: 'procurement:read', write: 'procurement:manage' },
  actions: [
    { key: ACTIVATE_CONTRACT_ACTION, label: 'Activate', icon: 'check' },
    { key: TERMINATE_CONTRACT_ACTION, label: 'Terminate', icon: 'close' },
  ],
  fields: [
    { key: 'contractNumber', label: 'Contract #', type: 'text', required: true, placeholder: 'VC-0001' },
    { key: 'supplierRef', label: 'Supplier', type: 'text', required: true, placeholder: 'Supplier record id' },
    { key: 'supplierName', label: 'Supplier Name', type: 'text', readOnly: true },
    { key: 'startDate', label: 'Valid From', type: 'date', required: true, format: 'date' },
    { key: 'endDate', label: 'Valid To', type: 'date', required: true, format: 'date' },
    { key: 'contractValue', label: 'Value', type: 'number', min: 0, format: 'currency' },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'text', column: false, placeholder: 'Net 30' },
    { key: 'renewalNoticeDays', label: 'Renewal Notice (days)', type: 'number', default: 30, column: false },
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
        { value: 'terminated', label: 'Terminated', tone: 'orange' },
      ],
    },
    { key: 'activatedAt', label: 'Activated At', type: 'text', readOnly: true, column: false },
    { key: 'terminatedAt', label: 'Terminated At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Scope, SLAs, escalation…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the Vendor Contracts module. The Suppliers store backs the
 * supplier-exists guard and the name snapshot the PO gate matches on.
 * (Injected, so tests run Electron-free.)
 */
export function createVendorContractModule(
  storePath: string,
  supplierStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, VENDOR_CONTRACTS_MODULE_ID, VENDOR_CONTRACT_KIND);
  return defineEnterpriseModule({
    descriptor: VENDOR_CONTRACT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(VENDOR_CONTRACT_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Terminated contracts are commercial history — immutable.
        if (str(input.fields?.terminatedAt)) {
          return {
            ok: false,
            errors: { status: 'This contract is terminated — terminated agreements are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const startDate = str(result.values.startDate).trim();
        const endDate = str(result.values.endDate).trim();
        const start = parseContractDate(startDate);
        const end = parseContractDate(endDate);
        if (start === null) errors.startDate = 'Valid-from must be a real date (YYYY-MM-DD).';
        if (end === null) errors.endDate = 'Valid-to must be a real date (YYYY-MM-DD).';
        if (start !== null && end !== null && end < start) {
          errors.endDate = 'Valid-to cannot be before valid-from.';
        }
        const noticeDays = num(result.values.renewalNoticeDays);
        if (noticeDays < 0 || noticeDays > 365 || !Number.isInteger(noticeDays)) {
          errors.renewalNoticeDays = 'Renewal notice must be a whole number of days between 0 and 365.';
        }
        const supplierRef = str(result.values.supplierRef).trim();
        const supplier = supplierStore.list().find((r) => r.id === supplierRef && r.status !== 'deleted');
        if (!supplier) {
          errors.supplierRef = 'Supplier not found — the contract must reference a real supplier record id.';
        } else {
          result.values.supplierName = str(supplier.fields.name) || supplier.title;
        }
        const contractNumber = str(result.values.contractNumber).trim();
        const duplicate = store
          .list()
          .some((r) => r.status !== 'deleted' && str(r.fields.contractNumber).trim() === contractNumber);
        if (duplicate) {
          errors.contractNumber = `A live contract numbered "${contractNumber}" already exists — contract numbers are unique.`;
        }
        // Drafted or edited records always re-enter as drafts; only ACTIVATE puts one in force.
        result.values.status = 'draft';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const state = contractWindowState(str(f.startDate), str(f.endDate), new Date().toISOString());
        const days = contractDaysRemaining(str(f.endDate), new Date().toISOString());
        const notice = Math.max(num(f.renewalNoticeDays), 0);
        const expiringSoon = str(f.status) === 'active' && state === 'open' && days !== null && days <= notice;
        return {
          moduleId: VENDOR_CONTRACTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.contractNumber)} · ${str(f.supplierName) || '—'} · ${str(f.status)}`,
          summary:
            `${str(f.supplierName) || 'Supplier'} — valid ${str(f.startDate)} → ${str(f.endDate)}` +
            (num(f.contractValue) > 0 ? `, value ${num(f.contractValue)}` : '') +
            `. Record ${str(f.status)}; window ${state}` +
            (days !== null && state === 'open' ? `, ${days} day(s) remaining` : '') +
            '.',
          risk: expiringSoon ? 'medium' : 'low',
          riskReason: expiringSoon
            ? `Inside the ${notice}-day renewal notice period — renegotiate or let it lapse deliberately.`
            : 'Contract state and window agree with how orders may rely on it.',
          executiveExplanation:
            'Active vendor contracts with an open validity window can govern purchase-order approval — orders that name a closed or foreign contract are refused.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const f = record.fields;
        if (action === ACTIVATE_CONTRACT_ACTION) {
          if (str(f.status) !== 'draft') {
            return { ok: false, error: `Only a draft can be activated — this contract is ${str(f.status)}.` };
          }
          const state = contractWindowState(str(f.startDate), str(f.endDate), actionCtx.now());
          if (state === 'expired') {
            return {
              ok: false,
              error: `This contract's window already expired on ${str(f.endDate)} — activating dead paper is refused. Extend the dates first.`,
            };
          }
          if (state === 'invalid') {
            return { ok: false, error: 'This contract has an invalid validity window — fix the dates first.' };
          }
          store.update(record.id, {
            fields: { status: 'active', activatedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message:
              state === 'pending'
                ? `Contract ${str(f.contractNumber)} activated — in force from ${str(f.startDate)}.`
                : `Contract ${str(f.contractNumber)} activated — in force now through ${str(f.endDate)}.`,
          };
        }
        if (action === TERMINATE_CONTRACT_ACTION) {
          if (str(f.status) !== 'active') {
            return { ok: false, error: `Only an active contract can be terminated — this one is ${str(f.status)}.` };
          }
          store.update(record.id, {
            fields: { status: 'terminated', terminatedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: `Contract ${str(f.contractNumber)} terminated — orders can no longer rely on it. This is final.`,
          };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
