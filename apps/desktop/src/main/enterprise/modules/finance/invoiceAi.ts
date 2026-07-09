/**
 * Invoice AI runner — the bridge from an invoice to the EXISTING AI pipeline
 * (`aiEngine.run` with a versioned prompt). It hands the deterministic facts +
 * computed risk to the model and asks only for narrative; the model never sets
 * the risk band. Returns null when no model is configured or the call is empty,
 * so the module falls back to the deterministic summary.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  FinanceInvoice,
  InvoiceRisk,
} from '@neuropause/shared';
import {
  calculateCollectionRisk,
  calculateInvoiceAmount,
  calculateOutstandingBalance,
  calculatePaymentStatus,
  formatInvoiceAmount,
  invoiceStatusLabel,
} from '@neuropause/shared';
import type { InvoiceAiNarrative } from './invoiceModule';

/** The slice of the AI engine this module needs (keeps it decoupled + testable). */
export interface InvoiceAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

export async function runInvoiceAi(
  engine: InvoiceAiEngine,
  invoice: FinanceInvoice,
  risk: InvoiceRisk,
): Promise<InvoiceAiNarrative | null> {
  const nowMs = Date.now();
  const facts = [
    `Number: ${invoice.number}`,
    `Customer: ${invoice.customer || '(none)'}`,
    `Subtotal: ${formatInvoiceAmount(invoice.amount, invoice.currency)}`,
    `Total (incl. tax): ${formatInvoiceAmount(calculateInvoiceAmount(invoice), invoice.currency)}`,
    `Amount paid: ${formatInvoiceAmount(invoice.amountPaid, invoice.currency)}`,
    `Outstanding: ${formatInvoiceAmount(calculateOutstandingBalance(invoice), invoice.currency)}`,
    `Stored status: ${invoiceStatusLabel(invoice.status)}`,
    `Effective status: ${invoiceStatusLabel(calculatePaymentStatus(invoice, nowMs))}`,
    `Source order: ${invoice.sourceOrder || '(none)'}`,
    `Issued: ${invoice.issueDate ?? '(none)'}`,
    `Due: ${invoice.dueDate ?? '(none)'}`,
    `Deterministic collection risk: ${calculateCollectionRisk(invoice, nowMs)}/100`,
    `Deterministic risk band: ${risk.level} — ${risk.reason}`,
  ].join('\n');

  const res = await engine.run({
    worker: 'finance',
    promptId: 'finance.invoice-summary',
    tier: 'fast',
    variables: { invoice: facts, risk: risk.level, riskReason: risk.reason },
    maxOutputTokens: 400,
  });

  // No real model ran (unconfigured / error) → let the deterministic fallback win.
  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation =
    typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}
