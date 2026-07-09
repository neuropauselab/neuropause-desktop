/**
 * Procurement AI runners — bridges from suppliers / purchase orders / goods
 * receipts to the EXISTING AI pipeline. Each hands deterministic facts to the
 * model and asks only for narrative; the model never computes a total, rating, or
 * quantity. Returns null when no model is configured → deterministic fallback.
 */
import type {
  AiEngineRequest,
  AiEngineResponse,
  GoodsReceipt,
  PurchaseOrder,
  Supplier,
  SupplierHealth,
} from '@neuropause/shared';
import {
  calculateGoodsReceiptAccuracy,
  calculatePurchaseTotal,
} from '@neuropause/shared';
import type { SupplierAiNarrative } from './supplierModule';
import type { PurchaseOrderAiNarrative } from './purchaseOrderModule';
import type { GoodsReceiptAiNarrative } from './goodsReceiptModule';

export interface ProcurementAiEngine {
  run(req: AiEngineRequest): Promise<AiEngineResponse>;
}

interface Narrative {
  summary: string;
  executiveExplanation: string;
  grounded: boolean;
  model: string;
}

async function run(
  engine: ProcurementAiEngine,
  promptId: string,
  variables: Record<string, string>,
): Promise<Narrative | null> {
  const res = await engine.run({ worker: 'support', promptId, tier: 'fast', variables, maxOutputTokens: 380 });
  if (!res.grounded) return null;
  const data = res.data ?? {};
  const summary = typeof data.summary === 'string' && data.summary.trim() ? data.summary : res.text;
  const executiveExplanation = typeof data.executiveExplanation === 'string' ? data.executiveExplanation : '';
  if (!summary.trim()) return null;
  return { summary, executiveExplanation, grounded: true, model: res.model };
}

export async function runSupplierAi(engine: ProcurementAiEngine, supplier: Supplier, health: SupplierHealth): Promise<SupplierAiNarrative | null> {
  const facts = [
    `Company: ${supplier.name}`,
    `Contact: ${supplier.contactPerson || '(none)'}`,
    `Payment terms: ${supplier.paymentTerms || '(none)'}`,
    `Lead time: ${supplier.leadTime} days`,
    `Rating: ${supplier.vendorRating || '(unrated)'}/5`,
    `Status: ${supplier.status}`,
    `Deterministic health: ${health.level} — ${health.reason}`,
  ].join('\n');
  return run(engine, 'procurement.supplier-summary', { supplier: facts, health: health.level, healthReason: health.reason });
}

export async function runPurchaseOrderAi(engine: ProcurementAiEngine, order: PurchaseOrder): Promise<PurchaseOrderAiNarrative | null> {
  const facts = [
    `PO number: ${order.poNumber}`,
    `Supplier: ${order.supplier || '(none)'}`,
    `Product: ${order.product || '(none)'}`,
    `Quantity: ${order.quantity}`,
    `Subtotal: ${order.subtotal} · Discount: ${order.discount} · Tax: ${order.tax}`,
    `Deterministic total: ${calculatePurchaseTotal(order)}`,
    `Budget: ${order.budget}`,
    `Status: ${order.status}`,
    `Expected delivery: ${order.expectedDelivery || '(none)'}`,
  ].join('\n');
  return run(engine, 'procurement.po-summary', { order: facts, status: order.status });
}

export async function runGoodsReceiptAi(engine: ProcurementAiEngine, receipt: GoodsReceipt): Promise<GoodsReceiptAiNarrative | null> {
  const facts = [
    `GR number: ${receipt.grNumber}`,
    `Purchase order: ${receipt.purchaseOrder || '(none)'}`,
    `Product: ${receipt.product || '(none)'}`,
    `Warehouse: ${receipt.warehouse || '(none)'}`,
    `Ordered: ${receipt.quantityOrdered} · Received: ${receipt.quantityReceived}`,
    `Deterministic accuracy: ${calculateGoodsReceiptAccuracy(receipt.quantityOrdered, receipt.quantityReceived)}%`,
    `Status: ${receipt.status}`,
    `Stock movement: ${receipt.receiptMovement || '(not posted)'}`,
  ].join('\n');
  return run(engine, 'procurement.gr-summary', { receipt: facts, status: receipt.status });
}
