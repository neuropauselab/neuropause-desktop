/**
 * The SAP S/4HANA connector FAMILY (P5 — Increment 11) — ERP master data + transactions via OData.
 *
 * ONE connector (`sap`) — one OAuth 2.0 app, one token, one vault record, one card, one health engine, one
 * inspector — with each S/4HANA business object mounted as an `AdapterResource` on the SAME authenticated
 * session, read through the standard OData V2 Business APIs. This mirrors, exactly, how `microsoft-entra`
 * hosts M365 and `salesforce`/`hubspot`/`servicenow` host their objects. Every resource is wrapped in the
 * shared `graceful()` guard, so a service a tenant hasn't licensed / added to a Communication Arrangement
 * (403), or that doesn't exist (404), degrades to a tagged empty page instead of failing the family.
 *
 * The SAP wrinkles, handled by EXTENDING existing seams:
 *   • **Per-instance host** — every OAuth + OData endpoint lives on the customer's tenant host, built from
 *     `NEUROPAUSE_SAP_HOST` (in the manifest for the authorize/token URLs — the ServiceNow env-host pattern;
 *     and here for the data calls — the github.ts env-base pattern). No per-org resolution call.
 *   • **`expires_in` returned** by the token endpoint → the EXISTING proactive-refresh path covers it with
 *     no synthesized TTL (like HubSpot / ServiceNow).
 *   • **Access is role / Communication-Arrangement governed, not per-object OAuth scope** — so, like
 *     Salesforce / ServiceNow (unlike HubSpot), there is NO scope catalog and NO `serviceCapabilities`
 *     branch; which modules (Finance / Procurement / Manufacturing / Sales / …) a tenant exposes is
 *     discovered at RUNTIME from the per-module degrade the Supervisor overlays.
 *   • **OData V2 quirks** — the JSON envelope is `{d:{results:[…],__next}}`; dates come back as
 *     `/Date(1704067200000)/` epoch-millis; and — critically — a `$filter` datetime literal is TYPE-
 *     dependent: `datetimeoffset'…Z'` for `Edm.DateTimeOffset` (`LastChangeDateTime`) but
 *     `datetime'…T00:00:00'` for `Edm.DateTime` day-granular fields (`LastChangeDate`, `PostingDate`).
 *     Mixing them is a 400. Field/service availability also varies by S/4HANA release, so a **400 is
 *     treated as unprovisioned** (a per-tenant OData quirk degrades the module, not the family).
 *
 * Object → UDM (SAP keys are unique only within an object type — a BusinessPartner `1000` and a Material
 * `1000` both exist — so every sourceId is prefixed with its object type to keep unified ids collision-free
 * AND self-describing):
 *   business_partner / customer / supplier / plant / warehouse → organization
 *   material / inventory / financial_document                  → document
 *   sales_order / purchase_order / production_order            → task
 *
 * Incremental sync (the 6 objects with a change field): `<changeField> ge <high-water> $orderby=<change>,
 * <full key> asc` (the full key gives a total order, so `$skip` paging is stable even for compound-key
 * objects), resuming across runs via the durable high-water — a MAX_PAGES cap advances it and the next run
 * resumes from there (leapfrog-free ASC-resume, as in `salesforce.ts` / `servicenow.ts`). `ge` (not `gt`)
 * re-scans the boundary — essential for the day-granular BusinessPartner / Financials fields — with the
 * store deduping. Because those day-granular fields cannot sub-divide a day, if a whole capped run lands on
 * ONE saturated day the `$skip` offset is carried across runs to drain that day rather than stalling on it.
 * The 5 objects with no change field (Customer/Supplier snapshot views, the Material-Stock snapshot,
 * Plant/Warehouse masters) are a full `$skip` walk that continues across runs and resets on drain.
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor } from './util';

/** The env var supplying the customer's S/4HANA API host (also read by the manifest for the OAuth URLs). */
const SAP_HOST_ENV = 'NEUROPAUSE_SAP_HOST';
/** Modest OData page size ($top); the high-water / $skip continuation walks the rest. */
const PAGE = 100;
/** Bound one run's page walk. 100 × 30 = 3,000 rows/run; the high-water resumes forward (never leapfrogged). */
const MAX_PAGES = 30;
/** Overlap window subtracted from a fine-grained (DateTimeOffset) high-water to absorb clock skew (deduped). */
const OVERLAP_MS = 2 * 60 * 1000;
/** Stable baseline for a record missing its stamps — never the run clock, which would re-churn it. */
const SAP_STABLE_TS = '1970-01-01T00:00:00.000Z';

/** The tenant API base, from configuration (never a per-org resolution call). */
function sapBase(): string {
  const host = (process.env[SAP_HOST_ENV] ?? '').trim();
  return `https://${host || 'HOST'}`;
}

/* ── OData V2 helpers ──────────────────────────────────────────────────────────── */

/** The ECMAScript maximum valid `Date` epoch; a value beyond this makes `new Date().toISOString()` throw. */
const MAX_EPOCH_MS = 8.64e15;

/** Parse an OData V2 date value (`/Date(1704067200000)/` epoch-millis, or ISO) to epoch ms, or NaN. */
function odataEpoch(v: unknown): number {
  let t: number;
  if (v == null) return NaN;
  else if (typeof v === 'number') t = v;
  else {
    const str = String(v);
    const m = /\/Date\((-?\d+)(?:[+-]\d+)?\)\//.exec(str);
    t = m ? Number(m[1]) : Date.parse(str);
  }
  // Guard out-of-range epochs (a malformed `/Date(999…)/`) so `new Date(t).toISOString()` never throws.
  return Number.isFinite(t) && Math.abs(t) <= MAX_EPOCH_MS ? t : NaN;
}
/** Normalize an OData V2 date to ISO-Z, or a fallback when absent/invalid. */
function odataIso(v: unknown, fallback: string): string {
  const t = odataEpoch(v);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/** A field value as a trimmed string, or null (SAP OData V2 fields are flat scalars). */
function s(rec: SapRecord, k: string): string | null {
  const v = rec[k];
  if (v == null) return null;
  const str = String(v).trim();
  return str || null;
}

/**
 * Interpret a SAP boolean-ish flag as a boolean — an `Edm.Boolean` (`true`/`false`) OR a block *code*
 * (`""` = not blocked, a non-empty code = blocked). Routing such a flag through `s()`'s string-truthiness
 * would read a JSON `false` as the truthy string `"false"`; this reads it correctly.
 */
function isFlagged(rec: SapRecord, k: string): boolean {
  const v = rec[k];
  if (v === true) return true;
  if (v == null || v === false) return false;
  const str = String(v).trim().toLowerCase();
  return str !== '' && str !== 'false' && str !== '0';
}

type SapRecord = Record<string, unknown>;

/** Whether an object syncs incrementally (has a change field) or is a full-list snapshot. */
type DeltaType = 'datetimeoffset' | 'datetime' | null;

/**
 * Build the `$filter` datetime literal for a high-water. `Edm.DateTimeOffset` fields are fine-grained
 * (subtract the overlap, format with `Z`, no millis); `Edm.DateTime` fields are day-granular (floor to the
 * day's midnight — `ge` then re-scans the whole day). Using the wrong literal type for the field is a 400.
 */
function deltaLiteral(deltaType: DeltaType, hwMs: number): string {
  if (deltaType === 'datetime') {
    return `datetime'${new Date(hwMs).toISOString().slice(0, 10)}T00:00:00'`;
  }
  const t = Math.max(0, hwMs - OVERLAP_MS);
  return `datetimeoffset'${new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')}'`;
}

/* ── Entity spec ───────────────────────────────────────────────────────────────── */

/** One S/4HANA object mounted as a service resource. id === resource id === catalog id === module-stat id. */
interface SapSpec {
  id: string;
  label: string;
  /** OData service technical name (`…/sap/opu/odata/sap/{service}/{entitySet}`). */
  service: string;
  entitySet: string;
  kind: UnifiedEntityKind;
  /** Sourceid prefix + collision guard (SAP keys are unique only within an object type). */
  prefix: string;
  /** Key field(s) — joined for the sourceId. */
  keyFields: string[];
  /** Incremental change field (null ⇒ full-list snapshot). */
  deltaField: string | null;
  deltaType: DeltaType;
  /** $select business fields (keys + delta + created field are appended automatically). */
  fields: string[];
  /** Field for createdAt (optional). */
  createdField: string | null;
  map: (ctx: SyncContext, rec: SapRecord) => UnifiedEntity;
}

/**
 * The shared UDM envelope. `sourceId` is the prefixed, key-joined id; timestamps come from the object's
 * created / change fields (falling back to a STABLE baseline — never the run clock — so a stamp-less row
 * isn't re-churned every sync). No `url`: an S/4HANA Fiori deep link needs per-app config (documented).
 */
function base(ctx: SyncContext, spec: SapSpec, rec: SapRecord) {
  const created = spec.createdField ? odataIso(rec[spec.createdField], SAP_STABLE_TS) : SAP_STABLE_TS;
  const updated = spec.deltaField ? odataIso(rec[spec.deltaField], created) : created;
  const key = spec.keyFields.map((k) => s(rec, k) ?? '').join('-');
  return {
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: spec.kind,
    sourceId: `${spec.prefix}${key}`,
    now: ctx.now,
    url: null,
    createdAt: created,
    updatedAt: updated,
  } as const;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────────── */

export function mapBusinessPartner(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_business_partners, rec),
    title: s(rec, 'BusinessPartnerFullName') || s(rec, 'BusinessPartnerName') || s(rec, 'OrganizationBPName1') || `Business Partner ${s(rec, 'BusinessPartner')}`,
    status: s(rec, 'BusinessPartnerCategory') === '1' ? 'person' : 'organization',
    metadata: ({
      sapObject: 'BusinessPartner',
      businessPartner: s(rec, 'BusinessPartner'),
      category: s(rec, 'BusinessPartnerCategory'),
      grouping: s(rec, 'BusinessPartnerGrouping'),
      firstName: s(rec, 'FirstName'),
      lastName: s(rec, 'LastName'),
    }),
  });
}

export function mapCustomer(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_customers, rec),
    title: s(rec, 'CustomerFullName') || s(rec, 'CustomerName') || `Customer ${s(rec, 'Customer')}`,
    status: isFlagged(rec, 'BillingIsBlockedForCustomer') ? 'blocked' : 'active',
    metadata: ({
      sapObject: 'Customer',
      customer: s(rec, 'Customer'),
      accountGroup: s(rec, 'CustomerAccountGroup'),
      country: s(rec, 'Country'),
    }),
  });
}

export function mapSupplier(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_suppliers, rec),
    title: s(rec, 'SupplierFullName') || s(rec, 'SupplierName') || `Supplier ${s(rec, 'Supplier')}`,
    status: isFlagged(rec, 'PaymentIsBlockedForSupplier') ? 'blocked' : 'active',
    metadata: ({
      sapObject: 'Supplier',
      supplier: s(rec, 'Supplier'),
      accountGroup: s(rec, 'SupplierAccountGroup'),
      country: s(rec, 'Country'),
    }),
  });
}

export function mapMaterial(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_materials, rec),
    title: s(rec, 'Product') || 'Material',
    status: 'active',
    metadata: ({
      sapObject: 'Product',
      product: s(rec, 'Product'),
      productType: s(rec, 'ProductType'),
      baseUnit: s(rec, 'BaseUnit'),
      productGroup: s(rec, 'ProductGroup'),
      division: s(rec, 'Division'),
      grossWeight: s(rec, 'GrossWeight'),
      weightUnit: s(rec, 'WeightUnit'),
    }),
  });
}

export function mapInventory(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  const material = s(rec, 'Material');
  const plant = s(rec, 'Plant');
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_inventory, rec),
    title: `Stock ${material ?? ''} @ ${plant ?? ''}`.trim(),
    status: 'active',
    metadata: ({
      sapObject: 'MaterialStock',
      material,
      plant,
      storageLocation: s(rec, 'StorageLocation'),
      quantity: s(rec, 'MatlWrhsStkQtyInMatlBaseUnit'),
      baseUnit: s(rec, 'MaterialBaseUnit'),
    }),
  });
}

export function mapSalesOrder(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_sales_orders, rec),
    title: `Sales Order ${s(rec, 'SalesOrder')}`,
    status: s(rec, 'OverallSDProcessStatus'),
    timestamp: rec.SalesOrderDate ? odataIso(rec.SalesOrderDate, ctx.now) : null,
    metadata: ({
      sapObject: 'SalesOrder',
      salesOrder: s(rec, 'SalesOrder'),
      type: s(rec, 'SalesOrderType'),
      soldToParty: s(rec, 'SoldToParty'),
      netAmount: s(rec, 'TotalNetAmount'),
      currency: s(rec, 'TransactionCurrency'),
      salesOrganization: s(rec, 'SalesOrganization'),
    }),
  });
}

export function mapPurchaseOrder(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_purchase_orders, rec),
    title: `Purchase Order ${s(rec, 'PurchaseOrder')}`,
    status: s(rec, 'PurchasingProcessingStatus'),
    timestamp: rec.PurchaseOrderDate ? odataIso(rec.PurchaseOrderDate, ctx.now) : null,
    metadata: ({
      sapObject: 'PurchaseOrder',
      purchaseOrder: s(rec, 'PurchaseOrder'),
      type: s(rec, 'PurchaseOrderType'),
      supplier: s(rec, 'Supplier'),
      companyCode: s(rec, 'CompanyCode'),
      purchasingOrganization: s(rec, 'PurchasingOrganization'),
      currency: s(rec, 'DocumentCurrency'),
    }),
  });
}

export function mapProductionOrder(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_production_orders, rec),
    title: `Production Order ${s(rec, 'ManufacturingOrder')}`,
    status: s(rec, 'ManufacturingOrderType'),
    timestamp: rec.MfgOrderPlannedStartDate ? odataIso(rec.MfgOrderPlannedStartDate, ctx.now) : null,
    endTimestamp: rec.MfgOrderPlannedEndDate ? odataIso(rec.MfgOrderPlannedEndDate, ctx.now) : null,
    metadata: ({
      sapObject: 'ManufacturingOrder',
      manufacturingOrder: s(rec, 'ManufacturingOrder'),
      material: s(rec, 'Material'),
      productionPlant: s(rec, 'ProductionPlant'),
      totalQuantity: s(rec, 'TotalQuantity'),
      productionUnit: s(rec, 'ProductionUnit'),
    }),
  });
}

export function mapFinancialDocument(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_financials, rec),
    title: `Doc ${s(rec, 'AccountingDocument')}/${s(rec, 'FiscalYear')} · ${s(rec, 'CompanyCode')}`,
    status: 'posted',
    timestamp: rec.PostingDate ? odataIso(rec.PostingDate, ctx.now) : null,
    metadata: ({
      sapObject: 'JournalEntryItem',
      companyCode: s(rec, 'CompanyCode'),
      fiscalYear: s(rec, 'FiscalYear'),
      accountingDocument: s(rec, 'AccountingDocument'),
      glAccount: s(rec, 'GLAccount'),
      amount: s(rec, 'AmountInCompanyCodeCurrency'),
      currency: s(rec, 'CompanyCodeCurrency'),
      ledger: s(rec, 'Ledger'),
    }),
  });
}

export function mapPlant(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_plants, rec),
    title: s(rec, 'PlantName') || `Plant ${s(rec, 'Plant')}`,
    status: 'active',
    metadata: ({ sapObject: 'Plant', plant: s(rec, 'Plant'), name: s(rec, 'PlantName') }),
  });
}

export function mapWarehouse(ctx: SyncContext, rec: SapRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.sap_warehouses, rec),
    title: s(rec, 'WarehouseName') || s(rec, 'EWMWarehouse') || `Warehouse ${s(rec, 'Warehouse')}`,
    status: 'active',
    metadata: ({ sapObject: 'Warehouse', warehouse: s(rec, 'EWMWarehouse') || s(rec, 'Warehouse'), name: s(rec, 'WarehouseName') }),
  });
}

/* ── Object catalog ────────────────────────────────────────────────────────────── */

const SPECS: SapSpec[] = [
  { id: 'sap_business_partners', label: 'Business Partners', service: 'API_BUSINESS_PARTNER', entitySet: 'A_BusinessPartner', kind: 'organization', prefix: 'business_partner-',
    keyFields: ['BusinessPartner'], deltaField: 'LastChangeDate', deltaType: 'datetime', createdField: 'CreationDate', map: mapBusinessPartner,
    fields: ['BusinessPartnerFullName', 'BusinessPartnerName', 'BusinessPartnerCategory', 'OrganizationBPName1', 'FirstName', 'LastName', 'BusinessPartnerGrouping'] },
  { id: 'sap_customers', label: 'Customers', service: 'API_BUSINESS_PARTNER', entitySet: 'A_Customer', kind: 'organization', prefix: 'customer-',
    keyFields: ['Customer'], deltaField: null, deltaType: null, createdField: null, map: mapCustomer,
    fields: ['CustomerName', 'CustomerFullName', 'CustomerAccountGroup', 'BillingIsBlockedForCustomer', 'Country'] },
  { id: 'sap_suppliers', label: 'Suppliers', service: 'API_BUSINESS_PARTNER', entitySet: 'A_Supplier', kind: 'organization', prefix: 'supplier-',
    keyFields: ['Supplier'], deltaField: null, deltaType: null, createdField: null, map: mapSupplier,
    fields: ['SupplierName', 'SupplierFullName', 'SupplierAccountGroup', 'PaymentIsBlockedForSupplier', 'Country'] },
  { id: 'sap_materials', label: 'Materials', service: 'API_PRODUCT_SRV', entitySet: 'A_Product', kind: 'document', prefix: 'material-',
    keyFields: ['Product'], deltaField: 'LastChangeDateTime', deltaType: 'datetimeoffset', createdField: 'CreationDate', map: mapMaterial,
    fields: ['ProductType', 'BaseUnit', 'ProductGroup', 'Division', 'GrossWeight', 'NetWeight', 'WeightUnit'] },
  { id: 'sap_inventory', label: 'Inventory', service: 'API_MATERIAL_STOCK_SRV', entitySet: 'A_MaterialStock', kind: 'document', prefix: 'inventory-',
    keyFields: ['Material', 'Plant', 'StorageLocation'], deltaField: null, deltaType: null, createdField: null, map: mapInventory,
    fields: ['MatlWrhsStkQtyInMatlBaseUnit', 'MaterialBaseUnit'] },
  { id: 'sap_sales_orders', label: 'Sales Orders', service: 'API_SALES_ORDER_SRV', entitySet: 'A_SalesOrder', kind: 'task', prefix: 'sales_order-',
    keyFields: ['SalesOrder'], deltaField: 'LastChangeDateTime', deltaType: 'datetimeoffset', createdField: 'CreationDate', map: mapSalesOrder,
    fields: ['SalesOrderType', 'SalesOrganization', 'SoldToParty', 'TotalNetAmount', 'TransactionCurrency', 'OverallSDProcessStatus', 'SalesOrderDate'] },
  { id: 'sap_purchase_orders', label: 'Purchase Orders', service: 'API_PURCHASEORDER_PROCESS_SRV', entitySet: 'A_PurchaseOrder', kind: 'task', prefix: 'purchase_order-',
    keyFields: ['PurchaseOrder'], deltaField: 'LastChangeDateTime', deltaType: 'datetimeoffset', createdField: 'CreationDate', map: mapPurchaseOrder,
    fields: ['PurchaseOrderType', 'Supplier', 'CompanyCode', 'PurchasingOrganization', 'DocumentCurrency', 'PurchaseOrderDate', 'PurchasingProcessingStatus'] },
  { id: 'sap_production_orders', label: 'Production Orders', service: 'API_PRODUCTION_ORDER_2_SRV', entitySet: 'A_ProductionOrder_2', kind: 'task', prefix: 'production_order-',
    keyFields: ['ManufacturingOrder'], deltaField: 'LastChangeDateTime', deltaType: 'datetimeoffset', createdField: null, map: mapProductionOrder,
    fields: ['Material', 'ProductionPlant', 'ManufacturingOrderType', 'MfgOrderPlannedStartDate', 'MfgOrderPlannedEndDate', 'TotalQuantity', 'ProductionUnit'] },
  { id: 'sap_financials', label: 'Financials', service: 'API_OPLACCTGDOCITEMCUBE_SRV', entitySet: 'A_OperationalAcctgDocItemCube', kind: 'document', prefix: 'financial_document-',
    keyFields: ['CompanyCode', 'FiscalYear', 'AccountingDocument', 'AccountingDocumentItem'], deltaField: 'PostingDate', deltaType: 'datetime', createdField: null, map: mapFinancialDocument,
    fields: ['GLAccount', 'DocumentDate', 'AmountInCompanyCodeCurrency', 'CompanyCodeCurrency', 'Ledger'] },
  { id: 'sap_plants', label: 'Plants', service: 'API_PLANT_SRV', entitySet: 'A_Plant', kind: 'organization', prefix: 'plant-',
    keyFields: ['Plant'], deltaField: null, deltaType: null, createdField: null, map: mapPlant,
    fields: ['PlantName'] },
  { id: 'sap_warehouses', label: 'Warehouses', service: 'API_WAREHOUSE_SRV', entitySet: 'A_Warehouse', kind: 'organization', prefix: 'warehouse-',
    keyFields: ['EWMWarehouse'], deltaField: null, deltaType: null, createdField: null, map: mapWarehouse,
    fields: ['WarehouseName'] },
];

const SPEC_BY_ID: Record<string, SapSpec> = Object.fromEntries(SPECS.map((sp) => [sp.id, sp]));

/* ── Uniform OData V2 pull ─────────────────────────────────────────────────────── */

interface ODataResp {
  d?: { results?: SapRecord[]; __next?: string };
  value?: SapRecord[];
  '@odata.nextLink'?: string;
}

interface SapCursor {
  /** Epoch-ms high-water (max change value committed); the durable cross-run resume key (delta objects). */
  hw?: number;
  /** OData `$skip` offset. Delta: run-scoped (rebuilt from hw each run) unless `sat`; full-list: continues. */
  skip?: number;
  /** Run clock that minted skip/page (delta objects) — a fresh run rebuilds the query from the high-water. */
  runAt?: string;
  /** Max change value (epoch ms) seen this walk; committed as `hw` on drain (delta objects). */
  pending?: number;
  page?: number;
  /**
   * Saturated-boundary continuation (delta objects). When a whole MAX_PAGES run lands on ONE change value —
   * a day-granular field (Financials `PostingDate`, BusinessPartner `LastChangeDate`) with >MAX_PAGES×PAGE
   * rows on a single day, which is routine — the high-water cannot advance, so the `$skip` offset is carried
   * ACROSS runs (bypassing the run-scoped reset) to drain that boundary rather than stalling on it forever.
   * Cleared the moment the high-water advances.
   */
  sat?: boolean;
}

/**
 * Pull one page of `spec` via OData V2. Delta objects filter `<change> ge <high-water>` and order by
 * `<change>,<full key> asc` (a TOTAL order — every key field, so `$skip` paging is stable for compound-key
 * objects like Financials/Inventory too), advancing the high-water across runs; a MAX_PAGES cap normally
 * resets `$skip` and resumes from the (advanced) high-water — but if the whole run landed on ONE change
 * value (a saturated day-granular boundary), it carries `$skip` across runs to DRAIN that boundary instead
 * of stalling. Full-list objects (no change field) `$skip`-walk continuously across runs and reset on drain.
 * A page shorter than `$top` WITH a `__next`/`@odata.nextLink` means the server capped the page — advance
 * `$skip` by the actual row count so no record is skipped. A 400/404 is re-mapped so `graceful` degrades the
 * object as unprovisioned (S/4HANA field/service availability varies by release; an unlicensed service is 403).
 */
function makePull(spec: SapSpec): (ctx: SyncContext) => Promise<SyncPage> {
  const isDelta = spec.deltaField != null;
  // Full key in the sort → a total order, so `$skip` paging is stable even for compound-key objects.
  const keyOrder = spec.keyFields.map((k) => `${k} asc`).join(',');
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<SapCursor>(ctx.cursor) ?? {};
    const url = `${sapBase()}/sap/opu/odata/sap/${spec.service}/${spec.entitySet}`;

    // Delta: the $skip offset is run-scoped (a fresh run rebuilds from the high-water) UNLESS it is a
    // saturated-boundary continuation (`sat`). Full-list: the $skip offset always continues across runs.
    const sameRun = c.runAt === ctx.now;
    const carry = !isDelta || c.sat === true || sameRun;
    const skip = carry ? (c.skip ?? 0) : 0;
    const page = sameRun ? (c.page ?? 0) : 0;

    const select = [...new Set([...spec.keyFields, ...(spec.deltaField ? [spec.deltaField] : []), ...(spec.createdField ? [spec.createdField] : []), ...spec.fields])].join(',');
    const query: Record<string, string | number | boolean | undefined> = { $format: 'json', $select: select, $top: PAGE, $skip: skip };
    if (isDelta) {
      query.$orderby = `${spec.deltaField} asc,${keyOrder}`;
      // First sync (no high-water) walks everything ASC; subsequent runs filter from the high-water.
      if (c.hw != null) query.$filter = `${spec.deltaField} ge ${deltaLiteral(spec.deltaType, c.hw)}`;
    } else {
      query.$orderby = keyOrder;
    }

    let resp;
    try {
      resp = await ctx.http.getJson<ODataResp>(url, { query });
    } catch (err) {
      // A missing/unlicensed service is 404/403 (handled by graceful); a per-release field/query-shape quirk
      // is 400 — re-map to 404 so the object degrades as unprovisioned instead of failing the whole family.
      if (err instanceof HttpError && err.status === 400) {
        throw new HttpError(404, `sap: ${spec.service}/${spec.entitySet} not available on this tenant`, false);
      }
      throw err;
    }

    const rows = resp.data.d?.results ?? resp.data.value ?? [];
    const nextLink = resp.data.d?.__next ?? resp.data['@odata.nextLink'];
    const hasMoreData = rows.length === PAGE || !!nextLink;
    const entities = rows.map((r) => spec.map(ctx, r));

    if (isDelta) {
      // ASC walk → advance the high-water to the newest change value seen (the field we order/filter by).
      let pending = carry ? (c.pending ?? c.hw) : c.hw;
      for (const r of rows) {
        const t = odataEpoch(r[spec.deltaField as string]);
        if (!Number.isNaN(t) && (pending == null || t > pending)) pending = t;
      }
      if (!hasMoreData) {
        // Drain → the whole `ge hw` walk is complete; commit the newest change value and start a fresh walk.
        return { entities, cursor: toJsonCursor({ hw: pending } satisfies SapCursor), hasMore: false };
      }
      if (page + 1 < MAX_PAGES) {
        return { entities, cursor: toJsonCursor({ hw: c.hw, skip: skip + rows.length, runAt: ctx.now, pending, page: page + 1 } satisfies SapCursor), hasMore: true };
      }
      // MAX_PAGES cap. If the high-water advanced, resume from it next run (reset $skip — avoids deep offsets).
      // If it did NOT (one change value saturated the whole run), carry $skip across runs to drain it.
      const advanced = pending != null && (c.hw == null || pending > c.hw);
      return advanced
        ? { entities, cursor: toJsonCursor({ hw: pending } satisfies SapCursor), hasMore: false }
        : { entities, cursor: toJsonCursor({ hw: c.hw, skip: skip + rows.length, pending, sat: true } satisfies SapCursor), hasMore: false };
    }

    // Full-list: continue the $skip walk (across runs too, bounded by the orchestrator's page cap); reset on
    // drain so the next pass re-syncs the snapshot. The store dedups an unchanged row (no write unless changed).
    const cursor = hasMoreData ? toJsonCursor({ skip: skip + rows.length } satisfies SapCursor) : toJsonCursor({ skip: 0 } satisfies SapCursor);
    return { entities, cursor, hasMore: hasMoreData };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const SAP_REASONS = {
  unauthorized: 'Service not authorized — not in a Communication Arrangement / role for this tenant (403)',
  unprovisioned: 'Service not available for this S/4HANA tenant — not licensed, not activated, or the API shape differs by release (400/404)',
} as const;

/** Wrap a pull so one unavailable object degrades instead of failing the whole family. */
function serviceResource(spec: SapSpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), SAP_REASONS) };
}

export const sapAdapter: ConnectorAdapter = {
  connectorId: 'sap',
  baseHeaders: { Accept: 'application/json' },
  resources: SPECS.map(serviceResource),
};

/* ── Service catalog (reference; NO scope projection — access is role/arrangement-governed, like Salesforce) ── */

/** An SAP S/4HANA service (object) in the family. */
export interface SapService {
  id: string;
  label: string;
  /** The OData service this object reads. */
  service: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per object, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families, SAP has no per-
 * object OAuth scope — access is governed by the tenant's Communication Arrangement + the user's roles — so,
 * exactly like Salesforce / ServiceNow, there is no `sapServiceAvailability(grantedScopes)` projection and no
 * `serviceCapabilities` branch. The generic fallback is correct, and which modules (Finance / Procurement /
 * Manufacturing / Sales / Warehouse / …) a tenant exposes is discovered live from the per-module degrade.
 */
export const SAP_SERVICES: SapService[] = SPECS.map((sp) => ({
  id: sp.id,
  label: sp.label,
  service: sp.service,
  kind: sp.kind,
}));
