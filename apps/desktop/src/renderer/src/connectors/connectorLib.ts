/**
 * Presentation helpers for the Connectors surface: status/health/sync → tone+label
 * maps and small label dictionaries. Pure and dependency-light so the page, the
 * cards, and the detail pane stay visually consistent.
 */
import type {
  ConnectorAuthType,
  ConnectorCapability,
  ConnectorCategory,
  ConnectorHealth,
  ConnectorStatus,
  SyncState,
} from '@neuropause/shared';
import type { OpsTone } from '@renderer/operations/lib';

interface Meta {
  label: string;
  tone: OpsTone;
}

export function statusMeta(s: ConnectorStatus): Meta {
  switch (s) {
    case 'connected':
      return { label: 'Connected', tone: 'green' };
    case 'connecting':
      return { label: 'Connecting…', tone: 'blue' };
    case 'disconnected':
      return { label: 'Not connected', tone: 'gray' };
    case 'reauth_required':
      return { label: 'Reconnect needed', tone: 'orange' };
    case 'error':
      return { label: 'Error', tone: 'red' };
    case 'unavailable':
      return { label: 'Setup required', tone: 'gray' };
  }
}

export function healthMeta(h: ConnectorHealth): Meta {
  switch (h) {
    case 'healthy':
      return { label: 'Healthy', tone: 'green' };
    case 'degraded':
      return { label: 'Degraded', tone: 'orange' };
    case 'down':
      return { label: 'Down', tone: 'red' };
    case 'unknown':
      return { label: 'Unknown', tone: 'gray' };
  }
}

export function syncMeta(s: SyncState): Meta {
  switch (s) {
    case 'idle':
      return { label: 'Idle', tone: 'gray' };
    case 'syncing':
      return { label: 'Syncing…', tone: 'blue' };
    case 'success':
      return { label: 'Synced', tone: 'green' };
    case 'error':
      return { label: 'Sync failed', tone: 'red' };
    case 'never':
      return { label: 'Never synced', tone: 'gray' };
  }
}

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  ai_assistant: 'AI Assistants',
  developer: 'Developer',
  productivity: 'Productivity',
  design: 'Design',
  communication: 'Communication',
  storage: 'Storage',
  calendar: 'Calendar',
  automation: 'Automation',
  project_management: 'Project Management',
};

export const AUTH_LABEL: Record<ConnectorAuthType, string> = {
  oauth2_pkce: 'OAuth 2.0 · PKCE',
  oauth2_confidential: 'OAuth 2.0',
  api_key: 'API key',
};

export const CAPABILITY_LABEL: Record<ConnectorCapability, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  files: 'Files',
  documents: 'Documents',
  conversations: 'Conversations',
  messages: 'Messages',
  notifications: 'Notifications',
  events: 'Events',
  activities: 'Activity',
  calendar: 'Calendar',
  repositories: 'Repositories',
  issues: 'Issues',
  contacts: 'Contacts',
};

/** Two-letter glyph for a connector's brand chip. */
export function connectorGlyph(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '');
  return (cleaned.slice(0, 2) || '?').toUpperCase();
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Date.now() - then;
  if (diff < 45_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
