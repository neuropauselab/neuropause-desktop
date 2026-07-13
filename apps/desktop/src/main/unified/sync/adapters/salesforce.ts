/**
 * The Salesforce connector FAMILY (P5 — Increment 8) — Sales Cloud + Service Cloud.
 *
 * ONE connector (`salesforce`) — one OAuth 2.0 app, one token, one vault record, one card, one health
 * engine, one inspector — with each CRM object mounted as an `AdapterResource` on the SAME authenticated
 * session. This mirrors, exactly, how `microsoft-entra` hosts `m365Resources`, `atlassian` hosts Jira +
 * Confluence, and `google-workspace` / `github` / `slack` host their families. Every resource is wrapped
 * in the shared `graceful()` guard, so an object the org/user can't see degrades to a tagged empty page
 * instead of failing the whole family.
 *
 * The Salesforce wrinkle: API calls do NOT go to a fixed host, and which objects exist depends on the
 * org's edition + licensing (Sales Cloud vs Service Cloud). After OAuth, the adapter resolves — cached in
 * each resource's opaque cursor, and periodically re-resolved so capability stays live — the org's
 * `instance_url` (via the OIDC `userinfo` endpoint, which needs the `openid` scope) AND the set of objects
 * the authenticated user can actually query (via `describeGlobal`'s per-object `queryable` flag). Every
 * data call then goes to `{instance}/services/data/vXX/...`. The shared `HttpClient` bearers any absolute
 * URL (no host allowlist); microsoft-entra and atlassian already bearer a token to an API host distinct
 * from the auth host, and Salesforce goes one step further by deriving that host at runtime — but only
 * from Salesforce's own TLS-authenticated `userinfo`, using the org's own token, so an org token only ever
 * reaches that same org's instance (no trust boundary is crossed; the resolved origin is asserted https).
 * This is the runtime capability discovery: an object that isn't queryable is never queried (so an absent
 * object never returns the 400 INVALID_TYPE that `graceful` — 403/404 only — would let escape and fail the
 * family); it degrades as unprovisioned.
 *
 * Object → UDM (SF ids are globally unique 15/18-char keys, so NO collision prefix is needed):
 *   Account      → organization    (SOQL, SystemModstamp high-water, ASC)
 *   Contact      → contact
 *   Lead         → contact         (metadata.sfType disambiguates)
 *   Opportunity  → task            (a deal has an owner + close date + stage; nearest UDM kind)
 *   Case         → task            (a ticket; like a Jira issue → task)
 *   Campaign     → project
 *   Product2     → document        (a catalog record)
 *   User         → contact
 *   Task         → task            (an "Activity")
 *   Event        → calendar_event  (an "Activity" with start/end)
 *
 * Incremental sync is uniform across every object: `WHERE SystemModstamp >= <high-water> ORDER BY
 * SystemModstamp ASC, Id ASC`, draining `nextRecordsUrl` WITHIN a run and resuming ACROSS runs via the
 * SystemModstamp high-water — a MAX_PAGES cap commits the newest SystemModstamp seen and the next run's
 * SOQL picks up from exactly there. This is the same leapfrog-free ASC-resume pattern proven at
 * `atlassian.ts` `pullIssues`. Two Salesforce-specific hardenings:
 *   • A query locator (`nextRecordsUrl`) is bound to the OAuth SESSION and dies when the token rotates.
 *     Because the 600s token TTL mints a fresh session most syncs, a locator persisted from an
 *     interrupted run (a graceful 403 mid-walk, a 5xx, a crash) would be stale on the next run and 400.
 *     So the locator is tagged with the run clock (`ctx.now`) and followed ONLY within the same run;
 *     across runs it is ignored and the walk rebuilds from the durable high-water. Never wedges.
 *   • `>=` is second-precision (SOQL datetime literals have no sub-second form), so the boundary second
 *     is re-scanned (the store dedups). A single run drains up to MAX_PAGES×PAGE (20,000) rows, so the
 *     high-water always advances UNLESS more than 20,000 rows share one SystemModstamp second — a bound
 *     only a >20k-row single-transaction bulk load could reach (documented, like atlassian's).
 */
import type { UnifiedEntity, UnifiedEntityKind } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

/** Salesforce OAuth + OIDC host (the login host the manifest authorizes against). */
const SF_LOGIN = 'https://login.salesforce.com';
/** Data API version. Broadly available on every supported org; the fields we select are ancient/stable. */
const API_VERSION = 'v59.0';
/** SOQL batch size (Sforce-Query-Options; Salesforce's max). Fewer round-trips + a high same-second budget. */
const PAGE = 2000;
/** Bound one run's page walk (the SystemModstamp high-water resumes the rest next run — never leapfrogged). */
const MAX_PAGES = 10;
/**
 * How long a resolved `{instance, objects}` env is trusted before re-running userinfo + describeGlobal.
 * Unlike an atlassian cloudId (immutable), the queryable-object set is MUTABLE (edition/licensing/FLS
 * changes), so caching it forever would strand a newly-licensed object as "unprovisioned" forever. A
 * periodic re-resolve keeps capability discovery genuinely live while costing two calls per resource per
 * window only.
 */
const ENV_TTL_MS = 6 * 60 * 60 * 1000;

/** Normalize any timestamp string to a clean ISO-Z, or a fallback when absent/invalid. */
function iso(ts: string | null | undefined, fallback: string): string {
  if (!ts) return fallback;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/**
 * Format a raw SystemModstamp for a SOQL `WHERE SystemModstamp >= <literal>` filter. SOQL datetime
 * literals are UNQUOTED, UTC, and second-precision (`2026-07-01T10:00:00Z`) — SystemModstamp is stored in
 * UTC, so this is a straight truncation of the millisecond ISO. `>=` (not `>`) with second precision means
 * the boundary second is re-scanned each run; the store dedups by id, so no row is dropped and none is
 * double-counted. An unparseable value falls back to the epoch so the walk still makes forward progress.
 */
function soqlDate(raw: string): string {
  const t = Date.parse(raw);
  const d = Number.isNaN(t) ? new Date(0) : new Date(t);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The Lightning record URL for a Salesforce object row. */
function recordUrl(instance: string, object: string, id: string): string {
  return `${instance}/lightning/r/${object}/${id}/view`;
}

/* ── Instance + capability resolution (cached in each resource's cursor) ──────── */

/** The resolved org environment: the API host + which of OUR objects the user can actually query. */
interface SfEnv {
  /** The org's API origin, e.g. `https://acme.my.salesforce.com`. */
  instance: string;
  /** The subset of OUR objects (see `OBJECT_SPECS`) the org exposes AND the user can query. */
  objects: string[];
  /** When this env was resolved (ISO); drives periodic re-resolution so capability stays live. */
  resolvedAt?: string;
}

interface UserInfoResp {
  urls?: { rest?: string; sobjects?: string; query?: string };
}
interface DescribeGlobalResp {
  sobjects?: Array<{ name?: string; queryable?: boolean }>;
}

/** Parse the instance origin out of a userinfo `urls.*` value, rejecting anything not https. */
function instanceOrigin(restUrl: string): string {
  let origin: string;
  try {
    // urls.rest looks like `https://acme.my.salesforce.com/services/data/v{version}/` — the `{version}`
    // placeholder lives in the PATH, so only the origin is taken (and it is all we need).
    origin = new URL(restUrl).origin;
  } catch {
    throw new HttpError(404, 'salesforce: unparseable instance URL in userinfo', false);
  }
  // Defense in depth: the bearer token follows this origin, so refuse a non-https host outright.
  if (!origin.startsWith('https://')) throw new HttpError(404, 'salesforce: refusing non-https instance URL', false);
  return origin;
}

/**
 * Resolve the org's `instance_url` (via OIDC userinfo — its `urls.rest` carries a `{version}` placeholder,
 * so we take only its origin) and the set of queryable objects (via describeGlobal's per-object
 * `queryable` flag, which reflects this user's object-level access). Cached in the cursor and re-resolved
 * once the cache is older than `ENV_TTL_MS`, so a later-licensed object (Service Cloud added, a permission
 * granted) is picked up live rather than stranded "unprovisioned" forever. Mirrors `atlassian.resolveSite`
 * but with a TTL because — unlike an immutable cloudId — the queryable-object set is mutable.
 */
async function resolveEnv(ctx: SyncContext, cached?: SfEnv): Promise<SfEnv> {
  const fresh = cached?.instance && cached.resolvedAt && Date.parse(ctx.now) - Date.parse(cached.resolvedAt) < ENV_TTL_MS;
  if (fresh) return cached as SfEnv;
  const info = await ctx.http.getJson<UserInfoResp>(`${SF_LOGIN}/services/oauth2/userinfo`);
  const restUrl = info.data?.urls?.rest ?? info.data?.urls?.sobjects ?? info.data?.urls?.query;
  if (!restUrl) throw new HttpError(404, 'salesforce: no instance URL in userinfo (grant the openid scope)', false);
  const instance = instanceOrigin(restUrl);
  const dg = await ctx.http.getJson<DescribeGlobalResp>(`${instance}/services/data/${API_VERSION}/sobjects/`);
  const queryable = new Set((dg.data?.sobjects ?? []).filter((s) => s.queryable && s.name).map((s) => s.name as string));
  const objects = OBJECT_SPECS.map((s) => s.object).filter((o) => queryable.has(o));
  return { instance, objects, resolvedAt: ctx.now };
}

/** Pull the relative locator out of a Salesforce `nextRecordsUrl` (already a `/services/...` path). */
function relativeNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  return next.startsWith('http') ? new URL(next).pathname + new URL(next).search : next;
}

/* ── Record type + mappers ─────────────────────────────────────────────────────── */

/** A raw Salesforce record: the selected scalar fields plus SF's `attributes` envelope (ignored). */
type SfRecord = Record<string, string | number | boolean | null | undefined> & {
  Id?: string;
  SystemModstamp?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
};

/** String/number/boolean coercion for scalar metadata (SF sometimes returns numbers/bools). */
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * The shared UDM envelope for a Salesforce record: id, created/updated stamps (LastModifiedDate is the
 * user-meaningful "updated"; SystemModstamp is the incremental key and a fallback), and the record URL.
 * `instance` is threaded in per-call — NEVER via module state — because the orchestrator syncs distinct
 * accounts (and therefore distinct org instances) concurrently.
 */
function base(ctx: SyncContext, instance: string, object: string, kind: UnifiedEntityKind, r: SfRecord) {
  const created = iso(r.CreatedDate, ctx.now);
  const updated = iso(r.LastModifiedDate ?? r.SystemModstamp, created);
  return {
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind,
    sourceId: String(r.Id),
    now: ctx.now,
    url: r.Id ? recordUrl(instance, object, String(r.Id)) : null,
    createdAt: created,
    updatedAt: updated,
  } as const;
}

export function mapAccount(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'Account', 'organization', r),
    title: str(r.Name) || String(r.Id),
    status: 'active',
    body: truncate(str(r.Industry), 200),
    metadata: {
      sfType: 'Account',
      industry: str(r.Industry),
      type: str(r.Type),
      website: str(r.Website),
      phone: str(r.Phone),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapContact(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  const containerId = r.AccountId ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'organization', String(r.AccountId)) : null;
  return makeEntity({
    ...base(ctx, instance, 'Contact', 'contact', r),
    title: str(r.Name) || str(r.Email) || String(r.Id),
    author: str(r.Email),
    containerId,
    metadata: {
      sfType: 'Contact',
      email: str(r.Email),
      phone: str(r.Phone),
      title: str(r.Title),
      accountId: str(r.AccountId),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapLead(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'Lead', 'contact', r),
    title: str(r.Name) || str(r.Company) || String(r.Id),
    status: str(r.Status),
    author: str(r.Email),
    metadata: {
      sfType: 'Lead',
      email: str(r.Email),
      company: str(r.Company),
      status: str(r.Status),
      leadSource: str(r.LeadSource),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapOpportunity(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  const containerId = r.AccountId ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'organization', String(r.AccountId)) : null;
  return makeEntity({
    ...base(ctx, instance, 'Opportunity', 'task', r),
    title: str(r.Name) || String(r.Id),
    status: str(r.StageName),
    timestamp: r.CloseDate ? iso(str(r.CloseDate), ctx.now) : null,
    containerId,
    metadata: {
      sfType: 'Opportunity',
      stage: str(r.StageName),
      amount: typeof r.Amount === 'number' ? r.Amount : str(r.Amount),
      closeDate: str(r.CloseDate),
      probability: typeof r.Probability === 'number' ? r.Probability : str(r.Probability),
      isClosed: typeof r.IsClosed === 'boolean' ? r.IsClosed : null,
      isWon: typeof r.IsWon === 'boolean' ? r.IsWon : null,
      accountId: str(r.AccountId),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapCase(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  const containerId = r.AccountId ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'organization', String(r.AccountId)) : null;
  return makeEntity({
    ...base(ctx, instance, 'Case', 'task', r),
    title: str(r.Subject) || (r.CaseNumber ? `Case ${str(r.CaseNumber)}` : String(r.Id)),
    status: str(r.Status),
    containerId,
    metadata: {
      sfType: 'Case',
      caseNumber: str(r.CaseNumber),
      status: str(r.Status),
      priority: str(r.Priority),
      origin: str(r.Origin),
      accountId: str(r.AccountId),
      contactId: str(r.ContactId),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapCampaign(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'Campaign', 'project', r),
    title: str(r.Name) || String(r.Id),
    status: str(r.Status) ?? 'active',
    timestamp: r.StartDate ? iso(str(r.StartDate), ctx.now) : null,
    endTimestamp: r.EndDate ? iso(str(r.EndDate), ctx.now) : null,
    metadata: {
      sfType: 'Campaign',
      type: str(r.Type),
      status: str(r.Status),
      isActive: typeof r.IsActive === 'boolean' ? r.IsActive : null,
      startDate: str(r.StartDate),
      endDate: str(r.EndDate),
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapProduct(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'Product2', 'document', r),
    title: str(r.Name) || str(r.ProductCode) || String(r.Id),
    body: truncate(str(r.Description), 300),
    status: r.IsActive === false ? 'inactive' : 'active',
    metadata: {
      sfType: 'Product2',
      productCode: str(r.ProductCode),
      family: str(r.Family),
      isActive: typeof r.IsActive === 'boolean' ? r.IsActive : null,
    },
  });
}

export function mapUser(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'User', 'contact', r),
    title: str(r.Name) || str(r.Username) || String(r.Id),
    author: str(r.Email),
    status: r.IsActive === false ? 'inactive' : 'active',
    metadata: {
      sfType: 'User',
      username: str(r.Username),
      email: str(r.Email),
      title: str(r.Title),
      department: str(r.Department),
      isActive: typeof r.IsActive === 'boolean' ? r.IsActive : null,
    },
  });
}

export function mapTask(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  return makeEntity({
    ...base(ctx, instance, 'Task', 'task', r),
    title: str(r.Subject) || String(r.Id),
    status: str(r.Status),
    timestamp: r.ActivityDate ? iso(str(r.ActivityDate), ctx.now) : null,
    metadata: {
      sfType: 'Task',
      status: str(r.Status),
      priority: str(r.Priority),
      activityDate: str(r.ActivityDate),
      whatId: str(r.WhatId),
      whoId: str(r.WhoId),
      isClosed: typeof r.IsClosed === 'boolean' ? r.IsClosed : null,
      ownerId: str(r.OwnerId),
    },
  });
}

export function mapEvent(ctx: SyncContext, instance: string, r: SfRecord): UnifiedEntity {
  const startsAt = r.StartDateTime ? iso(str(r.StartDateTime), ctx.now) : (r.ActivityDate ? iso(str(r.ActivityDate), ctx.now) : null);
  const endsAt = r.EndDateTime ? iso(str(r.EndDateTime), ctx.now) : null;
  return makeEntity({
    ...base(ctx, instance, 'Event', 'calendar_event', r),
    title: str(r.Subject) || String(r.Id),
    timestamp: startsAt,
    endTimestamp: endsAt,
    metadata: {
      sfType: 'Event',
      location: str(r.Location),
      startDateTime: str(r.StartDateTime),
      endDateTime: str(r.EndDateTime),
      isAllDayEvent: typeof r.IsAllDayEvent === 'boolean' ? r.IsAllDayEvent : null,
      whatId: str(r.WhatId),
      whoId: str(r.WhoId),
      ownerId: str(r.OwnerId),
    },
  });
}

/* ── Object catalog ────────────────────────────────────────────────────────────── */

/** One Salesforce object mounted as a service resource. `id` === resource id === module-stat id. */
interface ObjectSpec {
  id: string;
  label: string;
  /** The SOQL sObject name — the runtime capability key describeGlobal is filtered against. */
  object: string;
  kind: UnifiedEntityKind;
  /** Fields to SELECT. Curated to standard fields present on a stock org (avoid INVALID_FIELD). */
  fields: string[];
  map: (ctx: SyncContext, instance: string, r: SfRecord) => UnifiedEntity;
}

/** Fields every incremental walk needs: the key, the high-water field, and the created/updated stamps. */
const SYS = ['Id', 'CreatedDate', 'LastModifiedDate', 'SystemModstamp'];

const OBJECT_SPECS: ObjectSpec[] = [
  { id: 'salesforce_accounts', label: 'Accounts', object: 'Account', kind: 'organization', map: mapAccount,
    fields: [...SYS, 'Name', 'Type', 'Industry', 'Website', 'Phone', 'OwnerId'] },
  { id: 'salesforce_contacts', label: 'Contacts', object: 'Contact', kind: 'contact', map: mapContact,
    fields: [...SYS, 'Name', 'FirstName', 'LastName', 'Email', 'Phone', 'Title', 'AccountId', 'OwnerId'] },
  { id: 'salesforce_leads', label: 'Leads', object: 'Lead', kind: 'contact', map: mapLead,
    fields: [...SYS, 'Name', 'FirstName', 'LastName', 'Email', 'Company', 'Status', 'LeadSource', 'OwnerId'] },
  { id: 'salesforce_opportunities', label: 'Opportunities', object: 'Opportunity', kind: 'task', map: mapOpportunity,
    fields: [...SYS, 'Name', 'StageName', 'Amount', 'CloseDate', 'Probability', 'IsClosed', 'IsWon', 'AccountId', 'OwnerId'] },
  { id: 'salesforce_cases', label: 'Cases', object: 'Case', kind: 'task', map: mapCase,
    fields: [...SYS, 'CaseNumber', 'Subject', 'Status', 'Priority', 'Origin', 'AccountId', 'ContactId', 'OwnerId'] },
  { id: 'salesforce_campaigns', label: 'Campaigns', object: 'Campaign', kind: 'project', map: mapCampaign,
    fields: [...SYS, 'Name', 'Type', 'Status', 'IsActive', 'StartDate', 'EndDate', 'OwnerId'] },
  { id: 'salesforce_products', label: 'Products', object: 'Product2', kind: 'document', map: mapProduct,
    fields: [...SYS, 'Name', 'ProductCode', 'Family', 'IsActive', 'Description'] },
  { id: 'salesforce_users', label: 'Users', object: 'User', kind: 'contact', map: mapUser,
    fields: [...SYS, 'Name', 'Username', 'Email', 'Title', 'Department', 'IsActive'] },
  { id: 'salesforce_tasks', label: 'Tasks', object: 'Task', kind: 'task', map: mapTask,
    fields: [...SYS, 'Subject', 'Status', 'Priority', 'ActivityDate', 'WhatId', 'WhoId', 'IsClosed', 'OwnerId'] },
  { id: 'salesforce_events', label: 'Events', object: 'Event', kind: 'calendar_event', map: mapEvent,
    fields: [...SYS, 'Subject', 'Location', 'StartDateTime', 'EndDateTime', 'ActivityDate', 'IsAllDayEvent', 'WhatId', 'WhoId', 'OwnerId'] },
];

/* ── Generic SOQL pull ─────────────────────────────────────────────────────────── */

interface QueryResp {
  records?: SfRecord[];
  done?: boolean;
  nextRecordsUrl?: string | null;
  totalSize?: number;
}

interface QueryCursor {
  env?: SfEnv;
  /** Raw ISO high-water (max SystemModstamp committed at last drain/cap); the durable cross-run resume key. */
  hw?: string;
  /** Within-run query locator (relative path), valid only while `runAt === ctx.now` — see below. */
  next?: string;
  /** The run clock (`ctx.now`) that minted `next`/`page`; a locator is session-bound, so it is followed
   *  ONLY within the same run and ignored across runs (where the token — hence the session — has rotated). */
  runAt?: string;
  /** Max SystemModstamp seen this walk (raw ISO); committed as `hw` on drain/cap. */
  pending?: string;
  page?: number;
}

/**
 * Pull one page of `spec.object`. Uniform across every object:
 *   • resolve (or reuse cached, TTL'd) instance + queryable-object set;
 *   • if this object isn't queryable for the org/user, degrade as unprovisioned (never issue the query,
 *     which would 400 INVALID_TYPE and — since graceful only swallows 403/404 — take the family down);
 *   • else SOQL `WHERE SystemModstamp >= hw ORDER BY SystemModstamp ASC, Id ASC`, draining `nextRecordsUrl`
 *     WITHIN the run and committing the newest SystemModstamp as the high-water at drain or the MAX_PAGES
 *     cap so the next run resumes forward from there (leapfrog-free — the ASC-resume pattern from atlassian).
 * A locator is only ever resumed within the same run; a locator left in the cursor by an interrupted run
 * belongs to a now-rotated session, so a fresh run ignores it and rebuilds the query from the high-water.
 */
function makePull(spec: ObjectSpec): (ctx: SyncContext) => Promise<SyncPage> {
  return async (ctx: SyncContext): Promise<SyncPage> => {
    const c = parseJsonCursor<QueryCursor>(ctx.cursor) ?? {};
    const env = await resolveEnv(ctx, c.env);

    if (!env.objects.includes(spec.object)) {
      // Runtime capability discovery: object absent / not licensed / no object-level access for this user.
      // Preserve any incremental high-water so the module resumes cleanly if the object later appears.
      return {
        entities: [],
        cursor: toJsonCursor({ env, hw: c.hw }),
        hasMore: false,
        degraded: { kind: 'unprovisioned', reason: SF_REASONS.unprovisioned },
      };
    }

    // A locator (and its page counter) is only valid within the run that minted it — the OAuth session it
    // belongs to has rotated by the next run. Across runs we drop it and rebuild the SOQL from the high-water.
    const sameRun = !!c.next && c.runAt === ctx.now;
    const page = sameRun ? (c.page ?? 0) : 0;
    let resp;
    if (sameRun) {
      resp = await ctx.http.getJson<QueryResp>(`${env.instance}${c.next}`);
    } else {
      const where = c.hw ? `WHERE SystemModstamp >= ${soqlDate(c.hw)} ` : '';
      const soql = `SELECT ${spec.fields.join(',')} FROM ${spec.object} ${where}ORDER BY SystemModstamp ASC, Id ASC`;
      resp = await ctx.http.getJson<QueryResp>(`${env.instance}/services/data/${API_VERSION}/query`, {
        query: { q: soql },
        headers: { 'Sforce-Query-Options': `batchSize=${PAGE}` },
      });
    }

    const records = resp.data.records ?? [];
    // ASC walk → advance the high-water to the newest SystemModstamp seen. On a fresh run start tracking
    // from the committed high-water (never a stale mid-walk `pending` from an interrupted prior run).
    let pending = sameRun ? (c.pending ?? c.hw) : c.hw;
    for (const r of records) {
      const sm = r.SystemModstamp;
      if (sm && (!pending || Date.parse(sm) > Date.parse(pending))) pending = sm;
    }
    const next = resp.data.done ? undefined : relativeNext(resp.data.nextRecordsUrl);
    const more = !!next && records.length > 0 && page + 1 < MAX_PAGES;
    const cursor = more
      ? toJsonCursor({ env, hw: c.hw, next, runAt: ctx.now, pending, page: page + 1 })
      : toJsonCursor({ env, hw: pending });
    return { entities: records.map((r) => spec.map(ctx, env.instance, r)), cursor, hasMore: more };
  };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const SF_REASONS = {
  unauthorized: 'Service not authorized — the Salesforce grant lacks access to this object (403)',
  unprovisioned: 'Object not available for this Salesforce org — not licensed, not enabled, or no object-level access',
} as const;

/** Wrap a service resource so one unavailable object degrades instead of failing the whole family. */
function serviceResource(spec: ObjectSpec): AdapterResource {
  return { id: spec.id, label: spec.label, kind: spec.kind, pull: graceful(makePull(spec), SF_REASONS) };
}

export const salesforceAdapter: ConnectorAdapter = {
  connectorId: 'salesforce',
  baseHeaders: { Accept: 'application/json' },
  resources: OBJECT_SPECS.map(serviceResource),
};

/* ── Runtime capability discovery ─────────────────────────────────────────────── */

/** A Salesforce service (object) in the family. */
export interface SalesforceService {
  id: string;
  label: string;
  /** The SOQL object this service syncs. */
  object: string;
  /** The UDM kind it produces. */
  kind: UnifiedEntityKind;
}

/**
 * The service catalog — one entry per CRM object, ids matching the `AdapterResource.id` so the Enterprise
 * Connector Center shows a live object count per service. Unlike the scope-gated families (Google / GitHub
 * / Slack / Atlassian), Salesforce has NO per-object scope: the single `api` scope unlocks the whole data
 * API, and per-object AVAILABILITY is a runtime property of the org (edition + licensing + object-level
 * security), surfaced through describeGlobal → the per-module degraded status the Supervisor overlays.
 * There is therefore deliberately no `salesforceServiceAvailability(grantedScopes)` scope projection and
 * no `serviceCapabilities` branch — the sync subsystem's generic fallback (the adapter's declared
 * resources) is correct, and runtime capability is discovered live, never hardcoded.
 */
export const SALESFORCE_SERVICES: SalesforceService[] = OBJECT_SPECS.map((s) => ({
  id: s.id,
  label: s.label,
  object: s.object,
  kind: s.kind,
}));
