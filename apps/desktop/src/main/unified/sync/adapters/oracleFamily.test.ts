/**
 * P5 — Increment 12: the Oracle Fusion Cloud ERP connector FAMILY (Business Units, Suppliers, Customers,
 * Items, Inventory, Purchase Orders, Receipts, Invoices, Payments, Projects, Work Orders on one `oracle`
 * connector). Pure-node, fake HttpClient. Covers family composition, the uniform Fusion REST pull (delta
 * `>=` high-water with the quoted +00:00 ISO literal, ISO date parsing, `offset`/`hasMore` paging, the
 * run-scoped offset guard, the MAX_PAGES cap, the saturated-boundary carry; full-list `offset` continuation
 * + reset on drain), the crmRestApi-vs-fscmRestApi split, the 400/404 degrade, the mappers (kinds, per-
 * object id prefixes, compound keys, collision-free ids), and graceful degradation.
 */
// oracleBase() reads the Fusion pod host from this env var at call time; set it before the pulls run.
process.env.NEUROPAUSE_ORACLE_FUSION_HOST = 'mytenant.fa.us2.oraclecloud.com';

import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  oracleAdapter,
  ORACLE_SERVICES,
  mapBusinessUnit,
  mapSupplier,
  mapCustomer,
  mapItem,
  mapInventory,
  mapPurchaseOrder,
  mapReceipt,
  mapInvoice,
  mapPayment,
  mapProject,
  mapWorkOrder,
} from './oracle';

const FUSION = 'https://mytenant.fa.us2.oraclecloud.com';
const V = '11.13.18.05';
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { connectorId: 'oracle', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };

interface Handled { items?: Record<string, unknown>[]; hasMore?: boolean }

/** ctx whose http replays a Fusion `{items, hasMore, count}` body (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => Handled, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        const out = handler(url, opts);
        const items = out.items ?? [];
        return Promise.resolve({ data: { items, hasMore: out.hasMore ?? false, count: items.length }, headers: {}, status: 200 });
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...baseCtx, http, cursor };
}
const rejecting = (err: Error, cursor: string | null): SyncContext => ({
  ...baseCtx,
  http: { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'],
  cursor,
});

const byId = (id: string) => oracleAdapter.resources.find((r) => r.id === id)!;
const inventoryR = byId('oracle_inventory');
const invoicesR = byId('oracle_invoices');
const customersR = byId('oracle_customers');
const suppliersR = byId('oracle_suppliers');
const projectsR = byId('oracle_projects');

describe('Oracle family — composition & catalog', () => {
  it('is ONE connector with every Fusion object mounted as a service resource', () => {
    expect(oracleAdapter.connectorId).toBe('oracle');
    expect(oracleAdapter.resources.map((r) => r.id)).toEqual([
      'oracle_business_units', 'oracle_suppliers', 'oracle_projects', 'oracle_customers', 'oracle_items',
      'oracle_inventory', 'oracle_purchase_orders', 'oracle_receipts', 'oracle_invoices', 'oracle_payments', 'oracle_work_orders',
    ]);
  });

  it('the catalog ids match the adapter resource ids, each with a concrete resource + kind', () => {
    expect(ORACLE_SERVICES.map((s) => s.id)).toEqual(oracleAdapter.resources.map((r) => r.id));
    const m = Object.fromEntries(ORACLE_SERVICES.map((s) => [s.id, s]));
    expect(m.oracle_customers.resource).toBe('accounts');
    expect(m.oracle_customers.kind).toBe('organization');
    expect(m.oracle_purchase_orders.kind).toBe('task');
    expect(m.oracle_projects.kind).toBe('project');
  });
});

describe('Oracle mappers — kinds, per-object id prefixes, ISO parsing, compound keys', () => {
  it('maps a Business Unit → organization with a prefixed id and a normalized (Z) timestamp from ISO+offset', () => {
    const e = mapBusinessUnit(pureCtx, { BusinessUnitId: 300, BusinessUnitName: 'US Operations', CreationDate: '2026-06-01T00:00:00+00:00', LastUpdateDate: '2026-07-02T09:30:00+00:00' });
    expect(e.kind).toBe('organization');
    expect(e.id).toBe('oracle:a1:organization:business_unit-300');
    expect(e.title).toBe('US Operations');
    expect(e.updatedAt).toBe('2026-07-02T09:30:00.000Z'); // ISO+offset → ISO-Z
    expect(e.metadata.oracleObject).toBe('BusinessUnit');
  });

  it('prefixes sourceIds per object so a shared numeric key never collides across object types', () => {
    const bu = mapBusinessUnit(pureCtx, { BusinessUnitId: '1000' });
    const inv = mapInvoice(pureCtx, { InvoiceId: '1000' });
    const wo = mapWorkOrder(pureCtx, { WorkOrderId: '1000' });
    // Same raw key '1000' across three object types → three DISTINCT unified ids (different kinds AND prefixes).
    expect(new Set([bu.id, inv.id, wo.id]).size).toBe(3);
    expect(bu.id).toBe('oracle:a1:organization:business_unit-1000');
    expect(inv.id).toBe('oracle:a1:document:invoice-1000');
    expect(wo.id).toBe('oracle:a1:task:work_order-1000');
  });

  it('maps an Item → document with a COMPOUND-key id joined from ItemId + OrganizationId', () => {
    const e = mapItem(pureCtx, { ItemId: '4977', OrganizationId: '204', ItemNumber: 'AS54888', ItemDescription: 'Standard Desktop', LastUpdateDate: '2026-07-01T00:00:00+00:00' });
    expect(e.kind).toBe('document');
    expect(e.id).toBe('oracle:a1:document:item-4977-204');
    expect(e.title).toBe('AS54888');
    expect(e.body).toBe('Standard Desktop');
  });

  it('maps Inventory → document keyed on the FULL physical grain (org/item/subinv/locator/lot/serial/revision)', () => {
    const e = mapInventory(pureCtx, { OrganizationId: '204', InventoryItemId: '4977', SubinventoryCode: 'STORES', LotNumber: 'LOT1', ItemNumber: 'AS54888', PrimaryTransactionQuantity: '42' });
    expect(e.kind).toBe('document');
    expect(e.id).toBe('oracle:a1:document:inventory-204-4977-STORES--LOT1--'); // org-item-subinv-locator-lot-serial-rev (absent dims → '')
    expect(e.metadata.quantity).toBe('42');
    expect(e.metadata.lotNumber).toBe('LOT1');
  });

  it('gives distinct ids to two balances of the SAME item/subinventory that differ only by locator/lot (no silent overwrite)', () => {
    const common = { OrganizationId: '204', InventoryItemId: '4977', SubinventoryCode: 'STORES', ItemNumber: 'AS54888' };
    const a = mapInventory(pureCtx, { ...common, LocatorId: 'L1', LotNumber: 'LOTA', PrimaryTransactionQuantity: '42' });
    const b = mapInventory(pureCtx, { ...common, LocatorId: 'L2', LotNumber: 'LOTB', PrimaryTransactionQuantity: '10' });
    // Under a (item,org,subinv)-only key these collapse to one id and the store keeps only the last — data loss.
    expect(a.id).not.toBe(b.id);
    expect(new Set([a.id, b.id]).size).toBe(2);
  });

  it('maps the remaining objects to their kinds (PO/receipt/work-order→task, invoice/payment→document, supplier/customer→organization, project→project)', () => {
    expect(mapSupplier(pureCtx, { SupplierId: 'S1', SupplierName: 'Acme Supply' }).kind).toBe('organization');
    expect(mapCustomer(pureCtx, { PartyNumber: 'CDRM_1', OrganizationName: 'Buyer Co' }).kind).toBe('organization');
    expect(mapPurchaseOrder(pureCtx, { POHeaderId: 'PO1', OrderNumber: '1001' }).kind).toBe('task');
    expect(mapReceipt(pureCtx, { TransactionId: 'T1', ReceiptNumber: 'RCV-9' }).kind).toBe('task');
    expect(mapPayment(pureCtx, { CheckId: 'CK1', PaymentNumber: 'P-5' }).kind).toBe('document');
    expect(mapProject(pureCtx, { ProjectId: 'PR1', ProjectName: 'Rollout' }).kind).toBe('project');
    expect(mapProject(pureCtx, { ProjectId: 'PR1', ProjectName: 'Rollout' }).id).toBe('oracle:a1:project:project-PR1');
  });

  it('a stamp-less record falls back to the STABLE baseline (never the run clock) so it is not re-churned', () => {
    const e = mapSupplier(pureCtx, { SupplierId: 'S9', SupplierName: 'No Dates Inc' });
    expect(e.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(e.syncedAt).toBe(NOW); // syncedAt is the run clock; created/updated are not
  });
});

describe('Oracle REST delta — high-water (>=, quoted +00:00 literal, leapfrog-free)', () => {
  it('first sync: no q filter, orders by LastUpdateDate,key, commits the newest high-water on drain', async () => {
    let q: Record<string, unknown> = {};
    const ctx = routed((url, opts) => {
      expect(url).toBe(`${FUSION}/fscmRestApi/resources/${V}/invoices`);
      q = opts?.query as Record<string, unknown>;
      return { items: [{ InvoiceId: '9', InvoiceNumber: 'INV-9', LastUpdateDate: '2026-07-10T00:00:00+00:00' }] };
    }, null);
    const page = await invoicesR.pull(ctx);
    expect(q.q).toBeUndefined(); // no high-water yet
    expect(q.orderBy).toBe('LastUpdateDate:asc,InvoiceId:asc');
    expect(q.onlyData).toBe(true);
    expect(q.limit).toBe(200);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00+00:00')); // epoch-ms high-water
  });

  it('incremental: filters `>= \'<iso>+00:00\'` at the high-water minus the overlap window', async () => {
    const hw = Date.parse('2026-07-05T08:15:20.000Z');
    const floor = new Date(hw - 2 * 60 * 1000).toISOString().replace('Z', '+00:00');
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { items: [{ InvoiceId: '10', LastUpdateDate: '2026-07-11T00:00:00+00:00' }] }; }, JSON.stringify({ hw }));
    await invoicesR.pull(ctx);
    expect(q.q).toBe(`LastUpdateDate >= '${floor}'`);
    expect(floor).toBe('2026-07-05T08:13:20.000+00:00'); // 2 minutes earlier, +00:00 offset (not a bare Z)
  });

  it('within a run it advances offset by the ACTUAL row count (tagged with the run clock) while hasMore, then drains', async () => {
    const p1 = await invoicesR.pull(routed((_url, opts) => {
      expect(opts?.query?.offset).toBe(0);
      return { items: [{ InvoiceId: '1', LastUpdateDate: '2026-07-18T00:00:00+00:00' }], hasMore: true };
    }, null));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.offset).toBe(1); // advanced by the ACTUAL row count (handles a server-capped short page)
    expect(c1.runAt).toBe(NOW);
    expect(c1.hw).toBeUndefined(); // not committed mid-walk
    expect(c1.pending).toBe(Date.parse('2026-07-18T00:00:00+00:00'));

    const p2 = await invoicesR.pull(routed((_url, opts) => {
      expect(opts?.query?.offset).toBe(1); // same-run offset resumed
      return { items: [{ InvoiceId: '2', LastUpdateDate: '2026-07-20T00:00:00+00:00' }], hasMore: false }; // drain
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe(Date.parse('2026-07-20T00:00:00+00:00'));
  });

  it('an offset AND a mid-walk pending from a PRIOR run (runAt ≠ now) are NEVER replayed — rebuild from the high-water', async () => {
    const hw = Date.parse('2026-07-02T00:00:00.000Z');
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { items: [{ InvoiceId: 'X', LastUpdateDate: '2026-07-30T00:00:00+00:00' }] }; },
      JSON.stringify({ hw, offset: 1200, runAt: '2020-01-01T00:00:00.000Z', pending: Date.parse('2026-12-31T00:00:00Z'), page: 6 }));
    const page = await invoicesR.pull(ctx);
    expect(q.offset).toBe(0); // stale offset dropped; a fresh run restarts at 0
    expect(String(q.q)).toContain('>='); // rebuilt from the durable high-water
    // Committed high-water derives from THIS page's records, never the stale mid-walk pending.
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-30T00:00:00+00:00'));
  });

  it('compound-key objects order by the FULL key (a total order for stable offset paging)', async () => {
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { items: [] }; }, null);
    await inventoryR.pull(ctx);
    // Inventory key = the full physical grain — all of them, after the change field → a total order.
    expect(q.orderBy).toBe('LastUpdateDate:asc,OrganizationId:asc,InventoryItemId:asc,SubinventoryCode:asc,LocatorId:asc,LotNumber:asc,SerialNumber:asc,Revision:asc');
  });

  it('a row missing its change field does not crash and does not corrupt the high-water', async () => {
    const ctx = routed(() => ({ items: [
      { InvoiceId: '1', LastUpdateDate: '2026-07-10T00:00:00+00:00' },
      { InvoiceId: '2' }, // no LastUpdateDate → skipped for the high-water, still mapped
    ] }), null);
    const page = await invoicesR.pull(ctx);
    expect(page.entities).toHaveLength(2);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00+00:00'));
  });

  it('incremental with zero new rows commits the high-water unchanged (steady state)', async () => {
    const hw = Date.parse('2026-07-10T00:00:00.000Z');
    const page = await invoicesR.pull(routed(() => ({ items: [] }), JSON.stringify({ hw })));
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(hw);
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the offset — the query resumes next run', async () => {
    // Within the run (runAt === now) at page 29 → page+1 (30) is not < MAX_PAGES (30), so it caps with hasMore.
    const page = await invoicesR.pull(routed(() => ({ items: [{ InvoiceId: '99', LastUpdateDate: '2026-07-25T00:00:00+00:00' }], hasMore: true }),
      JSON.stringify({ hw: Date.parse('2026-07-01T00:00:00Z'), offset: 5800, runAt: NOW, page: 29 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe(Date.parse('2026-07-25T00:00:00+00:00')); // committed → next run's >=(this) resumes forward
    expect(c.offset).toBeUndefined(); // offset dropped; the durable high-water drives resumption
  });

  it('saturated-boundary guard: a capped run whose high-water cannot advance carries offset across runs (no stall)', async () => {
    const instant = Date.parse('2026-07-05T00:00:00.000Z');
    // At the cap, every row shares the SAME LastUpdateDate as the high-water, so it can't advance.
    const capped = await invoicesR.pull(routed(() => ({
      items: [{ InvoiceId: '900', LastUpdateDate: '2026-07-05T00:00:00+00:00' }],
      hasMore: true,
    }), JSON.stringify({ hw: instant, offset: 5800, runAt: NOW, page: 29 })));
    expect(capped.hasMore).toBe(false);
    const c = JSON.parse(capped.cursor as string);
    expect(c.sat).toBe(true);     // saturated → continuation flagged (NOT a stall)
    expect(c.offset).toBe(5801);  // offset KEPT (5800 + 1 row) so the next run drains further
    expect(c.hw).toBe(instant);   // high-water unchanged

    // Next run (runAt no longer matches) HONORS the sat continuation: resumes offset instead of resetting to 0.
    let q: Record<string, unknown> = {};
    await invoicesR.pull(routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { items: [{ InvoiceId: '999', LastUpdateDate: '2026-07-06T00:00:00+00:00' }] }; }, capped.cursor));
    expect(q.offset).toBe(5801); // continued across the run boundary (would be 0 without the sat carry → stall)
  });
});

describe('Oracle REST full-list — offset continuation across runs', () => {
  it('a full-list object (no change field) continues its offset walk across runs and resets on drain', async () => {
    const p1 = await suppliersR.pull(routed((url, opts) => {
      expect(url).toBe(`${FUSION}/fscmRestApi/resources/${V}/suppliers`);
      expect(opts?.query?.q).toBeUndefined(); // no change field → no incremental filter
      expect(opts?.query?.orderBy).toBe('SupplierId:asc');
      return { items: [{ SupplierId: 'S1', SupplierName: 'Acme' }], hasMore: true };
    }, null));
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string).offset).toBe(1); // continues by the actual row count (no runAt — full-list walks across runs)

    const p2 = await suppliersR.pull(routed(() => ({ items: [{ SupplierId: 'S2' }], hasMore: false }), p1.cursor)); // drain
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string)).toEqual({ offset: 0 }); // reset → next pass re-walks the snapshot
  });

  it('a full-list offset from a PRIOR run is HONORED (continues across runs — not run-scoped like delta)', async () => {
    let q: Record<string, unknown> = {};
    await projectsR.pull(routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { items: [{ ProjectId: 'P9' }], hasMore: true }; },
      JSON.stringify({ offset: 400 })));
    expect(q.offset).toBe(400); // full-list offset continues regardless of run boundary
  });

  it('a pathological hasMore-with-no-rows response stops instead of advancing the offset forever', async () => {
    const page = await suppliersR.pull(routed(() => ({ items: [], hasMore: true }), JSON.stringify({ offset: 200 })));
    expect(page.hasMore).toBe(false); // rows.length === 0 guard overrides hasMore
    expect(JSON.parse(page.cursor as string)).toEqual({ offset: 0 }); // reset, not offset:400
  });
});

describe('Oracle REST — the two-host / two-apiRoot split', () => {
  it('the CX customer `accounts` resource is read from crmRestApi; ERP objects from fscmRestApi', async () => {
    let custUrl = '';
    await customersR.pull(routed((url) => { custUrl = url; return { items: [] }; }, null));
    expect(custUrl).toBe(`${FUSION}/crmRestApi/resources/${V}/accounts`);

    let invUrl = '';
    await invoicesR.pull(routed((url) => { invUrl = url; return { items: [] }; }, null));
    expect(invUrl).toBe(`${FUSION}/fscmRestApi/resources/${V}/invoices`);
  });
});

describe('Oracle graceful degradation', () => {
  it('a 400 (attribute not queryable / mandatory-finder resource) degrades the SERVICE visibly, not the family', async () => {
    const page = await invoicesR.pull(rejecting(new HttpError(400, 'Bad Request', false), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned');
    // Surfaced with a DISTINCT reason naming the 400 (not masked as a native 404) so a systematic query-shape
    // problem — which would hit every delta object at once — is observable, never a silent healthy zero.
    expect(page.degraded?.reason).toContain('400');
    expect(page.cursor).toBeNull(); // cursor preserved (here: the null first-run cursor) — no high-water advance
  });

  it('a 404 (resource not on this pod) degrades as unprovisioned; a 403 (no role/data-security) as unauthorized', async () => {
    expect((await invoicesR.pull(rejecting(new HttpError(404, 'not found', false), null))).degraded?.kind).toBe('unprovisioned');
    expect((await invoicesR.pull(rejecting(new AuthError('forbidden', 403), null))).degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(invoicesR.pull(rejecting(new HttpError(500, 'server error', true), null))).rejects.toThrow();
  });
});

describe('Oracle manifest — IDCS OAuth (Basic auth) + Fusion data host + refresh', () => {
  it('builds IDCS-hosted OAuth endpoints with Basic client auth, offline_access, no TTL, single-account', () => {
    const oracle = MANIFEST_BY_ID['oracle'];
    expect(oracle?.oauth?.authorizeUrl).toMatch(/\/oauth2\/v1\/authorize$/);
    expect(oracle?.oauth?.tokenUrl).toMatch(/\/oauth2\/v1\/token$/);
    expect(oracle?.oauth?.tokenAuthStyle).toBe('basic'); // IDCS confidential clients authenticate with HTTP Basic
    expect(oracle?.oauth?.usePkce).toBe(false);
    expect(oracle?.oauth?.scopes).toContain('offline_access'); // yields the refresh token
    expect(oracle?.oauth?.revokeUrl).toBeNull(); // IDCS revoke shape differs → drop token locally
    expect(oracle?.oauth?.loopbackPort).toBe(42827); // distinct from the other families' ports
    expect(oracle?.oauth?.accessTokenTtlSeconds).toBeUndefined(); // expires_in (3600) returned → existing refresh path
    expect(oracle?.multiAccount).toBe(false); // one pod per deployment
  });
});
