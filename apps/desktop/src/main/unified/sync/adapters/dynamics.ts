/**
 * The Microsoft Dynamics 365 connector FAMILY (P5 — Increment 13) — Sales, Customer Service, Field
 * Service, Project Operations and the core Dataverse tables via the Dataverse Web API.
 *
 * ONE connector (`dynamics365`) — one Microsoft Entra OAuth app, one token, one vault record, one card, one
 * health engine, one inspector — with each Dataverse table mounted as an `AdapterResource` on the SAME
 * authenticated session, read through the uniform OData v4 Web API. This mirrors, exactly, how
 * `microsoft-entra` hosts M365 and `salesforce`/`servicenow`/`sap`/`oracle` host their objects. Every
 * resource is wrapped in the shared `graceful()` guard, so a table whose first-party solution isn't
 * installed (404 `0x8006088a`), the user's security role can't read (403), or that a customization made
 * unqueryable (400) degrades to a tagged empty page instead of failing the whole family.
 *
 * The Dynamics wrinkles, and how each is handled by EXTENDING existing seams:
 *   • **Same identity provider as Entra.** Dynamics authenticates through Microsoft Entra ID — the exact
 *     `login.microsoftonline.com/{tenant}/oauth2/v2.0` endpoints the `microsoft-entra` connector already
 *     uses (PKCE public client, `offline_access` → refresh, `expires_in` → the existing proactive-refresh
 *     path, no synthesized TTL). The ONLY difference is the resource scope, which is the per-org Dataverse
 *     URL. Handled entirely in the manifest — nothing here.
 *   • **Per-org data host.** The Dataverse Web API lives on the customer's org host
 *     (`https://{org}.crm.dynamics.com`), built from `NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL` — in the
 *     manifest (for the OAuth resource scope, the ServiceNow/SAP env-host precedent) and here (for the data
 *     calls, the github.ts / sapBase() env-base precedent). Read at call time so a late-set env is honored.
 *   • **Access is security-role governed, not per-object OAuth scope** — the single `user_impersonation`
 *     scope unlocks the whole Web API; which tables a user can read is governed by Dataverse security roles.
 *     So — like Salesforce/ServiceNow/SAP/Oracle, unlike the scope-gated families — there is NO scope
 *     catalog and NO `serviceCapabilities` branch; which apps (Sales / Customer Service / Field Service /
 *     Project Operations / …) a org exposes is discovered at RUNTIME from the per-module degrade.
 *   • **OData v4 shape** — the JSON envelope is `{value:[…], '@odata.nextLink'}`; pagination is a
 *     server-driven opaque `$skiptoken` cookie followed via `@odata.nextLink` VERBATIM (`$skip`/offset is
 *     NOT supported); page size is the `Prefer: odata.maxpagesize` header; option-set / status / money
 *     fields carry a companion `…@OData.Community.Display.V1.FormattedValue` label when the FormattedValue
 *     annotation is requested. Dataverse GUIDs are globally unique across tables, so — like Salesforce —
 *     the raw GUID is the sourceId (no per-object prefix), and every record is deep-linkable.
 *
 * Table → UDM:
 *   accounts                                        → organization
 *   contacts / leads / systemusers                  → contact
 *   opportunities / incidents / salesorders /
 *     msdyn_purchaseorders                          → task
 *   products / invoices / msdyn_customerassets      → document
 *   msdyn_projects                                  → project
 *
 * Incremental sync is uniform across all twelve tables: `$filter=modifiedon ge <high-water> $orderby=
 * modifiedon asc`, paging WITHIN a run by following `@odata.nextLink` and resuming ACROSS runs via the
 * durable `modifiedon` high-water — a MAX_PAGES cap commits the newest `modifiedon` seen and the next run
 * resumes from exactly there. This is the leapfrog-free ASC-resume proven at `salesforce.ts` /
 * `servicenow.ts` / `oracle.ts`, adapted to Dataverse's nextLink cursor (which pages positionally, so a
 * saturated instant is drained by the cursor itself rather than an offset). `ge` (inclusive, minus an
 * overlap window) re-scans the boundary — the store dedups. A saturated-instant `next` carry (the SAP/
 * Oracle `sat` fix) is retained as defense-in-depth for the extreme case of >MAX_PAGES×PAGE modifications
 * sharing one `modifiedon` instant. NOTE: a `modifiedon` watermark does not observe hard deletes (a deleted
 * row simply stops appearing); delete detection would need Dataverse change-tracking (documented).
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

/** The env var supplying the customer's Dataverse org URL (also read by the manifest for the OAuth scope). */
const DYN_ORG_URL_ENV = 'NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL';
/** Dataverse Web API version segment (`/api/data/{version}/…`); pinned, release-stable. */
const API_VERSION = 'v9.2';
/** OData page size (`Prefer: odata.maxpagesize`). Dataverse default/max is 5000; a modest size bounds payloads. */
const PAGE = 200;
/**
 * Bound one run's page walk. 200 × 25 = 5,000 rows/run; the high-water resumes forward (never leapfrogged).
 * MUST stay below the orchestrator's MAX_PAGES_PER_RESOURCE (50) so THIS adapter self-caps first (returning
 * hasMore:false at the cap and committing an advanced high-water). If the orchestrator broke the loop first,
 * the within-run cursor's high-water would never advance and the table would re-scan the same prefix forever.
 */
const MAX_PAGES = 25;
/** Overlap window subtracted from the high-water to absorb clock skew / boundary jitter (the store dedups). */
const OVERLAP_MS = 2 * 60 * 1000;
/** Stable baseline for a record missing its WHO stamps — never the run clock, which would re-churn it. */
const DYN_STABLE_TS = '1970-01-01T00:00:00.000Z';
/** The ECMAScript maximum valid `Date` epoch; beyond this `new Date().toISOString()` throws. */
const MAX_EPOCH_MS = 8.64e15;

/**
 * The Prefer header: bound the page size AND request the FormattedValue annotation so option-set / status /
 * money fields come back with a human-readable `…@OData.Community.Display.V1.FormattedValue` companion.
 * Resent on every request (including a followed `@odata.nextLink`), as the platform requires.
 */
const DYN_HEADERS: Record<string, string> = {
  Prefer: `odata.maxpagesize=${PAGE},odata.include-annotations="OData.Community.Display.V1.FormattedValue"`,
};

/** The Dataverse org base URL, from configuration (never a per-org resolution call). Read at call time so a
 *  test / late-set env is honored, exactly like sapBase() / the github.ts env-base. Trailing slash trimmed. */
function dynBase(): string {
  const raw = (process.env[DYN_ORG_URL_ENV] ?? '').trim().replace(/\/+$/, '');
  return raw || 'https://ORG.crm.dynamics.com';
}

/* ── Dataverse helpers (modifiedon/createdon are Edm.DateTimeOffset ISO strings, UTC) ─────────────── */

/** Parse a Dataverse date value (ISO 8601, e.g. `2024-01-15T10:30:00Z`) to epoch ms, or NaN. Range-guarded
 *  so a malformed value never makes `new Date(t).toISOString()` throw. */
function dynEpoch(v: unknown): number {
  if (v == null) return NaN;
  const t = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(t) && Math.abs(t) <= MAX_EPOCH_MS ? t : NaN;
}
/** Normalize a Dataverse date to ISO-Z, or a fallback when absent/invalid. */
function dynIso(v: unknown, fallback: string): string {
  const t = dynEpoch(v);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}
/**
 * The `$filter` datetime literal for a high-water (minus the overlap window). Dataverse expects an
 * UNQUOTED ISO-8601 datetime (`modifiedon ge 2024-01-15T10:28:00.000Z`) — quoting it is a type error. The
 * `Z` suffix pins UTC. Isolated here so a change to the accepted shape is a one-line edit.
 */
function dynLiteral(hwMs: number): string {
  return new Date(Math.max(0, hwMs - OVERLAP_MS)).toISOString();
}

type DynRecord = Record<string, unknown>;

/** A Dataverse field value as a trimmed string, or null. */
function s(rec: DynRecord, k: string): string | null {
  const v = rec[k];
  if (v == null) return null;
  const str = String(v).trim();
  return str || null;
}

/**
 * A field's human-readable FormattedValue annotation (option-set / status / money / lookup labels) when the
 * FormattedValue annotation was requested, falling back to the raw scalar. This is why the pull sends the
 * `odata.include-annotations` Prefer — a `statuscode` of `1` comes back with a `"In Progress"` label.
 */
function fv(rec: DynRecord, k: string): string | null {
  const formatted = rec[`${k}@OData.Community.Display.V1.FormattedValue`];
  if (formatted != null) {
    const str = String(formatted).trim();
    if (str) return str;
  }
  return s(rec, k);
}

/** The record deep link — the model-driven-app record form. `base` + the singular logical name are known,
 *  so Dynamics entities ARE linkable (unlike SAP/Oracle). */
function recordUrl(base: string, etn: string, guid: string): string {
  return `${base}/main.aspx?pagetype=entityrecord&etn=${etn}&id=${guid}`;
}

/* ── Entity spec ───────────────────────────────────────────────────────────────── */

/** One Dataverse table mounted as a service resource. id === resource id === catalog id === module-stat id. */
interface DynSpec {
  id: string;
  label: string;
  /** Plural entity-set name — the `/api/data/v9.2/{entitySet}` segment (case-sensitive). */
  entitySet: string;
  /** Singular logical name — for the record deep link (`etn=`). */
  etn: string;
  /** GUID primary-key attribute — the (globally-unique) sourceId. */
  key: string;
  /** Primary display-name attribute. */
  nameField: string;
  kind: UnifiedEntityKind;
  /** `$select` fields (all standard, stable logical names; keeps payloads small without field-name risk). */
  select: string[];
  map: (ctx: SyncContext, rec: DynRecord) => UnifiedEntity;
}

/**
 * The shared UDM envelope. `sourceId` is the raw Dataverse GUID (globally unique across tables — no prefix,
 * like Salesforce); the deep link is the model-driven-app record form; timestamps come from the Dataverse
 * WHO columns (createdon / modifiedon), falling back to a STABLE baseline — never the run clock — so a
 * stamp-less row isn't re-churned every sync.
 */
function base(ctx: SyncContext, spec: DynSpec, rec: DynRecord) {
  const guid = s(rec, spec.key);
  const created = dynIso(rec.createdon, DYN_STABLE_TS);
  const updated = dynIso(rec.modifiedon, created);
  return {
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: spec.kind,
    sourceId: guid ?? '',
    now: ctx.now,
    url: guid ? recordUrl(dynBase(), spec.etn, guid) : null,
    createdAt: created,
    updatedAt: updated,
  } as const;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────────── */

export function mapAccount(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_accounts, rec),
    title: s(rec, 'name') || `Account ${s(rec, 'accountid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    author: s(rec, 'emailaddress1'),
    metadata: {
      dynamicsEntity: 'account',
      accountNumber: s(rec, 'accountnumber'),
      phone: s(rec, 'telephone1'),
      email: s(rec, 'emailaddress1'),
      website: s(rec, 'websiteurl'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapContact(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_contacts, rec),
    title: s(rec, 'fullname') || s(rec, 'emailaddress1') || `Contact ${s(rec, 'contactid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    author: s(rec, 'emailaddress1'),
    metadata: {
      dynamicsEntity: 'contact',
      email: s(rec, 'emailaddress1'),
      phone: s(rec, 'telephone1'),
      jobTitle: s(rec, 'jobtitle'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapLead(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_leads, rec),
    title: s(rec, 'fullname') || s(rec, 'subject') || `Lead ${s(rec, 'leadid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    body: truncate(s(rec, 'subject'), 300),
    author: s(rec, 'emailaddress1'),
    metadata: {
      dynamicsEntity: 'lead',
      subject: s(rec, 'subject'),
      company: s(rec, 'companyname'),
      email: s(rec, 'emailaddress1'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapOpportunity(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_opportunities, rec),
    title: s(rec, 'name') || `Opportunity ${s(rec, 'opportunityid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    timestamp: rec.estimatedclosedate ? dynIso(rec.estimatedclosedate, ctx.now) : null,
    metadata: {
      dynamicsEntity: 'opportunity',
      estimatedValue: fv(rec, 'estimatedvalue'),
      estimatedCloseDate: s(rec, 'estimatedclosedate'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapCase(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_cases, rec),
    title: s(rec, 'title') || `Case ${s(rec, 'ticketnumber') || s(rec, 'incidentid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'incident',
      ticketNumber: s(rec, 'ticketnumber'),
      priority: fv(rec, 'prioritycode'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapProduct(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_products, rec),
    title: s(rec, 'name') || `Product ${s(rec, 'productnumber') || s(rec, 'productid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'product',
      productNumber: s(rec, 'productnumber'),
      price: fv(rec, 'price'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapSalesOrder(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_salesorders, rec),
    title: s(rec, 'name') || `Sales Order ${s(rec, 'ordernumber') || s(rec, 'salesorderid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'salesorder',
      orderNumber: s(rec, 'ordernumber'),
      totalAmount: fv(rec, 'totalamount'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapPurchaseOrder(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_purchaseorders, rec),
    title: s(rec, 'msdyn_name') || `Purchase Order ${s(rec, 'msdyn_purchaseorderid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'msdyn_purchaseorder',
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapInvoice(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_invoices, rec),
    title: s(rec, 'name') || `Invoice ${s(rec, 'invoicenumber') || s(rec, 'invoiceid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'invoice',
      invoiceNumber: s(rec, 'invoicenumber'),
      totalAmount: fv(rec, 'totalamount'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapProject(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_projects, rec),
    title: s(rec, 'msdyn_subject') || `Project ${s(rec, 'msdyn_projectid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'msdyn_project',
      subject: s(rec, 'msdyn_subject'),
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapAsset(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_assets, rec),
    title: s(rec, 'msdyn_name') || `Asset ${s(rec, 'msdyn_customerassetid')}`,
    status: fv(rec, 'statuscode') || fv(rec, 'statecode'),
    metadata: {
      dynamicsEntity: 'msdyn_customerasset',
      state: fv(rec, 'statecode'),
      status: fv(rec, 'statuscode'),
    },
  });
}

export function mapUser(ctx: SyncContext, rec: DynRecord): UnifiedEntity {
  const disabled = String(rec.isdisabled) === 'true';
  return makeEntity({
    ...base(ctx, SPEC_BY_ID.dynamics365_users, rec),
    title: s(rec, 'fullname') || s(rec, 'internalemailaddress') || `User ${s(rec, 'systemuserid')}`,
    status: disabled ? 'disabled' : 'enabled',
    author: s(rec, 'internalemailaddress'),
    metadata: {
      dynamicsEntity: 'systemuser',
      email: s(rec, 'internalemailaddress'),
      title: s(rec, 'title'),
      domainName: s(rec, 'domainname'),
      disabled: String(rec.isdisabled) === 'true',
    },
  });
}

/* ── Table catalog ────────────────────────────────────────────────────────────── */

/** createdon/modifiedon are appended to every spec's `$select` — required for the stamps + the high-water. */
const WHO_FIELDS = ['createdon', 'modifiedon'];

const SPECS: DynSpec[] = [
  { id: 'dynamics365_accounts', label: 'Accounts', entitySet: 'accounts', etn: 'account', key: 'accountid', nameField: 'name', kind: 'organization', map: mapAccount,
    select: ['accountid', 'name', 'accountnumber', 'telephone1', 'emailaddress1', 'websiteurl', 'statecode', 'statuscode'] },
  { id: 'dynamics365_contacts', label: 'Contacts', entitySet: 'contacts', etn: 'contact', key: 'contactid', nameField: 'fullname', kind: 'contact', map: mapContact,
    select: ['contactid', 'fullname', 'emailaddress1', 'telephone1', 'jobtitle', 'statecode', 'statuscode'] },
  { id: 'dynamics365_leads', label: 'Leads', entitySet: 'leads', etn: 'lead', key: 'leadid', nameField: 'fullname', kind: 'contact', map: mapLead,
    select: ['leadid', 'fullname', 'subject', 'companyname', 'emailaddress1', 'statecode', 'statuscode'] },
  { id: 'dynamics365_opportunities', label: 'Opportunities', entitySet: 'opportunities', etn: 'opportunity', key: 'opportunityid', nameField: 'name', kind: 'task', map: mapOpportunity,
    select: ['opportunityid', 'name', 'estimatedvalue', 'estimatedclosedate', 'statecode', 'statuscode'] },
  { id: 'dynamics365_cases', label: 'Cases', entitySet: 'incidents', etn: 'incident', key: 'incidentid', nameField: 'title', kind: 'task', map: mapCase,
    select: ['incidentid', 'title', 'ticketnumber', 'prioritycode', 'statecode', 'statuscode'] },
  { id: 'dynamics365_products', label: 'Products', entitySet: 'products', etn: 'product', key: 'productid', nameField: 'name', kind: 'document', map: mapProduct,
    select: ['productid', 'name', 'productnumber', 'price', 'statecode', 'statuscode'] },
  { id: 'dynamics365_salesorders', label: 'Sales Orders', entitySet: 'salesorders', etn: 'salesorder', key: 'salesorderid', nameField: 'name', kind: 'task', map: mapSalesOrder,
    select: ['salesorderid', 'name', 'ordernumber', 'totalamount', 'statecode', 'statuscode'] },
  { id: 'dynamics365_purchaseorders', label: 'Purchase Orders', entitySet: 'msdyn_purchaseorders', etn: 'msdyn_purchaseorder', key: 'msdyn_purchaseorderid', nameField: 'msdyn_name', kind: 'task', map: mapPurchaseOrder,
    select: ['msdyn_purchaseorderid', 'msdyn_name', 'statecode', 'statuscode'] },
  { id: 'dynamics365_invoices', label: 'Invoices', entitySet: 'invoices', etn: 'invoice', key: 'invoiceid', nameField: 'name', kind: 'document', map: mapInvoice,
    select: ['invoiceid', 'name', 'invoicenumber', 'totalamount', 'statecode', 'statuscode'] },
  { id: 'dynamics365_projects', label: 'Projects', entitySet: 'msdyn_projects', etn: 'msdyn_project', key: 'msdyn_projectid', nameField: 'msdyn_subject', kind: 'project', map: mapProject,
    select: ['msdyn_projectid', 'msdyn_subject', 'statecode', 'statuscode'] },
  { id: 'dynamics365_assets', label: 'Assets', entitySet: 'msdyn_customerassets', etn: 'msdyn_customerasset', key: 'msdyn_customerassetid', nameField: 'msdyn_name', kind: 'document', map: mapAsset,
    select: ['msdyn_customerassetid', 'msdyn_name', 'statecode', 'statuscode'] },
  { id: 'dynamics365_users', label: 'Users', entitySet: 'systemusers', etn: 'systemuser', key: 'systemuserid', nameField: 'fullname', kind: 'contact', map: mapUser,
    select: ['systemuserid', 'fullname', 'internalemailaddress', 'domainname', 'title', 'isdisabled'] },
];

const SPEC_BY_ID: Record<string, DynSpec> = Object.fromEntries(SPECS.map((sp) => [sp.id, sp]));

/* ── Uniform Dataverse OData v4 incremental pull ───────────────────────────────── */

interface DynResp {
  value?: DynRecord[];
  '@odata.nextLink'?: string;
}

interface DynCursor {
  /** Epoch-ms high-water (max modifiedon committed); the durable cross-run resume key. */
  hw?: number;
  /** `@odata.nextLink` URL for the next page. Run-scoped (rebuilt from hw each run) unless `sat`. */
  next?: string;
  /** Run clock that minted `next`; a fresh run rebuilds the query from the high-water (drops a stale nextLink). */
  runAt?: string;
  /** Max modifiedon (epoch ms) seen this walk; committed as `hw` on drain/cap. */
  pending?: number;
  page?: number;
  /**
   * Saturated-instant continuation. If a whole MAX_PAGES run landed on ONE `modifiedon` instant — needing
   * >MAX_PAGES×PAGE rows to share a single timestamp, the extreme edge of a bulk import — the high-water
   * cannot advance, so the `@odata.nextLink` (a POSITIONAL cursor) is carried ACROSS runs to drain that
   * instant rather than stalling on it. Cleared the moment the high-water advances. Mirrors the `sap.ts` /
   * `oracle.ts` fix (there via offset; here via the nextLink cursor).
   */
  sat?: boolean;
}

/** Degrade a resource visibly (never a silent healthy zero) while keeping the family alive; preserves the cursor. */
function degradedPage(ctx: SyncContext, reason: string): SyncPage {
  return { entities: [], deletedSourceIds: [], cursor: ctx.cursor, hasMore: false, degraded: { kind: 'unprovisioned', reason } };
}

/**
 * Pull one page of `spec` via the Dataverse Web API. `$filter=modifiedon ge <high-water> $orderby=
 * modifiedon asc`, paging WITHIN the run by following `@odata.nextLink` verbatim and committing the newest
 * `modifiedon` as the high-water at drain (no nextLink) or the MAX_PAGES cap so the next run resumes forward
 * (leapfrog-free). The nextLink is only honored within the run that minted it — a fresh run rebuilds from
 * the high-water, never a stale skiptoken over a shifted result set — UNLESS it is a saturated-instant
 * continuation (`sat`). A 400 (a customization made an attribute unqueryable) degrades the object VISIBLY;
 * a 404 (table/solution not installed) and 403 (security role) are left to `graceful`.
 */
function makePull(spec: DynSpec): (ctx: SyncContext) => Promise<SyncPage> {
  const select = [...new Set([...spec.select, ...WHO_FIELDS])].join(',');
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<DynCursor>(ctx.cursor) ?? {};
    const sameRun = c.runAt === ctx.now;
    // Within-run OR a saturated continuation → follow the stored nextLink; else rebuild the query from hw.
    const carry = c.sat === true || sameRun;
    const followUrl = carry && c.next ? c.next : null;
    const page = sameRun ? (c.page ?? 0) : 0;

    let resp;
    try {
      if (followUrl) {
        // Follow the server-driven nextLink VERBATIM — never append query options (would corrupt the skiptoken).
        resp = await ctx.http.getJson<DynResp>(followUrl, { headers: DYN_HEADERS });
      } else {
        const query: Record<string, string | number | boolean | undefined> = {
          $select: select,
          $orderby: 'modifiedon asc',
        };
        // First sync (no high-water) walks everything ASC; subsequent runs filter from the high-water.
        if (c.hw != null) query.$filter = `modifiedon ge ${dynLiteral(c.hw)}`;
        resp = await ctx.http.getJson<DynResp>(`${dynBase()}/api/data/${API_VERSION}/${spec.entitySet}`, {
          headers: DYN_HEADERS,
          query,
        });
      }
    } catch (err) {
      // A missing table/solution is 404 and a security-role denial is 403 (both handled by graceful). A 400
      // is one of two things:
      //   • A 400 while FOLLOWING a carried saturated-instant skiptoken (`sat`) means the opaque paging cookie
      //     went stale. Re-following it verbatim would stall the table FOREVER — the `sat` cursor has no
      //     `runAt`, so unlike a within-run nextLink it never self-drops. Fall back to a from-high-water
      //     rebuild next run (which mints a fresh skiptoken), self-healing like oracle's offset re-derivation.
      //   • Any OTHER 400 is a base-query schema issue (a customization made a $select/$filter attribute
      //     unqueryable). Degrade VISIBLY (a distinct reason, not a silent zero) with the cursor preserved.
      // Both keep the family alive; only the disposition of the cursor differs.
      if (err instanceof HttpError && err.status === 400) {
        if (followUrl && c.sat === true) {
          return {
            entities: [],
            deletedSourceIds: [],
            hasMore: false,
            cursor: toJsonCursor({ hw: c.hw } satisfies DynCursor),
            degraded: { kind: 'unprovisioned', reason: `Dynamics table ${spec.entitySet} paging continuation expired (400) — resuming from the high-water on the next sync` },
          };
        }
        return degradedPage(ctx, `Dynamics table ${spec.entitySet} returned 400 — an attribute in the query is not available on this org (a customization or missing column); verify the table's schema`);
      }
      throw err;
    }

    const rows = resp.data.value ?? [];
    const next = resp.data['@odata.nextLink'];
    // The nextLink is the authoritative "more pages" signal; the `rows.length > 0` guard stops a pathological
    // nextLink-with-no-rows response from looping forever.
    const hasMoreData = !!next && rows.length > 0;
    // Map only rows carrying their primary key. Dataverse always returns the GUID (it's in `$select`), so this
    // is defensive: a keyless row would otherwise coalesce to an empty sourceId and silently overwrite another.
    const entities = rows.filter((r) => s(r, spec.key) != null).map((r) => spec.map(ctx, r));

    // ASC walk → advance the high-water to the newest modifiedon seen (the field we order/filter by). On a
    // fresh run start from the committed high-water, never a stale mid-walk `pending` from a prior run.
    let pending = carry ? (c.pending ?? c.hw) : c.hw;
    for (const r of rows) {
      const t = dynEpoch(r.modifiedon);
      if (!Number.isNaN(t) && (pending == null || t > pending)) pending = t;
    }

    if (!hasMoreData) {
      // Drain → the whole `ge hw` walk is complete; commit the newest modifiedon and start a fresh walk.
      return { entities, cursor: toJsonCursor({ hw: pending } satisfies DynCursor), hasMore: false };
    }
    if (page + 1 < MAX_PAGES) {
      return { entities, cursor: toJsonCursor({ hw: c.hw, next, runAt: ctx.now, pending, page: page + 1 } satisfies DynCursor), hasMore: true };
    }
    // MAX_PAGES cap. If the high-water advanced, resume from it next run (drop the nextLink — a fresh query).
    // If it did NOT (one instant saturated the whole run), carry the nextLink across runs to drain it.
    const advanced = pending != null && (c.hw == null || pending > c.hw);
    return advanced
      ? { entities, cursor: toJsonCursor({ hw: pending } satisfies DynCursor), hasMore: false }
      : { entities, cursor: toJsonCursor({ hw: c.hw, next, pending, sat: true } satisfies DynCursor), hasMore: false };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const DYN_REASONS = {
  unauthorized: 'Service not authorized — the user\'s Dataverse security role cannot read this table (403)',
  unprovisioned: 'Table not available for this Dynamics 365 org — the first-party app/solution (Sales / Customer Service / Field Service / Project Operations) is not installed (404)',
} as const;

/** Wrap a pull so one unavailable table degrades instead of failing the whole family. */
function serviceResource(spec: DynSpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), DYN_REASONS) };
}

export const dynamicsAdapter: ConnectorAdapter = {
  connectorId: 'dynamics365',
  // Dataverse Web API requires the OData version headers on every request; the bearer token is injected by
  // the orchestrator's HttpClient (never handled here).
  baseHeaders: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
  resources: SPECS.map(serviceResource),
};

/* ── Service catalog (reference; NO scope projection — access is security-role-governed, like Salesforce) ── */

/** A Dynamics 365 service (Dataverse table) in the family. */
export interface DynamicsService {
  id: string;
  label: string;
  /** The Dataverse entity set this service syncs. */
  entitySet: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per table, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families (Google / GitHub
 * / Slack / Atlassian / HubSpot), Dynamics 365 has NO per-object OAuth scope: the single `user_impersonation`
 * scope unlocks the whole Web API and access is governed by the user's Dataverse security roles. So —
 * exactly like Salesforce / ServiceNow / SAP / Oracle — there is deliberately no
 * `dynamicsServiceAvailability(grantedScopes)` projection and no `serviceCapabilities` branch; the sync
 * subsystem's generic fallback is correct, and which apps (Sales / Customer Service / Field Service /
 * Project Operations / …) are installed is discovered live from the per-module degrade (a missing table's
 * 404 → unprovisioned), never hardcoded.
 */
export const DYNAMICS_SERVICES: DynamicsService[] = SPECS.map((sp) => ({
  id: sp.id,
  label: sp.label,
  entitySet: sp.entitySet,
  kind: sp.kind,
}));
