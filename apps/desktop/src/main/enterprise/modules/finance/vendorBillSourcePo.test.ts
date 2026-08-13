/**
 * Phase 9 (certification fix) — the vendor bill's source-PO field was declared
 * readOnly with no writer anywhere: permanently empty, severing the PO↔bill
 * audit trail. It is now human-writable and guarded — a named source PO must
 * resolve to a REAL purchase order (record id or PO number); empty stays valid;
 * without the injected store, prior behavior is untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createVendorBillModule } from './vendorBillModule';
import { createPurchaseOrderModule } from '../procurement/purchaseOrderModule';
import type { EnterpriseModule } from '../../framework';

let dir: string;
let pos: EnterpriseModule;
let bills: EnterpriseModule;

beforeEach(async () => {
  dir = join(tmpdir(), `np-billpo-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  pos = createPurchaseOrderModule(join(dir, 'pos.json'));
  await pos.store.load();
  bills = createVendorBillModule(join(dir, 'bills.json'), pos.store);
  await bills.store.load();
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 25));
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    await new Promise((r) => setTimeout(r, 100));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const BILL = { billNumber: 'VB-1', vendor: 'Acme', amount: 100 };

describe('vendor bill source-PO linkage (Phase 9)', () => {
  it('refuses a dangling PO reference; accepts real id or PO number; empty stays valid', async () => {
    const ghost = bills.hooks.validate({ fields: { ...BILL, sourcePurchaseOrder: 'PO-GHOST' } });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(JSON.stringify(ghost.errors)).toContain('No purchase order');

    const pv = pos.hooks.validate({ fields: { poNumber: 'PO-77', supplier: 'Acme', subtotal: 100 } });
    if (!pv.ok) throw new Error(JSON.stringify(pv.errors));
    const po = pos.store.create({ title: 'PO-77', fields: pv.values, actor: 't', now: '2026-08-07T00:00:00.000Z' });

    expect(bills.hooks.validate({ fields: { ...BILL, sourcePurchaseOrder: po.id } }).ok).toBe(true);
    expect(bills.hooks.validate({ fields: { ...BILL, sourcePurchaseOrder: 'PO-77' } }).ok).toBe(true);
    expect(bills.hooks.validate({ fields: { ...BILL } }).ok).toBe(true);
  });

  it('without the injected store, prior behavior is untouched (additive-optional proof)', async () => {
    const legacy = createVendorBillModule(join(dir, 'legacy.json'));
    await legacy.store.load();
    expect(legacy.hooks.validate({ fields: { ...BILL, sourcePurchaseOrder: 'ANYTHING' } }).ok).toBe(true);
  });
});
