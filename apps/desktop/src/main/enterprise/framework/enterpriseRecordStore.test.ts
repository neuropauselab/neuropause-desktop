import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseRecordStore } from './enterpriseRecordStore';
import { TEST_TENANT_SCOPE } from '../../tenancy/testScope';

const opened: EnterpriseRecordStore[] = [];
const paths: string[] = [];

function tempPath(): string {
  const p = join(tmpdir(), `np-erp-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

async function newStore(): Promise<EnterpriseRecordStore> {
  const s = new EnterpriseRecordStore(tempPath(), 'finance', 'invoice').bindScope(() => TEST_TENANT_SCOPE);
  opened.push(s);
  await s.load();
  return s;
}

afterEach(async () => {
  for (const s of opened.splice(0)) await s.flush();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const T0 = '2026-07-08T00:00:00.000Z';
const T1 = '2026-07-08T01:00:00.000Z';

describe('EnterpriseRecordStore — create', () => {
  it('assembles a canonical entity with envelope + rev 1', async () => {
    const s = await newStore();
    const rec = s.create({ title: 'INV-001', fields: { amount: 100 }, actor: 'a@np.dev', now: T0 });
    expect(rec).toMatchObject({
      moduleId: 'finance',
      kind: 'invoice',
      title: 'INV-001',
      status: 'active',
      rev: 1,
      createdAt: T0,
      updatedAt: T0,
      createdBy: 'a@np.dev',
      updatedBy: 'a@np.dev',
    });
    expect(rec.fields).toEqual({ amount: 100 });
    expect(rec.id).toMatch(/^rec_/);
  });

  it('honors an explicit id and defensively copies fields/tags/metadata', async () => {
    const s = await newStore();
    const fields = { a: 1 };
    const rec = s.create({ id: 'rec_x', title: 'T', fields, tags: ['t'], now: T0 });
    fields.a = 999;
    expect(rec.id).toBe('rec_x');
    expect(rec.fields).toEqual({ a: 1 }); // not mutated by caller
  });
});

describe('EnterpriseRecordStore — read/query', () => {
  it('lists newest-updated first and excludes deleted by default', async () => {
    const s = await newStore();
    s.create({ id: 'a', title: 'A', fields: {}, now: T0 });
    s.create({ id: 'b', title: 'B', fields: {}, now: T1 });
    s.softDelete('a', { now: T1 });
    const list = s.list();
    expect(list.map((r) => r.id)).toEqual(['b']);
  });

  it('filters by explicit status', async () => {
    const s = await newStore();
    s.create({ id: 'a', title: 'A', fields: {}, now: T0 });
    s.softDelete('a', { now: T1 });
    expect(s.list({ status: 'deleted' }).map((r) => r.id)).toEqual(['a']);
    expect(s.list({ status: 'active' })).toEqual([]);
  });

  it('search matches title/tags/field values; count respects status', async () => {
    const s = await newStore();
    s.create({
      id: 'a',
      title: 'Acme invoice',
      fields: { note: 'net-30' },
      tags: ['urgent'],
      now: T0,
    });
    s.create({ id: 'b', title: 'Beta', fields: {}, now: T0 });
    expect(s.search('acme').map((r) => r.id)).toEqual(['a']);
    expect(s.search('net-30').map((r) => r.id)).toEqual(['a']);
    expect(s.search('urgent').map((r) => r.id)).toEqual(['a']);
    expect(s.count()).toBe(2);
    expect(s.count('active')).toBe(2);
  });
});

describe('EnterpriseRecordStore — update/lifecycle', () => {
  it('merges fields, bumps rev + updatedAt + updatedBy', async () => {
    const s = await newStore();
    s.create({ id: 'a', title: 'A', fields: { x: 1, y: 2 }, actor: 'creator', now: T0 });
    const up = s.update('a', { fields: { y: 9 }, actor: 'editor', now: T1 });
    expect(up).toMatchObject({ rev: 2, updatedAt: T1, updatedBy: 'editor', createdBy: 'creator' });
    expect(up?.fields).toEqual({ x: 1, y: 9 }); // merged, not replaced
  });

  it('rejects updates to a deleted record', async () => {
    const s = await newStore();
    s.create({ id: 'a', title: 'A', fields: {}, now: T0 });
    s.softDelete('a', { now: T1 });
    expect(s.update('a', { title: 'B', now: T1 })).toBeNull();
  });

  it('enforces legal status transitions', async () => {
    const s = await newStore();
    s.create({ id: 'a', title: 'A', fields: {}, now: T0 });
    expect(s.setStatus('a', 'archived', { now: T1 })?.status).toBe('archived');
    expect(s.setStatus('a', 'active', { now: T1 })?.status).toBe('active');
    // deleted is terminal: no transition back out.
    s.setStatus('a', 'deleted', { now: T1 });
    expect(s.setStatus('a', 'active', { now: T1 })).toBeNull();
  });

  it('setStatus to the same status is a no-op that returns the record', async () => {
    const s = await newStore();
    const rec = s.create({ id: 'a', title: 'A', fields: {}, now: T0 });
    expect(s.setStatus('a', 'active', { now: T1 })).toBe(rec);
  });
});

describe('EnterpriseRecordStore — persistence', () => {
  it('round-trips through disk (atomic write + reload)', async () => {
    const path = tempPath();
    const s1 = new EnterpriseRecordStore(path, 'finance', 'invoice').bindScope(() => TEST_TENANT_SCOPE);
    await s1.load();
    s1.create({ id: 'a', title: 'Persisted', fields: { amount: 42 }, now: T0 });
    await s1.flush();

    const s2 = new EnterpriseRecordStore(path, 'finance', 'invoice').bindScope(() => TEST_TENANT_SCOPE);
    await s2.load();
    const rec = s2.get('a');
    expect(rec?.title).toBe('Persisted');
    expect(rec?.fields).toEqual({ amount: 42 });
    await fs.rm(path, { force: true }).catch(() => undefined);
  });
});
