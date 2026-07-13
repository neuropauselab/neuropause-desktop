/**
 * The Oracle Fusion Cloud ERP connector FAMILY (P5 — Increment 12) — Financials, Procurement, Supply
 * Chain, Manufacturing, Projects, Inventory, Receivables & Payables via the Fusion REST framework.
 *
 * ONE connector (`oracle`) — one OAuth 2.0 app, one token, one vault record, one card, one health engine,
 * one inspector — with each Fusion business object mounted as an `AdapterResource` on the SAME
 * authenticated session, read through the uniform Fusion REST API. This mirrors, exactly, how
 * `microsoft-entra` hosts M365 and `salesforce`/`hubspot`/`servicenow`/`sap` host their objects. Every
 * resource is wrapped in the shared `graceful()` guard, so an object a pod hasn't provisioned / licensed
 * (404), the integration user's role can't read (403), or that a given Fusion release doesn't expose the
 * expected query shape for (400) degrades to a tagged empty page instead of failing the whole family.
 *
 * The Oracle wrinkles, and how each is handled by EXTENDING existing seams:
 *   • **Two hosts.** Fusion splits OAuth (Oracle Identity Cloud Service — IDCS/IAM) from the data API (the
 *     Fusion applications pod). The OAuth authorize/token URLs live on the IDCS host (in the manifest, the
 *     ServiceNow/SAP env-host precedent — `NEUROPAUSE_ORACLE_IDCS_HOST`); the REST data calls live on the
 *     Fusion host (here, the github.ts / sapBase() env-base precedent — `NEUROPAUSE_ORACLE_FUSION_HOST`).
 *     No per-org resolution call — both are configuration.
 *   • **IDCS token endpoint takes HTTP Basic client auth** (`tokenAuthStyle: 'basic'`), unlike the
 *     body-credential families; **`expires_in` (3600s) + a refresh token** (via `offline_access`) means the
 *     EXISTING proactive-refresh path covers it with no synthesized TTL (like HubSpot/ServiceNow/SAP,
 *     unlike Salesforce). Both handled entirely in the manifest — nothing here.
 *   • **Access is ROLE / data-security governed, not per-object OAuth scope** (the granted scope is the
 *     coarse Fusion resource scope; least-privilege is a read-only integration user with the relevant duty
 *     roles). So — like Salesforce/ServiceNow/SAP, unlike HubSpot — there is NO scope catalog and NO
 *     `serviceCapabilities` branch; which pillars (Financials / Procurement / SCM / Manufacturing /
 *     Projects) a pod exposes is discovered at RUNTIME from the per-module degrade the Supervisor overlays.
 *   • **Fusion REST shape** — the JSON envelope is `{items:[…], hasMore, count}` (an explicit `hasMore`
 *     boolean drives paging — no Link header); `limit`/`offset` page; `onlyData=true` strips per-row link
 *     blocks; the `q` finder filters (`LastUpdateDate >= '<ISO>'`) and `orderBy` sorts. A resource whose
 *     `q`/`orderBy` attribute isn't queryable on this release, or that requires a mandatory finder, answers
 *     **400** — which `graceful` (403/404 only) would let escape — so a 400 is re-mapped to a 404 here and
 *     degraded as unprovisioned (the runtime per-release capability probe, as in ServiceNow/SAP).
 *
 * Object → UDM (Fusion surrogate keys are unique only within an object type — a `SupplierId` and an
 * `InvoiceId` can collide — and several objects map to the same kind, so every sourceId is prefixed with
 * its object type to keep unified ids collision-free AND self-describing):
 *   business_units / suppliers / customers          → organization
 *   items / inventory / invoices / payments         → document
 *   purchase_orders / receipts / work_orders        → task
 *   projects                                        → project
 *
 * Incremental sync (the 8 objects with a change field): `LastUpdateDate >= <high-water> orderBy=
 * LastUpdateDate:asc,<full key>:asc` (the full key gives a TOTAL order, so `offset` paging is stable even
 * for the compound-key objects — items, inventory), paging within a run via `offset` and resuming across
 * runs via the durable `LastUpdateDate` high-water — a MAX_PAGES cap commits the newest LastUpdateDate seen
 * and the next run resumes from exactly there (leapfrog-free ASC-resume, as in `salesforce.ts` /
 * `servicenow.ts` / `sap.ts`). `>=` re-scans the boundary (the store dedups). Fusion `LastUpdateDate` is a
 * fractional-second timestamp so a single-instant burst never saturates a whole run; the same saturated-
 * boundary `offset` carry SAP uses is retained as defense-in-depth in case a pod returns second-granular
 * stamps. The 3 objects with no reliably-queryable change field (Business Units LOV, Suppliers, Projects)
 * are a full `offset` walk that continues across runs and resets on drain.
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

/** The env var supplying the customer's Fusion applications (data API) host. Read at call time. */
const ORACLE_FUSION_HOST_ENV = 'NEUROPAUSE_ORACLE_FUSION_HOST';
/** Fusion REST framework version segment (`…/resources/{version}/{resource}`); pinned, release-stable. */
const API_VERSION = '11.13.18.05';
/** Modest Fusion page size (`limit`); the high-water / offset continuation walks the rest. */
const PAGE = 200;
/** Bound one run's page walk. 200 × 30 = 6,000 rows/run; the high-water resumes forward (never leapfrogged). */
const MAX_PAGES = 30;
/** Overlap window subtracted from the high-water to absorb clock skew / boundary jitter (the store dedups). */
const OVERLAP_MS = 2 * 60 * 1000;
/** Stable baseline for a record missing its WHO stamps — never the run clock, which would re-churn it. */
const ORACLE_STABLE_TS = '1970-01-01T00:00:00.000Z';
/** The ECMAScript maximum valid `Date` epoch; beyond this `new Date().toISOString()` throws. */
const MAX_EPOCH_MS = 8.64e15;

/** The Fusion data-API base, from configuration (never a per-org resolution call). Read at call time so a
 *  test / late-set env is honored, exactly like sapBase() / the github.ts env-base. */
function oracleBase(): string {
  const host = (process.env[ORACLE_FUSION_HOST_ENV] ?? '').trim();
  return `https://${host || 'FUSION_HOST'}`;
}

/* ── Fusion REST helpers (LastUpdateDate/CreationDate are ISO 8601 with a UTC offset) ─────────────── */

/** Parse a Fusion date value (ISO 8601, e.g. `2024-01-15T10:30:00.123+00:00`) to epoch ms, or NaN. Range-
 *  guarded so a malformed value never makes `new Date(t).toISOString()` throw. */
function oracleEpoch(v: unknown): number {
  if (v == null) return NaN;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) && Math.abs(t) <= MAX_EPOCH_MS ? t : NaN;
}
/** Normalize a Fusion date to ISO-Z, or a fallback when absent/invalid. */
function oracleIso(v: unknown, fallback: string): string {
  const t = oracleEpoch(v);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}
/**
 * The `q`-finder datetime literal for a high-water (minus the overlap window). Fusion's `q` coerces a
 * quoted ISO-8601 string to the attribute's TIMESTAMP type; the explicit `+00:00` offset pins UTC (a bare
 * `Z` is rejected by some pods). Isolated here so a pod that wants a different shape is a one-line change.
 */
function oracleLiteral(hwMs: number): string {
  const t = Math.max(0, hwMs - OVERLAP_MS);
  return new Date(t).toISOString().replace('Z', '+00:00');
}

/** A Fusion field value as a trimmed string, or null. Fusion REST returns flat scalars (string/number/bool);
 *  IDs arrive as JSON numbers, so this stringifies them (Fusion surrogate keys sit well under 2^53). */
function s(rec: OracleRecord, k: string): string | null {
  const v = rec[k];
  if (v == null) return null;
  const str = String(v).trim();
  return str || null;
}

/** First non-null of several candidate attributes (Fusion attribute names vary slightly by release/resource). */
function firstOf(rec: OracleRecord, keys: string[]): string | null {
  for (const k of keys) {
    const v = s(rec, k);
    if (v != null) return v;
  }
  return null;
}

type OracleRecord = Record<string, unknown>;

/* ── Entity spec ───────────────────────────────────────────────────────────────── */

/** One Fusion object mounted as a service resource. id === resource id === catalog id === module-stat id. */
interface OracleSpec {
  id: string;
  label: string;
  /** REST resource collection name (`…/{apiRoot}/resources/{version}/{resource}`). */
  resource: string;
  /** REST root — `fscmRestApi` (SCM/ERP) for most, `crmRestApi` for the CX customer `accounts` resource. */
  apiRoot: 'fscmRestApi' | 'crmRestApi';
  kind: UnifiedEntityKind;
  /** Sourceid prefix + collision guard (Fusion keys are unique only within an object type). */
  prefix: string;
  /** Key field(s) — joined for the sourceId, and appended to `orderBy` for a stable total order. */
  keyFields: string[];
  /** Incremental change field (null ⇒ full-list snapshot — not reliably queryable on this resource). */
  deltaField: string | null;
  map: (ctx: SyncContext, rec: OracleRecord) => UnifiedEntity;
}

/**
 * The shared UDM envelope. `sourceId` is the prefixed, key-joined id; timestamps come from the Fusion WHO
 * columns (CreationDate / LastUpdateDate), falling back to a STABLE baseline — never the run clock — so a
 * stamp-less row isn't re-churned every sync. No `url`: a Fusion deep link needs per-pod UI config (documented).
 */
function base(ctx: SyncContext, spec: OracleSpec, rec: OracleRecord) {
  const created = oracleIso(rec.CreationDate, ORACLE_STABLE_TS);
  const updated = oracleIso(rec.LastUpdateDate, created);
  const key = spec.keyFields.map((k) => s(rec, k) ?? '').join('-');
  return {
    connectorId: ctx.connectorId,
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

export function mapBusinessUnit(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_business_units, rec),
    title: firstOf(rec, ['BusinessUnitName', 'Name']) || `Business Unit ${s(rec, 'BusinessUnitId')}`,
    status: 'active',
    metadata: {
      oracleObject: 'BusinessUnit',
      businessUnitId: s(rec, 'BusinessUnitId'),
      name: firstOf(rec, ['BusinessUnitName', 'Name']),
      ledger: firstOf(rec, ['PrimaryLedgerName', 'PrimaryLedgerId']),
      status: s(rec, 'Status'),
    },
  });
}

export function mapSupplier(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_suppliers, rec),
    title: firstOf(rec, ['SupplierName', 'Supplier']) || `Supplier ${s(rec, 'SupplierId')}`,
    status: firstOf(rec, ['Status', 'SupplierStatus']) || 'active',
    metadata: {
      oracleObject: 'Supplier',
      supplierId: s(rec, 'SupplierId'),
      supplierNumber: s(rec, 'SupplierNumber'),
      supplierType: s(rec, 'SupplierType'),
      businessRelationship: s(rec, 'BusinessRelationship'),
      taxOrganizationType: s(rec, 'TaxOrganizationType'),
      status: firstOf(rec, ['Status', 'SupplierStatus']),
    },
  });
}

export function mapCustomer(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_customers, rec),
    title: firstOf(rec, ['OrganizationName', 'PartyName', 'PartyUniqueName']) || `Customer ${s(rec, 'PartyNumber')}`,
    status: firstOf(rec, ['PartyStatus', 'Status']) || 'active',
    metadata: {
      oracleObject: 'CustomerAccount',
      partyNumber: s(rec, 'PartyNumber'),
      partyId: s(rec, 'PartyId'),
      type: firstOf(rec, ['Type', 'PartyType']),
      ownerName: s(rec, 'OwnerName'),
      country: firstOf(rec, ['Country', 'PrimaryAddressCountry']),
      currency: s(rec, 'CurrencyCode'),
    },
  });
}

export function mapItem(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_items, rec),
    title: firstOf(rec, ['ItemNumber', 'Item']) || `Item ${s(rec, 'ItemId')}`,
    status: firstOf(rec, ['ItemStatusValue', 'ItemStatus', 'LifecyclePhaseValue']) || 'active',
    body: truncate(firstOf(rec, ['ItemDescription', 'Description']), 300),
    metadata: {
      oracleObject: 'Item',
      itemId: s(rec, 'ItemId'),
      organizationId: s(rec, 'OrganizationId'),
      itemNumber: s(rec, 'ItemNumber'),
      itemClass: s(rec, 'ItemClass'),
      itemStatus: firstOf(rec, ['ItemStatusValue', 'ItemStatus']),
      lifecyclePhase: s(rec, 'LifecyclePhaseValue'),
      primaryUOM: firstOf(rec, ['PrimaryUOMValue', 'PrimaryUnitOfMeasure']),
    },
  });
}

export function mapInventory(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  const item = firstOf(rec, ['ItemNumber', 'InventoryItemId']);
  const org = firstOf(rec, ['OrganizationCode', 'OrganizationId']);
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_inventory, rec),
    title: `Stock ${item ?? ''} @ ${org ?? ''}`.trim(),
    status: 'active',
    metadata: {
      oracleObject: 'OnhandBalance',
      inventoryItemId: s(rec, 'InventoryItemId'),
      itemNumber: s(rec, 'ItemNumber'),
      organizationId: s(rec, 'OrganizationId'),
      organizationCode: s(rec, 'OrganizationCode'),
      subinventoryCode: s(rec, 'SubinventoryCode'),
      // The full physical grain — distinct balances of the same item/subinventory differ by these dimensions.
      locator: firstOf(rec, ['Locator', 'LocatorId']),
      lotNumber: s(rec, 'LotNumber'),
      serialNumber: s(rec, 'SerialNumber'),
      revision: s(rec, 'Revision'),
      quantity: firstOf(rec, ['PrimaryTransactionQuantity', 'OnhandQuantity', 'PrimaryQuantity']),
      uom: firstOf(rec, ['PrimaryUOMCode', 'UnitOfMeasure']),
    },
  });
}

export function mapPurchaseOrder(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_purchase_orders, rec),
    title: `Purchase Order ${firstOf(rec, ['OrderNumber', 'POHeaderId'])}`,
    status: firstOf(rec, ['DocumentStatus', 'Status']),
    timestamp: rec.CreationDate ? oracleIso(rec.CreationDate, ctx.now) : null,
    metadata: {
      oracleObject: 'PurchaseOrder',
      poHeaderId: s(rec, 'POHeaderId'),
      orderNumber: s(rec, 'OrderNumber'),
      supplier: firstOf(rec, ['Supplier', 'SupplierId']),
      procurementBU: firstOf(rec, ['ProcurementBU', 'ProcurementBUId']),
      buyer: s(rec, 'Buyer'),
      status: firstOf(rec, ['DocumentStatus', 'Status']),
      total: s(rec, 'Total'),
      currency: firstOf(rec, ['CurrencyCode', 'Currency']),
    },
  });
}

export function mapReceipt(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_receipts, rec),
    title: `Receipt ${firstOf(rec, ['ReceiptNumber', 'TransactionId'])}`,
    status: firstOf(rec, ['TransactionType', 'TransactionStatus']),
    timestamp: rec.TransactionDate ? oracleIso(rec.TransactionDate, ctx.now) : null,
    metadata: {
      oracleObject: 'ReceivingTransaction',
      transactionId: s(rec, 'TransactionId'),
      receiptNumber: s(rec, 'ReceiptNumber'),
      transactionType: s(rec, 'TransactionType'),
      item: firstOf(rec, ['ItemNumber', 'ItemDescription']),
      quantity: s(rec, 'Quantity'),
      poNumber: firstOf(rec, ['DocumentNumber', 'OrderNumber']),
      supplier: s(rec, 'VendorName'),
    },
  });
}

export function mapInvoice(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_invoices, rec),
    title: `Invoice ${firstOf(rec, ['InvoiceNumber', 'InvoiceId'])}`,
    status: firstOf(rec, ['InvoiceStatus', 'ApprovalStatus', 'PaymentStatus']),
    timestamp: rec.InvoiceDate ? oracleIso(rec.InvoiceDate, ctx.now) : null,
    metadata: {
      oracleObject: 'PayablesInvoice',
      invoiceId: s(rec, 'InvoiceId'),
      invoiceNumber: s(rec, 'InvoiceNumber'),
      supplier: firstOf(rec, ['Supplier', 'SupplierName']),
      businessUnit: firstOf(rec, ['BusinessUnit', 'InvoiceBusinessUnit']),
      amount: firstOf(rec, ['InvoiceAmount', 'Amount']),
      currency: firstOf(rec, ['InvoiceCurrency', 'CurrencyCode']),
      invoiceType: firstOf(rec, ['InvoiceType', 'Type']),
      status: firstOf(rec, ['InvoiceStatus', 'ApprovalStatus']),
    },
  });
}

export function mapPayment(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_payments, rec),
    title: `Payment ${firstOf(rec, ['PaymentNumber', 'CheckId'])}`,
    status: firstOf(rec, ['PaymentStatus', 'Status']),
    timestamp: rec.PaymentDate ? oracleIso(rec.PaymentDate, ctx.now) : null,
    metadata: {
      oracleObject: 'PayablesPayment',
      checkId: s(rec, 'CheckId'),
      paymentNumber: s(rec, 'PaymentNumber'),
      payee: firstOf(rec, ['PayeeName', 'Supplier', 'SupplierName']),
      businessUnit: firstOf(rec, ['BusinessUnit', 'PaymentBusinessUnit']),
      amount: firstOf(rec, ['PaymentAmount', 'Amount']),
      currency: firstOf(rec, ['CurrencyCode', 'Currency']),
      paymentType: firstOf(rec, ['PaymentType', 'PaymentMethod']),
      status: firstOf(rec, ['PaymentStatus', 'Status']),
    },
  });
}

export function mapProject(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_projects, rec),
    title: firstOf(rec, ['ProjectName', 'Name']) || `Project ${firstOf(rec, ['ProjectNumber', 'ProjectId'])}`,
    status: firstOf(rec, ['ProjectStatus', 'Status']),
    timestamp: rec.StartDate ? oracleIso(rec.StartDate, ctx.now) : null,
    endTimestamp: rec.FinishDate ? oracleIso(rec.FinishDate, ctx.now) : null,
    metadata: {
      oracleObject: 'Project',
      projectId: s(rec, 'ProjectId'),
      projectNumber: s(rec, 'ProjectNumber'),
      name: firstOf(rec, ['ProjectName', 'Name']),
      projectManager: firstOf(rec, ['ProjectManagerName', 'ProjectManager']),
      businessUnit: firstOf(rec, ['BusinessUnit', 'ProjectBusinessUnit']),
      status: firstOf(rec, ['ProjectStatus', 'Status']),
    },
  });
}

export function mapWorkOrder(ctx: SyncContext, rec: OracleRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.oracle_work_orders, rec),
    title: `Work Order ${firstOf(rec, ['WorkOrderNumber', 'WorkOrderId'])}`,
    status: firstOf(rec, ['WorkOrderStatusValue', 'StatusCode', 'Status']),
    timestamp: rec.PlannedStartDate ? oracleIso(rec.PlannedStartDate, ctx.now) : null,
    endTimestamp: rec.PlannedCompletionDate ? oracleIso(rec.PlannedCompletionDate, ctx.now) : null,
    metadata: {
      oracleObject: 'WorkOrder',
      workOrderId: s(rec, 'WorkOrderId'),
      workOrderNumber: s(rec, 'WorkOrderNumber'),
      workOrderType: firstOf(rec, ['WorkOrderType', 'WorkOrderSubType']),
      item: firstOf(rec, ['ItemNumber', 'InventoryItemId']),
      organization: firstOf(rec, ['OrganizationCode', 'OrganizationId']),
      quantity: firstOf(rec, ['PlannedQuantity', 'WorkOrderQuantity']),
      status: firstOf(rec, ['WorkOrderStatusValue', 'StatusCode']),
    },
  });
}

/* ── Object catalog ────────────────────────────────────────────────────────────── */

const SPECS: OracleSpec[] = [
  // ── Full-list masters (no reliably-queryable change field → continuous offset walk, reset on drain) ──
  { id: 'oracle_business_units', label: 'Business Units', resource: 'finBusinessUnitsLOV', apiRoot: 'fscmRestApi', kind: 'organization', prefix: 'business_unit-',
    keyFields: ['BusinessUnitId'], deltaField: null, map: mapBusinessUnit },
  { id: 'oracle_suppliers', label: 'Suppliers', resource: 'suppliers', apiRoot: 'fscmRestApi', kind: 'organization', prefix: 'supplier-',
    keyFields: ['SupplierId'], deltaField: null, map: mapSupplier },
  { id: 'oracle_projects', label: 'Projects', resource: 'projects', apiRoot: 'fscmRestApi', kind: 'project', prefix: 'project-',
    keyFields: ['ProjectId'], deltaField: null, map: mapProject },
  // ── Incremental objects (LastUpdateDate high-water, ASC-resume) ──
  { id: 'oracle_customers', label: 'Customers', resource: 'accounts', apiRoot: 'crmRestApi', kind: 'organization', prefix: 'customer-',
    keyFields: ['PartyNumber'], deltaField: 'LastUpdateDate', map: mapCustomer },
  { id: 'oracle_items', label: 'Items', resource: 'itemsV2', apiRoot: 'fscmRestApi', kind: 'document', prefix: 'item-',
    keyFields: ['ItemId', 'OrganizationId'], deltaField: 'LastUpdateDate', map: mapItem },
  // Inventory grain is one row PER (org, item, subinventory, locator, lot, serial, revision) — NOT just
  // (item, org, subinventory). The full dimension set is the sourceId key AND the offset-paging total order,
  // so lot/locator/serial-controlled balances get collision-free unified ids instead of overwriting each
  // other. Absent dimensions (a non-lot item) resolve to '' in the joined key — still deterministic + unique.
  { id: 'oracle_inventory', label: 'Inventory', resource: 'inventoryOnhandBalances', apiRoot: 'fscmRestApi', kind: 'document', prefix: 'inventory-',
    keyFields: ['OrganizationId', 'InventoryItemId', 'SubinventoryCode', 'LocatorId', 'LotNumber', 'SerialNumber', 'Revision'], deltaField: 'LastUpdateDate', map: mapInventory },
  { id: 'oracle_purchase_orders', label: 'Purchase Orders', resource: 'purchaseOrders', apiRoot: 'fscmRestApi', kind: 'task', prefix: 'purchase_order-',
    keyFields: ['POHeaderId'], deltaField: 'LastUpdateDate', map: mapPurchaseOrder },
  { id: 'oracle_receipts', label: 'Receipts', resource: 'receivingTransactionsHistory', apiRoot: 'fscmRestApi', kind: 'task', prefix: 'receipt-',
    keyFields: ['TransactionId'], deltaField: 'LastUpdateDate', map: mapReceipt },
  { id: 'oracle_invoices', label: 'Invoices', resource: 'invoices', apiRoot: 'fscmRestApi', kind: 'document', prefix: 'invoice-',
    keyFields: ['InvoiceId'], deltaField: 'LastUpdateDate', map: mapInvoice },
  { id: 'oracle_payments', label: 'Payments', resource: 'payablesPayments', apiRoot: 'fscmRestApi', kind: 'document', prefix: 'payment-',
    keyFields: ['CheckId'], deltaField: 'LastUpdateDate', map: mapPayment },
  { id: 'oracle_work_orders', label: 'Work Orders', resource: 'workOrders', apiRoot: 'fscmRestApi', kind: 'task', prefix: 'work_order-',
    keyFields: ['WorkOrderId'], deltaField: 'LastUpdateDate', map: mapWorkOrder },
];

const SPEC_BY_ID: Record<string, OracleSpec> = Object.fromEntries(SPECS.map((sp) => [sp.id, sp]));

/* ── Uniform Fusion REST pull ──────────────────────────────────────────────────── */

interface OracleResp {
  items?: OracleRecord[];
  hasMore?: boolean;
  count?: number;
}

interface OracleCursor {
  /** Epoch-ms high-water (max LastUpdateDate committed); the durable cross-run resume key (delta objects). */
  hw?: number;
  /** Fusion `offset`. Delta: run-scoped (rebuilt from hw each run) unless `sat`; full-list: continues. */
  offset?: number;
  /** Run clock that minted offset/page (delta objects); a fresh run rebuilds the query from the high-water. */
  runAt?: string;
  /** Max LastUpdateDate (epoch ms) seen this walk; committed as `hw` on drain/cap (delta objects). */
  pending?: number;
  page?: number;
  /**
   * Saturated-boundary continuation (delta objects). If a whole MAX_PAGES run landed on ONE LastUpdateDate
   * instant — impossible for a fractional-second stamp, but a guard in case a pod returns second-granular
   * stamps and >MAX_PAGES×PAGE rows share a second — the high-water cannot advance, so `offset` is carried
   * ACROSS runs (bypassing the run-scoped reset) to drain that boundary rather than stalling on it forever.
   * Cleared the moment the high-water advances. Mirrors the proven `sap.ts` fix.
   */
  sat?: boolean;
}

/**
 * Pull one page of `spec` via the Fusion REST API. Delta objects filter `LastUpdateDate >= <high-water>`
 * and order by `LastUpdateDate:asc,<full key>:asc` (a TOTAL order — every key field, so `offset` paging is
 * stable for compound-key objects like Items / Inventory too), advancing the high-water across runs; a
 * MAX_PAGES cap commits the newest LastUpdateDate and the next run resumes from it — but if the whole run
 * landed on ONE instant (a saturated boundary) it carries `offset` across runs to DRAIN it instead of
 * stalling. Full-list objects (no change field) `offset`-walk continuously across runs and reset on drain.
 * A 400 (attribute not queryable on this release / a mandatory-finder resource) is re-mapped to a 404 so
 * `graceful` degrades the object as unprovisioned instead of failing the whole family (403 = role/licence).
 */
function makePull(spec: OracleSpec): (ctx: SyncContext) => Promise<SyncPage> {
  const isDelta = spec.deltaField != null;
  // Full key in the sort → a total order, so `offset` paging is stable even for compound-key objects.
  const keyOrder = spec.keyFields.map((k) => `${k}:asc`).join(',');
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<OracleCursor>(ctx.cursor) ?? {};
    const url = `${oracleBase()}/${spec.apiRoot}/resources/${API_VERSION}/${spec.resource}`;

    // Delta: the offset is run-scoped (a fresh run rebuilds from the high-water) UNLESS it is a saturated-
    // boundary continuation (`sat`). Full-list: the offset always continues across runs.
    const sameRun = c.runAt === ctx.now;
    const carry = !isDelta || c.sat === true || sameRun;
    const offset = carry ? (c.offset ?? 0) : 0;
    const page = sameRun ? (c.page ?? 0) : 0;

    const query: Record<string, string | number | boolean | undefined> = {
      onlyData: true,
      limit: PAGE,
      offset,
    };
    if (isDelta) {
      query.orderBy = `${spec.deltaField}:asc,${keyOrder}`;
      // First sync (no high-water) walks everything ASC; subsequent runs filter from the high-water.
      if (c.hw != null) query.q = `${spec.deltaField} >= '${oracleLiteral(c.hw)}'`;
    } else {
      query.orderBy = keyOrder;
    }

    let resp;
    try {
      resp = await ctx.http.getJson<OracleResp>(url, { query });
    } catch (err) {
      // Fusion returns 400 for BOTH a resource that isn't available on this pod/release AND a malformed query
      // (a non-queryable `q`/`orderBy` attribute, an unsupported literal, or a resource that mandates a
      // finder). Unlike ServiceNow — which silently IGNORES a bad query rather than 400-ing it, so a 400
      // there reliably means "table absent" — a Fusion 400 cannot be disambiguated from the status alone. So
      // we degrade the resource (one object down never fails the family) but SURFACE it with a distinct,
      // observable reason — never a silent healthy zero — so a systematic query-shape problem (which would
      // hit every delta object at once) is visible in the module status and not mistaken for one unlicensed
      // pillar. The cursor is preserved (no high-water advance), exactly like graceful's native-404 path.
      if (err instanceof HttpError && err.status === 400) {
        return {
          entities: [],
          deletedSourceIds: [],
          cursor: ctx.cursor,
          hasMore: false,
          degraded: {
            kind: 'unprovisioned',
            reason: `Oracle object ${spec.resource} returned 400 — not provisioned on this pod, or its ${spec.deltaField ?? 'orderBy'} query shape is unsupported on this release (verify the resource is provisioned and queryable)`,
          },
        };
      }
      throw err;
    }

    const rows = resp.data.items ?? [];
    // Fusion's `hasMore` boolean is authoritative; the `rows.length > 0` guard stops a pathological
    // hasMore-with-no-rows response from advancing the offset forever.
    const hasMoreData = resp.data.hasMore === true && rows.length > 0;
    const entities = rows.map((r) => spec.map(ctx, r));

    if (isDelta) {
      // ASC walk → advance the high-water to the newest LastUpdateDate seen (the field we order/filter by).
      let pending = carry ? (c.pending ?? c.hw) : c.hw;
      for (const r of rows) {
        const t = oracleEpoch(r[spec.deltaField as string]);
        if (!Number.isNaN(t) && (pending == null || t > pending)) pending = t;
      }
      if (!hasMoreData) {
        // Drain → the whole `>= hw` walk is complete; commit the newest LastUpdateDate and start fresh.
        return { entities, cursor: toJsonCursor({ hw: pending } satisfies OracleCursor), hasMore: false };
      }
      if (page + 1 < MAX_PAGES) {
        // Advance the offset by the ACTUAL row count (not the fixed PAGE) so a server-capped short page WITH
        // more rows doesn't skip the gap — mirrors sap.ts's `skip + rows.length`.
        return { entities, cursor: toJsonCursor({ hw: c.hw, offset: offset + rows.length, runAt: ctx.now, pending, page: page + 1 } satisfies OracleCursor), hasMore: true };
      }
      // MAX_PAGES cap. If the high-water advanced, resume from it next run (reset offset — avoids deep offsets).
      // If it did NOT (one instant saturated the whole run), carry offset across runs to drain it.
      const advanced = pending != null && (c.hw == null || pending > c.hw);
      return advanced
        ? { entities, cursor: toJsonCursor({ hw: pending } satisfies OracleCursor), hasMore: false }
        : { entities, cursor: toJsonCursor({ hw: c.hw, offset: offset + rows.length, pending, sat: true } satisfies OracleCursor), hasMore: false };
    }

    // Full-list: continue the offset walk (across runs too, bounded by the orchestrator's page cap); reset on
    // drain so the next pass re-syncs the snapshot. The store dedups an unchanged row (no write unless changed).
    // Advance by the actual row count (not the fixed PAGE) so a short page WITH more never skips the gap.
    const cursor = hasMoreData ? toJsonCursor({ offset: offset + rows.length } satisfies OracleCursor) : toJsonCursor({ offset: 0 } satisfies OracleCursor);
    return { entities, cursor, hasMore: hasMoreData };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const ORACLE_REASONS = {
  unauthorized: 'Service not authorized — the integration user\'s roles / data-security policies cannot read this object (403)',
  unprovisioned: 'Object not available for this Oracle Fusion pod — not licensed, not provisioned, or the resource shape differs by release (400/404)',
} as const;

/** Wrap a pull so one unavailable object degrades instead of failing the whole family. */
function serviceResource(spec: OracleSpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), ORACLE_REASONS) };
}

export const oracleAdapter: ConnectorAdapter = {
  connectorId: 'oracle',
  baseHeaders: { Accept: 'application/json' },
  resources: SPECS.map(serviceResource),
};

/* ── Service catalog (reference; NO scope projection — access is role/data-security-governed, like SAP) ── */

/** An Oracle Fusion ERP service (object) in the family. */
export interface OracleService {
  id: string;
  label: string;
  /** The Fusion REST resource this object reads. */
  resource: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per object, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families (Google / GitHub
 * / Slack / Atlassian / HubSpot), Oracle Fusion has no per-object OAuth scope — access is governed by the
 * integration user's roles + data-security policies — so, exactly like Salesforce / ServiceNow / SAP, there
 * is no `oracleServiceAvailability(grantedScopes)` projection and no `serviceCapabilities` branch. The
 * generic fallback is correct, and which pillars (Financials / Procurement / SCM / Manufacturing /
 * Projects) a pod exposes is discovered live from the per-module degrade (a missing object's 400/404).
 */
export const ORACLE_SERVICES: OracleService[] = SPECS.map((sp) => ({
  id: sp.id,
  label: sp.label,
  resource: sp.resource,
  kind: sp.kind,
}));
