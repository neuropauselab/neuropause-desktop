import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 11: the SAP S/4HANA connector FAMILY (Business Partners, Customers, Suppliers, Materials,
 * Inventory, Sales/Purchase/Production Orders, Financials, Plants, Warehouses on one `sap` connector).
 * Pure-node, fake HttpClient. Covers family composition, the uniform OData V2 pull (delta `ge` high-water
 * with the TYPE-DEPENDENT datetime literal, /Date(ms)/ parsing, `$skip` paging via `__next`, run-scoped
 * offset guard, MAX_PAGES cap; full-list `$skip` continuation + reset on drain), the 400/404 degrade, the
 * mappers (kinds, per-object id prefixes, compound keys, collision-free ids), and graceful degradation.
 */
// sapBase() reads the tenant host from this env var at call time; set it before the pulls run.
process.env.NEUROPAUSE_SAP_HOST = 'mytenant-api.s4hana.cloud.sap';

import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import { MANIFEST_BY_ID } from '../../../connectors/manifests';
import {
  sapAdapter,
  SAP_SERVICES,
  mapBusinessPartner,
  mapCustomer,
  mapSupplier,
  mapMaterial,
  mapInventory,
  mapSalesOrder,
  mapPurchaseOrder,
  mapProductionOrder,
  mapFinancialDocument,
  mapPlant,
  mapWarehouse,
} from './sap';

const BASE = 'https://mytenant-api.s4hana.cloud.sap';
const NOW = '2026-07-13T00:00:00.000Z';
const baseCtx = { tenantId: 'org-test', connectorId: 'sap', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...baseCtx, http: undefined as never, cursor: null };
/** An OData V2 epoch-millis date literal. */
const D = (iso: string) => `/Date(${Date.parse(iso)})/`;

interface Handled { results?: Record<string, unknown>[]; next?: string }

/** ctx whose http replays an OData V2 `{d:{results,__next}}` body (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => Handled, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        const out = handler(url, opts);
        return Promise.resolve({ data: { d: { results: out.results ?? [], __next: out.next } }, headers: {}, status: 200 });
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

const byId = (id: string) => sapAdapter.resources.find((r) => r.id === id)!;
const materialsR = byId('sap_materials');
const bpR = byId('sap_business_partners');
const customersR = byId('sap_customers');
const financialsR = byId('sap_financials');

describe('SAP family — composition & catalog', () => {
  it('is ONE connector with every ERP object mounted as a service resource', () => {
    expect(sapAdapter.connectorId).toBe('sap');
    expect(sapAdapter.resources.map((r) => r.id)).toEqual([
      'sap_business_partners', 'sap_customers', 'sap_suppliers', 'sap_materials', 'sap_inventory',
      'sap_sales_orders', 'sap_purchase_orders', 'sap_production_orders', 'sap_financials', 'sap_plants', 'sap_warehouses',
    ]);
  });

  it('the catalog ids match the adapter resource ids, each with a concrete service + kind', () => {
    expect(SAP_SERVICES.map((s) => s.id)).toEqual(sapAdapter.resources.map((r) => r.id));
    const m = Object.fromEntries(SAP_SERVICES.map((s) => [s.id, s]));
    expect(m.sap_business_partners.service).toBe('API_BUSINESS_PARTNER');
    expect(m.sap_business_partners.kind).toBe('organization');
    expect(m.sap_sales_orders.kind).toBe('task');
  });
});

describe('SAP mappers — kinds, per-object id prefixes, /Date(ms)/ parsing, compound keys', () => {
  it('maps a Business Partner → organization with a prefixed id and a normalized (Z) timestamp from /Date(ms)/', () => {
    const e = mapBusinessPartner(pureCtx, { BusinessPartner: '1000', BusinessPartnerFullName: 'Acme Corp', BusinessPartnerCategory: '2', CreationDate: D('2026-06-01T00:00:00Z'), LastChangeDate: D('2026-07-02T00:00:00Z') });
    expect(e.kind).toBe('organization');
    expect(e.id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'organization', 'business_partner-1000'));
    expect(e.title).toBe('Acme Corp');
    expect(e.updatedAt).toBe('2026-07-02T00:00:00.000Z'); // /Date(ms)/ → ISO-Z
    expect(e.metadata.sapObject).toBe('BusinessPartner');
  });

  it('prefixes sourceIds per object so a shared numeric key never collides across object types', () => {
    const bp = mapBusinessPartner(pureCtx, { BusinessPartner: '1000' });
    const mat = mapMaterial(pureCtx, { Product: '1000', LastChangeDateTime: D('2026-07-01T00:00:00Z') });
    const so = mapSalesOrder(pureCtx, { SalesOrder: '1000' });
    // Same raw key '1000' across three object types → three DISTINCT unified ids (different kinds AND prefixes).
    expect(new Set([bp.id, mat.id, so.id]).size).toBe(3);
    expect(bp.id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'organization', 'business_partner-1000'));
    expect(mat.id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'document', 'material-1000'));
    expect(so.id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'task', 'sales_order-1000'));
  });

  it('maps a Financial Document → document with a COMPOUND-key id joined from its four key fields', () => {
    const fd = mapFinancialDocument(pureCtx, { CompanyCode: '1710', FiscalYear: '2026', AccountingDocument: '100000001', AccountingDocumentItem: '1', GLAccount: '400000', AmountInCompanyCodeCurrency: '99.50', CompanyCodeCurrency: 'USD', PostingDate: D('2026-07-01T00:00:00Z') });
    expect(fd.kind).toBe('document');
    expect(fd.id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'document', 'financial_document-1710-2026-100000001-1'));
    expect(fd.metadata.amount).toBe('99.50');
  });

  it('maps the remaining objects to their kinds (order→task, material/inventory→document, party/plant/warehouse→organization)', () => {
    expect(mapCustomer(pureCtx, { Customer: 'C1', CustomerFullName: 'Buyer' }).kind).toBe('organization');
    expect(mapSupplier(pureCtx, { Supplier: 'S1', SupplierFullName: 'Vendor' }).kind).toBe('organization');
    expect(mapInventory(pureCtx, { Material: 'M1', Plant: '1710', StorageLocation: '0001', MatlWrhsStkQtyInMatlBaseUnit: '42' }).kind).toBe('document');
    expect(mapPurchaseOrder(pureCtx, { PurchaseOrder: 'PO1' }).kind).toBe('task');
    expect(mapProductionOrder(pureCtx, { ManufacturingOrder: 'MO1' }).kind).toBe('task');
    expect(mapProductionOrder(pureCtx, { ManufacturingOrder: 'MO1' }).id).toBe(makeUnifiedId('org-test', 'sap', 'a1', 'task', 'production_order-MO1'));
    expect(mapPlant(pureCtx, { Plant: '1710', PlantName: 'Main' }).kind).toBe('organization');
    expect(mapWarehouse(pureCtx, { EWMWarehouse: 'WH1', WarehouseName: 'DC' }).kind).toBe('organization');
  });
});

describe('SAP OData delta — high-water (ge, type-dependent literal, leapfrog-free)', () => {
  it('first sync: no $filter, orders by change,key, commits the newest high-water on drain', async () => {
    let q: Record<string, unknown> = {};
    const ctx = routed((url, opts) => {
      expect(url).toBe(`${BASE}/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product`);
      q = opts?.query as Record<string, unknown>;
      return { results: [{ Product: 'M1', LastChangeDateTime: D('2026-07-10T00:00:00Z') }] };
    }, null);
    const page = await materialsR.pull(ctx);
    expect(q.$filter).toBeUndefined(); // no high-water yet
    expect(q.$orderby).toBe('LastChangeDateTime asc,Product asc');
    expect(q.$format).toBe('json');
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00Z')); // epoch-ms high-water
  });

  it('incremental (DateTimeOffset field): filters `ge datetimeoffset\'…Z\'` at the high-water minus the overlap', async () => {
    const hw = Date.parse('2026-07-05T08:15:20Z');
    const floor = new Date(hw - 2 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { results: [{ Product: 'M2', LastChangeDateTime: D('2026-07-11T00:00:00Z') }] }; }, JSON.stringify({ hw }));
    await materialsR.pull(ctx);
    expect(q.$filter).toBe(`LastChangeDateTime ge datetimeoffset'${floor}'`);
    expect(floor).toBe('2026-07-05T08:13:20Z');
  });

  it('incremental (DateTime day-granular field): filters `ge datetime\'…T00:00:00\'` floored to the day (BusinessPartner)', async () => {
    const hw = Date.parse('2026-07-05T09:30:00Z');
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { results: [{ BusinessPartner: '1', LastChangeDate: D('2026-07-06T00:00:00Z') }] }; }, JSON.stringify({ hw }));
    await bpR.pull(ctx);
    // Day-granular Edm.DateTime → floored to midnight, `datetime'…'` literal (mixing in an offset would be a 400).
    expect(q.$filter).toBe("LastChangeDate ge datetime'2026-07-05T00:00:00'");
  });

  it('within a run it advances $skip by the row count (tagged with the run clock) while __next says more, then drains', async () => {
    const p1 = await materialsR.pull(routed((_url, opts) => {
      expect(opts?.query?.$skip).toBe(0);
      return { results: [{ Product: 'M1', LastChangeDateTime: D('2026-07-18T00:00:00Z') }], next: `${BASE}/...$skiptoken=1` };
    }, null));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.skip).toBe(1); // advanced by the ACTUAL row count (handles a server-capped page)
    expect(c1.runAt).toBe(NOW);
    expect(c1.hw).toBeUndefined(); // not committed mid-walk
    expect(c1.pending).toBe(Date.parse('2026-07-18T00:00:00Z'));

    const p2 = await materialsR.pull(routed((_url, opts) => {
      expect(opts?.query?.$skip).toBe(1); // same-run offset resumed
      return { results: [{ Product: 'M2', LastChangeDateTime: D('2026-07-20T00:00:00Z') }] }; // no __next → drain
    }, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe(Date.parse('2026-07-20T00:00:00Z'));
  });

  it('an offset AND a mid-walk pending from a PRIOR run (runAt ≠ now) are NEVER replayed — rebuild from the high-water', async () => {
    const hw = Date.parse('2026-07-02T00:00:00Z');
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { results: [{ Product: 'M', LastChangeDateTime: D('2026-07-30T00:00:00Z') }] }; },
      JSON.stringify({ hw, skip: 600, runAt: '2020-01-01T00:00:00.000Z', pending: Date.parse('2026-12-31T00:00:00Z'), page: 6 }));
    const page = await materialsR.pull(ctx);
    expect(q.$skip).toBe(0); // stale offset dropped; a fresh run restarts at 0
    expect(String(q.$filter)).toContain('datetimeoffset'); // rebuilt from the durable high-water
    // Committed high-water derives from THIS page's records, never the stale mid-walk pending.
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-30T00:00:00Z'));
  });

  it('compound-key objects order by the FULL key (a total order for stable $skip paging)', async () => {
    let q: Record<string, unknown> = {};
    const ctx = routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { results: [] }; }, null);
    await financialsR.pull(ctx);
    // Financials key = CompanyCode, FiscalYear, AccountingDocument, AccountingDocumentItem — all of them.
    expect(q.$orderby).toBe('PostingDate asc,CompanyCode asc,FiscalYear asc,AccountingDocument asc,AccountingDocumentItem asc');
  });

  it('a row missing its change field does not crash and does not corrupt the high-water', async () => {
    const ctx = routed(() => ({ results: [
      { Product: 'M1', LastChangeDateTime: D('2026-07-10T00:00:00Z') },
      { Product: 'M2' }, // no LastChangeDateTime → skipped for the high-water, still mapped
    ] }), null);
    const page = await materialsR.pull(ctx);
    expect(page.entities).toHaveLength(2);
    expect(JSON.parse(page.cursor as string).hw).toBe(Date.parse('2026-07-10T00:00:00Z'));
  });

  it('incremental with zero new rows commits the high-water unchanged (steady state)', async () => {
    const hw = Date.parse('2026-07-10T00:00:00Z');
    const page = await materialsR.pull(routed(() => ({ results: [] }), JSON.stringify({ hw })));
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string).hw).toBe(hw);
  });

  it('day-granular saturation: a capped run stuck on ONE day carries $skip across runs instead of stalling', async () => {
    const day = Date.parse('2026-07-05T00:00:00Z');
    // At the MAX_PAGES cap (page 29), every row shares the SAME day (PostingDate), so the high-water can't advance.
    const capped = await financialsR.pull(routed(() => ({
      results: [{ CompanyCode: '1710', FiscalYear: '2026', AccountingDocument: '900', AccountingDocumentItem: '1', PostingDate: D('2026-07-05T00:00:00Z') }],
      next: `${BASE}/...more`,
    }), JSON.stringify({ hw: day, skip: 2900, runAt: NOW, page: 29 })));
    expect(capped.hasMore).toBe(false);
    const c = JSON.parse(capped.cursor as string);
    expect(c.sat).toBe(true);   // saturated → continuation flagged (NOT a stall)
    expect(c.skip).toBe(2901);  // $skip KEPT (2900 + 1 row) so the next run drains further into the day
    expect(c.hw).toBe(day);     // high-water unchanged (a day can't be sub-divided)

    // Next run (runAt no longer matches) HONORS the sat continuation: resumes $skip instead of resetting to 0.
    let q: Record<string, unknown> = {};
    await financialsR.pull(routed((_url, opts) => { q = opts?.query as Record<string, unknown>; return { results: [{ CompanyCode: '1710', FiscalYear: '2026', AccountingDocument: '999', AccountingDocumentItem: '1', PostingDate: D('2026-07-06T00:00:00Z') }] }; }, capped.cursor));
    expect(q.$skip).toBe(2901); // continued across the run boundary (would be 0 without the sat carry → stall)
  });

  it('at the MAX_PAGES cap it commits the high-water and drops the offset — the query resumes next run', async () => {
    // Within the run (runAt === now) at page 29 → page+1 (30) is not < MAX_PAGES (30), so it caps with a live __next.
    const page = await materialsR.pull(routed(() => ({ results: [{ Product: 'M9', LastChangeDateTime: D('2026-07-25T00:00:00Z') }], next: `${BASE}/...more` }),
      JSON.stringify({ hw: Date.parse('2026-07-01T00:00:00Z'), skip: 2900, runAt: NOW, page: 29 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe(Date.parse('2026-07-25T00:00:00Z')); // committed → next run's ge(this) resumes forward
    expect(c.skip).toBeUndefined(); // offset dropped; the durable high-water drives resumption
  });
});

describe('SAP OData full-list — $skip continuation across runs', () => {
  it('a full-list object (no change field) continues its $skip walk across runs and resets on drain', async () => {
    const p1 = await customersR.pull(routed((_url, opts) => {
      expect(opts?.query?.$filter).toBeUndefined(); // no change field → no incremental filter
      expect(opts?.query?.$orderby).toBe('Customer asc');
      return { results: [{ Customer: 'C1', CustomerFullName: 'Buyer' }], next: `${BASE}/...$skiptoken=1` };
    }, null));
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string).skip).toBe(1); // continues (no runAt — full-list walks across runs)

    const p2 = await customersR.pull(routed(() => ({ results: [{ Customer: 'C2' }] }), p1.cursor)); // no __next → drain
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string)).toEqual({ skip: 0 }); // reset → next pass re-walks the snapshot
  });
});

describe('SAP graceful degradation', () => {
  it('a 400 (per-release field/query quirk) degrades the SERVICE as unprovisioned, not the family', async () => {
    const page = await materialsR.pull(rejecting(new HttpError(400, 'Bad Request', false), null));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned'); // 400 re-mapped to 404 → graceful unprovisioned
  });

  it('a 404 (service not activated/licensed) degrades as unprovisioned; a 403 (no arrangement/role) as unauthorized', async () => {
    expect((await materialsR.pull(rejecting(new HttpError(404, 'not found', false), null))).degraded?.kind).toBe('unprovisioned');
    expect((await materialsR.pull(rejecting(new AuthError('forbidden', 403), null))).degraded?.kind).toBe('unauthorized');
  });

  it('a 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(materialsR.pull(rejecting(new HttpError(500, 'server error', true), null))).rejects.toThrow();
  });
});

describe('SAP manifest — tenant host + refresh', () => {
  it('builds tenant-hosted OAuth endpoints with the sap-client mandant, no scopes, no TTL, single-account', () => {
    const sap = MANIFEST_BY_ID['sap'];
    expect(sap?.oauth?.authorizeUrl).toMatch(/\/sap\/bc\/sec\/oauth2\/authorize$/);
    expect(sap?.oauth?.tokenUrl).toMatch(/\/sap\/bc\/sec\/oauth2\/token$/);
    expect(sap?.oauth?.extraAuthParams?.['sap-client']).toBeTruthy(); // mandant on the authorize request
    expect(sap?.oauth?.extraTokenParams?.['sap-client']).toBeTruthy(); // and the token request
    expect(sap?.oauth?.scopes).toEqual([]); // access is role/arrangement-governed, not scope-gated
    expect(sap?.oauth?.accessTokenTtlSeconds).toBeUndefined(); // expires_in returned → existing refresh path
    expect(sap?.multiAccount).toBe(false); // one tenant per deployment
  });
});
