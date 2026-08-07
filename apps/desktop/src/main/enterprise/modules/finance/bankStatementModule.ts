/**
 * Finance → Bank Statements — imported bank statements + deterministic
 * reconciliation on the Enterprise Module Framework: a descriptor + the
 * framework's record store + a `validate` hook + a `reconcile`/`finalize`
 * action pair + a deterministic `summarize`. CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * A statement is imported as a record whose `lines` field carries the bank rows
 * (JSON textarea, the BOM/journal convention). RECONCILE runs the pure matching
 * engine against CLEARED customer payments — exact reference first, then unique
 * amount±3-day window; ambiguity stays UNMATCHED (never guessed, never
 * auto-cleared) and withdrawals stay unmatched until the vendor-payment side
 * exists. Reconcile is idempotent and re-runnable while the statement is open;
 * FINALIZE locks the statement (immutable snapshot, the period-close pattern)
 * and — FW-8 — WRITES BACK: each matched payment is stamped bankReconciledAt +
 * bankStatementRef from the stored (human-reviewed) matches, becomes immutable,
 * and never competes as a match candidate again.
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
  BANK_STATEMENTS_MODULE_ID,
  BANK_STATEMENT_KIND,
  PAYMENTS_MODULE_ID,
  matchBankStatement,
  parseBankStatementLines,
  paymentFromRecord,
  validateEnterpriseRecordInput,
  type BankMatchCandidate,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a bank statement — drives store, CRUD, and the UI. */
export const BANK_STATEMENT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: BANK_STATEMENTS_MODULE_ID,
  title: 'Bank Statements',
  singular: 'Bank Statement',
  plural: 'Bank Statements',
  icon: 'database',
  description: 'Imported bank statements reconciled against cleared payments — unmatched lines stay visible, never guessed.',
  group: 'Finance',
  titleField: 'statementNumber',
  // Reuses the certified Finance scopes: any member can read, managers+ can write.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: 'reconcile', label: 'Reconcile', icon: 'upload' },
    { key: 'finalize', label: 'Finalize', icon: 'close' },
  ],
  fields: [
    { key: 'statementNumber', label: 'Statement #', type: 'text', required: true, placeholder: 'STMT-2026-08' },
    { key: 'bankAccount', label: 'Bank Account', type: 'text', required: true, placeholder: 'HDFC ****1234' },
    { key: 'statementDate', label: 'Statement Date', type: 'date', format: 'date' },
    {
      key: 'lines',
      label: 'Statement Lines (JSON)',
      type: 'textarea',
      required: true,
      column: false,
      help: 'JSON array: [{"date":"2026-08-01","description":"NEFT CR","reference":"TXN123","amount":118}] — deposits positive, withdrawals negative.',
      placeholder: '[{"date":"2026-08-01","description":"NEFT CR","reference":"TXN123","amount":118}]',
    },
    { key: 'lineCount', label: 'Lines', type: 'number', readOnly: true, default: 0 },
    { key: 'matchedCount', label: 'Matched', type: 'number', readOnly: true, default: 0 },
    { key: 'unmatchedCount', label: 'Unmatched', type: 'number', readOnly: true, default: 0 },
    { key: 'matchedAmount', label: 'Matched Amt', type: 'number', readOnly: true, format: 'currency', default: 0, column: false },
    { key: 'unmatchedAmount', label: 'Unmatched Amt', type: 'number', readOnly: true, format: 'currency', default: 0 },
    { key: 'matches', label: 'Match Results (JSON)', type: 'textarea', readOnly: true, column: false },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'imported',
      badge: true,
      filterable: true,
      options: [
        { value: 'imported', label: 'Imported', tone: 'neutral' },
        { value: 'reconciled', label: 'Reconciled', tone: 'blue' },
        { value: 'finalized', label: 'Finalized', tone: 'green' },
      ],
    },
    { key: 'finalizedAt', label: 'Finalized At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Bank Statements module. The payment store is injected (the
 * Payments ← invoice-store pattern) so reconciliation reads real cleared
 * payments.
 */
export function createBankStatementModule(
  storePath: string,
  paymentStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, BANK_STATEMENTS_MODULE_ID, BANK_STATEMENT_KIND);

  const clearedCandidates = (): BankMatchCandidate[] =>
    paymentStore
      .list()
      // FW-8: a payment already bank-reconciled by a FINALIZED statement is
      // evidenced exactly once — it never competes as a candidate again.
      .filter((r) => !str(r.fields.bankReconciledAt))
      .map(paymentFromRecord)
      .filter((p) => p.status === 'cleared')
      .map((p) => ({
        paymentNumber: p.paymentNumber,
        amount: p.amount,
        receivedDate: p.receivedDate ?? '',
        transactionRef: p.transactionRef ?? '',
      }));

  return defineEnterpriseModule({
    descriptor: BANK_STATEMENT_DESCRIPTOR,
    store,
    hooks: {
      // Deterministic guards: parseable lines, derived status, and finalized
      // statements immutable through the validated update path.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(BANK_STATEMENT_DESCRIPTOR, input);
        if (!result.ok) return result;

        // finalizedAt is stamped exclusively by the `finalize` action. Reaching
        // validate WITH one means an edit of a finalized statement — refused.
        if (str(result.values.finalizedAt)) {
          return {
            ok: false,
            errors: { _: 'Finalized statements are immutable — import a new statement instead.' },
            values: result.values,
          };
        }

        const parsed = parseBankStatementLines(str(result.values.lines));
        if (!parsed.ok) {
          return { ok: false, errors: { lines: parsed.error }, values: result.values };
        }
        result.values.lines = JSON.stringify(parsed.lines);
        result.values.lineCount = parsed.lines.length;
        // Editing lines invalidates any earlier match results — back to imported.
        result.values.status = 'imported';
        result.values.matchedCount = 0;
        result.values.unmatchedCount = parsed.lines.length;
        result.values.matchedAmount = 0;
        result.values.unmatchedAmount = parsed.lines.reduce((s, l) => s + l.amount, 0);
        result.values.matches = '';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const unmatched = Number(f.unmatchedCount ?? 0);
        const status = str(f.status);
        return {
          moduleId: BANK_STATEMENTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.statementNumber)} · ${str(f.bankAccount)} · ${Number(f.matchedCount ?? 0)}/${Number(f.lineCount ?? 0)} matched`,
          summary:
            status === 'imported'
              ? `${Number(f.lineCount ?? 0)} line(s) imported and not yet reconciled.`
              : `${Number(f.matchedCount ?? 0)} of ${Number(f.lineCount ?? 0)} line(s) matched cleared payments; ${unmatched} unmatched (${Number(f.unmatchedAmount ?? 0).toLocaleString('en-US')}).`,
          risk: status !== 'imported' && unmatched > 0 ? 'medium' : 'low',
          riskReason:
            status === 'imported'
              ? 'Not yet reconciled.'
              : unmatched > 0
                ? 'Unmatched lines need manual review — they are surfaced, never auto-cleared.'
                : 'Every line matched a cleared payment.',
          executiveExplanation:
            'Matching is deterministic: exact reference first, then a unique amount within ±3 days; ambiguity stays unmatched. Withdrawals reconcile once the vendor-payment side exists.',
          grounded: false,
          model: 'none',
        };
      },
      // Lifecycle actions — reconcile (idempotent, re-runnable) / finalize (lock).
      runAction: async (action, record, actionCtx) => {
        const status = str(record.fields.status);

        if (action === 'reconcile') {
          if (status === 'finalized') {
            return { ok: false, message: 'This statement is finalized — import a new one to reconcile again.' };
          }
          const parsed = parseBankStatementLines(str(record.fields.lines));
          if (!parsed.ok) return { ok: false, error: parsed.error };
          await paymentStore.load();
          const result = matchBankStatement(parsed.lines, clearedCandidates());
          const updated = store.update(record.id, {
            fields: {
              status: 'reconciled',
              matchedCount: result.summary.matchedCount,
              unmatchedCount: result.summary.unmatchedCount,
              matchedAmount: result.summary.matchedAmount,
              unmatchedAmount: result.summary.unmatchedAmount,
              matches: JSON.stringify(result.lines),
            },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Statement not found.' };
          const self = actionCtx.moduleFor(BANK_STATEMENTS_MODULE_ID);
          if (self) actionCtx.emit(self, 'updated', updated);
          return {
            ok: true,
            message: `Reconciled: ${result.summary.matchedCount} matched, ${result.summary.unmatchedCount} unmatched.`,
          };
        }

        if (action === 'finalize') {
          if (status === 'finalized') return { ok: false, message: 'Already finalized.' };
          if (status !== 'reconciled') {
            return { ok: false, message: 'Reconcile the statement before finalizing it.' };
          }
          // FW-8 (write-back): finalizing turns the reviewed matches into bank
          // EVIDENCE on the payments themselves — each matched payment is
          // stamped bankReconciledAt + bankStatementRef, becomes immutable,
          // and stops competing as a candidate for future statements. The
          // stamps come from the STORED matches (exactly what the human
          // reviewed), never a fresh re-match.
          let stamped = 0;
          let skipped = 0;
          const statementNumber = str(record.fields.statementNumber);
          try {
            const matchedNumbers = (JSON.parse(str(record.fields.matches) || '[]') as Array<{ paymentNumber?: unknown }>)
              .map((l) => str(l.paymentNumber))
              .filter((n) => n !== '');
            await paymentStore.load();
            const paymentsModule = actionCtx.moduleFor(PAYMENTS_MODULE_ID);
            for (const paymentNumber of matchedNumbers) {
              const payment = paymentStore
                .list()
                .find((r) => r.status !== 'deleted' && str(r.fields.paymentNumber) === paymentNumber);
              // Vanished since reconcile, or already evidenced by another
              // statement — skipped and SAID, never silently restamped.
              if (!payment || str(payment.fields.bankReconciledAt)) {
                skipped += 1;
                continue;
              }
              const stampedPayment = paymentStore.update(payment.id, {
                fields: { bankReconciledAt: actionCtx.now(), bankStatementRef: statementNumber },
                actor: actionCtx.actor(),
                now: actionCtx.now(),
              });
              if (stampedPayment) {
                stamped += 1;
                if (paymentsModule) actionCtx.emit(paymentsModule, 'updated', stampedPayment);
              }
            }
          } catch {
            return { ok: false, error: 'Stored match results are unreadable — re-run Reconcile, then finalize.' };
          }
          const updated = store.update(record.id, {
            fields: { status: 'finalized', finalizedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          if (!updated) return { ok: false, error: 'Statement not found.' };
          const self = actionCtx.moduleFor(BANK_STATEMENTS_MODULE_ID);
          if (self) actionCtx.emit(self, 'updated', updated);
          return {
            ok: true,
            message:
              `Statement ${statementNumber} finalized — ${stamped} payment(s) stamped as bank-reconciled` +
              (skipped > 0 ? `; ${skipped} match(es) skipped (payment missing or already evidenced elsewhere)` : '') +
              '.',
          };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
