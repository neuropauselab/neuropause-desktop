import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  assessProcessMining,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../framework';
import { createQuoteModule } from './sales/quoteModule';
import { createOrderModule } from './sales/orderModule';
import { createInvoiceModule } from './finance/invoiceModule';

const T0 = '2026-07-08T00:00:00.000Z';

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string; target: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'ops@np.dev',
    now: () => T0,
  };
}
function tmp(tag: string): string {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  registry = new EnterpriseModuleRegistry();
  registry.register(createQuoteModule(tmp('quote')));
  registry.register(createOrderModule(tmp('order')));
  registry.register(createInvoiceModule(tmp('invoice')));
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}
async function createIn(moduleId: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity };
}
function listOf(moduleId: string): EnterpriseEntity[] {
  return registry.get(moduleId)!.store.list();
}
function miningInput() {
  return { quotes: listOf('sales-quotes'), orders: listOf('sales-orders'), invoices: listOf('finance') };
}

describe('Process Mining reconstructs from the SAME records that feed Timeline + Audit', () => {
  it('reconstructs an order-to-cash case from live module records — and mining writes nothing', async () => {
    const quote = await createIn('sales-quotes', { quoteNumber: 'Q-1', customer: 'Acme' });
    const order = await createIn('sales-orders', { orderNumber: 'SO-1', customer: 'Acme', sourceQuote: quote.record!.id });
    await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100, sourceOrder: order.record!.id });

    // Audit integration: each create appended a real module audit entry (the same trail the timeline reads).
    expect(rec.audit.some((a) => a.action === 'module.sales-quotes.created')).toBe(true);
    expect(rec.audit.some((a) => a.action === 'module.sales-orders.created')).toBe(true);
    expect(rec.audit.some((a) => a.action === 'module.finance.created')).toBe(true);
    // Timeline integration: each create published the platform event the Enterprise Timeline is built from.
    expect(rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:sales-orders')).toBe(true);

    // The miner reconstructs the case from those very records — no duplicate store, no new events.
    const publishedBefore = rec.publish.length;
    const auditBefore = rec.audit.length;
    const countsBefore = [listOf('sales-quotes').length, listOf('sales-orders').length, listOf('finance').length];

    const assessment = assessProcessMining(miningInput());
    const otc = assessment.traces.find((t) => t.processType === 'order_to_cash');
    expect(otc).toBeTruthy();
    expect(otc!.stages.map((s) => s.activity)).toEqual(['Quote', 'Order', 'Invoice']);

    // Read-only proof: mining emitted no timeline/audit events and changed no store.
    expect(rec.publish.length).toBe(publishedBefore);
    expect(rec.audit.length).toBe(auditBefore);
    expect([listOf('sales-quotes').length, listOf('sales-orders').length, listOf('finance').length]).toEqual(countsBefore);
  });

  it('does not correlate unrelated records into a case (no fabricated links)', async () => {
    await createIn('sales-quotes', { quoteNumber: 'Q-1', customer: 'Acme' });
    await createIn('sales-orders', { orderNumber: 'SO-2', customer: 'Globex' }); // no sourceQuote → its own case
    const assessment = assessProcessMining(miningInput());
    // Two independent cases (a lone quote + a lone order), never merged.
    expect(assessment.traces).toHaveLength(2);
    expect(assessment.traces.every((t) => t.stages.length === 1)).toBe(true);
  });
});
