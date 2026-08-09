/**
 * Phase 6 — cross-domain relationship engine tests.
 *
 * The properties that matter here are the ones a plausible-looking
 * implementation gets wrong: prefix collisions, silent disambiguation of two
 * equally-good candidates, similarity matching on money, and import order.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnterpriseModuleDescriptor } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { RelationshipEngine } from './relationshipEngine';
import { RelationshipStore } from './relationshipStore';
import { TargetIndex, normalizeRefValue, resolveReference } from './relationshipResolver';
import {
  RELATIONSHIPS,
  RELATIONSHIP_CHAINS,
  assertRelationshipsAreDeclarable,
  relationshipByKey,
  relationshipsFrom,
  relationshipsTo,
} from './relationshipModel';

const T0 = '2026-08-09T09:00:00.000Z';

let dir: string;
let stores: Map<string, EnterpriseRecordStore>;
let relStore: RelationshipStore;
let engine: RelationshipEngine;
let audit: { action: string; target: string; summary: string }[];

const DESCRIPTORS: EnterpriseModuleDescriptor[] = [
  {
    id: 'crm-customers',
    title: 'Customers',
    singular: 'Customer',
    plural: 'Customers',
    icon: 'user',
    description: '',
    fields: [
      { key: 'name', label: 'Customer Name', type: 'text', required: true },
      { key: 'customerCode', label: 'Customer Code', type: 'text' },
    ],
    titleField: 'name',
    permissions: { read: 'crm:read', write: 'crm:manage' },
  },
  {
    id: 'finance-invoices',
    title: 'Invoices',
    singular: 'Invoice',
    plural: 'Invoices',
    icon: 'doc',
    description: '',
    fields: [
      { key: 'number', label: 'Invoice #', type: 'text', required: true },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'sourceOrder', label: 'Source Order', type: 'text' },
    ],
    titleField: 'number',
    permissions: { read: 'operations:read', write: 'operations:manage' },
  },
  {
    id: 'finance-payments',
    title: 'Payments',
    singular: 'Payment',
    plural: 'Payments',
    icon: 'doc',
    description: '',
    fields: [
      { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true },
      { key: 'invoiceRef', label: 'Invoice', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
    ],
    titleField: 'paymentNumber',
    permissions: { read: 'operations:read', write: 'operations:manage' },
  },
];

function store(moduleId: string, kind: string): EnterpriseRecordStore {
  const s = new EnterpriseRecordStore(join(dir, `${moduleId}.json`), moduleId, kind);
  stores.set(moduleId, s);
  return s;
}

async function add(
  moduleId: string,
  title: string,
  fields: Record<string, string | number | boolean | null>,
): Promise<string> {
  const s = stores.get(moduleId);
  if (!s) throw new Error(`no store for ${moduleId}`);
  await s.load();
  const rec = s.create({ title, fields, actor: 'test', now: T0 });
  await s.flush();
  return rec.id;
}

async function records(moduleId: string): Promise<ReturnType<EnterpriseRecordStore['list']>> {
  const s = stores.get(moduleId);
  if (!s) throw new Error(`no store for ${moduleId}`);
  await s.load();
  return s.list();
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), `np-rel-${randomUUID()}-`));
  stores = new Map();
  audit = [];
  store('crm-customers', 'customer');
  store('finance-invoices', 'invoice');
  store('finance-payments', 'payment');
  store('sales-orders', 'order');
  relStore = new RelationshipStore(join(dir, 'relationships.json'));
  await relStore.load();
  engine = new RelationshipEngine({
    store: relStore,
    storeFor: (id) => stores.get(id) ?? null,
    describe: (id) => DESCRIPTORS.find((d) => d.id === id) ?? null,
    actor: () => 'reviewer@np.example',
    now: () => T0,
    audit: (e) => audit.push(e),
  });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// ── the declaration itself ─────────────────────────────────────────────────

describe('relationship declarations', () => {
  it('every declaration names a field that actually exists on both modules', () => {
    // The real guard runs at wiring time against the live descriptors. Here it
    // runs against the three-module test set, so only those are checked — the
    // point is that the checker itself works.
    const problems = assertRelationshipsAreDeclarable(DESCRIPTORS);
    for (const rel of RELATIONSHIPS.filter((r) => DESCRIPTORS.some((d) => d.id === r.fromModuleId))) {
      const relevant = problems.filter((p) => p.startsWith(`"${rel.key}"`));
      const bothPresent = DESCRIPTORS.some((d) => d.id === rel.toModuleId);
      if (bothPresent) expect(relevant, `${rel.key}: ${relevant.join('; ')}`).toEqual([]);
    }
  });

  it('catches a declaration pointing at a field that does not exist', () => {
    const problems = assertRelationshipsAreDeclarable([
      { id: 'finance-invoices', fields: [{ key: 'number' }] },
      { id: 'crm-customers', fields: [{ key: 'name' }] },
    ]);
    expect(problems.some((p) => p.includes('finance-invoices.customer'))).toBe(true);
  });

  it('has no duplicate relationship keys', () => {
    const keys = RELATIONSHIPS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never allows a name proposal to stand alone on a financial link', () => {
    for (const rel of RELATIONSHIPS.filter((r) => r.sensitivity === 'financial')) {
      // Financial links may LIST look-alikes, but the resolver refuses to
      // auto-apply them; this locks the declaration side of that contract.
      expect(rel.keyFields.length).toBeGreaterThan(0);
    }
  });

  it('exposes both traversal directions', () => {
    expect(relationshipsFrom('finance-invoices').map((r) => r.key)).toContain('invoice.customer');
    expect(relationshipsTo('crm-customers').map((r) => r.key)).toContain('invoice.customer');
    expect(relationshipByKey('payment.invoice')?.toModuleId).toBe('finance-invoices');
    expect(relationshipByKey('nope')).toBeNull();
  });

  it('every chain step references a declared relationship', () => {
    for (const chain of RELATIONSHIP_CHAINS) {
      for (const key of chain.keys) {
        expect(relationshipByKey(key), `${chain.id} references undeclared "${key}"`).not.toBeNull();
      }
    }
  });
});

// ── the resolver ───────────────────────────────────────────────────────────

describe('resolveReference', () => {
  const def = relationshipByKey('payment.invoice');
  if (!def) throw new Error('payment.invoice must be declared');

  function index(rows: { id: string; title: string; number: string }[]): TargetIndex {
    return new TargetIndex(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: 'invoice',
        moduleId: 'finance-invoices',
        status: 'active',
        rev: 1,
        createdAt: T0,
        updatedAt: T0,
        createdBy: 'test',
        updatedBy: 'test',
        tags: [],
        fields: { number: r.number },
      })) as never,
      def.keyFields,
    );
  }

  it('does NOT match a prefix — the defect a substring search would produce', () => {
    // `store.search('INV-1')` matches INV-1, INV-10 and INV-100. Linking a
    // payment that way would attach money to the wrong invoice.
    const idx = index([
      { id: 'a', title: 'INV-1', number: 'INV-1' },
      { id: 'b', title: 'INV-10', number: 'INV-10' },
      { id: 'c', title: 'INV-100', number: 'INV-100' },
    ]);
    const out = resolveReference('INV-1', def, idx);
    expect(out.status).toBe('resolved');
    expect(out.targetRecordId).toBe('a');
    expect(out.method).toBe('business_key');
  });

  it('matches a record id directly, which is the strongest signal', () => {
    const idx = index([{ id: 'rec_42', title: 'INV-9', number: 'INV-9' }]);
    const out = resolveReference('rec_42', def, idx);
    expect(out.method).toBe('internal_id');
    expect(out.confidence).toBe(1);
  });

  it('refuses to choose between two equally-good candidates', () => {
    const idx = index([
      { id: 'a', title: 'INV-7', number: 'INV-7' },
      { id: 'b', title: 'INV-7 (dup)', number: 'INV-7' },
    ]);
    const out = resolveReference('INV-7', def, idx);
    expect(out.status).toBe('ambiguous');
    expect(out.targetRecordId).toBeNull();
    expect(out.candidates).toHaveLength(2);
    expect(out.reason).toContain('More than one');
  });

  it('matches ignoring case and punctuation, at slightly lower confidence', () => {
    const idx = index([{ id: 'a', title: 'INV-7', number: 'INV-7' }]);
    const out = resolveReference('inv 7', def, idx);
    expect(out.status).toBe('resolved');
    expect(out.method).toBe('normalized_key');
    expect(out.confidence).toBeLessThan(1);
  });

  it('says plainly when the target module is empty rather than blaming the value', () => {
    const out = resolveReference('INV-1', def, index([]));
    expect(out.status).toBe('unresolved');
    expect(out.reason).toContain('will resolve once they are imported');
  });

  it('treats an empty reference as nothing to do, not as a failure', () => {
    const out = resolveReference('   ', def, index([{ id: 'a', title: 'x', number: 'INV-1' }]));
    expect(out.status).toBe('unresolved');
    expect(out.candidates).toEqual([]);
    expect(out.reason).toContain('nothing to link');
  });

  it('normalizes reference values consistently', () => {
    expect(normalizeRefValue('  ABC  Hospital, Ltd. ')).toBe('abc hospital ltd');
  });
});

describe('similarity matching is never silent on money', () => {
  const financial = relationshipByKey('invoice.customer');
  const operational = relationshipByKey('order.customer');
  if (!financial || !operational) throw new Error('declarations missing');

  function customerIndex(names: string[], keyFields: readonly string[]): TargetIndex {
    return new TargetIndex(
      names.map((n, i) => ({
        id: `c${i}`,
        title: n,
        kind: 'customer',
        moduleId: 'crm-customers',
        status: 'active',
        rev: 1,
        createdAt: T0,
        updatedAt: T0,
        createdBy: 'test',
        updatedBy: 'test',
        tags: [],
        fields: { name: n, customerCode: `CUST-00${i}` },
      })) as never,
      keyFields,
    );
  }

  it('offers a look-alike as a PROPOSAL on a financial link, never as a match', () => {
    const idx = customerIndex(['ABC Hospital Limited'], financial.keyFields);
    const out = resolveReference('ABC Hospital Ltd.', financial, idx);
    expect(out.status).toBe('ambiguous');
    expect(out.targetRecordId).toBeNull();
    expect(out.candidates[0]?.method).toBe('canonical_name');
    expect(out.reason).toContain('affects money');
  });

  it('also proposes rather than matches on an operational link', () => {
    const idx = customerIndex(['ABC Hospital Limited'], operational.keyFields);
    const out = resolveReference('ABC Hospital Ltd.', operational, idx);
    expect(out.status).toBe('ambiguous');
    expect(out.targetRecordId).toBeNull();
    expect(out.reason).toContain('Confirm before linking');
  });

  it('still resolves deterministically when the code matches exactly', () => {
    const idx = customerIndex(['ABC Hospital Limited'], financial.keyFields);
    const out = resolveReference('CUST-000', financial, idx);
    expect(out.status).toBe('resolved');
    expect(out.method).toBe('business_key');
  });
});

// ── the engine ─────────────────────────────────────────────────────────────

describe('RelationshipEngine', () => {
  it('links an invoice to its customer by exact code', async () => {
    const customerId = await add('crm-customers', 'ABC Hospital', { name: 'ABC Hospital', customerCode: 'CUST-001' });
    await add('finance-invoices', 'INV-1001', { number: 'INV-1001', customer: 'CUST-001' });

    const pass = await engine.resolveRecords('finance-invoices', await records('finance-invoices'), 'dp_1');
    expect(pass.resolved).toBe(1);

    const links = relStore.outgoing((await records('finance-invoices'))[0]?.id ?? '');
    expect(links[0]?.targetRecordId).toBe(customerId);
    expect(links[0]?.method).toBe('business_key');
    expect(links[0]?.correlationId).toBe('dp_1');
    // The record keeps what the source system said.
    expect((await records('finance-invoices'))[0]?.fields.customer).toBe('CUST-001');
  });

  it('parks a reference whose target has not been imported yet', async () => {
    await add('finance-invoices', 'INV-1002', { number: 'INV-1002', customer: 'CUST-999' });
    const pass = await engine.resolveRecords('finance-invoices', await records('finance-invoices'), 'dp_2');
    expect(pass.unresolved).toBe(1);
    expect(relStore.counts().unresolved).toBe(1);
  });

  it('IMPORT ORDER DOES NOT MATTER — a parked reference resolves when its target arrives', async () => {
    // Invoices first, customers second: the worst realistic ordering.
    await add('finance-invoices', 'INV-1003', { number: 'INV-1003', customer: 'CUST-007' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), 'dp_a');
    expect(relStore.counts().unresolved).toBe(1);
    expect(relStore.counts().links).toBe(0);

    const customerId = await add('crm-customers', 'Bond Health', { name: 'Bond Health', customerCode: 'CUST-007' });
    const retry = await engine.retryPending('dp_b');

    expect(retry.resolved).toBe(1);
    expect(relStore.counts().unresolved).toBe(0);
    expect(relStore.counts().links).toBe(1);
    const invoiceId = (await records('finance-invoices'))[0]?.id ?? '';
    expect(relStore.linkFor(invoiceId, 'invoice.customer')?.targetRecordId).toBe(customerId);
  });

  it('never creates a duplicate target to satisfy a dangling reference', async () => {
    await add('finance-invoices', 'INV-1', { number: 'INV-1', customer: 'Ghost Ltd' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);
    await engine.retryPending(null);
    expect(await records('crm-customers')).toHaveLength(0);
  });

  it('is idempotent — re-running resolution does not accumulate links', async () => {
    await add('crm-customers', 'ABC Hospital', { name: 'ABC Hospital', customerCode: 'CUST-001' });
    await add('finance-invoices', 'INV-1', { number: 'INV-1', customer: 'CUST-001' });
    for (let i = 0; i < 3; i += 1) {
      await engine.resolveRecords('finance-invoices', await records('finance-invoices'), 'dp_x');
    }
    expect(relStore.counts().links).toBe(1);
  });

  it('an empty reference is neither a link nor a review item', async () => {
    await add('finance-invoices', 'INV-2', { number: 'INV-2', customer: '' });
    const pass = await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);
    expect(pass.empty).toBeGreaterThan(0);
    expect(relStore.counts().links).toBe(0);
    expect(relStore.counts().unresolved).toBe(0);
  });

  it('records a reviewer decision as a manual link and audits it', async () => {
    // "ABC Hospital Limited" does not normalize to "ABC Hospital Ltd" — only the
    // LEGAL-SUFFIX canonical form does. So this is the proposal path, which on a
    // financial link never resolves itself.
    const second = await add('crm-customers', 'ABC Hospital Ltd', { name: 'ABC Hospital Ltd', customerCode: 'CUST-011' });
    await add('finance-invoices', 'INV-1004', { number: 'INV-1004', customer: 'ABC Hospital Limited' });

    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), 'dp_c');
    const pending = relStore.queue();
    expect(pending[0]?.status).toBe('ambiguous');
    expect(pending[0]?.candidates.length).toBeGreaterThanOrEqual(1);

    const res = await engine.decide(pending[0]?.id ?? '', second, 'dp_c');
    expect(res.ok).toBe(true);
    const invoiceId = (await records('finance-invoices'))[0]?.id ?? '';
    const link = relStore.linkFor(invoiceId, 'invoice.customer');
    expect(link?.targetRecordId).toBe(second);
    expect(link?.method).toBe('manual');
    expect(link?.decidedBy).toBe('reviewer@np.example');
    expect(audit.some((a) => a.action === 'relationship.decided')).toBe(true);
    expect(relStore.counts().ambiguous).toBe(0);
  });

  it('refuses a decision pointing at a record that does not exist', async () => {
    await add('crm-customers', 'ABC Hospital Ltd', { name: 'ABC Hospital Ltd', customerCode: 'CUST-010' });
    await add('finance-invoices', 'INV-5', { number: 'INV-5', customer: 'ABC Hospital Limited' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);
    const pending = relStore.queue();
    const res = await engine.decide(pending[0]?.id ?? '', 'rec_nonexistent', null);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('no longer exists');
    expect(relStore.counts().links).toBe(0);
  });

  it('a skipped item is a recorded decision and is not silently retried', async () => {
    await add('finance-invoices', 'INV-6', { number: 'INV-6', customer: 'CUST-404' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);
    const pending = relStore.queue();
    const res = await engine.skip(pending[0]?.id ?? '');
    expect(res.ok).toBe(true);
    expect(audit.some((a) => a.action === 'relationship.skipped')).toBe(true);

    // Even once the target arrives, a skipped decision stands.
    await add('crm-customers', 'Late Co', { name: 'Late Co', customerCode: 'CUST-404' });
    const retry = await engine.retryPending(null);
    expect(retry.resolved).toBe(0);
    expect(relStore.counts().skipped).toBe(1);
  });

  it('builds a record-backed neighbourhood in both directions', async () => {
    const customerId = await add('crm-customers', 'ABC Hospital', { name: 'ABC Hospital', customerCode: 'CUST-001' });
    await add('finance-invoices', 'INV-2001', { number: 'INV-2001', customer: 'CUST-001' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);

    const invoiceId = (await records('finance-invoices'))[0]?.id ?? '';
    await add('finance-payments', 'PAY-1', { paymentNumber: 'PAY-1', invoiceRef: 'INV-2001', customer: 'CUST-001' });
    await engine.resolveRecords('finance-payments', await records('finance-payments'), null);

    const hood = await engine.neighbourhood(invoiceId);
    expect(hood.record?.id).toBe(invoiceId);
    expect(hood.outgoing.map((e) => e.recordId)).toContain(customerId);
    expect(hood.outgoing[0]?.moduleTitle).toBe('Customers');
    // The payment points AT the invoice — the backward-trace direction.
    expect(hood.incoming.map((e) => e.label)).toContain('Invoice');
  });

  it('shows a broken edge rather than hiding it when the far end is deleted', async () => {
    const customerId = await add('crm-customers', 'Gone Co', { name: 'Gone Co', customerCode: 'CUST-020' });
    await add('finance-invoices', 'INV-3001', { number: 'INV-3001', customer: 'CUST-020' });
    await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);

    const customers = stores.get('crm-customers');
    customers?.softDelete(customerId, { actor: 'test', now: T0 });
    await customers?.flush();

    const invoiceId = (await records('finance-invoices'))[0]?.id ?? '';
    const hood = await engine.neighbourhood(invoiceId);
    expect(hood.outgoing).toHaveLength(1);
    expect(hood.outgoing[0]?.title).toContain('deleted record');
  });

  it('survives a module that is not wired in this build', async () => {
    await add('finance-invoices', 'INV-7', { number: 'INV-7', sourceOrder: 'SO-1' });
    stores.delete('sales-orders');
    const pass = await engine.resolveRecords('finance-invoices', await records('finance-invoices'), null);
    expect(pass.resolved).toBe(0);
  });
});

// ── persistence ────────────────────────────────────────────────────────────

describe('RelationshipStore', () => {
  it('survives a reload with both collections intact', async () => {
    await relStore.link({
      relationshipKey: 'invoice.customer',
      sourceModuleId: 'finance-invoices',
      sourceRecordId: 'inv_1',
      sourceField: 'customer',
      sourceValue: 'CUST-001',
      targetModuleId: 'crm-customers',
      targetRecordId: 'cus_1',
      method: 'business_key',
      confidence: 1,
      decidedBy: null,
      at: T0,
      correlationId: 'dp_1',
      reason: 'exact',
    });
    await relStore.park({
      relationshipKey: 'payment.invoice',
      sourceModuleId: 'finance-payments',
      sourceRecordId: 'pay_1',
      sourceTitle: 'PAY-1',
      sourceField: 'invoiceRef',
      sourceValue: 'INV-404',
      targetModuleId: 'finance-invoices',
      targetLabel: 'Invoice',
      status: 'unresolved',
      candidates: [],
      reason: 'not found',
      lastCheckedAt: T0,
      correlationId: 'dp_1',
    });

    const reloaded = new RelationshipStore(join(dir, 'relationships.json'));
    await reloaded.load();
    expect(reloaded.counts()).toEqual({ links: 1, ambiguous: 0, unresolved: 1, skipped: 0 });
    expect(reloaded.linkFor('inv_1', 'invoice.customer')?.targetRecordId).toBe('cus_1');
  });

  it('counts a repeated park as one item with a rising attempt count', async () => {
    const park = {
      relationshipKey: 'payment.invoice',
      sourceModuleId: 'finance-payments',
      sourceRecordId: 'pay_2',
      sourceTitle: 'PAY-2',
      sourceField: 'invoiceRef',
      sourceValue: 'INV-404',
      targetModuleId: 'finance-invoices',
      targetLabel: 'Invoice',
      status: 'unresolved' as const,
      candidates: [],
      reason: 'not found',
      lastCheckedAt: T0,
      correlationId: null,
    };
    await relStore.park(park);
    const second = await relStore.park(park);
    expect(relStore.counts().unresolved).toBe(1);
    expect(second.attempts).toBe(2);
  });

  it('orders the queue so ambiguous items are seen before unresolved ones', async () => {
    const base = {
      sourceModuleId: 'finance-invoices',
      sourceField: 'customer',
      targetModuleId: 'crm-customers',
      targetLabel: 'Customer',
      candidates: [],
      reason: 'r',
      lastCheckedAt: T0,
      correlationId: null,
    };
    await relStore.park({ ...base, relationshipKey: 'invoice.customer', sourceRecordId: 'a', sourceTitle: 'A', sourceValue: 'x', status: 'unresolved' });
    await relStore.park({ ...base, relationshipKey: 'order.customer', sourceRecordId: 'b', sourceTitle: 'B', sourceValue: 'y', status: 'ambiguous' });
    expect(relStore.queue().map((p) => p.status)).toEqual(['ambiguous', 'unresolved']);
  });
});
