/**
 * Microsoft 365 / Microsoft Graph — shared, pure logic (Phase P2.3).
 *
 * Read/sync layer for the M365 productivity data (Outlook mail, Calendar, OneDrive, Contacts, Teams),
 * built on the SAME authenticated Graph token as the Entra directory connector (no second OAuth). This is
 * the connector-agnostic, deterministic core: the real Graph v1.0 response SHAPES, the pure field
 * extractors that flatten each object into Unified metadata (primitives only), the OneDrive delta split
 * (which uses a `deleted` facet rather than `@removed`), and the least-privilege READ scopes. The generic
 * `@odata.nextLink`/`@odata.deltaLink` cursor helpers are reused from `entraGraph`. No I/O, no fabricated
 * data — these are types + pure functions over what the live Graph endpoints return.
 */
import type { GraphDeltaResponse } from './entraGraph';
import { GRAPH_BASE_URL } from './entraGraph';

/* ── least-privilege READ scopes (only what the read/sync resources actually use) ─────── */

export const M365_READ_SCOPES: readonly string[] = [
  'Mail.Read',
  'Calendars.Read',
  'Files.Read',
  'Contacts.Read',
  'Team.ReadBasic.All',
];

/**
 * The Microsoft 365 module (adapter resource) ids, in display order. These ride on the
 * `microsoft-entra` connector as additional resources; the UI uses this list to pick the
 * M365 modules out of the connector's per-resource sync stats.
 */
export const M365_MODULE_IDS = ['mail', 'calendar', 'drive', 'contacts', 'teams'] as const;
export type M365ModuleId = (typeof M365_MODULE_IDS)[number];

/* ── endpoint paths + $select field lists ─────────────────────────────────────────────── */

export const MAIL_DELTA_URL =
  `${GRAPH_BASE_URL}/me/mailFolders/inbox/messages/delta` +
  `?$select=id,subject,bodyPreview,from,receivedDateTime,sentDateTime,isRead,hasAttachments,importance,conversationId,webLink`;

export const DRIVE_DELTA_URL = `${GRAPH_BASE_URL}/me/drive/root/delta`;

export const CONTACTS_DELTA_URL =
  `${GRAPH_BASE_URL}/me/contacts/delta` +
  `?$select=id,displayName,emailAddresses,mobilePhone,companyName,jobTitle,department`;

export const JOINED_TEAMS_URL = `${GRAPH_BASE_URL}/me/joinedTeams`;

/** The calendarView delta base needs an explicit date window (supplied by the adapter at call time). */
export const CALENDAR_VIEW_DELTA_PATH = `${GRAPH_BASE_URL}/me/calendarView/delta`;

/* ── Graph response shapes (real v1.0) ────────────────────────────────────────────────── */

export interface GraphEmailAddress {
  name?: string | null;
  address?: string | null;
}

export interface GraphMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  from?: { emailAddress?: GraphEmailAddress } | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isRead?: boolean | null;
  hasAttachments?: boolean | null;
  importance?: string | null;
  conversationId?: string | null;
  webLink?: string | null;
  '@removed'?: { reason?: string };
}

export interface GraphEvent {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  location?: { displayName?: string | null } | null;
  organizer?: { emailAddress?: GraphEmailAddress } | null;
  attendees?: unknown[] | null;
  isAllDay?: boolean | null;
  isCancelled?: boolean | null;
  seriesMasterId?: string | null;
  webLink?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  '@removed'?: { reason?: string };
}

export interface GraphDriveItem {
  id: string;
  name?: string | null;
  size?: number | null;
  webUrl?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  folder?: { childCount?: number | null } | null;
  file?: { mimeType?: string | null } | null;
  parentReference?: { path?: string | null; id?: string | null } | null;
  /** OneDrive marks deletions with a `deleted` facet (not `@removed`). */
  deleted?: { state?: string | null } | null;
}

export interface GraphContact {
  id: string;
  displayName?: string | null;
  emailAddresses?: GraphEmailAddress[] | null;
  mobilePhone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  '@removed'?: { reason?: string };
}

export interface GraphTeam {
  id: string;
  displayName?: string | null;
  description?: string | null;
  visibility?: string | null;
}

/* ── field extractors (Graph object → flat primitive metadata + display fields) ─────────── */

type Meta = Record<string, string | number | boolean | null>;

export interface MessageFields {
  title: string;
  author: string | null;
  preview: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  url: string | null;
  metadata: Meta;
}

export function messageFields(m: GraphMessage): MessageFields {
  const from = m.from?.emailAddress ?? null;
  return {
    title: m.subject || '(no subject)',
    author: from?.address ?? from?.name ?? null,
    preview: m.bodyPreview ?? null,
    receivedAt: m.receivedDateTime ?? null,
    sentAt: m.sentDateTime ?? null,
    url: m.webLink ?? null,
    metadata: {
      module: 'outlook',
      fromAddress: from?.address ?? null,
      fromName: from?.name ?? null,
      isRead: m.isRead ?? null,
      hasAttachments: m.hasAttachments ?? false,
      importance: m.importance ?? null,
      conversationId: m.conversationId ?? null,
      folder: 'inbox',
    },
  };
}

export interface EventFields {
  title: string;
  author: string | null;
  preview: string | null;
  start: string | null;
  end: string | null;
  url: string | null;
  status: string | null;
  metadata: Meta;
}

export function eventFields(e: GraphEvent): EventFields {
  const org = e.organizer?.emailAddress ?? null;
  return {
    title: e.subject || '(no title)',
    author: org?.address ?? org?.name ?? null,
    preview: e.bodyPreview ?? null,
    start: e.start?.dateTime ?? null,
    end: e.end?.dateTime ?? null,
    url: e.webLink ?? null,
    status: e.isCancelled ? 'cancelled' : null,
    metadata: {
      module: 'calendar',
      location: e.location?.displayName ?? null,
      attendees: Array.isArray(e.attendees) ? e.attendees.length : 0,
      isAllDay: e.isAllDay ?? false,
      isRecurring: e.seriesMasterId != null,
      organizerAddress: org?.address ?? null,
    },
  };
}

export interface DriveItemFields {
  title: string;
  url: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  metadata: Meta;
}

export function driveItemFields(d: GraphDriveItem): DriveItemFields {
  const isFolder = d.folder != null;
  return {
    title: d.name || '(unnamed)',
    url: d.webUrl ?? null,
    createdAt: d.createdDateTime ?? null,
    modifiedAt: d.lastModifiedDateTime ?? null,
    metadata: {
      module: 'onedrive',
      isFolder,
      itemType: isFolder ? 'folder' : 'file',
      sizeBytes: d.size ?? null,
      mimeType: d.file?.mimeType ?? null,
      childCount: d.folder?.childCount ?? null,
      path: d.parentReference?.path ?? null,
    },
  };
}

export interface ContactFields {
  title: string;
  author: string | null;
  metadata: Meta;
}

export function contactFields(c: GraphContact): ContactFields {
  const email = c.emailAddresses?.[0] ?? null;
  return {
    title: c.displayName || email?.address || '(no name)',
    author: email?.address ?? null,
    metadata: {
      module: 'contacts',
      source: 'personal',
      email: email?.address ?? null,
      mobilePhone: c.mobilePhone ?? null,
      companyName: c.companyName ?? null,
      jobTitle: c.jobTitle ?? null,
      department: c.department ?? null,
    },
  };
}

export interface TeamFields {
  title: string;
  metadata: Meta;
}

export function teamFields(t: GraphTeam): TeamFields {
  return {
    title: t.displayName || t.id,
    metadata: {
      module: 'teams',
      visibility: t.visibility ?? null,
      description: t.description ?? null,
    },
  };
}

/** OneDrive delta split: partition present items vs. those carrying the `deleted` facet. Deterministic. */
export function splitDriveDelta(resp: GraphDeltaResponse<GraphDriveItem>): {
  present: GraphDriveItem[];
  removedIds: string[];
} {
  const present: GraphDriveItem[] = [];
  const removedIds: string[] = [];
  for (const item of resp.value ?? []) {
    if (item.deleted) removedIds.push(item.id);
    else present.push(item);
  }
  return { present, removedIds };
}
