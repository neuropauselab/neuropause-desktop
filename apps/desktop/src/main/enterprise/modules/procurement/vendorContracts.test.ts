/**
 * Procurement → FW-7 Vendor Contracts — the pure contract-window engine
 * (inclusive validity windows, days-remaining, the PO gate decision) and the
 * cross-module proof: PO approval requires the named contract to be live,
 * human-activated, inside its window on the approval date, and for the same
 * supplier — refusing dangling/draft/terminated/expired/foreign contracts
 * with the reason, while contract-less orders behave exactly as before FW-7.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  contractDaysRemaining,
  contractWindowState,
  evaluateContractGate,
} from '@neuropause/shared';
import { createSupplierModule } from './supplierModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import {
  ACTIVATE_CONTRACT_ACTION,
  TERMINATE_CONTRACT_ACTION,
  createVendorContractModule,
} from './vendorContractModule';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';

const T0 = '2026-08-07T10:00:00.000Z';

// ── Pure engine ────────────────────────────────────────────────────────────

describe('Contract-window engine (pure)', () => {
  it('window state: strict dates, inclusive bounds, honest invalids', () => {
    expect(contractWindowState('2026-01-01', '2026-12-31', T0)).toBe('open');
    expect(contractWindowState('2026-08-07', '2026-12-31', T0)).toBe('open'); // starts today — inclusive
    expect(contractWindowState('2026-01-01', '2026-08-07', T0)).toBe('open'); // ends today — inclusive
    expect(contractWindowState('2026-09-01', '2027-08-31', T0)).toBe('pending');
    expect(contractWindowState('2025-01-01', '2025-12-31', T0)).toBe('expired');
    expect(contractWindowState('2026-12-31', '2026-01-01', T0)).toBe('invalid'); // end before start
    expect(contractWindowState('2026-02-30', '2026-12-31', T0)).toBe('invalid'); // rollover date
    expect(contractDaysRemaining('2026-08-20', T0)).toBe(13);
    expect(contractDaysRemaining('junk', T0)).toBeNull();
  });

  it('the gate refuses dangling, draft, terminated, closed-window, and foreign contracts — each with the reason', () => {
    const contract = (fields: Record<string, unknown>) => ({ id: 'c1', status: 'active', fields });
    const gate = (fields: Record<string, unknown>, supplierName = 'Acme Supplies') =>
      evaluateContractGate({ contractRef: 'c1', supplierName, onDate: T0, contracts: [contract(fields)] });
    const live = {
      contractNumber: 'VC-1', supplierName: 'Acme Supplies', status: 'active',
      startDate: '2026-01-01', endDate: '2026-12-31', renewalNoticeDays: 30,
    };
    // Uncontrolled and dangling.
    const none = evaluateContractGate({ contractRef: '', supplierName: 'Acme', onDate: T0, contracts: [] });
    expect(none.allowed).toBe(true);
    expect(none.controlled).toBe(false);
    const dangling = evaluateContractGate({ contractRef: 'ghost', supplierName: 'Acme', onDate: T0, contracts: [] });
    expect(dangling.allowed).toBe(false);
    expect(dangling.note).toContain('not found');
    // Record lifecycle.
    expect(gate({ ...live, status: 'draft' }).note).toContain('draft');
    expect(gate({ ...live, status: 'terminated' }).note).toContain('terminated');
    // Window.
    expect(gate({ ...live, startDate: '2026-09-01', endDate: '2027-08-31' }).note).toContain('not started');
    expect(gate({ ...live, startDate: '2025-01-01', endDate: '2025-12-31' }).note).toContain('expired');
    // Supplier identity (case-insensitive on match, refusal on true mismatch).
    expect(gate(live, 'acme supplies').allowed).toBe(true);
    const foreign = gate(live, 'Other Corp');
    expect(foreign.allowed).toBe(false);
    expect(foreign.note).toContain('its own supplier');
    // Open + covered, with expiry awareness.
    const ok = gate(live);
    expect(ok.allowed).toBe(true);
    expect(ok.daysRemaining).toBe(146);
    expect(ok.expiringSoon).toBe(false);
    const soon = gate({ ...live, endDate: '2026-08-20' });
    expect(soon.allowed).toBe(true);
    expect(soon.expiringSoon).toBe(true);
    expect(soon.note).toContain('RENEWAL DUE');
  });
});

// ── Module guards + PO integration ─────────────────────────────────────────

describe('Vendor Contracts module and the PO approval gate', () => {
  let dir: string;
  let suppliers: EnterpriseModule;
  let contracts: EnterpriseModule;
  let pos: EnterpriseModule;
  let supplierId: string;

  const ctx = (): EnterpriseModuleActionContext =>
    ({ actor: () => 'buyer', now: () => T0, emit: () => {}, moduleFor: () => null }) as unknown as EnterpriseModuleActionContext;

  const createVia = (mod: EnterpriseModule, fields: Record<string, unknown>, title: string) => {
    const v = mod.hooks.validate({ fields });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return mod.store.create({ title, fields: v.values, actor: 't', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-vc-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    suppliers = createSupplierModule(join(dir, 'suppliers.json'));
    contracts = createVendorContractModule(join(dir, 'contracts.json'), suppliers.store);
    pos = createPurchaseOrderModule(join(dir, 'pos.json'), undefined, undefined, contracts.store);
    await Promise.all([suppliers.store.load(), contracts.store.load(), pos.store.load()]);
    supplierId = createVia(suppliers, { name: 'Acme Supplies' }, 'Acme Supplies').id;
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

  const mkContract = (over: Record<string, unknown> = {}) =>
    createVia(
      contracts,
      {
        contractNumber: 'VC-1', supplierRef: supplierId, startDate: '2026-01-01', endDate: '2026-12-31',
        contractValue: 50000, paymentTerms: 'Net 30', renewalNoticeDays: 30, ...over,
      },
      'VC-1',
    );

  it('guards: real dates, ordered window, live supplier, sane notice, UNIQUE number; snapshots the supplier name', async () => {
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', supplierRef: supplierId, startDate: '2026-02-30', endDate: '2026-12-31' } }).ok).toBe(false);
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', supplierRef: supplierId, startDate: '2026-12-31', endDate: '2026-01-01' } }).ok).toBe(false);
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', supplierRef: 'ghost', startDate: '2026-01-01', endDate: '2026-12-31' } }).ok).toBe(false);
    expect(contracts.hooks.validate({ fields: { contractNumber: 'X', supplierRef: supplierId, startDate: '2026-01-01', endDate: '2026-12-31', renewalNoticeDays: 400 } }).ok).toBe(false);
    const c = mkContract();
    expect(String(c.fields.supplierName)).toBe('Acme Supplies');
    expect(String(c.fields.status)).toBe('draft'); // only ACTIVATE puts it in force
    expect(contracts.hooks.validate({ fields: { contractNumber: 'VC-1', supplierRef: supplierId, startDate: '2026-01-01', endDate: '2026-12-31' } }).ok).toBe(false); // dup number
  });

  it('lifecycle: activate (never dead paper), terminate is final and immutable', async () => {
    const c = mkContract();
    const activated = await contracts.hooks.runAction!(ACTIVATE_CONTRACT_ACTION, contracts.store.get(c.id)!, ctx());
    expect(activated.ok).toBe(true);
    expect(String(contracts.store.get(c.id)!.fields.status)).toBe('active');
    // A draft whose window already expired refuses activation.
    const dead = mkContract({ contractNumber: 'VC-DEAD', startDate: '2025-01-01', endDate: '2025-12-31' });
    const refused = await contracts.hooks.runAction!(ACTIVATE_CONTRACT_ACTION, contracts.store.get(dead.id)!, ctx());
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('expired');
    // Terminate only from active; then the record is history.
    expect((await contracts.hooks.runAction!(TERMINATE_CONTRACT_ACTION, contracts.store.get(dead.id)!, ctx())).ok).toBe(false);
    const ended = await contracts.hooks.runAction!(TERMINATE_CONTRACT_ACTION, contracts.store.get(c.id)!, ctx());
    expect(ended.ok).toBe(true);
    expect(String(contracts.store.get(c.id)!.fields.status)).toBe('terminated');
    expect(
      contracts.hooks.validate({ fields: { ...contracts.store.get(c.id)!.fields, notes: 'rewrite history' } }).ok,
    ).toBe(false); // immutable
  });

  it('PO approval: covered by an ACTIVE open contract → approved + stamped; closed/foreign/dangling → refused', async () => {
    const c = mkContract();
    await contracts.hooks.runAction!(ACTIVATE_CONTRACT_ACTION, contracts.store.get(c.id)!, ctx());
    const po = createVia(pos, { poNumber: 'PO-1', supplier: 'Acme Supplies', subtotal: 1000, contractRef: c.id }, 'PO-1');
    const ok = await pos.hooks.runAction!('approve', pos.store.get(po.id)!, ctx());
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    expect(String(pos.store.get(po.id)!.fields.status)).toBe('approved');
    expect(String(pos.store.get(po.id)!.fields.contractCheck)).toContain('Covered by vendor contract VC-1');
    // Terminate the contract → the next order can no longer rely on it.
    await contracts.hooks.runAction!(TERMINATE_CONTRACT_ACTION, contracts.store.get(c.id)!, ctx());
    const po2 = createVia(pos, { poNumber: 'PO-2', supplier: 'Acme Supplies', subtotal: 1000, contractRef: c.id }, 'PO-2');
    const refused = await pos.hooks.runAction!('approve', pos.store.get(po2.id)!, ctx());
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('terminated');
    expect(String(pos.store.get(po2.id)!.fields.status)).toBe('draft'); // unchanged
    // Foreign supplier and dangling ref refuse with the reason.
    const other = createVia(pos, { poNumber: 'PO-3', supplier: 'Other Corp', subtotal: 10, contractRef: c.id }, 'PO-3');
    expect((await pos.hooks.runAction!('approve', pos.store.get(other.id)!, ctx())).ok).toBe(false);
    const ghost = createVia(pos, { poNumber: 'PO-4', supplier: 'Acme Supplies', subtotal: 10, contractRef: 'ghost' }, 'PO-4');
    const dangling = await pos.hooks.runAction!('approve', pos.store.get(ghost.id)!, ctx());
    expect(dangling.ok).toBe(false);
    expect(dangling.error).toContain('not found');
  });

  it('no contractRef = uncontrolled approval, exactly as before FW-7', async () => {
    const po = createVia(pos, { poNumber: 'PO-9', supplier: 'Anyone', subtotal: 5000 }, 'PO-9');
    const res = await pos.hooks.runAction!('approve', pos.store.get(po.id)!, ctx());
    expect(res.ok).toBe(true);
    expect(String(pos.store.get(po.id)!.fields.contractCheck ?? '')).toBe('');
  });
});
