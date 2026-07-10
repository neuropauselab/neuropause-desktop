/**
 * Microsoft Entra ID (Azure AD) connector adapter — Phase P2.2.
 *
 * A REAL Microsoft Graph adapter that plugs into the existing unified sync orchestrator exactly like the
 * other built-in adapters (see googleCalendar.ts — this mirrors its delta pattern). It pulls the tenant
 * directory live from Graph v1.0: `/users/delta` and `/groups/delta` (true incremental sync via
 * `@odata.deltaLink`, with `@removed` tombstones → deletes and a `410 Gone` → full-resync fallback), plus
 * `/organization` for the tenant identity. The access token is injected by the orchestrator's HttpClient
 * (never handled here); 429/Retry-After/timeouts and retry/backoff are the framework's job. All Graph
 * parsing/mapping is the pure shared `entraGraph` core. No mocked responses — every request hits live Graph.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import {
  GRAPH_BASE_URL,
  ENTRA_USER_SELECT,
  ENTRA_GROUP_SELECT,
  graphUserFields,
  graphGroupFields,
  tenantFromOrganization,
  splitGraphDelta,
  entraDeltaRequestUrl,
  entraAdvanceCursor,
  type GraphUser,
  type GraphGroup,
  type GraphOrganization,
  type GraphDeltaResponse,
  type EntraDeltaCursor,
} from '@neuropause/shared';
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { HttpError } from '../http';
import { parseJsonCursor, toJsonCursor, truncate } from './util';
import { m365Resources } from './m365';

const USERS_DELTA = `${GRAPH_BASE_URL}/users/delta?$select=${ENTRA_USER_SELECT.join(',')}`;
const GROUPS_DELTA = `${GRAPH_BASE_URL}/groups/delta?$select=${ENTRA_GROUP_SELECT.join(',')}`;
const ORGANIZATION_URL = `${GRAPH_BASE_URL}/organization`;

/** Map a Graph user → a Unified `contact` entity. Pure given ctx. */
export function mapUser(ctx: SyncContext, u: GraphUser): UnifiedEntity {
  const f = graphUserFields(u);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'contact',
    sourceId: u.id,
    now: ctx.now,
    title: f.title,
    createdAt: u.createdDateTime ?? ctx.now,
    updatedAt: ctx.now,
    author: f.email ?? f.upn ?? null,
    status: f.enabled ? 'enabled' : 'disabled',
    metadata: f.metadata,
  });
}

/** Map a Graph group → a Unified `organization` entity. Pure given ctx. */
export function mapGroup(ctx: SyncContext, g: GraphGroup): UnifiedEntity {
  const f = graphGroupFields(g);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'organization',
    sourceId: g.id,
    now: ctx.now,
    title: f.title,
    body: truncate(g.description ?? undefined, 500),
    createdAt: g.createdDateTime ?? ctx.now,
    updatedAt: ctx.now,
    metadata: f.metadata,
  });
}

/** Map the Graph organization → a Unified `organization` entity representing the tenant. Pure given ctx. */
export function mapOrganization(ctx: SyncContext, org: GraphOrganization): UnifiedEntity {
  const t = tenantFromOrganization(org);
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'organization',
    sourceId: org.id,
    now: ctx.now,
    title: t.name,
    createdAt: org.createdDateTime ?? ctx.now,
    updatedAt: ctx.now,
    metadata: {
      directoryType: 'tenant',
      tenantId: t.tenantId,
      defaultDomain: t.defaultDomain,
      verifiedDomains: t.verifiedDomainCount,
      countryLetterCode: org.countryLetterCode ?? null,
      tenantType: org.tenantType ?? null,
    },
  });
}

/** Generic delta pull for a Graph directory collection. Mirrors googleCalendar's page/sync-token flow. */
async function pullDelta<T extends { id: string; '@removed'?: { reason?: string } }>(
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
    // An expired deltaLink returns 410 Gone — restart from a fresh full delta sync.
    if (err instanceof HttpError && err.status === 410) {
      data = (await ctx.http.getJson<GraphDeltaResponse<T>>(baseUrl)).data;
    } else {
      throw err;
    }
  }

  const { present, removedIds } = splitGraphDelta<T>(data);
  const entities = present.map((item) => map(ctx, item));
  const { cursor: nextCursor, hasMore } = entraAdvanceCursor<T>(data, cursor?.delta ?? null);
  return {
    entities,
    deletedSourceIds: removedIds,
    cursor: toJsonCursor(nextCursor),
    hasMore,
  };
}

/** Pull the tenant organization (single object; no delta). */
async function pullOrganization(ctx: SyncContext): Promise<SyncPage> {
  const data = (await ctx.http.getJson<GraphDeltaResponse<GraphOrganization>>(ORGANIZATION_URL)).data;
  const entities = (data.value ?? []).map((org) => mapOrganization(ctx, org));
  return { entities, cursor: null, hasMore: false };
}

export const entraAdapter: ConnectorAdapter = {
  connectorId: 'microsoft-entra',
  resources: [
    {
      id: 'users',
      label: 'Users',
      kind: 'contact',
      pull: (ctx) => pullDelta<GraphUser>(ctx, USERS_DELTA, mapUser),
    },
    {
      id: 'groups',
      label: 'Groups',
      kind: 'organization',
      pull: (ctx) => pullDelta<GraphGroup>(ctx, GROUPS_DELTA, mapGroup),
    },
    {
      id: 'organization',
      label: 'Organization',
      kind: 'organization',
      pull: pullOrganization,
    },
    // Microsoft 365 read/sync resources on the same Graph token (mail, calendar, drive, contacts, teams).
    // Each degrades gracefully if the module is not licensed for this user (see m365.ts).
    ...m365Resources,
  ],
};
