/**
 * Google Calendar adapter. Maps the primary calendar's events → calendar_event.
 *
 * This is the cleanest incremental case: Google issues a `syncToken` that, on the
 * next run, returns only what changed — including cancellations (status
 * 'cancelled'), which become soft-deletes. The cursor carries either a page token
 * (mid-run) or the sync token (between runs). An expired sync token (HTTP 410)
 * transparently falls back to a bounded full resync.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { parseJsonCursor, toJsonCursor, truncate } from './util';
import { isExpiredCursorError } from './delta';

const GCAL = 'https://www.googleapis.com/calendar/v3';
/** How far back the very first sync reaches. */
const INITIAL_WINDOW_DAYS = 60;

interface GCalEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: unknown[];
  hangoutLink?: string;
  recurringEventId?: string;
}

interface GCalResp {
  items?: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GCalCursor {
  page?: string;
  mode?: 'initial' | 'incremental';
  sync?: string | null;
}

export function mapEvent(ctx: SyncContext, ev: GCalEvent): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'calendar_event',
    sourceId: ev.id,
    now: ctx.now,
    title: ev.summary || '(no title)',
    url: ev.htmlLink ?? null,
    createdAt: ev.created ?? ctx.now,
    updatedAt: ev.updated ?? ctx.now,
    body: truncate(ev.description, 500),
    status: ev.status ?? null,
    author: ev.organizer?.email ?? ev.organizer?.displayName ?? null,
    timestamp: ev.start?.dateTime ?? ev.start?.date ?? null,
    endTimestamp: ev.end?.dateTime ?? ev.end?.date ?? null,
    metadata: {
      calendar: 'primary',
      location: ev.location ?? null,
      attendees: ev.attendees?.length ?? 0,
      hangoutLink: ev.hangoutLink ?? null,
      recurringEventId: ev.recurringEventId ?? null,
      organizerEmail: ev.organizer?.email ?? null,
    },
  });
}

function getEvents(
  ctx: SyncContext,
  mode: 'initial' | 'incremental',
  syncToken: string | null,
  pageToken: string | undefined,
) {
  const query: Record<string, string | number | boolean | undefined> = { maxResults: 250, pageToken };
  if (mode === 'incremental' && syncToken) {
    query.syncToken = syncToken;
    query.singleEvents = true;
  } else {
    query.singleEvents = true;
    query.orderBy = 'updated';
    query.timeMin = new Date(Date.now() - INITIAL_WINDOW_DAYS * 86_400_000).toISOString();
  }
  return ctx.http.getJson<GCalResp>(`${GCAL}/calendars/primary/events`, { query });
}

async function pullEvents(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<GCalCursor>(ctx.cursor);
  let mode: 'initial' | 'incremental';
  let pageToken: string | undefined;
  let syncToken: string | null;

  if (c?.page != null) {
    pageToken = c.page;
    mode = c.mode ?? 'initial';
    syncToken = c.sync ?? null;
  } else {
    pageToken = undefined;
    if (c?.sync) {
      mode = 'incremental';
      syncToken = c.sync;
    } else {
      mode = 'initial';
      syncToken = null;
    }
  }

  let data: GCalResp;
  try {
    data = (await getEvents(ctx, mode, syncToken, pageToken)).data;
  } catch (err) {
    if (isExpiredCursorError(err)) {
      // Sync token expired (410 Gone) — start a fresh bounded full resync.
      mode = 'initial';
      syncToken = null;
      pageToken = undefined;
      data = (await getEvents(ctx, mode, syncToken, pageToken)).data;
    } else {
      throw err;
    }
  }

  const items = data.items ?? [];
  const entities: UnifiedEntity[] = [];
  const deletedSourceIds: string[] = [];
  for (const ev of items) {
    if (ev.status === 'cancelled') deletedSourceIds.push(ev.id);
    else entities.push(mapEvent(ctx, ev));
  }

  const more = data.nextPageToken != null;
  const cursor = more
    ? toJsonCursor({ page: data.nextPageToken, mode, sync: mode === 'incremental' ? syncToken : null })
    : toJsonCursor({ sync: data.nextSyncToken ?? syncToken ?? null });
  return { entities, deletedSourceIds, cursor, hasMore: more };
}

/** Calendar service resource(s), mounted on the google-workspace connector (one shared token). */
export const googleCalendarResources: AdapterResource[] = [
  { id: 'calendar', label: 'Calendar', kind: 'calendar_event', pull: pullEvents },
];
