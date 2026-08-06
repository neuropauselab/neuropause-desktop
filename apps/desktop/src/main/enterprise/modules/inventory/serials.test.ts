import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialCodePayload, serialFromRecord, serialRuntimeState, type EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createProductModule } from './productModule';
import { createSerialModule } from './serialModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('Serial domain rules (pure)', () => {
  it('derives state from markers (scrap wins over issue) and encodes a deterministic payload', () => {
    const base = { id: 's', serialNumber: 'SN-1', product: 'SKU-1', warehouse: 'WH-01', lotRef: '', receiptRef: '', issuedTo: '', codePayload: '', createdAt: T0, updatedAt: T0 };
    expect(serialRuntimeState({ ...base, issuedAt: null, scrappedAt: null })).toBe('in_stock');
    expect(serialRuntimeState({ ...base, issuedAt: T0, scrappedAt: null })).toBe('issued');
    expect(serialRuntimeState({ ...base, issuedAt: T0, scrappedAt: T0 })).toBe('scrapped'); // scrap wins
    expect(serialCodePayload({ serialNumber: 'SN-1', product: 'SKU-1', warehouse: 'WH-01' })).toBe('{"sn":"SN-1","sku":"SKU-1","wh":"WH-01"}');
  });
});

describe('Serial module over real stores — lifecycle, guards, duplicate detection', () => {
  let dir: string;
  let products: EnterpriseModule;
  let serials: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-serial-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    products = createProductModule(join(dir, 'products.json'));
    serials = createSerialModule(join(dir, 'serials.json'), products.store);
    await Promise.all([products.store.load(), serials.store.load()]);
    products.store.create({ title: 'Widget', fields: { sku: 'SKU-1', name: 'Widget' }, actor: 't@np', now: T0 });
    ctx = { actor: () => 't@np', now: () => T0, authorize: () => undefined, moduleFor: () => null, emit: () => undefined };
  });

  afterEach(async () => {
    await Promise.all([products.store.flush(), serials.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const make = (fields: Record<string, unknown>): EnterpriseEntity => {
    const v = serials.hooks.validate({ fields: { serialNumber: `SN-${randomUUID().slice(0, 5)}`, product: 'SKU-1', warehouse: 'WH-01', ...fields } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return serials.store.create({ title: String(v.values.serialNumber), fields: v.values, actor: 't@np', now: T0 });
  };

  it('creates in-stock with a stamped payload, refuses unknown SKUs', () => {
    const rec = make({ serialNumber: 'SN-100' });
    expect(rec.fields.status).toBe('in_stock');
    expect(String(rec.fields.codePayload)).toContain('"sn":"SN-100"');
    expect(serials.hooks.validate({ fields: { serialNumber: 'SN-X', product: 'SKU-404', warehouse: 'WH-01' } }).ok).toBe(false);
  });

  it('issue → return → issue → scrap, with the right guards at each step', async () => {
    const rec = make({ serialNumber: 'SN-200', issuedTo: 'WO-42' });
    // Return before issue is refused.
    expect((await serials.hooks.runAction!('return', rec, ctx)).ok).toBe(false);
    const issued = await serials.hooks.runAction!('issue', rec, ctx);
    expect(issued.ok, issued.ok ? '' : issued.error).toBe(true);
    if (issued.ok) expect(String(issued.message)).toContain('WO-42');
    let cur = serials.store.get(rec.id)!;
    expect(cur.fields.status).toBe('issued');
    expect(serialRuntimeState(serialFromRecord(cur))).toBe('issued');
    // Double-issue refused.
    expect((await serials.hooks.runAction!('issue', cur, ctx)).ok).toBe(false);
    // Return clears the issue back to stock.
    expect((await serials.hooks.runAction!('return', cur, ctx)).ok).toBe(true);
    cur = serials.store.get(rec.id)!;
    expect(cur.fields.status).toBe('in_stock');
    expect(cur.fields.issuedAt).toBe('');
    expect(cur.fields.issuedTo).toBe('');
    // Scrap is terminal — record immutable, further actions refused.
    expect((await serials.hooks.runAction!('scrap', cur, ctx)).ok).toBe(true);
    cur = serials.store.get(rec.id)!;
    expect(cur.fields.status).toBe('scrapped');
    expect(serials.hooks.validate({ fields: { ...cur.fields, warehouse: 'WH-02' } }).ok).toBe(false);
    expect((await serials.hooks.runAction!('issue', cur, ctx)).ok).toBe(false);
  });

  it('flags duplicate serial numbers as a high risk (uniqueness cannot be hard-enforced at validate)', async () => {
    const a = make({ serialNumber: 'SN-DUP' });
    make({ serialNumber: 'SN-DUP' }); // same number, same product — a genuine duplicate
    const summary = await serials.hooks.summarize!(serials.store.get(a.id)!);
    expect(summary.risk).toBe('high');
    expect(String(summary.summary)).toContain('share this serial number');
  });
});
