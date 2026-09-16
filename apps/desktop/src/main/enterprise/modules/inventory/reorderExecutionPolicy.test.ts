/**
 * S88 — Reorder governance POLICY primitives (pure decision layer). Proves the five closed decisions
 * (DECISION-REGISTER-S88) as fail-closed behavior, reusing the existing `assessReorder` engine and the
 * Session-3 deterministic-number idempotency guard. This layer creates NOTHING (no PR/PO/inventory/GL);
 * execution is a separate later gate, so there is no store/tenant/RBAC at this layer — those are the
 * governed command's job (unbuilt) and are proven blocked by reorderExecutionBoundary.test.ts (S87).
 */
import { describe, expect, it } from 'vitest';
import type { Product } from '@neuropause/shared';
import {
  REORDER_EXECUTION_PR_PREFIX,
  reorderExecutionRequestNumber,
  deriveReorderExecutionDecision,
} from './reorderExecutionPolicy';

const product = (o: Partial<Product> & { sku: string }): Product => ({
  id: o.id ?? o.sku,
  sku: o.sku,
  name: o.name ?? o.sku,
  category: o.category ?? '',
  unit: o.unit ?? 'unit',
  purchaseCost: o.purchaseCost ?? 0,
  standardCost: o.standardCost ?? 0,
  sellingPrice: o.sellingPrice ?? 0,
  reorderLevel: o.reorderLevel ?? 0,
  safetyStock: o.safetyStock ?? 0,
  maximumStock: o.maximumStock ?? 0,
  currentStock: o.currentStock ?? 0,
  reservedStock: o.reservedStock ?? 0,
  availableStock: o.availableStock ?? 0,
  status: o.status ?? 'active',
  autoReorder: o.autoReorder ?? 'off',
  createdAt: o.createdAt ?? '2026-07-01T00:00:00.000Z',
  updatedAt: o.updatedAt ?? '2026-07-01T00:00:00.000Z',
} as Product);

const REPORT = 'REORDER-DECISION-2026-07-31-1';
// availableStock 5, reorderLevel 20, safety 10, max 50 → target 50, position 5 → suggested 45
const triggered = product({ sku: 'SKU-1', availableStock: 5, reorderLevel: 20, safetyStock: 10, maximumStock: 50, purchaseCost: 4 });

describe('S88 D1 — recommendation identity (deterministic, stable, per report×sku)', () => {
  it('the same (report, sku) always maps to the same PR number; a different report differs', () => {
    expect(reorderExecutionRequestNumber(REPORT, 'SKU-1')).toBe(`${REORDER_EXECUTION_PR_PREFIX}-${REPORT}-SKU-1`);
    expect(reorderExecutionRequestNumber(REPORT, 'SKU-1')).toBe(reorderExecutionRequestNumber(REPORT, 'SKU-1'));
    expect(reorderExecutionRequestNumber('REORDER-DECISION-2026-08-31-1', 'SKU-1')).not.toBe(reorderExecutionRequestNumber(REPORT, 'SKU-1'));
    expect(reorderExecutionRequestNumber(REPORT, 'SKU-2')).not.toBe(reorderExecutionRequestNumber(REPORT, 'SKU-1'));
  });
});

describe('S88 D2/D3/D4/D5 — the pure execution decision is fail-closed', () => {
  it('EXECUTABLE when still triggered, quantity matches, and no PR exists yet', () => {
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 45, existingRequestNumbers: new Set() });
    expect(d).toMatchObject({ executable: true, status: 'executable', sku: 'SKU-1', expectedQuantity: 45, currentQuantity: 45, supplierRequired: false });
    expect(d.requestNumber).toBe(`${REORDER_EXECUTION_PR_PREFIX}-${REPORT}-SKU-1`);
  });

  it('D2 — already-drafted: one recommendation drafts at most one PR (deterministic-number guard)', () => {
    const num = reorderExecutionRequestNumber(REPORT, 'SKU-1');
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 45, existingRequestNumbers: new Set([num]) });
    expect(d).toMatchObject({ executable: false, status: 'already-drafted' });
    expect(d.reason).toMatch(/at most one purchase request/i);
  });

  it('D3 — stale-not-triggered: open supply restored the position (fail closed)', () => {
    // open supply 100 lifts position 5+100=105 > reorderLevel 20 → not triggered anymore
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 100, expectedQuantity: 45, existingRequestNumbers: new Set() });
    expect(d).toMatchObject({ executable: false, status: 'stale-not-triggered' });
    expect(d.reason).toMatch(/stale/i);
  });

  it('D3/D4 — stale-quantity-changed: the live recommended quantity differs from the report (fail closed)', () => {
    // still triggered, but the report row expected 30 while live assessReorder now suggests 45
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 30, existingRequestNumbers: new Set() });
    expect(d).toMatchObject({ executable: false, status: 'stale-quantity-changed', currentQuantity: 45, expectedQuantity: 30 });
  });

  it('not-required when the row recommended no reorder (expectedQuantity ≤ 0)', () => {
    const ok = product({ sku: 'SKU-9', availableStock: 400, reorderLevel: 20 });
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: ok, openSupply: 0, expectedQuantity: 0, existingRequestNumbers: new Set() });
    expect(d).toMatchObject({ executable: false, status: 'not-required' });
  });

  it('D4 — quantity is immutable: executable ONLY when currentQuantity === expectedQuantity', () => {
    const match = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 45, existingRequestNumbers: new Set() });
    expect(match.executable).toBe(true);
    for (const q of [1, 44, 46, 1000]) {
      const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: q, existingRequestNumbers: new Set() });
      expect(d.executable).toBe(false); // any mismatch fails closed — never an override
    }
  });

  it('D5 — a reorder decision never requires or carries a supplier', () => {
    const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 45, existingRequestNumbers: new Set() });
    expect(d.supplierRequired).toBe(false);
    expect(Object.keys(d)).not.toContain('supplier');
  });

  it('fail-closed invariant: executable is true for exactly the "executable" status and no other', () => {
    const cases = [
      { expectedQuantity: 45, openSupply: 0, existing: new Set<string>() }, // executable
      { expectedQuantity: 45, openSupply: 0, existing: new Set([reorderExecutionRequestNumber(REPORT, 'SKU-1')]) }, // already-drafted
      { expectedQuantity: 45, openSupply: 100, existing: new Set<string>() }, // stale-not-triggered
      { expectedQuantity: 30, openSupply: 0, existing: new Set<string>() }, // stale-quantity-changed
      { expectedQuantity: 0, openSupply: 0, existing: new Set<string>() }, // not-required
    ];
    for (const c of cases) {
      const d = deriveReorderExecutionDecision({ reportNumber: REPORT, product: triggered, openSupply: c.openSupply, expectedQuantity: c.expectedQuantity, existingRequestNumbers: c.existing });
      expect(d.executable).toBe(d.status === 'executable');
    }
  });

  it('pure + deterministic: identical inputs → identical decision', () => {
    const args = { reportNumber: REPORT, product: triggered, openSupply: 0, expectedQuantity: 45, existingRequestNumbers: new Set<string>() };
    expect(JSON.stringify(deriveReorderExecutionDecision(args))).toBe(JSON.stringify(deriveReorderExecutionDecision(args)));
  });
});
