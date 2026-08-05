/**
 * Finance → Credit Notes — customer-side adjustment documents on the
 * Enterprise Module Framework: a descriptor + the framework's record store + a
 * `validate` hook + `issue`/`cancel` actions + a deterministic `summarize`.
 * CRUD, RBAC (`operations:read` / `operations:manage`), audit, timeline,
 * search, offline persistence, and the entire list/detail/form UI are all
 * inherited.
 *
 * DETERMINISTIC: tax/total are computed stamps, `status` derives from the
 * action-stamped markers, the referenced invoice must resolve to exactly one
 * record, and OVER-CREDITING is refused — issued notes against one invoice can
 * never exceed its total. Issuing books Dr Sales Revenue (+ Dr Tax Payable) /
 * Cr Accounts Receivable through the shared idempotent posting seam
 * (`JE-CN-*`); cancellation reverses the booking. Invoice records themselves
 * are untouched — the note carries provenance and the BOOKS carry the truth;
 * netting credit notes into aging views is stated future work, not silently
 * approximated.
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
  CREDIT_NOTES_MODULE_ID,
  CREDIT_NOTE_KIND,
  adjustmentNoteFromRecord,
  calculateBillTax,
  calculateInvoiceAmount,
  creditNoteIssueLines,
  glCreditNoteEntryNumber,
  invoiceFromRecord,
  overAdjustmentError,
  sumIssuedNotesFor,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';
import { applyGlDerivedEntries } from './glPosting';

/** The declarative description of a credit note — drives store, CRUD, and the UI. */
export const CREDIT_NOTE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CREDIT_NOTES_MODULE_ID,
  title: 'Credit Notes',
  singular: 'Credit Note',
  plural: 'Credit Notes',
  icon: 'download',
  description: 'Customer credit notes against issued invoices — issuing books the revenue and tax reversal.',
  group: 'Finance',
  titleField: 'noteNumber',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'issue', label: 'Issue', icon: 'upload' },
    { key: 'cancel', label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'noteNumber', label: 'Note #', type: 'text', required: true, placeholder: 'CN-0001' },
    { key: 'documentRef', label: 'Invoice', type: 'text', required: true, placeholder: 'Invoice number or id' },
    { key: 'party', label: 'Customer', type: 'text', placeholder: 'Acme Inc.' },
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
        { value: 'return', label: 'Goods Returned' },
        { value: 'discount', label: 'Post-sale Discount' },
        { value: 'correction', label: 'Billing Correction' },
        { value: 'writeoff', label: 'Write-off' },
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

/** Resolve an invoice by record id or by its invoice number (payment-module rule). */
function findInvoice(invoiceStore: EnterpriseRecordStore, ref: string) {
  if (!ref) return null;
  const byId = invoiceStore.get(ref);
  if (byId && byId.status !== 'deleted') return byId;
  return invoiceStore.list().find((r) => str(r.fields.number) === ref) ?? null;
}

/** Build the Credit Notes module (invoice store injected for resolution + guards). */
export function createCreditNoteModule(
  storePath: string,
  invoiceStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CREDIT_NOTES_MODULE_ID, CREDIT_NOTE_KIND);
  return defineEnterpriseModule({
    descriptor: CREDIT_NOTE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CREDIT_NOTE_DESCRIPTOR, input);
        if (!result.ok) return result;

        // issuedAt/cancelledAt are stamped exclusively by the actions. An
        // issued note is immutable — cancel it or leave it.
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
        if (!findInvoice(invoiceStore, ref)) {
          errors.documentRef = 'No matching invoice was found.';
        }
        result.values.taxAmount = calculateBillTax(amount, Number(result.values.taxRate ?? 0));
        result.values.total = Math.round((amount + Number(result.values.taxAmount)) * 100) / 100;

        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const note = adjustmentNoteFromRecord(record);
        return {
          moduleId: CREDIT_NOTES_MODULE_ID,
          recordId: record.id,
          headline: `${note.noteNumber} · ${note.status} · ${note.currency} ${Math.round(note.total).toLocaleString('en-US')}`,
          summary: `Credit against invoice ${note.documentRef}: subtotal ${note.amount.toLocaleString('en-US')}, tax ${note.taxAmount.toLocaleString('en-US')} — ${note.status}.`,
          risk: 'low',
          riskReason: 'Adjustments are deterministic and capped at the invoice total.',
          executiveExplanation:
            'Issuing books Dr Revenue (+ Dr Tax Payable) / Cr AR, idempotently; over-crediting past the invoice total is refused. Aging views still show gross AR — netting notes into aging is stated future work.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const note = adjustmentNoteFromRecord(record);
        const self = actionCtx.moduleFor(CREDIT_NOTES_MODULE_ID);

        if (action === 'issue') {
          if (note.status !== 'draft') return { ok: false, message: `Cannot issue a ${note.status} note.` };
          const invRecord = findInvoice(invoiceStore, note.documentRef);
          if (!invRecord) return { ok: false, message: 'The referenced invoice no longer exists.' };
          const invoice = invoiceFromRecord(invRecord);
          const alreadyIssued = sumIssuedNotesFor(
            note.documentRef,
            store.list().map(adjustmentNoteFromRecord),
          );
          const overError = overAdjustmentError({
            documentTotal: calculateInvoiceAmount(invoice),
            alreadyIssued,
            noteTotal: note.total,
            documentLabel: 'invoice',
          });
          if (overError) return { ok: false, message: overError };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: glCreditNoteEntryNumber(note.noteNumber),
                memo: `Credit note ${note.noteNumber} against invoice ${note.documentRef}`,
                lines: creditNoteIssueLines(note.amount, note.taxAmount, note.total),
                sourceModule: CREDIT_NOTES_MODULE_ID,
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
          return { ok: true, message: `Credit note ${note.noteNumber} issued — revenue and tax reversal booked.` };
        }

        if (action === 'cancel') {
          if (note.status !== 'issued') return { ok: false, message: `Cannot cancel a ${note.status} note.` };
          await applyGlDerivedEntries(
            [
              {
                entryNumber: `${glCreditNoteEntryNumber(note.noteNumber)}-REV`,
                memo: `Credit note ${note.noteNumber} cancelled — reversal`,
                lines: creditNoteIssueLines(note.amount, note.taxAmount, note.total).map((l) => ({
                  account: l.account,
                  debit: l.credit,
                  credit: l.debit,
                })),
                sourceModule: CREDIT_NOTES_MODULE_ID,
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
          return { ok: true, message: `Credit note ${note.noteNumber} cancelled — booking reversed.` };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
