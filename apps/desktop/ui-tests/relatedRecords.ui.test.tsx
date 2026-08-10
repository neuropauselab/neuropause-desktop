/**
 * Related records on screen, over the real traversal.
 *
 * The component talks to the actual `buildRelatedRecords` over actual record
 * stores and the actual relationship engine. What is being checked is mostly
 * WORDING, because on this panel the wording carries the security property: a
 * permission-filtered list that reads as complete is worse than an error, and
 * three different reasons for an empty list must not collapse into one
 * sentence.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';

import type { EnterpriseModuleDescriptor, EnterprisePermission } from '@neuropause/shared';
import { CrossDomainRelatedRequest } from '@neuropause/shared';
import { EnterpriseRecordStore } from '@main/enterprise/framework/enterpriseRecordStore';
import { RelationshipStore } from '@main/dataPlane/relationshipStore';
import { RelationshipEngine } from '@main/dataPlane/relationshipEngine';
import { buildRelatedRecords } from '@main/crossDomain/relatedRecords';
import { RelatedRecordsPanel } from '@renderer/enterprise/modules/RelatedRecordsPanel';
import { TEST_TENANT_SCOPE } from '@main/tenancy/testScope';

const DIR = join(tmpdir(), 'np-ui-related');
const T0 = '2026-08-10T00:00:00.000Z';
const ACTOR = 'priya@example.com';

const MODULES: Record<string, [string, EnterprisePermission]> = {
  'crm-customers': ['Customers', 'crm:read'],
  'sales-orders': ['Sales orders', 'sales:read'],
  finance: ['Invoices', 'operations:read'],
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

let dir: string;
let stores: Record<string, EnterpriseRecordStore>;
let relationships: RelationshipStore;
let engine: RelationshipEngine;
let held: Set<EnterprisePermission>;
let customerId: string;

async function wire(): Promise<void> {
  dir = join(DIR, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  held = new Set<EnterprisePermission>(['crm:read', 'sales:read', 'operations:read']);

  stores = {};
  for (const moduleId of Object.keys(MODULES)) {
    stores[moduleId] = new EnterpriseRecordStore(join(dir, `${moduleId}.json`), moduleId, moduleId).bindScope(() => TEST_TENANT_SCOPE);
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

  route('enterprise:related', async (payload) => {
    const req = CrossDomainRelatedRequest.parse(payload);
    return buildRelatedRecords(
      {
        relationships,
        storeFor: (id) => stores[id] ?? null,
        describe: (id) => {
          const found = MODULES[id];
          return found ? { plural: found[0], read: found[1] } : null;
        },
        allows: (permission) => held.has(permission),
      },
      {
        recordId: req.recordId,
        moduleId: req.moduleId,
        ...(req.depth === undefined ? {} : { depth: req.depth }),
      },
    );
  });
}

/** Customer → order → invoice, resolved by the real engine. */
async function seed(): Promise<void> {
  const customer = stores['crm-customers']!.create({
    title: 'Acme Ltd',
    fields: { name: 'Acme Ltd', customerCode: 'CUS-1' },
    actor: ACTOR,
    now: T0,
  });
  customerId = customer.id;
  const order = stores['sales-orders']!.create({
    title: 'SO-0001',
    fields: { orderNumber: 'SO-0001', customer: 'Acme Ltd', status: 'pending' },
    actor: ACTOR,
    now: T0,
  });
  stores['finance']!.create({
    title: 'INV-0001',
    fields: { number: 'INV-0001', customer: 'Acme Ltd', sourceOrder: order.id, status: 'issued' },
    actor: ACTOR,
    now: T0,
  });
  for (const moduleId of Object.keys(MODULES)) {
    await engine.resolveRecords(moduleId, stores[moduleId]!.list({ limit: 500 }), null);
  }
}

beforeEach(wire);
afterEach(async () => {
  cleanup();
  clearRoutes();
  await Promise.all(Object.values(stores).map((s) => s.flush()));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const panel = (moduleId = 'crm-customers'): JSX.Element => (
  <RelatedRecordsPanel recordId={customerId} moduleId={moduleId} revision="1" />
);

describe('related records on screen', () => {
  it('groups a customer’s world by domain', async () => {
    await seed();
    render(panel());
    await screen.findByText('Related records');
    expect(await screen.findByText('Sales orders')).toBeTruthy();
    expect(screen.getByText('Invoices')).toBeTruthy();
    expect(screen.getByText('SO-0001')).toBeTruthy();
    expect(screen.getByText('INV-0001')).toBeTruthy();
    expect(unroutedChannels()).toEqual([]);
  });

  it('explains a connection structurally when opened', async () => {
    const user = userEvent.setup();
    await seed();
    render(panel());
    await user.click(await screen.findByRole('button', { name: /SO-0001/ }));

    expect(await screen.findByText(/Why these are connected/i)).toBeTruthy();
    // The field, the literal value, and how it matched — checkable against the
    // record, not an assertion the reader has to trust.
    expect(screen.getByText(/sales-orders\.customer holds "Acme Ltd"/i)).toBeTruthy();
    expect(screen.getByText(/Exact — business key/i)).toBeTruthy();
    expect(screen.getByText(/nobody chose it/i)).toBeTruthy();
  });

  it('says the view is PARTIAL when permission hides something', async () => {
    await seed();
    held = new Set<EnterprisePermission>(['crm:read', 'sales:read']); // no operations:read
    render(panel());

    await screen.findByText('Sales orders');
    expect(screen.queryByText('INV-0001')).toBeNull();
    expect(screen.getByText(/This view is partial/i)).toBeTruthy();
    // And it names neither the module nor the count it withheld — that would
    // disclose the very fact the permission protects.
    expect(screen.queryByText(/Invoices/)).toBeNull();
  });

  it('distinguishes "nothing connected" from "the engine has not run"', async () => {
    // A module that is not registered at all — the engine cannot look it up.
    customerId = 'rec_nothing';
    render(panel('module-that-does-not-exist'));
    expect(await screen.findByText(/module is not available/i)).toBeTruthy();
    expect(screen.getByText(/not a statement that nothing is connected/i)).toBeTruthy();
  });

  it('says nothing is hidden when a record genuinely has no relations', async () => {
    await seed();
    // The invoice at depth 1 reaches the customer and the order; a lone record
    // reaches nothing. Use a customer nobody references.
    const lonely = stores['crm-customers']!.create({
      title: 'Lonely Ltd',
      fields: { name: 'Lonely Ltd', customerCode: 'CUS-9' },
      actor: ACTOR,
      now: T0,
    });
    customerId = lonely.id;
    render(panel());
    expect(await screen.findByText(/Nothing links to this record/i)).toBeTruthy();
    expect(screen.getByText(/nothing is being hidden from you/i)).toBeTruthy();
  });

  it('shows NOTHING when the root record is unreadable', async () => {
    await seed();
    held = new Set<EnterprisePermission>(['sales:read']);
    render(panel());

    expect(await screen.findByText(/This view is partial/i)).toBeTruthy();
    // The panel used to render the permitted sales order for a customer this
    // account cannot read — a filtered list around a forbidden centre.
    expect(screen.queryByText('SO-0001')).toBeNull();
    expect(screen.queryByText('Sales orders')).toBeNull();
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });

  it('never says "nothing is hidden" while also saying the view is partial', async () => {
    // A customer whose ONLY relations sit behind a scope this account lacks:
    // total is 0 AND something was hidden. Both notices used to render, so the
    // product asserted and denied the same thing an inch apart.
    const customer = stores['crm-customers']!.create({
      title: 'Finance Only Ltd',
      fields: { name: 'Finance Only Ltd', customerCode: 'CUS-7' },
      actor: ACTOR,
      now: T0,
    });
    stores['finance']!.create({
      title: 'INV-0007',
      fields: { number: 'INV-0007', customer: 'Finance Only Ltd', status: 'issued' },
      actor: ACTOR,
      now: T0,
    });
    for (const moduleId of Object.keys(MODULES)) {
      await engine.resolveRecords(moduleId, stores[moduleId]!.list({ limit: 500 }), null);
    }
    customerId = customer.id;
    held = new Set<EnterprisePermission>(['crm:read']); // no operations:read

    render(panel());
    expect(await screen.findByText(/This view is partial/i)).toBeTruthy();
    expect(screen.queryByText(/nothing is being hidden from you/i)).toBeNull();
    expect(screen.queryByText('INV-0007')).toBeNull();
  });

  it('lets the user widen the traversal, and states the cost', async () => {
    const user = userEvent.setup();
    await seed();
    render(panel());
    await screen.findByText('Related records');
    // Default is two steps out; the control says so rather than hiding it.
    expect(screen.getByRole('button', { name: /2 steps out/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /2 steps out/i }));
    expect(await screen.findByRole('button', { name: /3 steps out/i })).toBeTruthy();
  });

  it('surfaces a fault instead of an empty list', async () => {
    clearRoutes();
    route('enterprise:related', () => {
      throw new Error('ENOENT: no such file');
    });
    render(panel());
    expect(await screen.findByText(/This is a fault, not an empty result/i)).toBeTruthy();
    // And the retry stays reachable.
    expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
  });

  it('names a permission refusal as a permission refusal', async () => {
    clearRoutes();
    route('enterprise:related', () => {
      throw new Error('Not authorized: missing permission "crm:read".');
    });
    render(panel());
    expect(await screen.findByText(/do not have permission to read this record/i)).toBeTruthy();
  });
});
