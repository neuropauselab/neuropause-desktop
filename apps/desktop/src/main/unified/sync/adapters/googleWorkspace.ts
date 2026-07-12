/**
 * The Google Workspace connector family (P5 — Increment 3).
 *
 * ONE connector (`google-workspace`) — one PKCE OAuth, one refresh token, one vault record, one card,
 * one health engine, one inspector — with each Google service mounted as an `AdapterResource` on the
 * SAME authenticated session. This mirrors, exactly, how `microsoft-entra` hosts `m365Resources`. Each
 * service keeps its OWN production sync model (Gmail History API, Drive Changes API, Calendar & People
 * sync tokens, Tasks `updatedMin`); only authentication, runtime, health, diagnostics, and configuration
 * are shared — synchronization is never merged.
 *
 * Every service resource is wrapped in the shared `graceful()` guard, so a service the user didn't grant
 * (or whose API is disabled / not provisioned) degrades to a tagged empty page instead of failing the
 * whole family — the per-service capability / graceful-degradation mechanism. Docs/Sheets/Slides are
 * Google Drive files (google-apps mimeTypes) and surface through the Drive resource; they need no
 * separate sync resource.
 */
import type { AdapterResource, ConnectorAdapter } from '../adapterSdk';
import { graceful } from './delta';
import { gmailResources } from './gmail';
import { googleCalendarResources } from './googleCalendar';
import { googleDriveResources } from './googleDrive';
import { googlePeopleResources } from './googlePeople';
import { googleTasksResources } from './googleTasks';

const GOOGLE_REASONS = {
  unauthorized: 'Service not authorized — this Google scope was not granted, or its API is disabled (403)',
  unprovisioned: 'Service not provisioned for this Google account (404)',
} as const;

/** Wrap a service resource so one unavailable service degrades instead of failing the whole family. */
function serviceResource(r: AdapterResource): AdapterResource {
  return { ...r, pull: graceful(r.pull, GOOGLE_REASONS) };
}

export const googleWorkspaceAdapter: ConnectorAdapter = {
  connectorId: 'google-workspace',
  resources: [
    ...gmailResources,
    ...googleCalendarResources,
    ...googleDriveResources,
    ...googlePeopleResources,
    ...googleTasksResources,
  ].map(serviceResource),
};

/* ── Runtime capability discovery ─────────────────────────────────────────────────────────── */

/** A Google Workspace service and the OAuth scope that unlocks it. */
export interface GoogleService {
  id: string;
  label: string;
  /** The Google OAuth scope granting this service. */
  scope: string;
  /** How this service syncs (informational). */
  sync: string;
}

/**
 * The service catalog — the runtime source of truth for capability discovery. It is consumed by the
 * Enterprise Connector Center (Slice B) so the UI hardcodes no service list. Docs/Sheets/Slides are
 * surfaced through Drive, so they map to the Drive scope.
 */
export const GOOGLE_WORKSPACE_SERVICES: GoogleService[] = [
  { id: 'gmail', label: 'Gmail', scope: 'https://www.googleapis.com/auth/gmail.readonly', sync: 'History API' },
  { id: 'calendar', label: 'Calendar', scope: 'https://www.googleapis.com/auth/calendar.readonly', sync: 'Sync token' },
  { id: 'drive', label: 'Drive', scope: 'https://www.googleapis.com/auth/drive.readonly', sync: 'Changes API' },
  { id: 'docs', label: 'Docs', scope: 'https://www.googleapis.com/auth/drive.readonly', sync: 'Metadata (via Drive)' },
  { id: 'sheets', label: 'Sheets', scope: 'https://www.googleapis.com/auth/drive.readonly', sync: 'Metadata (via Drive)' },
  { id: 'slides', label: 'Slides', scope: 'https://www.googleapis.com/auth/drive.readonly', sync: 'Metadata (via Drive)' },
  { id: 'people', label: 'Contacts', scope: 'https://www.googleapis.com/auth/contacts.readonly', sync: 'Sync token' },
  { id: 'tasks', label: 'Tasks', scope: 'https://www.googleapis.com/auth/tasks.readonly', sync: 'updatedMin' },
];

/** A service plus whether the connected account actually granted its scope. */
export interface GoogleServiceStatus extends GoogleService {
  available: boolean;
}

/**
 * Runtime capability discovery: which services are available given the scopes Google actually granted
 * (`ConnectedAccount.grantedScopes`). Pure — the Enterprise Connector Center (Slice B) renders exactly
 * this (✓/✗); nothing is hardcoded. Reuses the same `grantedScopes` the M365 write executor already gates on.
 */
export function googleServiceAvailability(grantedScopes: readonly string[]): GoogleServiceStatus[] {
  const granted = new Set(grantedScopes);
  return GOOGLE_WORKSPACE_SERVICES.map((s) => ({ ...s, available: granted.has(s.scope) }));
}
