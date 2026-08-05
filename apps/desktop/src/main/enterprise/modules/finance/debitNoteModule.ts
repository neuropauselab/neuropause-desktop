/**
 * Finance → Debit Notes — vendor-side adjustment documents on the Enterprise
 * Module Framework, the exact mirror of Credit Notes: a descriptor + the
 * framework's record store + a `validate` hook + `issue`/`cancel` actions + a
 * deterministic `summarize`. CRUD, RBAC, audit, timeline, search, offline
 * persistence, and the UI are all inherited.
 *
 * DETERMINISTIC: tax/total are computed stamps, `status` derives from the
 * action-stamped markers, the referenced vendor bill must resolve to exactly
 * one record, and OVER-DEBITING is refused — issued notes against one bill can
 * never exceed its total. Issuing books Dr Accounts Payable / Cr Operating
 * Expense (+ Cr GST Input Credit) through the shared idempotent posting seam
 * (`JE-DN-*`); cancellation reverses the booking.
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
  DEBIT_NOTES_MODULE_ID,
  DEBIT_NOTE_KIND,
  adjustmentNoteFromRecord,
  calculateBillTax,
  debitNoteIssueLines,
  glDebitNoteEntryNumber,
  overAdjustmentError,
  sumIssuedNotesFor,
  validateEnterpriseRecordInput,
  vendorBillFromRecord,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { applyGlDerivedEntries } from './glPosting';

/** The declarative description of a debit note — drives store, CRUD, and the UI. */
export const DEBIT_NOTE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: DEBIT_NOTES_MODULE_ID,
  title: 'Debit Notes',
  singular: 'Debit Note',
  plural: 'Debit Notes',
  icon: 'upload',
  description: 'Vendor debit notes against approved bills — issuing books the payable and input-credit reversal.',
  group: 'Finance',
  titleField: 'noteNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'issue', label: 'Issue', icon: 'upload' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'noteNumber', label: 'Note #', type: 'text', required: true, placeholder: 'DN-0001' },
    { key: 'documentRef', label: 'Vendor Bill', type: 'text', required: true, placeholder: 'Bill number or id' },
    { key: 'party', label: 'Vendor', type: 'text', placeholder: 'Supplies Co.' },
    { key: 'amount', label: 'Subtotal', type: 'number', required: true, min: 0, format: 'currency' },
    { key: 'taxRate', label: 'Tax Rate %', type: 'number', min: 0, max: 100, column: false },
    { key: 'taxAmount', label: 'Tax', type: 'number', readOnly: true, format: 'currency', column: false },
    { key: 'total', label: 'Total', type: 'number', readOnly: true, format: 'currency' },
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
    {
      key: 'reason',
      label: 'Reason',
      type: 'select',
      default: 'correction',
      filterable: true,
      column: false,
      options: [
        { value: 'return', label: 'Goods Returned to Vendor' },
        { value: 'shortage', label: 'Short Delivery' },
        { value: 'correction', label: 'Billing Correction' },
        { value: 'quality', label: 'Quality Claim' },
      ],
    },
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
        { value: 'issued', label: 'Issued', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'orange' },
      ],
    },
    { key: 'issuedAt', label: 'Issued At', type: 'text', readOnly: true, column: false },
    { key: 'cancelledAt', label: 'Cancelled At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Resolve a vendor bill by record id or by its bill number (payment-module rule). */
function findBill(billStore: EnterpriseRecordStore, ref: string) {
  if (!ref) return null;
  const byId = billStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return billStore.list().find((r) => str(r.fields.billNumber) === ref) ?? null;
}

/** Build the Debit Notes module (vendor-bill store injected for resolution + guards). */
export function createDebitNoteModule(
  storePath: string,
  billStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, DEBIT_NOTES_MODULE_ID, DEBIT_NOTE_KIND);
  return defineEnterpriseModule({
    descriptor: DEBIT_NOTE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(DEBIT_NOTE_DESCRIPTOR, input);
        if (!result.ok) return result;

        if (str(result.values.issuedAt) || str(result.values.cancelledAt)) {
          return {
            ok: false,
            errors: { _: 'Issued notes are immutable — cancel the note or draft a new one.' },
            values: result.values,
          };
        }
        result.values.status = 'draft'; // derived, never user-forged

        const errors: Record<string, string> = {};
        const amount = Number(result.values.amount ?? 0);
        if (amount <= 0) errors.amount = 'Subtotal must be greater than zero.';
        const ref = str(result.values.documentRef).trim();
        result.values.documentRef = ref;
        if (!findBill(billStore, ref)) {
          errors.documentRef = 'No matching vendor bill was found.';
        }
        result.values.taxAmount = calculateBillTax(amount, Number(result.values.taxRate ?? 0));
        result.values.total = Math.round((amount + Number(result.values.taxAmount)) * 100) / 100;

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const note = adjustmentNoteFromRecord(record);
        return {
          moduleId: DEBIT_NOTES_MODULE_ID,
          recordId: record.id,
          headline: `${note.noteNumber} · ${note.status} · ${note.currency} ${Math.round(note.total).toLocaleString('en-US')}`,
          summary: `Debit against bill ${note.documentRef}: subtotal ${note.amount.toLocaleString('en-US')}, tax ${note.taxAmount.toLocaleString('en-US')} — ${note.status}.`,
          risk: 'low',
          riskReason: 'Adjustments are deterministic and capped at the bill total.',
          executiveExplanation:
            'Issuing books Dr AP / Cr Expense (+ Cr GST Input Credit), idempotently; over-debiting past the bill total is refused.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const note = adjustmentNoteFromRecord(record);
        const self = actionCtx.moduleFor(DEBIT_NOTES_MODULE_ID);

        if (action === 'issue') {
          if (note.status !== 'draft') return { ok: false, message: `Cannot issue a ${note.status} note.` };
          const billRecord = findBill(billStore, note.documentRef);
          if (!billRecord) return { ok: false, message: 'The referenced vendor bill no longer exists.' };
          const bill = vendorBillFromRecord(billRecord);
          const alreadyIssued = sumIssuedNotesFor(
            note.documentRef,
            store.list().map(adjustmentNoteFromRecord),
          );
          const overError = overAdjustmentError({
            documentTotal: bill.total,
            alreadyIssued,
            noteTotal: note.total,
            documentLabel: 'vendor bill',
          });
          if (overError) return { ok: false, message: overError };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: glDebitNoteEntryNumber(note.noteNumber),
                memo: `Debit note ${note.noteNumber} against bill ${note.documentRef}`,
                lines: debitNoteIssueLines(note.amount, note.taxAmount, note.total),
                sourceModule: DEBIT_NOTES_MODULE_ID,
                sourceRef: record.id,
              },
            ],
            actionCtx,
          );
          const updated = store.update(record.id, {
            fields: { issuedAt: actionCtx.now(), status: 'issued' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Note not found.' };
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Debit note ${note.noteNumber} issued — payable and input-credit reversal booked.` };
        }

        if (action === 'cancel') {
          if (note.status !== 'issued') return { ok: false, message: `Cannot cancel a ${note.status} note.` };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: `${glDebitNoteEntryNumber(note.noteNumber)}-REV`,
                memo: `Debit note ${note.noteNumber} cancelled — reversal`,
                lines: debitNoteIssueLines(note.amount, note.taxAmount, note.total).map((l) => ({
                  account: l.account,
                  debit: l.credit,
                  credit: l.debit,
                })),
                sourceModule: DEBIT_NOTES_MODULE_ID,
                sourceRef: record.id,
              },
            ],
            actionCtx,
          );
          const updated = store.update(record.id, {
            fields: { cancelledAt: actionCtx.now(), status: 'cancelled' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Note not found.' };
          if (self) actionCtx.emit(self, 'updated', updated);
          return { ok: true, message: `Debit note ${note.noteNumber} cancelled — booking reversed.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
