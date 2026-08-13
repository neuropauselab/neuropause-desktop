/**
 * The ServiceNow connector FAMILY (P5 — Increment 10) — ITSM + CMDB + Knowledge + Asset + Catalog.
 *
 * ONE connector (`servicenow`) — one OAuth 2.0 app, one token, one vault record, one card, one health
 * engine, one inspector — with each ServiceNow table mounted as an `AdapterResource` on the SAME
 * authenticated session, read through the uniform REST Table API. This mirrors, exactly, how
 * `microsoft-entra` hosts M365 and `salesforce`/`hubspot` host their CRM objects. Every resource is
 * wrapped in the shared `graceful()` guard, so a table a plugin hasn't provisioned (400 "Invalid table")
 * or the integration user's role can't read (403) degrades to a tagged empty page instead of failing the
 * whole family.
 *
 * The ServiceNow wrinkles, and how each is handled by EXTENDING existing seams:
 *   • **Per-instance host.** ServiceNow's OAuth endpoints AND its REST API all live on the customer's own
 *     instance host (`https://{instance}.service-now.com/...`), so the instance must be known before OAuth.
 *     It comes from the `NEUROPAUSE_SERVICENOW_INSTANCE` env var — in the manifest (for the authorize/token
 *     URLs, the Microsoft-Entra env-tenant precedent) and here (for the data calls, the github.ts env-base
 *     precedent). No per-org resolution call is needed — unlike Salesforce, the host is configuration.
 *   • **`expires_in` (1800s) + a durable refresh token**, so the EXISTING proactive-refresh path covers it
 *     with no synthesized TTL (like HubSpot, unlike Salesforce).
 *   • **Access is ROLE-governed, not scope-gated** (`scope=useraccount` is a no-op; least-privilege is the
 *     `snc_read_only` role + read roles on the integration user). So — like Salesforce, unlike HubSpot —
 *     there is NO scope catalog and NO `serviceCapabilities` branch; capability is discovered at RUNTIME
 *     from the per-module degrade the Supervisor overlays.
 *   • **A missing table (plugin absent) returns 400, not 404** — which `graceful` (403/404 only) would let
 *     escape and fail the family. Rather than a fragile `sys_db_object` preflight (which itself needs an
 *     elevated dictionary-read role a least-privilege user lacks), a Table-API 400 is re-mapped to a 404
 *     here (ServiceNow is lenient with malformed queries, so a Table-API 400 ≈ "table not available"), and
 *     `graceful` degrades it as unprovisioned. That IS the runtime plugin/hub detection.
 *
 * Table → UDM (sys_id is a 32-char GUID unique only WITHIN a table hierarchy, and four of our tables map
 * to `document` across four SEPARATE hierarchies, so every sourceId is prefixed with its table to keep
 * unified ids collision-free AND self-describing):
 *   incident / problem / change_request / sc_request → task   (all extend the ServiceNow [task] base)
 *   kb_knowledge / cmdb_ci / alm_asset / sc_cat_item  → document
 *   sys_user                                          → contact
 *   sys_user_group                                    → organization
 *
 * Incremental sync is uniform across all ten tables: `sys_updated_on>=<high-water> ORDER BY
 * sys_updated_on, sys_id`, paging within a run via `sysparm_offset` and resuming across runs via the
 * durable `sys_updated_on` high-water — a MAX_PAGES cap commits the newest `sys_updated_on` seen and the
 * next run picks up from exactly there. This is the same leapfrog-free ASC-resume pattern proven at
 * `salesforce.ts` / `hubspot.ts`. The `sys_id` secondary sort gives a stable total order for offset paging
 * across same-second blocks; the offset is run-scoped (a fresh run rebuilds from the high-water).
 * `sys_updated_on` is second-precision UTC, so — like Salesforce's SOQL — the boundary second is re-scanned
 * (the store dedups) and a >MAX_PAGES×PAGE single-second burst is a documented bound.
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { graceful } from './delta';
import { hasNextLink, parseJsonCursor, toJsonCursor, truncate } from './util';

/** The env var supplying the customer's instance subdomain (also read by the manifest for the OAuth URLs). */
const SN_INSTANCE_ENV = 'NEUROPAUSE_SERVICENOW_INSTANCE';
/** Gentle page size (ServiceNow's default is huge); the high-water resumes the rest next run. */
const PAGE = 100;
/** Bound one run's page walk. 100 × 30 = 3,000 rows/run; the high-water resumes forward (never leapfrogged). */
const MAX_PAGES = 30;
/**
 * A datetime literal in `sysparm_query` is interpreted in the integration user's session timezone, while
 * the stored `sys_updated_on` is UTC. The connector REQUIRES the integration user be GMT/UTC (documented),
 * which makes the round-trip exact; this small overlap re-scans a window below the high-water each run
 * (the store dedups) as defense-in-depth against clock skew / boundary jitter.
 */
const OVERLAP_MS = 2 * 60 * 1000;
/** Stable baseline for a record missing its system stamps — never the run clock, which would re-churn it. */
const SN_STABLE_TS = '1970-01-01T00:00:00.000Z';

/** The instance API base, from configuration (never a per-org resolution call). */
function snBase(): string {
  const inst = (process.env[SN_INSTANCE_ENV] ?? '').trim();
  return `https://${inst || 'INSTANCE'}.service-now.com`;
}

/* ── ServiceNow datetime helpers (sys_updated_on is `YYYY-MM-DD HH:MM:SS`, UTC, second precision) ──── */

/** Parse a ServiceNow UTC datetime to epoch ms. Space-separated, so parsed as `…T…Z` (NOT local time). */
function snToEpoch(s: string | null | undefined): number {
  if (!s) return NaN;
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}
/** Normalize a ServiceNow UTC datetime to ISO-Z, or a fallback when absent/invalid. */
function snToIso(s: string | null | undefined, fallback: string): string {
  const t = snToEpoch(s);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}
/** Format epoch ms back to ServiceNow's `YYYY-MM-DD HH:MM:SS` UTC (for the `sys_updated_on>=` filter). */
function snFromEpoch(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
/** The high-water minus the overlap window, formatted for the query filter. */
function snOverlap(hw: string): string {
  const t = snToEpoch(hw);
  return Number.isNaN(t) ? hw : snFromEpoch(Math.max(0, t - OVERLAP_MS));
}

/** Strip tags/entities from a ServiceNow rich-text body (knowledge `text` is HTML). */
function stripHtml(v: string | null): string | null {
  if (!v) return null;
  const text = v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return text || null;
}

/* ── Record shape (sysparm_display_value=all → every field is {value, display_value}) ─────────────── */

type SnField = { value?: string | null; display_value?: string | null } | string | null | undefined;
type SnRecord = Record<string, SnField>;

/** Raw value (sys_id, UTC timestamps, choice codes). Handles both the {value,…} object and bare-string
 *  shapes, and normalizes an empty ServiceNow field ({value:""}) to null rather than leaking "". */
function rv(r: SnRecord, k: string): string | null {
  const f = r[k];
  if (f == null) return null;
  if (typeof f === 'string') return f || null;
  return f.value || null;
}
/** Display value (reference names, choice labels), falling back to the raw value. */
function dv(r: SnRecord, k: string): string | null {
  const f = r[k];
  if (f == null) return null;
  if (typeof f === 'string') return f || null;
  return f.display_value || f.value || null;
}

/** The record deep link (the classic form view). `base` + table are known, so ServiceNow entities ARE linkable. */
function recordUrl(base: string, table: string, sysId: string | null): string | null {
  return sysId ? `${base}/${table}.do?sys_id=${sysId}` : null;
}

/**
 * The shared UDM envelope: the table-prefixed id, the record deep link, and the UTC system stamps. `base`
 * + `table` are threaded per-call (never module state), so mappers stay pure and testable.
 */
function base(ctx: SyncContext, baseUrl: string, table: string, kind: UnifiedEntityKind, r: SnRecord) {
  const sysId = rv(r, 'sys_id');
  const created = snToIso(rv(r, 'sys_created_on'), SN_STABLE_TS);
  const updated = snToIso(rv(r, 'sys_updated_on'), created);
  return {
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind,
    sourceId: `${table}-${sysId}`,
    now: ctx.now,
    url: recordUrl(baseUrl, table, sysId),
    createdAt: created,
    updatedAt: updated,
  } as const;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────────── */

const titleWithNumber = (r: SnRecord): string | null => {
  const num = dv(r, 'number');
  const desc = dv(r, 'short_description');
  return [num, desc].filter(Boolean).join(' — ') || num || desc;
};

export function mapIncident(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'task', r),
    title: titleWithNumber(r) || `Incident ${rv(r, 'sys_id')}`,
    status: dv(r, 'state'),
    body: truncate(dv(r, 'description'), 300),
    author: dv(r, 'assigned_to'),
    timestamp: rv(r, 'opened_at') ? snToIso(rv(r, 'opened_at'), ctx.now) : null,
    metadata: {
      servicenowTable: table,
      number: dv(r, 'number'),
      state: dv(r, 'state'),
      priority: dv(r, 'priority'),
      urgency: dv(r, 'urgency'),
      impact: dv(r, 'impact'),
      category: dv(r, 'category'),
      assignedTo: dv(r, 'assigned_to'),
      assignmentGroup: dv(r, 'assignment_group'),
      caller: dv(r, 'caller_id'),
      configItem: dv(r, 'cmdb_ci'),
    },
  });
}

export function mapProblem(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'task', r),
    title: titleWithNumber(r) || `Problem ${rv(r, 'sys_id')}`,
    status: dv(r, 'problem_state') || dv(r, 'state'),
    body: truncate(dv(r, 'description'), 300),
    author: dv(r, 'assigned_to'),
    metadata: {
      servicenowTable: table,
      number: dv(r, 'number'),
      state: dv(r, 'problem_state') || dv(r, 'state'),
      priority: dv(r, 'priority'),
      assignedTo: dv(r, 'assigned_to'),
      assignmentGroup: dv(r, 'assignment_group'),
    },
  });
}

export function mapChange(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'task', r),
    title: titleWithNumber(r) || `Change ${rv(r, 'sys_id')}`,
    status: dv(r, 'state'),
    body: truncate(dv(r, 'description'), 300),
    author: dv(r, 'assigned_to'),
    timestamp: rv(r, 'start_date') ? snToIso(rv(r, 'start_date'), ctx.now) : null,
    endTimestamp: rv(r, 'end_date') ? snToIso(rv(r, 'end_date'), ctx.now) : null,
    metadata: {
      servicenowTable: table,
      number: dv(r, 'number'),
      state: dv(r, 'state'),
      type: dv(r, 'type'),
      risk: dv(r, 'risk'),
      priority: dv(r, 'priority'),
      assignedTo: dv(r, 'assigned_to'),
      assignmentGroup: dv(r, 'assignment_group'),
    },
  });
}

export function mapRequest(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'task', r),
    title: titleWithNumber(r) || `Request ${rv(r, 'sys_id')}`,
    status: dv(r, 'request_state'),
    body: truncate(dv(r, 'description'), 300),
    author: dv(r, 'requested_for'),
    metadata: {
      servicenowTable: table,
      number: dv(r, 'number'),
      requestState: dv(r, 'request_state'),
      stage: dv(r, 'stage'),
      priority: dv(r, 'priority'),
      requestedFor: dv(r, 'requested_for'),
      openedBy: dv(r, 'opened_by'),
    },
  });
}

export function mapKnowledge(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'document', r),
    title: dv(r, 'short_description') || dv(r, 'number') || `Article ${rv(r, 'sys_id')}`,
    status: dv(r, 'workflow_state'),
    body: truncate(stripHtml(dv(r, 'text')), 500),
    author: dv(r, 'author'),
    metadata: {
      servicenowTable: table,
      number: dv(r, 'number'),
      workflowState: dv(r, 'workflow_state'),
      category: dv(r, 'kb_category'),
      knowledgeBase: dv(r, 'kb_knowledge_base'),
      published: rv(r, 'published'),
    },
  });
}

export function mapCi(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'document', r),
    title: dv(r, 'name') || `CI ${rv(r, 'sys_id')}`,
    status: dv(r, 'operational_status'),
    metadata: {
      servicenowTable: table,
      // The true class of a CI (base cmdb_ci returns every subclass); the primary disambiguator.
      ciClass: dv(r, 'sys_class_name'),
      operationalStatus: dv(r, 'operational_status'),
      installStatus: dv(r, 'install_status'),
      category: dv(r, 'category'),
      subcategory: dv(r, 'subcategory'),
      serialNumber: dv(r, 'serial_number'),
      assetTag: dv(r, 'asset_tag'),
      assignedTo: dv(r, 'assigned_to'),
    },
  });
}

export function mapAsset(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'document', r),
    title: dv(r, 'display_name') || dv(r, 'asset_tag') || `Asset ${rv(r, 'sys_id')}`,
    status: dv(r, 'install_status'),
    metadata: {
      servicenowTable: table,
      assetTag: dv(r, 'asset_tag'),
      serialNumber: dv(r, 'serial_number'),
      model: dv(r, 'model'),
      modelCategory: dv(r, 'model_category'),
      installStatus: dv(r, 'install_status'),
      substatus: dv(r, 'substatus'),
      assignedTo: dv(r, 'assigned_to'),
      cost: dv(r, 'cost'),
    },
  });
}

export function mapCatalogItem(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'document', r),
    title: dv(r, 'name') || `Catalog Item ${rv(r, 'sys_id')}`,
    status: rv(r, 'active') === 'false' ? 'inactive' : 'active',
    body: truncate(dv(r, 'short_description') || dv(r, 'description'), 300),
    metadata: {
      servicenowTable: table,
      price: dv(r, 'price'),
      category: dv(r, 'category'),
      active: rv(r, 'active'),
    },
  });
}

export function mapUser(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'contact', r),
    title: dv(r, 'name') || dv(r, 'user_name') || `User ${rv(r, 'sys_id')}`,
    status: rv(r, 'active') === 'false' ? 'inactive' : 'active',
    author: dv(r, 'email'),
    metadata: {
      servicenowTable: table,
      userName: dv(r, 'user_name'),
      email: dv(r, 'email'),
      title: dv(r, 'title'),
      department: dv(r, 'department'),
      active: rv(r, 'active'),
    },
  });
}

export function mapGroup(ctx: SyncContext, baseUrl: string, table: string, r: SnRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, baseUrl, table, 'organization', r),
    title: dv(r, 'name') || `Group ${rv(r, 'sys_id')}`,
    status: rv(r, 'active') === 'false' ? 'inactive' : 'active',
    body: truncate(dv(r, 'description'), 300),
    metadata: {
      servicenowTable: table,
      email: dv(r, 'email'),
      manager: dv(r, 'manager'),
      active: rv(r, 'active'),
    },
  });
}

/* ── Table catalog ─────────────────────────────────────────────────────────────── */

/** One ServiceNow table mounted as a service resource. id === resource id === catalog id === module-stat id. */
interface TableSpec {
  id: string;
  label: string;
  /** The ServiceNow table name — the `/api/now/table/{table}` segment and the sourceId prefix. */
  table: string;
  kind: UnifiedEntityKind;
  /** Fields to request via `sysparm_fields`. sys_id + the system stamps are always appended. */
  fields: string[];
  map: (ctx: SyncContext, baseUrl: string, table: string, r: SnRecord) => UnifiedEntity;
}

/** Appended to every spec's fields — required for the id, the deep link, and the high-water. */
const SYS_FIELDS = ['sys_id', 'sys_created_on', 'sys_updated_on'];

const TABLE_SPECS: TableSpec[] = [
  { id: 'servicenow_incidents', label: 'Incidents', table: 'incident', kind: 'task', map: mapIncident,
    fields: ['number', 'short_description', 'description', 'state', 'priority', 'urgency', 'impact', 'category', 'assigned_to', 'assignment_group', 'caller_id', 'cmdb_ci', 'opened_at'] },
  { id: 'servicenow_problems', label: 'Problems', table: 'problem', kind: 'task', map: mapProblem,
    fields: ['number', 'short_description', 'description', 'state', 'problem_state', 'priority', 'assigned_to', 'assignment_group'] },
  { id: 'servicenow_changes', label: 'Change Requests', table: 'change_request', kind: 'task', map: mapChange,
    fields: ['number', 'short_description', 'description', 'state', 'type', 'risk', 'priority', 'assigned_to', 'assignment_group', 'start_date', 'end_date'] },
  { id: 'servicenow_requests', label: 'Requests', table: 'sc_request', kind: 'task', map: mapRequest,
    fields: ['number', 'short_description', 'description', 'request_state', 'stage', 'priority', 'requested_for', 'opened_by'] },
  { id: 'servicenow_knowledge', label: 'Knowledge', table: 'kb_knowledge', kind: 'document', map: mapKnowledge,
    fields: ['number', 'short_description', 'text', 'workflow_state', 'kb_category', 'kb_knowledge_base', 'author', 'published'] },
  { id: 'servicenow_cmdb', label: 'CMDB', table: 'cmdb_ci', kind: 'document', map: mapCi,
    fields: ['name', 'sys_class_name', 'operational_status', 'install_status', 'category', 'subcategory', 'serial_number', 'asset_tag', 'assigned_to'] },
  { id: 'servicenow_assets', label: 'Assets', table: 'alm_asset', kind: 'document', map: mapAsset,
    fields: ['display_name', 'asset_tag', 'serial_number', 'model', 'model_category', 'install_status', 'substatus', 'assigned_to', 'cost'] },
  { id: 'servicenow_users', label: 'Users', table: 'sys_user', kind: 'contact', map: mapUser,
    fields: ['user_name', 'name', 'first_name', 'last_name', 'email', 'title', 'department', 'active'] },
  { id: 'servicenow_groups', label: 'Groups', table: 'sys_user_group', kind: 'organization', map: mapGroup,
    fields: ['name', 'description', 'email', 'manager', 'active'] },
  { id: 'servicenow_catalog', label: 'Catalog', table: 'sc_cat_item', kind: 'document', map: mapCatalogItem,
    fields: ['name', 'short_description', 'description', 'price', 'category', 'active'] },
];

/* ── Uniform Table-API incremental pull ────────────────────────────────────────── */

interface TableResp {
  result?: SnRecord[];
}

interface TableCursor {
  /** ServiceNow `YYYY-MM-DD HH:MM:SS` UTC high-water (max sys_updated_on committed); the durable resume key. */
  hw?: string;
  /** Within-run `sysparm_offset`, valid only while `runAt === ctx.now`. */
  offset?: number;
  /** The run clock that minted offset/page; across runs the offset is dropped and the walk rebuilds from hw. */
  runAt?: string;
  /** Max sys_updated_on seen this walk (SN datetime string); committed as hw on drain/cap. */
  pending?: string;
  page?: number;
}

/**
 * Pull one page of `spec.table` via the Table API. `sys_updated_on>=<hw> ORDER BY sys_updated_on, sys_id`,
 * paging within the run via `sysparm_offset` and committing the newest sys_updated_on as the high-water at
 * drain (no `Link` rel=next) or the MAX_PAGES cap so the next run resumes forward (leapfrog-free). The
 * offset is only honored within the run that minted it — a fresh run rebuilds from the high-water, never a
 * stale offset over a shifted result set. A 400 (missing table / plugin absent) is re-mapped to a 404 so
 * `graceful` degrades the module as unprovisioned instead of failing the family.
 */
function makePull(spec: TableSpec): (ctx: SyncContext) => Promise<SyncPage> {
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<TableCursor>(ctx.cursor) ?? {};
    const baseUrl = snBase();
    const sameRun = c.offset != null && c.runAt === ctx.now;
    const offset = sameRun ? (c.offset ?? 0) : 0;
    const page = sameRun ? (c.page ?? 0) : 0;

    const order = 'ORDERBYsys_updated_on^ORDERBYsys_id';
    const sysparm_query = c.hw ? `sys_updated_on>=${snOverlap(c.hw)}^${order}` : order;

    let resp;
    try {
      resp = await ctx.http.getJson<TableResp>(`${baseUrl}/api/now/table/${spec.table}`, {
        query: {
          sysparm_query,
          sysparm_limit: PAGE,
          sysparm_offset: offset,
          sysparm_fields: [...spec.fields, ...SYS_FIELDS].join(','),
          sysparm_display_value: 'all',
          sysparm_exclude_reference_link: true,
        },
      });
    } catch (err) {
      // A missing table (plugin not installed) returns 400 "Invalid table" — graceful only swallows 403/404,
      // so re-map it to a 404 (unprovisioned). ServiceNow is lenient with malformed queries (they're ignored,
      // not 400'd), so a Table-API 400 reliably means the table isn't available on this instance.
      if (err instanceof HttpError && err.status === 400) {
        throw new HttpError(404, `servicenow: table ${spec.table} not available on this instance`, false);
      }
      throw err;
    }

    const rows = resp.data.result ?? [];
    // ASC walk → advance the high-water to the newest sys_updated_on seen (read from the SAME field we
    // order/filter by). On a fresh run start tracking from the committed high-water, never a stale
    // mid-walk `pending` from an interrupted prior run.
    let pending = sameRun ? (c.pending ?? c.hw) : c.hw;
    for (const r of rows) {
      const u = rv(r, 'sys_updated_on');
      if (u && (!pending || snToEpoch(u) > snToEpoch(pending))) pending = u;
    }
    // The Link rel=next header is the reliable "more pages" signal (row-level ACLs can shrink a page below
    // the limit, so a length heuristic would stop early).
    const more = hasNextLink(resp.headers['link']) && page + 1 < MAX_PAGES;
    const cursor = more
      ? toJsonCursor({ hw: c.hw, offset: offset + PAGE, runAt: ctx.now, pending, page: page + 1 } satisfies TableCursor)
      : toJsonCursor({ hw: pending } satisfies TableCursor);
    return { entities: rows.map((r) => spec.map(ctx, baseUrl, spec.table, r)), cursor, hasMore: more };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const SN_REASONS = {
  unauthorized: 'Service not authorized — the integration user\'s role cannot read this table (403)',
  unprovisioned: 'Table not available for this ServiceNow instance — the plugin is not installed (400/404)',
} as const;

/** Wrap a pull so one unavailable table degrades instead of failing the whole family. */
function serviceResource(spec: TableSpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), SN_REASONS) };
}

export const servicenowAdapter: ConnectorAdapter = {
  connectorId: 'servicenow',
  baseHeaders: { Accept: 'application/json' },
  resources: TABLE_SPECS.map(serviceResource),
};

/* ── Service catalog (reference; NO scope projection — access is ROLE-governed, like Salesforce) ──── */

/** A ServiceNow service (table) in the family. */
export interface ServiceNowService {
  id: string;
  label: string;
  /** The ServiceNow table this service syncs. */
  table: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per table, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families (Google / GitHub
 * / Slack / Atlassian / HubSpot), ServiceNow has NO per-object OAuth scope: `scope=useraccount` is a no-op
 * and access is governed by the integration user's ROLES/ACLs. So — exactly like Salesforce — there is
 * deliberately no `servicenowServiceAvailability(grantedScopes)` projection and no `serviceCapabilities`
 * branch; the sync subsystem's generic fallback is correct, and which plugins/apps are active (ITSM / CMDB
 * / Knowledge / Asset Management / Catalog) is discovered live from the per-module degrade (a missing
 * table's 400 → unprovisioned), never hardcoded.
 */
export const SERVICENOW_SERVICES: ServiceNowService[] = TABLE_SPECS.map((s) => ({
  id: s.id,
  label: s.label,
  table: s.table,
  kind: s.kind,
}));
