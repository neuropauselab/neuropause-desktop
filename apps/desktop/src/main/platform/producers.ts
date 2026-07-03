/**
 * Producers translate domain signals into Platform Events. They are pure
 * functions (and a builder namespace) so they can be unit-tested without the
 * services that feed them; the actual `.on(...)` wiring lives in the platform
 * composition root, which calls these and publishes the result.
 */
import type {
  AuthStatus,
  NpsProgressEvent,
  PlatformEventInput,
  PluginHostEvent,
  RuntimeEvent,
} from '@neuropause/shared';

const appResource = (slug: string, name: string | null = null) => ({ type: 'app', id: slug, name });

/** Runtime lifecycle/health/crash → platform event (or null to ignore). */
export function runtimeEventToPlatform(e: RuntimeEvent): PlatformEventInput | null {
  const base = {
    category: 'runtime' as const,
    source: 'runtime',
    resource: appResource(e.appSlug),
    metadata: { status: e.status, health: e.health, message: e.message },
  };
  if (e.type === 'crash') return { ...base, type: 'runtime.crashed', priority: 'high' };
  if (e.type === 'health') return { ...base, type: 'runtime.health_changed' };
  if (e.type === 'lifecycle' && e.status === 'running') return { ...base, type: 'runtime.started' };
  if (e.type === 'lifecycle' && (e.status === 'stopped' || e.status === 'failed')) return { ...base, type: 'runtime.stopped' };
  return null;
}

/** Package progress → download.started / .progress / .completed / .failed. */
export function downloadEventToPlatform(e: NpsProgressEvent, seen: Set<string>): PlatformEventInput | null {
  const base = {
    category: 'download' as const,
    source: 'nps',
    resource: appResource(e.appSlug),
    metadata: {
      status: e.status,
      progress: e.progress,
      bytesDownloaded: e.bytesDownloaded,
      bytesTotal: e.bytesTotal,
      message: e.message,
    },
  };
  if (e.status === 'completed') {
    seen.delete(e.id);
    return { ...base, type: 'download.completed' };
  }
  if (e.status === 'failed' || e.status === 'cancelled') {
    seen.delete(e.id);
    return { ...base, type: 'download.failed', priority: 'high' };
  }
  if (!seen.has(e.id)) {
    seen.add(e.id);
    return { ...base, type: 'download.started' };
  }
  return { ...base, type: 'download.progress', priority: 'low' };
}

/** Plugin host runtime events → platform (only crashes are surfaced here;
 * enable/disable/install/remove come from the discrete builders below). */
export function pluginEventToPlatform(e: PluginHostEvent): PlatformEventInput | null {
  if (e.type === 'crash') {
    return {
      type: 'plugin.crashed',
      category: 'plugin',
      source: 'plugins',
      priority: 'high',
      resource: { type: 'plugin', id: e.pluginId, name: null },
      metadata: { status: e.status, health: e.health, message: e.message },
    };
  }
  return null;
}

/** Auth status transition → user.signed_in / signed_out. */
export function authStatusToPlatform(status: AuthStatus, wasAuthenticated: boolean): PlatformEventInput | null {
  const authed = status.state === 'authenticated';
  if (authed && !wasAuthenticated) {
    return { type: 'user.signed_in', category: 'session', source: 'auth', actor: { kind: 'user', id: null }, metadata: { state: status.state } };
  }
  if (!authed && wasAuthenticated) {
    return { type: 'user.signed_out', category: 'session', source: 'auth', actor: { kind: 'user', id: null }, metadata: { state: status.state } };
  }
  return null;
}

/** Discrete events published from IPC handlers / UI on success. */
export const build = {
  appInstalled: (slug: string, name: string | null, version: string | null): PlatformEventInput => ({
    type: 'application.installed', category: 'application', source: 'nps', actor: { kind: 'user', id: null }, resource: appResource(slug, name), metadata: { version },
  }),
  appUpdated: (slug: string, name: string | null, version: string | null): PlatformEventInput => ({
    type: 'application.updated', category: 'application', source: 'nps', actor: { kind: 'user', id: null }, resource: appResource(slug, name), metadata: { version },
  }),
  appRemoved: (slug: string, name: string | null): PlatformEventInput => ({
    type: 'application.removed', category: 'application', source: 'nps', actor: { kind: 'user', id: null }, resource: appResource(slug, name), metadata: {},
  }),
  permissionGranted: (slug: string, permission: string): PlatformEventInput => ({
    type: 'permission.granted', category: 'permission', source: 'permissions', actor: { kind: 'user', id: null }, resource: appResource(slug), priority: 'high', metadata: { permission },
  }),
  permissionRevoked: (slug: string, permission: string): PlatformEventInput => ({
    type: 'permission.revoked', category: 'permission', source: 'permissions', actor: { kind: 'user', id: null }, resource: appResource(slug), metadata: { permission },
  }),
  pluginInstalled: (id: string, name: string | null): PlatformEventInput => ({
    type: 'plugin.installed', category: 'plugin', source: 'plugins', actor: { kind: 'user', id: null }, resource: { type: 'plugin', id, name }, metadata: {},
  }),
  pluginEnabled: (id: string, name: string | null): PlatformEventInput => ({
    type: 'plugin.enabled', category: 'plugin', source: 'plugins', actor: { kind: 'user', id: null }, resource: { type: 'plugin', id, name }, metadata: {},
  }),
  pluginDisabled: (id: string, name: string | null): PlatformEventInput => ({
    type: 'plugin.disabled', category: 'plugin', source: 'plugins', actor: { kind: 'user', id: null }, resource: { type: 'plugin', id, name }, metadata: {},
  }),
  pluginRemoved: (id: string, name: string | null): PlatformEventInput => ({
    type: 'plugin.removed', category: 'plugin', source: 'plugins', actor: { kind: 'user', id: null }, resource: { type: 'plugin', id, name }, metadata: {},
  }),
  updateAvailable: (slug: string, latestVersion: string | null): PlatformEventInput => ({
    type: 'update.available', category: 'update', source: 'updates', resource: appResource(slug), metadata: { latestVersion },
  }),
  workspaceOpened: (id: string, name: string | null): PlatformEventInput => ({
    type: 'workspace.opened', category: 'session', source: 'workspace', actor: { kind: 'user', id: null }, resource: { type: 'workspace', id, name }, metadata: {},
  }),
  workspaceClosed: (id: string, name: string | null): PlatformEventInput => ({
    type: 'workspace.closed', category: 'session', source: 'workspace', actor: { kind: 'user', id: null }, resource: { type: 'workspace', id, name }, metadata: {},
  }),
};
