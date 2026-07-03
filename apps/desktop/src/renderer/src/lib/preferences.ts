/**
 * Durable UI preferences (sidebar, workspace layout, UI scale). Backed by the
 * renderer's storage so choices survive relaunches. The access is wrapped in a
 * typed, fail-safe interface so a corrupt or unavailable store never throws
 * into React — it just falls back to defaults.
 */
import { createLogger } from './logger';

const log = createLogger('prefs');
const NS = 'np.';

function backend(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const prefs = {
  read<T>(key: string, fallback: T): T {
    const store = backend();
    if (!store) return fallback;
    try {
      const raw = store.getItem(NS + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch (err) {
      log.warn(`Could not read pref "${key}"`, err);
      return fallback;
    }
  },
  write<T>(key: string, value: T): void {
    const store = backend();
    if (!store) return;
    try {
      store.setItem(NS + key, JSON.stringify(value));
    } catch (err) {
      log.warn(`Could not write pref "${key}"`, err);
    }
  },
  remove(key: string): void {
    backend()?.removeItem(NS + key);
  },
};

/** Centralized pref keys, so there are no stringly-typed typos at call sites. */
export const PrefKey = {
  sidebarCollapsed: 'sidebarCollapsed',
  sidebarWidth: 'sidebarWidth',
  activeSection: 'activeSection',
  workspaceTabs: 'workspaceTabs',
  activeTabId: 'activeTabId',
  uiScale: 'uiScale',
  collections: 'collections',
  downloadHistory: 'downloadHistory',
  updateChannel: 'updateChannel',
  ignoredVersions: 'ignoredVersions',
  autoUpdate: 'autoUpdate',
  recentCommands: 'recentCommands',
} as const;
