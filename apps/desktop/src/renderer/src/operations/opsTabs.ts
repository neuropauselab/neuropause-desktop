/**
 * Runtime (Operations) tab catalog — the single source of truth for the section's
 * sub-tabs, extracted from the view so it is pure and testable (no React, no DOM).
 *
 * Phase 2 (P3 · diagnostics): tabs marked `devOnly` are developer/internal surfaces —
 * the internal-persona AI tools ("Founder AI", "Engineering AI") and the raw event
 * inspector. They are hidden from packaged pilot builds and shown only in development,
 * so an ordinary pilot user never meets an internal-persona label, while developers
 * keep full access. The panels are retained and still routable — gated, not deleted.
 */
import type { IconName } from '@renderer/components/ui/Icon';

export type OpsTab =
  | 'overview'
  | 'installed'
  | 'sessions'
  | 'plugins'
  | 'downloads'
  | 'updates'
  | 'permissions'
  | 'logs'
  | 'health'
  | 'collections'
  | 'knowledge'
  | 'intelligence'
  | 'founder'
  | 'memory'
  | 'engineering'
  | 'traces'
  | 'sync'
  | 'diagnostics'
  | 'release'
  | 'recovery'
  | 'inspector';

export interface OpsTabDef {
  id: OpsTab;
  label: string;
  icon: IconName;
  ready: boolean;
  /**
   * Developer / internal-only surface — hidden from packaged pilot builds and shown
   * only in development. Retained and routable (a deep-link or saved tab still
   * resolves); it is simply not surfaced in the tab strip for ordinary users.
   */
  devOnly?: boolean;
}

/** Every Runtime tab, in display order. `visibleOpsTabs` filters this for the build. */
export const ALL_OPS_TABS: OpsTabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge', ready: true },
  { id: 'installed', label: 'Installed', icon: 'package', ready: true },
  { id: 'sessions', label: 'Sessions', icon: 'pulse', ready: true },
  { id: 'plugins', label: 'Plugins', icon: 'puzzle', ready: true },
  { id: 'downloads', label: 'Downloads', icon: 'download', ready: true },
  { id: 'updates', label: 'Updates', icon: 'refresh', ready: true },
  { id: 'permissions', label: 'Permissions', icon: 'shield', ready: true },
  { id: 'logs', label: 'Activity', icon: 'list', ready: true },
  { id: 'health', label: 'Health', icon: 'activity', ready: true },
  { id: 'collections', label: 'Collections', icon: 'grid', ready: true },
  { id: 'knowledge', label: 'Knowledge', icon: 'database', ready: true },
  { id: 'intelligence', label: 'Intelligence', icon: 'sparkles', ready: true },
  { id: 'founder', label: 'Founder AI', icon: 'bolt', ready: true, devOnly: true },
  { id: 'memory', label: 'Memory', icon: 'memory', ready: true },
  { id: 'engineering', label: 'Engineering AI', icon: 'cpu', ready: true, devOnly: true },
  { id: 'traces', label: 'Traces', icon: 'layers', ready: true },
  { id: 'sync', label: 'Sync Health', icon: 'pulse', ready: true },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'beaker', ready: true },
  { id: 'release', label: 'Release', icon: 'verified', ready: true },
  { id: 'recovery', label: 'Recovery', icon: 'undo', ready: true },
  { id: 'inspector', label: 'Inspector', icon: 'code', ready: true, devOnly: true },
];

/**
 * The tabs surfaced in this build. In a packaged pilot build (`isDev === false`) the
 * developer/internal-only tabs are omitted; in development every tab is shown.
 */
export function visibleOpsTabs(isDev: boolean): OpsTabDef[] {
  return ALL_OPS_TABS.filter((t) => !t.devOnly || isDev);
}
