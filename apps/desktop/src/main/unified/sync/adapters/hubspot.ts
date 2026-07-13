/**
 * The HubSpot connector FAMILY (P5 — Increment 9) — the HubSpot CRM (Sales / Service / Commerce hubs).
 *
 * ONE connector (`hubspot`) — one OAuth 2.0 app, one token, one vault record, one card, one health engine,
 * one inspector — with each CRM object mounted as an `AdapterResource` on the SAME authenticated session.
 * This mirrors, exactly, how `microsoft-entra` hosts M365, `atlassian` hosts Jira + Confluence, and
 * `salesforce` hosts its CRM objects. Every resource is wrapped in the shared `graceful()` guard, so an
 * object a portal hasn't licensed / the grant didn't scope (403) degrades to a tagged empty page instead
 * of failing the whole family.
 *
 * HubSpot is SIMPLER than the Salesforce family in two ways and different in one:
 *   • Fixed API host `api.hubapi.com` — no per-org instance resolution (no userinfo/describeGlobal step).
 *   • The token endpoint returns `expires_in` (1800s) with a durable, non-rotating refresh token, so the
 *     EXISTING proactive-refresh path (`getValidAccessToken` + `maybeRotate`) covers it with no manifest
 *     TTL — unlike Salesforce, which needed a synthesized expiry.
 *   • It IS scope-gated per object (`crm.objects.contacts.read`, `crm.objects.deals.read`, `tickets`,
 *     `e-commerce`, …), so — like GitHub / Slack / Atlassian, and UNLIKE Salesforce's single `api` scope —
 *     it exports a `HUBSPOT_SERVICES` catalog + `hubspotServiceAvailability(grantedScopes)` that the
 *     Enterprise Connector Center projects for pre-flight ✓/✗, and the sync subsystem adds a matching
 *     `serviceCapabilities` branch. Runtime hub detection is that projection PLUS the per-module 403
 *     degrade the Supervisor overlays — nothing hardcoded.
 *
 * Object → UDM (HubSpot ids are unique only WITHIN an object type — a deal, a ticket and an engagement
 * task can all be id `12345`, and owners come from a separate id space — so every sourceId is prefixed
 * with its type to keep unified ids collision-free, a generalization of the Atlassian `board-` prefix):
 *   Contacts  → contact         (Search, `lastmodifieddate` high-water)     prefix `contact-`
 *   Companies → organization    (Search, `hs_lastmodifieddate` high-water)  prefix `company-`
 *   Deals     → task            (a pipeline deal ≈ SF Opportunity)          prefix `deal-`
 *   Tickets   → task            (a support ticket ≈ SF Case)                prefix `ticket-`
 *   Products  → document        (catalog record ≈ SF Product2)             prefix `product-`
 *   Owners    → contact         (a HubSpot user; the `/crm/v3/owners` list) prefix `owner-`
 *   Notes     → activity        (engagement annotation)                     prefix `note-`
 *   Tasks     → task            (engagement task)                           prefix `task-`
 *   Meetings  → calendar_event  (engagement with start/end)                 prefix `meeting-`
 *   Emails    → message         (a single logged email)                     prefix `email-`
 *
 * Incremental sync is uniform across the nine CRM-object resources: `POST /crm/v3/objects/{type}/search`
 * with a `<lastmod> GTE <epoch-ms>` filter + `<lastmod> ASCENDING` sort, paging within a run via
 * `paging.next.after` and resuming across runs via the durable last-modified high-water — a MAX_PAGES cap
 * commits the newest `updatedAt` seen and the next run's search picks up from exactly there. This is the
 * same leapfrog-free ASC-resume pattern proven at `salesforce.ts` / `atlassian.pullIssues`, kept well
 * under HubSpot Search's 10,000-result-per-query cap (200 × 20 = 4,000 rows/run). The `after` token is
 * run-scoped (tagged with the run clock) so an interrupted run never resumes a stale offset — the fresh
 * run rebuilds from the high-water. Owners have no search/last-modified filter, so they are a full `after`
 * list walk stamped with each owner's own `updatedAt` (churn-free).
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

const HUBSPOT_API = 'https://api.hubapi.com';
/** Search page size (HubSpot's max) — fewest requests against the strict 5-req/s search bucket. */
const SEARCH_LIMIT = 200;
/** Owners list page size (the endpoint default/ceiling). */
const OWNERS_LIMIT = 100;
/** Bound one run's page walk; the last-modified high-water resumes the rest next run (never leapfrogged).
 *  200 × 20 = 4,000 rows/run — comfortably under HubSpot Search's 10,000-results-per-query hard cap. */
const MAX_PAGES = 20;
/**
 * HubSpot's Search index is asynchronous and NOT guaranteed to index in last-modified order, so a record
 * saved just under the high-water can surface just above it. Re-scan a small overlap window each run (the
 * store dedups the re-emit) so such a late-indexed record isn't skipped forever. Covers HubSpot's typical
 * sub-minute index lag; a lag beyond this AND a boundary that jumped past it is a documented rare edge.
 */
const OVERLAP_MS = 2 * 60 * 1000;
/** Stable baseline for a record missing BOTH timestamps — never the run clock, which would re-churn it. */
const HS_STABLE_TS = '1970-01-01T00:00:00.000Z';

/** Normalize an ISO timestamp to a clean ISO-Z, or a fallback when absent/invalid. */
function iso(ts: string | null | undefined, fallback: string): string {
  if (!ts) return fallback;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/**
 * Normalize a HubSpot *property* datetime, which comes back either as an ISO string or as an epoch-ms
 * string depending on the property, to a clean ISO-Z (or a fallback). Top-level `createdAt`/`updatedAt`
 * are always ISO and use `iso()`; this is only for property-map datetimes (meeting times, hs_timestamp…).
 */
function hsDate(v: string | null | undefined, fallback: string | null): string | null {
  if (!v) return fallback;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : fallback;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/** Parse a HubSpot datetime value (ISO string OR epoch-ms string) to epoch ms, or null. */
function hsEpoch(v: string | null | undefined): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Strip tags/entities out of a HubSpot rich-text body (note/task/meeting bodies are HTML). */
function stripHtml(v: string | null): string | null {
  if (!v) return null;
  const text = v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return text || null;
}

/* ── Record shapes ─────────────────────────────────────────────────────────────── */

/** A CRM v3 object: top-level id + ISO stamps + a string→string property map. */
interface HsRecord {
  id: string;
  properties?: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}
interface HsSearchResp {
  results?: HsRecord[];
  total?: number;
  paging?: { next?: { after?: string } | null } | null;
}
/** The `/crm/v3/owners` shape is flat + camelCase (no `properties` wrapper). */
interface HsOwner {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  userId?: number | null;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
interface HsOwnersResp {
  results?: HsOwner[];
  paging?: { next?: { after?: string } | null } | null;
}

/** Property accessor (HubSpot returns every property value as a string or null). */
const prop = (r: HsRecord, k: string): string | null => r.properties?.[k] ?? null;

/**
 * The shared UDM envelope for a HubSpot record: the type-prefixed id, and the uniform top-level
 * `createdAt`/`updatedAt` (HubSpot support's recommended timestamps — they sidestep the per-object
 * `createdate`/`hs_createdate` + `lastmodifieddate`/`hs_lastmodifieddate` property-name split). No `url`:
 * a HubSpot record deep link needs the portal id, which isn't resolved in v1 (documented follow-on).
 */
function base(ctx: SyncContext, kind: UnifiedEntityKind, prefix: string, r: HsRecord) {
  // Fall back to a STABLE baseline (never the run clock) if a stamp is absent, so a timestamp-less record
  // isn't re-classified as "updated" every sync. Records normally carry both stamps.
  const created = iso(r.createdAt, HS_STABLE_TS);
  const updated = iso(r.updatedAt, created);
  return {
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind,
    sourceId: `${prefix}${r.id}`,
    now: ctx.now,
    url: null,
    createdAt: created,
    updatedAt: updated,
  } as const;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────────── */

export function mapContact(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  const name = [prop(r, 'firstname'), prop(r, 'lastname')].filter(Boolean).join(' ').trim();
  return makeEntity({
    ...base(ctx, 'contact', 'contact-', r),
    title: name || prop(r, 'email') || prop(r, 'company') || `Contact ${r.id}`,
    author: prop(r, 'email'),
    status: prop(r, 'lifecyclestage'),
    metadata: {
      hubspotType: 'contact',
      email: prop(r, 'email'),
      phone: prop(r, 'phone'),
      jobTitle: prop(r, 'jobtitle'),
      company: prop(r, 'company'),
      lifecycleStage: prop(r, 'lifecyclestage'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapCompany(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'organization', 'company-', r),
    title: prop(r, 'name') || prop(r, 'domain') || `Company ${r.id}`,
    status: 'active',
    metadata: {
      hubspotType: 'company',
      domain: prop(r, 'domain'),
      industry: prop(r, 'industry'),
      phone: prop(r, 'phone'),
      city: prop(r, 'city'),
      state: prop(r, 'state'),
      country: prop(r, 'country'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapDeal(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'task', 'deal-', r),
    title: prop(r, 'dealname') || `Deal ${r.id}`,
    status: prop(r, 'dealstage'),
    timestamp: hsDate(prop(r, 'closedate'), null),
    metadata: {
      hubspotType: 'deal',
      stage: prop(r, 'dealstage'),
      pipeline: prop(r, 'pipeline'),
      amount: prop(r, 'amount'),
      closeDate: prop(r, 'closedate'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapTicket(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'task', 'ticket-', r),
    title: prop(r, 'subject') || truncate(prop(r, 'content'), 80) || `Ticket ${r.id}`,
    status: prop(r, 'hs_pipeline_stage'),
    body: truncate(prop(r, 'content'), 300),
    metadata: {
      hubspotType: 'ticket',
      pipeline: prop(r, 'hs_pipeline'),
      stage: prop(r, 'hs_pipeline_stage'),
      priority: prop(r, 'hs_ticket_priority'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapProduct(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'document', 'product-', r),
    title: prop(r, 'name') || prop(r, 'hs_sku') || `Product ${r.id}`,
    body: truncate(prop(r, 'description'), 300),
    status: 'active',
    metadata: {
      hubspotType: 'product',
      price: prop(r, 'price'),
      sku: prop(r, 'hs_sku'),
    },
  });
}

export function mapNote(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  const body = stripHtml(prop(r, 'hs_note_body'));
  return makeEntity({
    ...base(ctx, 'activity', 'note-', r),
    title: truncate(body, 80) || `Note ${r.id}`,
    body: truncate(body, 500),
    timestamp: hsDate(prop(r, 'hs_timestamp'), null),
    metadata: {
      hubspotType: 'note',
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapTask(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'task', 'task-', r),
    title: prop(r, 'hs_task_subject') || truncate(stripHtml(prop(r, 'hs_task_body')), 80) || `Task ${r.id}`,
    status: prop(r, 'hs_task_status'),
    body: truncate(stripHtml(prop(r, 'hs_task_body')), 300),
    // For a HubSpot task hs_timestamp is the DUE date (not creation) — surface it as the task's timestamp.
    timestamp: hsDate(prop(r, 'hs_timestamp'), null),
    metadata: {
      hubspotType: 'task',
      status: prop(r, 'hs_task_status'),
      priority: prop(r, 'hs_task_priority'),
      taskType: prop(r, 'hs_task_type'),
      dueDate: prop(r, 'hs_timestamp'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapMeeting(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'calendar_event', 'meeting-', r),
    title: prop(r, 'hs_meeting_title') || `Meeting ${r.id}`,
    body: truncate(stripHtml(prop(r, 'hs_meeting_body')), 300),
    timestamp: hsDate(prop(r, 'hs_meeting_start_time'), hsDate(prop(r, 'hs_timestamp'), null)),
    endTimestamp: hsDate(prop(r, 'hs_meeting_end_time'), null),
    metadata: {
      hubspotType: 'meeting',
      location: prop(r, 'hs_meeting_location'),
      startTime: prop(r, 'hs_meeting_start_time'),
      endTime: prop(r, 'hs_meeting_end_time'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

export function mapEmail(ctx: SyncContext, r: HsRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, 'message', 'email-', r),
    title: prop(r, 'hs_email_subject') || '(no subject)',
    body: truncate(stripHtml(prop(r, 'hs_email_text')), 500),
    author: prop(r, 'hs_email_from_email'),
    timestamp: hsDate(prop(r, 'hs_timestamp'), null),
    metadata: {
      hubspotType: 'email',
      direction: prop(r, 'hs_email_direction'),
      from: prop(r, 'hs_email_from_email'),
      hubspotOwnerId: prop(r, 'hubspot_owner_id'),
    },
  });
}

/** Owners come from `/crm/v3/owners` — a flat camelCase shape, NOT the CRM-object property map. */
export function mapOwner(ctx: SyncContext, o: HsOwner): UnifiedEntity {
  const name = [o.firstName, o.lastName].filter(Boolean).join(' ').trim();
  // An owner's own `updatedAt` is the churn-free stamp: owners are full-walked every run (no last-modified
  // filter exists), so stamping the run clock would re-dirty every owner each sync; `updatedAt` changes
  // only when the owner actually does. Fall back to a STABLE baseline (never the run clock) if absent.
  const created = iso(o.createdAt, HS_STABLE_TS);
  const updated = iso(o.updatedAt, created);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'contact',
    sourceId: `owner-${o.id}`,
    now: ctx.now,
    url: null,
    createdAt: created,
    updatedAt: updated,
    title: name || o.email || `Owner ${o.id}`,
    author: o.email ?? null,
    status: o.archived ? 'archived' : 'active',
    metadata: {
      hubspotType: 'owner',
      email: o.email ?? null,
      userId: o.userId ?? null,
    },
  });
}

/* ── Object catalog ────────────────────────────────────────────────────────────── */

/** One HubSpot CRM object mounted as a Search-driven service resource. id === resource id === catalog id. */
interface ObjectSpec {
  id: string;
  label: string;
  /** The `/crm/v3/objects/{object}` path segment. */
  object: string;
  kind: UnifiedEntityKind;
  /** The last-modified property to filter/sort on — the contacts exception is `lastmodifieddate`. */
  lastMod: string;
  /** Properties to request (HubSpot returns only a default subset otherwise). */
  properties: string[];
  map: (ctx: SyncContext, r: HsRecord) => UnifiedEntity;
}

const SEARCH_SPECS: ObjectSpec[] = [
  { id: 'hubspot_contacts', label: 'Contacts', object: 'contacts', kind: 'contact', lastMod: 'lastmodifieddate', map: mapContact,
    properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id'] },
  { id: 'hubspot_companies', label: 'Companies', object: 'companies', kind: 'organization', lastMod: 'hs_lastmodifieddate', map: mapCompany,
    properties: ['name', 'domain', 'industry', 'phone', 'city', 'state', 'country', 'hubspot_owner_id'] },
  { id: 'hubspot_deals', label: 'Deals', object: 'deals', kind: 'task', lastMod: 'hs_lastmodifieddate', map: mapDeal,
    properties: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate', 'hubspot_owner_id'] },
  { id: 'hubspot_tickets', label: 'Tickets', object: 'tickets', kind: 'task', lastMod: 'hs_lastmodifieddate', map: mapTicket,
    properties: ['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'hs_ticket_priority', 'hubspot_owner_id'] },
  { id: 'hubspot_products', label: 'Products', object: 'products', kind: 'document', lastMod: 'hs_lastmodifieddate', map: mapProduct,
    properties: ['name', 'price', 'description', 'hs_sku'] },
  { id: 'hubspot_notes', label: 'Notes', object: 'notes', kind: 'activity', lastMod: 'hs_lastmodifieddate', map: mapNote,
    properties: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'] },
  { id: 'hubspot_tasks', label: 'Tasks', object: 'tasks', kind: 'task', lastMod: 'hs_lastmodifieddate', map: mapTask,
    properties: ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority', 'hs_task_type', 'hs_timestamp', 'hubspot_owner_id'] },
  { id: 'hubspot_meetings', label: 'Meetings', object: 'meetings', kind: 'calendar_event', lastMod: 'hs_lastmodifieddate', map: mapMeeting,
    properties: ['hs_meeting_title', 'hs_meeting_body', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_location', 'hs_timestamp', 'hubspot_owner_id'] },
  { id: 'hubspot_emails', label: 'Emails', object: 'emails', kind: 'message', lastMod: 'hs_lastmodifieddate', map: mapEmail,
    properties: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_from_email', 'hs_timestamp', 'hubspot_owner_id'] },
];

/* ── Search-driven incremental pull ────────────────────────────────────────────── */

interface SearchBody {
  filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>;
  sorts: Array<{ propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>;
  properties: string[];
  limit: number;
  after?: string;
}

interface SearchCursor {
  /** Epoch-ms last-modified high-water (max `updatedAt` committed at last drain/cap); the durable resume key. */
  hw?: number;
  /** Within-run search offset (`paging.next.after`), valid only while `runAt === ctx.now`. */
  after?: string;
  /** The run clock that minted `after`/`page`; across runs the offset is dropped and the search rebuilds from `hw`. */
  runAt?: string;
  /** Max `updatedAt` (epoch ms) seen this walk; committed as `hw` on drain/cap. */
  pending?: number;
  page?: number;
}

/**
 * Pull one page of `spec.object` via the Search API. `WHERE <lastMod> GTE <hw> ORDER BY <lastMod>
 * ASCENDING`, paging within the run via `paging.next.after` and committing the newest `updatedAt` as the
 * high-water at drain or the MAX_PAGES cap so the next run resumes forward from there (leapfrog-free). The
 * `after` offset is only honored within the run that minted it — a fresh run rebuilds the search from the
 * high-water, so an interrupted run never resumes a stale/ shifted offset. First sync (no `hw`) sends no
 * filter → all objects ASC, walked in MAX_PAGES chunks across runs, always under Search's 10k-per-query cap.
 */
function makeSearchPull(spec: ObjectSpec): (ctx: SyncContext) => Promise<SyncPage> {
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<SearchCursor>(ctx.cursor) ?? {};
    const sameRun = !!c.after && c.runAt === ctx.now;
    const page = sameRun ? (c.page ?? 0) : 0;

    const body: SearchBody = {
      // GTE the high-water MINUS a small overlap (see OVERLAP_MS) so an out-of-order-indexed record near
      // the boundary is re-scanned rather than skipped; the store dedups the re-emit.
      filterGroups: c.hw != null ? [{ filters: [{ propertyName: spec.lastMod, operator: 'GTE', value: String(Math.max(0, c.hw - OVERLAP_MS)) }] }] : [],
      sorts: [{ propertyName: spec.lastMod, direction: 'ASCENDING' }],
      // Request the sort/filter property alongside the business fields, so the high-water can advance by
      // the SAME field we sort/filter on. (The top-level `updatedAt` is NOT safe for contacts: it tracks
      // `hs_lastmodifieddate`, but contacts sort on the distinct `lastmodifieddate`, so resuming by
      // `updatedAt` would skip contacts whose `lastmodifieddate` sits below a system-touched `updatedAt`.)
      properties: spec.properties.includes(spec.lastMod) ? spec.properties : [...spec.properties, spec.lastMod],
      limit: SEARCH_LIMIT,
      ...(sameRun ? { after: c.after } : {}),
    };
    const resp = await ctx.http.postJson<HsSearchResp>(`${HUBSPOT_API}/crm/v3/objects/${spec.object}/search`, body);
    const results = resp.data.results ?? [];

    // ASC walk → advance the high-water to the newest last-modified seen, read from the SAME property we
    // sorted/filtered on (falling back to the top-level `updatedAt` only if that property is absent). On a
    // fresh run start tracking from the committed high-water — never a stale mid-walk `pending` from an
    // interrupted prior run.
    let pending = sameRun ? (c.pending ?? c.hw) : c.hw;
    for (const r of results) {
      const t = hsEpoch(prop(r, spec.lastMod)) ?? (r.updatedAt ? Date.parse(r.updatedAt) : NaN);
      if (t != null && !Number.isNaN(t) && (pending == null || t > pending)) pending = t;
    }
    const nextAfter = resp.data.paging?.next?.after ?? undefined;
    const more = !!nextAfter && results.length > 0 && page + 1 < MAX_PAGES;
    const cursor = more
      ? toJsonCursor({ hw: c.hw, after: nextAfter, runAt: ctx.now, pending, page: page + 1 } satisfies SearchCursor)
      : toJsonCursor({ hw: pending } satisfies SearchCursor);
    return { entities: results.map((r) => spec.map(ctx, r)), cursor, hasMore: more };
  };
}

/* ── Owners full-list pull (no search / no last-modified filter) ───────────────── */

interface OwnersCursor {
  after?: string;
}

async function pullOwners(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<OwnersCursor>(ctx.cursor) ?? {};
  const resp = await ctx.http.getJson<HsOwnersResp>(`${HUBSPOT_API}/crm/v3/owners`, {
    query: { limit: OWNERS_LIMIT, archived: false, ...(c.after ? { after: c.after } : {}) },
  });
  const results = resp.data.results ?? [];
  const nextAfter = resp.data.paging?.next?.after ?? undefined;
  const more = !!nextAfter && results.length > 0;
  // On drain reset the cursor so the next run re-walks the full owner snapshot; the store dedups by id +
  // the owner's own `updatedAt`, so a re-walk writes nothing unless an owner actually changed.
  const cursor = more ? toJsonCursor({ after: nextAfter } satisfies OwnersCursor) : toJsonCursor({} satisfies OwnersCursor);
  return { entities: results.map((o) => mapOwner(ctx, o)), cursor, hasMore: more };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const HUBSPOT_REASONS = {
  unauthorized: 'Service not authorized — this HubSpot scope was not granted (e.g. the hub is not on this portal) (403)',
  unprovisioned: 'Object not available for this HubSpot portal (404)',
} as const;

/** Wrap a pull so one unavailable object degrades instead of failing the whole family. */
function serviceResource(id: string, label: string, kind: UnifiedEntityKind, pull: (ctx: SyncContext) => Promise<SyncPage>): AdapterResource {
  return { id, label, kind, pull: graceful(pull, HUBSPOT_REASONS) };
}

const hubspotResources: AdapterResource[] = [
  ...SEARCH_SPECS.map((s) => serviceResource(s.id, s.label, s.kind, makeSearchPull(s))),
  serviceResource('hubspot_owners', 'Owners', 'contact', pullOwners),
];

export const hubspotAdapter: ConnectorAdapter = {
  connectorId: 'hubspot',
  baseHeaders: { Accept: 'application/json' },
  resources: hubspotResources,
};

/* ── Runtime capability discovery (scope-gated, like GitHub / Slack / Atlassian) ── */

/** A HubSpot service (object) and the OAuth scope that unlocks it. */
export interface HubSpotService {
  id: string;
  label: string;
  /** The HubSpot OAuth scope granting read access to this service. */
  scope: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — the runtime source of truth for capability discovery. Ids match the
 * `AdapterResource.id`, so the Enterprise Connector Center shows a live object count per service. HubSpot's
 * scopes are per-object, so this projects like GitHub / Slack / Atlassian. Notes / Tasks / Meetings /
 * Emails have no dedicated scopes — HubSpot authorizes those engagement objects under
 * `crm.objects.contacts.read`; Products ride the tier-gated `e-commerce` scope; Tickets ride `tickets`.
 */
export const HUBSPOT_SERVICES: HubSpotService[] = [
  { id: 'hubspot_contacts', label: 'Contacts', scope: 'crm.objects.contacts.read', kind: 'contact' },
  { id: 'hubspot_companies', label: 'Companies', scope: 'crm.objects.companies.read', kind: 'organization' },
  { id: 'hubspot_deals', label: 'Deals', scope: 'crm.objects.deals.read', kind: 'task' },
  { id: 'hubspot_tickets', label: 'Tickets', scope: 'tickets', kind: 'task' },
  { id: 'hubspot_products', label: 'Products', scope: 'e-commerce', kind: 'document' },
  { id: 'hubspot_notes', label: 'Notes', scope: 'crm.objects.contacts.read', kind: 'activity' },
  { id: 'hubspot_tasks', label: 'Tasks', scope: 'crm.objects.contacts.read', kind: 'task' },
  { id: 'hubspot_meetings', label: 'Meetings', scope: 'crm.objects.contacts.read', kind: 'calendar_event' },
  { id: 'hubspot_emails', label: 'Emails', scope: 'crm.objects.contacts.read', kind: 'message' },
  // Owners is the one non-Search resource (the `/crm/v3/owners` list); listed last to match the adapter's
  // resource order so catalog ids align 1:1 with resource ids for the live per-service object counts.
  { id: 'hubspot_owners', label: 'Owners', scope: 'crm.objects.owners.read', kind: 'contact' },
];

/** A service plus whether the connected portal actually granted its scope. */
export interface HubSpotServiceStatus extends HubSpotService {
  available: boolean;
}

/**
 * Runtime capability discovery: which services are available given the scopes HubSpot actually granted
 * (`ConnectedAccount.grantedScopes`). Pure — the Enterprise Connector Center renders exactly this (✓/✗);
 * nothing is hardcoded. Mirrors `githubServiceAvailability` / `slackServiceAvailability` /
 * `atlassianServiceAvailability`.
 */
export function hubspotServiceAvailability(grantedScopes: readonly string[]): HubSpotServiceStatus[] {
  const granted = new Set(grantedScopes);
  return HUBSPOT_SERVICES.map((s) => ({ ...s, available: granted.has(s.scope) }));
}
