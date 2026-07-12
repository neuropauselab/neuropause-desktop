/**
 * Google People (Contacts) adapter. Maps a user's connections → the UDM `contact` kind.
 *
 * Incremental sync uses People API sync tokens: `connections.list(requestSyncToken=true)` returns a
 * `nextSyncToken` on the final page; the next run passes it as `syncToken` and receives only what changed
 * (deleted contacts arrive with `metadata.deleted=true` → soft-deletes). An expired sync token (410)
 * transparently falls back to a full resync. Mirrors googleCalendar.ts's token/page cursor + reset.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { isExpiredCursorError } from './delta';
import { parseJsonCursor, toJsonCursor } from './util';

const PEOPLE = 'https://people.googleapis.com/v1';
const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,photos,metadata';
const PAGE_SIZE = 500;

interface Person {
  resourceName: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string }>;
  metadata?: { deleted?: boolean; sources?: Array<{ updateTime?: string }> };
}
interface PeopleResp {
  connections?: Person[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Between runs `{ sync }`; mid-run `{ page }` (pagination uses pageToken, never syncToken, per the API). */
interface PeopleCursor {
  page?: string;
  sync?: string | null;
}

export function mapPerson(ctx: SyncContext, p: Person): UnifiedEntity {
  const email = p.emailAddresses?.[0]?.value ?? null;
  const org = p.organizations?.[0];
  const updatedAt = p.metadata?.sources?.[0]?.updateTime ?? ctx.now;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'contact',
    sourceId: p.resourceName,
    now: ctx.now,
    title: p.names?.[0]?.displayName ?? email ?? '(no name)',
    url: null,
    createdAt: updatedAt,
    updatedAt,
    author: email,
    metadata: {
      email,
      phone: p.phoneNumbers?.[0]?.value ?? null,
      organization: org?.name ?? null,
      jobTitle: org?.title ?? null,
      photo: p.photos?.[0]?.url ?? null,
    },
  });
}

async function requestConnections(ctx: SyncContext, syncToken: string | undefined, pageToken: string | undefined): Promise<PeopleResp> {
  const resp = await ctx.http.getJson<PeopleResp>(`${PEOPLE}/people/me/connections`, {
    query: {
      personFields: PERSON_FIELDS,
      pageSize: PAGE_SIZE,
      requestSyncToken: true,
      // syncToken and pageToken are mutually exclusive: the token opens a run, the page continues it.
      syncToken: pageToken ? undefined : syncToken,
      pageToken,
    },
  });
  return resp.data;
}

async function pullConnections(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<PeopleCursor>(ctx.cursor);
  const sync = c?.sync ?? undefined;
  const page = c?.page;

  let data: PeopleResp;
  try {
    data = await requestConnections(ctx, sync, page);
  } catch (err) {
    // Expired sync token (410) → drop it and do a full resync.
    if (isExpiredCursorError(err, [410])) {
      data = await requestConnections(ctx, undefined, undefined);
    } else {
      throw err;
    }
  }

  const entities: UnifiedEntity[] = [];
  const deletedSourceIds: string[] = [];
  for (const p of data.connections ?? []) {
    if (p.metadata?.deleted) deletedSourceIds.push(p.resourceName);
    else entities.push(mapPerson(ctx, p));
  }

  const next = data.nextPageToken;
  if (next) {
    const cursor: PeopleCursor = { page: next, sync: c?.sync ?? null };
    return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: true };
  }
  const cursor: PeopleCursor = { sync: data.nextSyncToken ?? c?.sync ?? null };
  return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: false };
}

export const googlePeopleAdapter: ConnectorAdapter = {
  connectorId: 'google-people',
  resources: [{ id: 'connections', label: 'Contacts', kind: 'contact', pull: pullConnections }],
};
