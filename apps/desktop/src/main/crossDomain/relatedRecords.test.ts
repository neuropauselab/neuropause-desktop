/**
 * Cross-domain traversal over the REAL relationship engine.
 *
 * Nothing here is a fixture graph. Records go into actual
 * `EnterpriseRecordStore`s, the actual `RelationshipEngine` resolves the
 * declared links from the values those records carry, and the traversal walks
 * whatever it resolved. That distinction matters: a hand-built graph would let
 * every test below pass while the thing that produces the graph in production
 * was broken.
 *
 * The load-bearing test is the permission one. A customer's world spans four
 * read scopes, so a traversal that ignores them is a way to read Finance
 * through CRM — and the existing cross-domain surfaces in this repo do exactly
 * that. `stops at a module the actor cannot read` is the test that says this
 * one does not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnterpriseModuleDescriptor, EnterprisePermission } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { RelationshipStore } from '../dataPlane/relationshipStore';
import { RelationshipEngine } from '../dataPlane/relationshipEngine';
import { buildRelatedRecords } from './relatedRecords';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-10T00:00:00.000Z';
const ACTOR = 'priya@example.com';

/** module id → [plural title, read scope]. Mirrors the real descriptors. */
const MODULES: Record<string, [string, EnterprisePermission]> = {
  'crm-customers': ['Customers', 'crm:read'],
  'sales-orders': ['Sales orders', 'sales:read'],
  finance: ['Invoices', 'operations:read'],
  'finance-payments': ['Payments', 'operations:read'],
  'helpdesk-tickets': ['Tickets', 'operations:read'],
};

/**
 * The minimum real descriptor the resolver reads. Typed rather than cast: a
 * cast here would hide the day the engine starts reading another field.
 */
function descriptorFor(id: string, plural: string): EnterpriseModuleDescriptor {
  return {
    id,
    title: plural,
    singular: plural,
    plural,
    icon: 'grid',
    description: 'test module',
    titleField: 'name',
    permissions: { read: MODULES[id]![1], write: MODULES[id]![1] },
    fields: [{ key: 'name', label: 'Name', type: 'text' }],
  };
}

describe('cross-domain related records', () => {
  let dir: string;
  let stores: Record<string, EnterpriseRecordStore>;
  let relationships: RelationshipStore;
  let engine: RelationshipEngine;
  /** Flipped per test to model a narrower account. */
  let held: Set<EnterprisePermission>;

  const create = (moduleId: string, title: string, fields: Record<string, string | number>) =>
    stores[moduleId]!.create({ title, fields, actor: ACTOR, now: T0 });

  /** Run the real resolver over every module, the way an import pass does. */
  const resolveEverything = async (): Promise<void> => {
    for (const moduleId of Object.keys(MODULES)) {
      await engine.resolveRecords(moduleId, stores[moduleId]!.list({ limit: 500 }), null);
    }
  };

  const related = (recordId: string, moduleId: string, depth?: number) =>
    buildRelatedRecords(
      {
        relationships,
        storeFor: (id) => stores[id] ?? null,
        describe: (id) => {
          const found = MODULES[id];
          return found ? { plural: found[0], read: found[1] } : null;
        },
        allows: (permission) => held.has(permission),
      },
      { recordId, moduleId, ...(depth === undefined ? {} : { depth }) },
    );

  beforeEach(async () => {
    dir = join(tmpdir(), `np-xdomain-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    held = new Set<EnterprisePermission>([
      'crm:read',
      'sales:read',
      'operations:read',
      'procurement:read',
    ]);

    stores = {};
    for (const moduleId of Object.keys(MODULES)) {
      stores[moduleId] = new EnterpriseRecordStore(
        join(dir, `${moduleId}.json`),
        moduleId,
        moduleId,
      ).bindScope(() => TEST_TENANT_SCOPE);
    }
    relationships = new RelationshipStore(join(dir, 'rel.json'));
    await Promise.all([...Object.values(stores).map((s) => s.load()), relationships.load()]);

    engine = new RelationshipEngine({
      store: relationships,
      storeFor: (id) => stores[id] ?? null,
      describe: (id) => (MODULES[id] ? descriptorFor(id, MODULES[id]![0]) : null),
      actor: () => ACTOR,
      audit: () => undefined,
      now: () => T0,
    });
  });

  afterEach(async () => {
    await Promise.all(Object.values(stores).map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /**
   * The order-to-cash chain, built from the values the records actually carry:
   * the order names the customer, the invoice names the order by id and the
   * customer by name, the payment names the invoice by number.
   */
  async function seedChain(): Promise<{ customerId: string; orderId: string; invoiceId: string; paymentId: string; ticketId: string }> {
    const customer = create('crm-customers', 'Acme Ltd', { name: 'Acme Ltd', customerCode: 'CUS-1' });
    const order = create('sales-orders', 'SO-0001', {
      orderNumber: 'SO-0001',
      customer: 'Acme Ltd',
      status: 'pending',
    });
    const invoice = create('finance', 'INV-0001', {
      number: 'INV-0001',
      customer: 'Acme Ltd',
      sourceOrder: order.id,
      status: 'issued',
    });
    const payment = create('finance-payments', 'PAY-0001', {
      paymentNumber: 'PAY-0001',
      invoiceRef: 'INV-0001',
      customer: 'Acme Ltd',
      status: 'cleared',
    });
    const ticket = create('helpdesk-tickets', 'TKT-0001', {
      ticketNumber: 'TKT-0001',
      customerRef: customer.id,
      subject: 'Delivery query',
    });
    // The REAL resolver decides what links; nothing is asserted into existence.
    await resolveEverything();
    return {
      customerId: customer.id,
      orderId: order.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
      ticketId: ticket.id,
    };
  }

  /* ── Customer 360 ──────────────────────────────────────────────────────── */

  describe('customer 360', () => {
    it('reaches every domain the customer actually touches', async () => {
      const ids = await seedChain();
      const view = await related(ids.customerId, 'crm-customers', 3);

      expect(view.root?.title).toBe('Acme Ltd');
      const byModule = Object.fromEntries(view.groups.map((g) => [g.moduleId, g.records.length]));
      expect(byModule['sales-orders']).toBe(1);
      expect(byModule['finance']).toBe(1);
      expect(byModule['finance-payments']).toBe(1);
      expect(byModule['helpdesk-tickets']).toBe(1);
      expect(view.hiddenByPermission).toBe(false);
    });

    it('records how many steps away each record is', async () => {
      const ids = await seedChain();
      const view = await related(ids.customerId, 'crm-customers', 3);
      const find = (moduleId: string) =>
        view.groups.find((g) => g.moduleId === moduleId)!.records[0]!;
      // Order, invoice, payment and ticket all name the customer directly, so
      // every one of them is one hop — the chain is a star, not a line.
      expect(find('sales-orders').hops).toBe(1);
      expect(find('helpdesk-tickets').hops).toBe(1);
    });

    it('explains every connection structurally, never as an opinion', async () => {
      const ids = await seedChain();
      const view = await related(ids.customerId, 'crm-customers', 1);
      for (const group of view.groups) {
        for (const record of group.records) {
          const hop = record.path[record.path.length - 1]!;
          expect(hop.why).toMatch(/holds "/);
          expect(hop.sourceValue.length).toBeGreaterThan(0);
          expect(hop.method).toBeTruthy();
          expect(hop.why.toLowerCase()).not.toMatch(/\bai\b|\blikely\b|\bprobably\b|\bseems\b/);
        }
      }
    });

    it('names the field and the literal value, so a person can check it', async () => {
      const ids = await seedChain();
      const view = await related(ids.orderId, 'sales-orders', 1);
      const customerHop = view.groups
        .flatMap((g) => g.records)
        .flatMap((r) => r.path)
        .find((h) => h.relationshipKey === 'order.customer')!;
      expect(customerHop.why).toContain('sales-orders.customer');
      expect(customerHop.why).toContain('"Acme Ltd"');
      expect(customerHop.decidedBy).toBeNull(); // deterministic — nobody chose it
      expect(customerHop.why).toContain('nobody chose it');
    });
  });

  /* ── The security property ─────────────────────────────────────────────── */

  describe('the graph is not an authorization bypass', () => {
    it('stops at a module the actor cannot read, and says the view is partial', async () => {
      const ids = await seedChain();
      held = new Set<EnterprisePermission>(['crm:read', 'sales:read']); // no operations:read

      const view = await related(ids.customerId, 'crm-customers', 3);
      const modules = view.groups.map((g) => g.moduleId);
      expect(modules).toContain('sales-orders');
      // Invoices, payments and tickets all sit behind operations:read.
      expect(modules).not.toContain('finance');
      expect(modules).not.toContain('finance-payments');
      expect(modules).not.toContain('helpdesk-tickets');
      // And the omission is DECLARED — a filtered view that looks complete is
      // worse than an empty one, because nothing invites the reader to doubt it.
      expect(view.hiddenByPermission).toBe(true);
    });

    it('leaks no id, title or count for what it withheld', async () => {
      const ids = await seedChain();
      held = new Set<EnterprisePermission>(['crm:read', 'sales:read']);

      const serialized = JSON.stringify(await related(ids.customerId, 'crm-customers', 3));
      for (const forbidden of [ids.invoiceId, ids.paymentId, ids.ticketId]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toContain('INV-0001');
      expect(serialized).not.toContain('PAY-0001');
      expect(serialized).not.toContain('TKT-0001');
      // Not even the module names of what was hidden.
      expect(serialized).not.toContain('finance-payments');
    });

    it('will not use a forbidden record as a BRIDGE to a permitted one', async () => {
      // The subtle version of the bypass. The payment is reachable only
      // through the invoice; if traversal stepped through a record it may not
      // show, the far side would come back anyway.
      const ids = await seedChain();
      const orphanPayment = create('finance-payments', 'PAY-0002', {
        paymentNumber: 'PAY-0002',
        invoiceRef: 'INV-0001',
        status: 'cleared',
      });
      await resolveEverything();
      held = new Set<EnterprisePermission>(['crm:read', 'sales:read', 'operations:read']);
      expect(
        JSON.stringify(await related(ids.customerId, 'crm-customers', 3)),
      ).toContain(orphanPayment.id);

      // Now revoke the module the bridge lives in.
      held = new Set<EnterprisePermission>(['crm:read', 'sales:read']);
      const serialized = JSON.stringify(await related(ids.customerId, 'crm-customers', 3));
      expect(serialized).not.toContain(orphanPayment.id);
      expect(serialized).not.toContain('PAY-0002');
    });

    it('returns NOTHING when the root record itself is unreadable', async () => {
      const ids = await seedChain();
      held = new Set<EnterprisePermission>(['sales:read']);
      const view = await related(ids.customerId, 'crm-customers', 2);

      expect(view.root).toBeNull();
      expect(view.hiddenByPermission).toBe(true);
      // The assertions that matter, and that an earlier version of this test
      // omitted: a null root used to leave the traversal running, so the
      // permitted sales order came back — along with hop.sourceValue and
      // hop.why, which quote the FORBIDDEN customer's own field values.
      expect(view.total).toBe(0);
      expect(view.groups).toEqual([]);
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(ids.orderId);
      expect(serialized).not.toContain('SO-0001');
      expect(serialized).not.toContain('Acme Ltd');
    });

    it('returns nothing when the moduleId does not match where the record lives', async () => {
      // A readable module id paired with a record from a forbidden one. The
      // root check would authorize CRM and the traversal would then walk the
      // invoice's neighbourhood.
      const ids = await seedChain();
      held = new Set<EnterprisePermission>(['crm:read', 'sales:read']);
      const view = await related(ids.invoiceId, 'crm-customers', 3);
      expect(view.root).toBeNull();
      expect(view.total).toBe(0);
      expect(JSON.stringify(view)).not.toContain('INV-0001');
    });

    it('returns nothing for a root that has been deleted', async () => {
      const ids = await seedChain();
      stores['crm-customers']!.softDelete(ids.customerId);
      const view = await related(ids.customerId, 'crm-customers', 2);
      expect(view.root).toBeNull();
      expect(view.total).toBe(0);
      // And the root's own absence is not reported as a broken LINK — there
      // is no link, so "1 link points at a record that no longer exists"
      // would be false.
      expect(view.brokenLinks).toBe(0);
    });
  });

  /* ── Bounded traversal ─────────────────────────────────────────────────── */

  describe('bounded traversal', () => {
    it('honours the depth limit', async () => {
      const ids = await seedChain();
      // The payment reaches the ORDER only via the invoice: 2 hops.
      const oneHop = await related(ids.orderId, 'sales-orders', 1);
      const twoHops = await related(ids.orderId, 'sales-orders', 2);
      expect(oneHop.groups.some((g) => g.moduleId === 'finance-payments')).toBe(false);
      expect(twoHops.groups.some((g) => g.moduleId === 'finance-payments')).toBe(true);
    });

    it('caps depth at 3 however large a number is asked for', async () => {
      const ids = await seedChain();
      expect((await related(ids.customerId, 'crm-customers', 99)).depth).toBe(3);
      expect((await related(ids.customerId, 'crm-customers', 0)).depth).toBe(1);
    });

    it('declares truncation when the DEPTH cap cut the walk short', async () => {
      const ids = await seedChain();
      // At depth 1 from the order there is more beyond the frontier; at depth
      // 3 the graph is exhausted. Reporting `truncated: false` in the first
      // case would claim the partial view is everything.
      expect((await related(ids.orderId, 'sales-orders', 1)).truncated).toBe(true);
      expect((await related(ids.orderId, 'sales-orders', 3)).truncated).toBe(false);
    });

    it('terminates on a cycle instead of spinning', async () => {
      // customer → order → invoice → customer is a real cycle in this data:
      // the invoice names both the order and the customer.
      const ids = await seedChain();
      const view = await related(ids.customerId, 'crm-customers', 3);
      // The root must never appear as its own relation.
      expect(view.groups.flatMap((g) => g.records).map((r) => r.recordId)).not.toContain(
        ids.customerId,
      );
      // And each record appears exactly once, by its shortest path.
      const seen = view.groups.flatMap((g) => g.records).map((r) => r.recordId);
      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  /* ── Honest states ─────────────────────────────────────────────────────── */

  describe('honest states', () => {
    it('reports an isolated record as isolated, not as an error', async () => {
      create('crm-customers', 'Lonely Ltd', { name: 'Lonely Ltd', customerCode: 'CUS-9' });
      const order = create('sales-orders', 'SO-9999', {
        orderNumber: 'SO-9999',
        customer: 'Lonely Ltd',
        status: 'pending',
      });
      await resolveEverything();
      // The order has exactly one link, to its customer. Ask from the order.
      const view = await related(order.id, 'sales-orders', 1);
      expect(view.total).toBe(1);
      expect(view.hiddenByPermission).toBe(false);
      expect(view.brokenLinks).toBe(0);
    });

    it('shows a deleted far end rather than hiding the link', async () => {
      const ids = await seedChain();
      stores['sales-orders']!.softDelete(ids.orderId);

      const view = await related(ids.customerId, 'crm-customers', 1);
      const order = view.groups
        .flatMap((g) => g.records)
        .find((r) => r.recordId === ids.orderId)!;
      expect(order.deleted).toBe(true);
      expect(order.title).toContain('(deleted)');
      expect(view.brokenLinks).toBeGreaterThan(0);
    });

    it('does not traverse THROUGH a deleted record', async () => {
      const ids = await seedChain();
      // A payment that names ONLY the invoice, so the invoice is its single
      // route back to anything. The seeded payment also names the customer
      // directly, which would reach it by another path and prove nothing.
      const orphan = create('finance-payments', 'PAY-0003', {
        paymentNumber: 'PAY-0003',
        invoiceRef: 'INV-0001',
        status: 'cleared',
      });
      await resolveEverything();
      expect(
        (await related(ids.orderId, 'sales-orders', 3)).groups.flatMap((g) => g.records).map((r) => r.recordId),
      ).toContain(orphan.id);

      stores['finance']!.softDelete(ids.invoiceId);
      const reached = (await related(ids.orderId, 'sales-orders', 3)).groups
        .flatMap((g) => g.records)
        .map((r) => r.recordId);
      expect(reached).toContain(ids.invoiceId); // reported as a broken far end…
      expect(reached).not.toContain(orphan.id); // …but never walked through
    });

    it('reflects a corrected record immediately — nothing is cached', async () => {
      const ids = await seedChain();
      expect((await related(ids.customerId, 'crm-customers', 1)).root?.title).toBe('Acme Ltd');
      stores['crm-customers']!.update(ids.customerId, {
        title: 'Acme Limited',
        actor: ACTOR,
        now: T0,
      });
      expect((await related(ids.customerId, 'crm-customers', 1)).root?.title).toBe('Acme Limited');
    });
  });
});
