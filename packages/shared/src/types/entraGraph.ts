/**
 * Microsoft Entra ID / Microsoft Graph — shared, pure logic (Phase P2.2).
 *
 * This is the connector-agnostic, deterministic core the Entra ConnectorAdapter (main) and its tests share:
 * the real Microsoft Graph response SHAPES (v1.0), the delta-sync cursor model (`@odata.nextLink` /
 * `@odata.deltaLink`, mirroring the Google Calendar adapter's page/sync-token pattern), the field
 * extractors that flatten a Graph user/group/organization into Unified metadata (primitives only), and the
 * Entra `EnterpriseIntegrationProfile` for the P2.1 foundation. NOTHING here is fabricated data or a mocked
 * API — these are type definitions + pure functions over inputs the live Graph endpoints return. No I/O.
 */
import type { EnterpriseIntegrationProfile } from './integrationManifest';

/* ── Microsoft Graph endpoints + constants ─────────────────────────────────────────── */

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
export const GRAPH_API_VERSION = 'v1.0';
export const ENTRA_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const ENTRA_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/** Delegated Microsoft Graph scopes the connector requests (offline_access yields the refresh token). */
export const ENTRA_GRAPH_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'User.Read.All',
  'Group.Read.All',
  'Directory.Read.All',
];

/** $select fields for /users/delta (delta-supported properties only). */
export const ENTRA_USER_SELECT: readonly string[] = [
  'id',
  'displayName',
  'userPrincipalName',
  'mail',
  'jobTitle',
  'department',
  'accountEnabled',
  'userType',
  'givenName',
  'surname',
  'officeLocation',
  'createdDateTime',
];

/** $select fields for /groups/delta. */
export const ENTRA_GROUP_SELECT: readonly string[] = [
  'id',
  'displayName',
  'description',
  'mail',
  'mailNickname',
  'mailEnabled',
  'securityEnabled',
  'groupTypes',
  'visibility',
  'createdDateTime',
];

/* ── Graph response shapes (real v1.0 shapes) ──────────────────────────────────────── */

/** A delta-removed marker Graph attaches to deleted objects. */
export interface GraphRemoved {
  reason?: string;
}

export interface GraphUser {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  givenName?: string | null;
  surname?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  officeLocation?: string | null;
  accountEnabled?: boolean | null;
  userType?: string | null;
  createdDateTime?: string | null;
  '@removed'?: GraphRemoved;
}

export interface GraphGroup {
  id: string;
  displayName?: string | null;
  description?: string | null;
  mail?: string | null;
  mailNickname?: string | null;
  mailEnabled?: boolean | null;
  securityEnabled?: boolean | null;
  groupTypes?: string[];
  visibility?: string | null;
  createdDateTime?: string | null;
  '@removed'?: GraphRemoved;
}

export interface GraphVerifiedDomain {
  name?: string;
  isDefault?: boolean;
  isInitial?: boolean;
  type?: string;
}

export interface GraphOrganization {
  id: string;
  displayName?: string | null;
  verifiedDomains?: GraphVerifiedDomain[];
  tenantType?: string | null;
  countryLetterCode?: string | null;
  createdDateTime?: string | null;
}

/** A Graph delta/collection response envelope. */
export interface GraphDeltaResponse<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/* ── delta cursor model ────────────────────────────────────────────────────────────── */

/**
 * The opaque cursor the adapter persists between pulls. Graph returns fully-formed, signed links, so we
 * store them verbatim: `next` while more pages remain this run, `delta` (the deltaLink) between runs.
 */
export interface EntraDeltaCursor {
  next?: string;
  delta?: string | null;
}

/** The URL to fetch next: an in-progress next page, else the stored delta link, else a fresh delta base. */
export function entraDeltaRequestUrl(cursor: EntraDeltaCursor | null, baseUrl: string): string {
  if (cursor?.next) return cursor.next;
  if (cursor?.delta) return cursor.delta;
  return baseUrl;
}

/** Advance the cursor from a delta response: keep paging on nextLink, else capture the new deltaLink. */
export function entraAdvanceCursor<T>(
  resp: GraphDeltaResponse<T>,
  prevDelta: string | null,
): { cursor: EntraDeltaCursor; hasMore: boolean } {
  const next = resp['@odata.nextLink'];
  if (next) return { cursor: { next }, hasMore: true };
  return { cursor: { delta: resp['@odata.deltaLink'] ?? prevDelta ?? null }, hasMore: false };
}

/** True when a delta item is a tombstone (deleted at the source). */
export function isGraphRemoved(item: { '@removed'?: GraphRemoved }): boolean {
  return item['@removed'] != null;
}

/** Partition a delta page into present objects and removed source ids. Deterministic. */
export function splitGraphDelta<T extends { id: string; '@removed'?: GraphRemoved }>(
  resp: GraphDeltaResponse<T>,
): { present: T[]; removedIds: string[] } {
  const present: T[] = [];
  const removedIds: string[] = [];
  for (const item of resp.value ?? []) {
    if (isGraphRemoved(item)) removedIds.push(item.id);
    else present.push(item);
  }
  return { present, removedIds };
}

/* ── field extractors (Graph object → flat Unified metadata; primitives only) ───────── */

export interface EntraUserFields {
  title: string;
  email: string | null;
  upn: string | null;
  enabled: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

export function graphUserFields(u: GraphUser): EntraUserFields {
  const title = u.displayName || u.userPrincipalName || u.mail || u.id;
  const enabled = u.accountEnabled !== false;
  return {
    title,
    email: u.mail ?? null,
    upn: u.userPrincipalName ?? null,
    enabled,
    metadata: {
      directoryType: 'user',
      userPrincipalName: u.userPrincipalName ?? null,
      mail: u.mail ?? null,
      jobTitle: u.jobTitle ?? null,
      department: u.department ?? null,
      officeLocation: u.officeLocation ?? null,
      accountEnabled: enabled,
      userType: (u.userType ?? 'Member').toLowerCase(),
    },
  };
}

export interface EntraGroupFields {
  title: string;
  metadata: Record<string, string | number | boolean | null>;
}

export function graphGroupFields(g: GraphGroup): EntraGroupFields {
  const title = g.displayName || g.mailNickname || g.id;
  const isM365 = (g.groupTypes ?? []).some((t) => t.toLowerCase() === 'unified');
  return {
    title,
    metadata: {
      directoryType: 'group',
      mail: g.mail ?? null,
      mailNickname: g.mailNickname ?? null,
      mailEnabled: g.mailEnabled ?? null,
      securityEnabled: g.securityEnabled ?? null,
      visibility: g.visibility ?? null,
      groupTypes: (g.groupTypes ?? []).join(',') || null,
      groupClass: isM365 ? 'microsoft365' : g.securityEnabled ? 'security' : 'distribution',
    },
  };
}

export interface EntraTenant {
  tenantId: string;
  name: string;
  defaultDomain: string | null;
  verifiedDomainCount: number;
}

export function tenantFromOrganization(org: GraphOrganization): EntraTenant {
  const domains = org.verifiedDomains ?? [];
  const def = domains.find((d) => d.isDefault) ?? domains.find((d) => d.isInitial) ?? domains[0];
  return {
    tenantId: org.id,
    name: org.displayName || def?.name || org.id,
    defaultDomain: def?.name ?? null,
    verifiedDomainCount: domains.length,
  };
}

/* ── P2.1 Enterprise Integration Profile for Entra ─────────────────────────────────── */

/**
 * The Entra connector's enterprise profile, consumed by the P2.1 foundation (validated by
 * `validateIntegrationProfile`). It declares the real Graph capabilities: OAuth2 confidential auth, the
 * directory scopes, delta/incremental/full sync, the users/groups/organization objects (mapped into the
 * UDM), and the health checks the connector supports.
 */
export const ENTRA_INTEGRATION_PROFILE: EnterpriseIntegrationProfile = {
  connectorId: 'microsoft-entra',
  version: '1.0.0',
  authKinds: ['oauth2_confidential'],
  scopes: [...ENTRA_GRAPH_SCOPES],
  syncModes: ['full', 'incremental', 'delta', 'scheduled', 'manual'],
  // Microsoft Graph throttling is per-resource + adaptive (429 + Retry-After honored by the HttpClient);
  // this documents a conservative steady-state envelope for the dashboard's planner.
  rateLimit: { requestsPerInterval: 10_000, intervalMs: 600_000 },
  webhook: { supported: false, events: [] },
  healthChecks: [
    { id: 'connectivity', label: 'Microsoft Graph connectivity', kind: 'connectivity' },
    { id: 'auth', label: 'Access token valid', kind: 'auth' },
    { id: 'permissions', label: 'Directory read permissions', kind: 'auth' },
    { id: 'freshness', label: 'Directory sync freshness', kind: 'data_freshness' },
  ],
  supportedObjects: [
    { id: 'users', label: 'Users', kind: 'contact', syncModes: ['full', 'incremental', 'delta'] },
    { id: 'groups', label: 'Groups', kind: 'organization', syncModes: ['full', 'incremental', 'delta'] },
    { id: 'organization', label: 'Organization', kind: 'organization', syncModes: ['full'] },
  ],
  docsUrl: 'https://learn.microsoft.com/graph/api/overview',
  iconId: 'microsoft-entra',
};
