/**
 * Microsoft 365 sync resources (Phase P2.3) — Outlook Mail, Calendar, OneDrive, Contacts, and Teams.
 *
 * These plug into the SAME `microsoft-entra` connector/adapter (same authenticated Graph token, same PKCE,
 * same vault — no second OAuth) as additional resources. Each pulls live Microsoft Graph via the shared
 * delta helpers (reused from the Entra adapter) and maps into the UDM. CRITICAL: every resource is wrapped
 * in `graceful()`, which turns a 403/404 (module not licensed / mailbox or OneDrive not provisioned for
 * this user) into an empty page — so a not-yet-licensed module never fails the account's directory sync.
 * Genuinely retryable errors (429/5xx/network, and the 410 delta-expiry) are handled normally.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import {
  entraDeltaRequestUrl,
  entraAdvanceCursor,
  splitGraphDelta,
  splitDriveDelta,
  messageFields,
  eventFields,
  driveItemFields,
  contactFields,
  teamFields,
  MAIL_DELTA_URL,
  DRIVE_DELTA_URL,
  CONTACTS_DELTA_URL,
  JOINED_TEAMS_URL,
  CALENDAR_VIEW_DELTA_PATH,
  type EntraDeltaCursor,
  type GraphDeltaResponse,
  type GraphMessage,
  type GraphEvent,
  type GraphDriveItem,
  type GraphContact,
  type GraphTeam,
} from '@neuropause/shared';
import type { AdapterResource, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

/* ── mappers (Graph object → UnifiedEntity). Pure given ctx. ──────────────────────────── */

export function mapMessage(ctx: SyncContext, m: GraphMessage): UnifiedEntity {
  const f = messageFields(m);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'message',
    sourceId: m.id,
    now: ctx.now,
    title: f.title,
    url: f.url,
    author: f.author,
    body: truncate(f.preview ?? undefined, 500),
    createdAt: f.sentAt ?? f.receivedAt ?? ctx.now,
    updatedAt: ctx.now,
    timestamp: f.receivedAt,
    metadata: f.metadata,
  });
}

export function mapEvent(ctx: SyncContext, e: GraphEvent): UnifiedEntity {
  const f = eventFields(e);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'calendar_event',
    sourceId: e.id,
    now: ctx.now,
    title: f.title,
    url: f.url,
    author: f.author,
    body: truncate(f.preview ?? undefined, 500),
    status: f.status,
    createdAt: e.createdDateTime ?? ctx.now,
    updatedAt: e.lastModifiedDateTime ?? ctx.now,
    timestamp: f.start,
    endTimestamp: f.end,
    metadata: f.metadata,
  });
}

export function mapDriveItem(ctx: SyncContext, d: GraphDriveItem): UnifiedEntity {
  const f = driveItemFields(d);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'file',
    sourceId: d.id,
    now: ctx.now,
    title: f.title,
    url: f.url,
    createdAt: f.createdAt ?? ctx.now,
    updatedAt: f.modifiedAt ?? ctx.now,
    timestamp: f.modifiedAt,
    metadata: f.metadata,
  });
}

export function mapContact(ctx: SyncContext, c: GraphContact): UnifiedEntity {
  const f = contactFields(c);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'contact',
    sourceId: c.id,
    now: ctx.now,
    title: f.title,
    author: f.author,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    metadata: f.metadata,
  });
}

export function mapTeam(ctx: SyncContext, t: GraphTeam): UnifiedEntity {
  const f = teamFields(t);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'workspace',
    sourceId: t.id,
    now: ctx.now,
    title: f.title,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    metadata: f.metadata,
  });
}

/* ── generic delta pulls ──────────────────────────────────────────────────────────────── */

/** Standard `@removed`-tombstone delta pull (mail, calendar, contacts). */
async function pullRemovedDelta<T extends { id: string; '@removed'?: { reason?: string } }>(
  ctx: SyncContext,
  baseUrl: string,
  map: (ctx: SyncContext, item: T) => UnifiedEntity,
): Promise<SyncPage> {
  const cursor = parseJsonCursor<EntraDeltaCursor>(ctx.cursor);
  const url = entraDeltaRequestUrl(cursor, baseUrl);
  let data: GraphDeltaResponse<T>;
  try {
    data = (await ctx.http.getJson<GraphDeltaResponse<T>>(url)).data;
  } catch (err) {
    if (err instanceof HttpError && err.status === 410) {
      data = (await ctx.http.getJson<GraphDeltaResponse<T>>(baseUrl)).data;
    } else {
      throw err;
    }
  }
  const { present, removedIds } = splitGraphDelta<T>(data);
  const entities = present.map((item) => map(ctx, item));
  const { cursor: nextCursor, hasMore } = entraAdvanceCursor<T>(data, cursor?.delta ?? null);
  return { entities, deletedSourceIds: removedIds, cursor: toJsonCursor(nextCursor), hasMore };
}

/** OneDrive delta pull — deletions arrive via a `deleted` facet; the drive root item is skipped. */
async function pullDrive(ctx: SyncContext): Promise<SyncPage> {
  const cursor = parseJsonCursor<EntraDeltaCursor>(ctx.cursor);
  const url = entraDeltaRequestUrl(cursor, DRIVE_DELTA_URL);
  let data: GraphDeltaResponse<GraphDriveItem>;
  try {
    data = (await ctx.http.getJson<GraphDeltaResponse<GraphDriveItem>>(url)).data;
  } catch (err) {
    if (err instanceof HttpError && err.status === 410) {
      data = (await ctx.http.getJson<GraphDeltaResponse<GraphDriveItem>>(DRIVE_DELTA_URL)).data;
    } else {
      throw err;
    }
  }
  const { present, removedIds } = splitDriveDelta(data);
  const entities = present
    .filter((d) => d.parentReference != null) // skip the drive root item itself
    .map((d) => mapDriveItem(ctx, d));
  const { cursor: nextCursor, hasMore } = entraAdvanceCursor(data, cursor?.delta ?? null);
  return { entities, deletedSourceIds: removedIds, cursor: toJsonCursor(nextCursor), hasMore };
}

/** calendarView delta needs a date window on the first call (the deltaLink encodes it thereafter). */
async function pullCalendar(ctx: SyncContext): Promise<SyncPage> {
  const start = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const base = `${CALENDAR_VIEW_DELTA_PATH}?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
  return pullRemovedDelta<GraphEvent>(ctx, base, mapEvent);
}

/** Teams list (non-delta). */
async function pullTeams(ctx: SyncContext): Promise<SyncPage> {
  const data = (await ctx.http.getJson<{ value?: GraphTeam[] }>(JOINED_TEAMS_URL)).data;
  const entities = (data.value ?? []).map((t) => mapTeam(ctx, t));
  return { entities, cursor: null, hasMore: false };
}

/**
 * Wrap a pull so an unlicensed / unprovisioned module (403 Forbidden, 404 mailbox/drive not found) is
 * skipped with an empty page instead of failing the whole account sync. The empty page is tagged with a
 * `degraded` reason (403 → unauthorized, 404 → unprovisioned) so the module surfaces in the UI as
 * degraded rather than silently reading "0". Other errors (429/5xx/network, 410 delta-expiry) propagate.
 */
function graceful(pull: (ctx: SyncContext) => Promise<SyncPage>): (ctx: SyncContext) => Promise<SyncPage> {
  return async (ctx: SyncContext): Promise<SyncPage> => {
    try {
      return await pull(ctx);
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        return {
          entities: [],
          deletedSourceIds: [],
          cursor: ctx.cursor,
          hasMore: false,
          degraded: { kind: 'unauthorized', reason: 'Missing Graph permission or module not licensed (403)' },
        };
      }
      if (err instanceof HttpError && err.status === 404) {
        return {
          entities: [],
          deletedSourceIds: [],
          cursor: ctx.cursor,
          hasMore: false,
          degraded: { kind: 'unprovisioned', reason: 'Mailbox / OneDrive not provisioned yet (404)' },
        };
      }
      throw err;
    }
  };
}

/** The Microsoft 365 read/sync resources, added to the microsoft-entra adapter (same Graph token). */
export const m365Resources: AdapterResource[] = [
  {
    id: 'mail',
    label: 'Outlook Mail',
    kind: 'message',
    pull: graceful((ctx) => pullRemovedDelta<GraphMessage>(ctx, MAIL_DELTA_URL, mapMessage)),
  },
  { id: 'calendar', label: 'Calendar', kind: 'calendar_event', pull: graceful(pullCalendar) },
  { id: 'drive', label: 'OneDrive', kind: 'file', pull: graceful(pullDrive) },
  {
    id: 'contacts',
    label: 'Contacts',
    kind: 'contact',
    pull: graceful((ctx) => pullRemovedDelta<GraphContact>(ctx, CONTACTS_DELTA_URL, mapContact)),
  },
  { id: 'teams', label: 'Teams', kind: 'workspace', pull: graceful(pullTeams) },
];
