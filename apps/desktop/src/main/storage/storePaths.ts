/**
 * Store-path registry (Phase 8 · RC hardening 8.2) — the ONE place that knows
 * which files under the data directory (Electron userData) belong to which
 * protected maintenance domain. The backup manager, the pre-migration
 * snapshot, and restore all consume THIS map, so a store added here is
 * automatically covered by every data-safety mechanism at once.
 *
 * Why this exists: before Phase 8 the backup manager carried a hand-written
 * 17-entry list while the app had grown to 100+ enterprise-module stores —
 * the General Ledger, every ERP record, assistant conversations and
 * automations were outside backup AND outside failed-migration rollback.
 * A literal list drifts; this registry closes the class of bug:
 *
 *  • Entries ending in `*` are PREFIX patterns resolved against the live
 *    data directory at snapshot time — `enterprise-module-*` covers every
 *    certified module store that exists now or is ever registered, with no
 *    per-module bookkeeping.
 *  • Every filename below is verified against the instance wiring that
 *    creates it (grep the name — each has exactly one production creator).
 *
 * Deliberately NOT backed up: `data-version.json` and `migration-audit.json`
 * (owned by the migration engine, which manages its own version revert on
 * rollback — restoring an older data-version file over a migrated store set
 * would lie to the engine), and the backend database (server-side).
 */
import type { MaintenanceDomain } from '@neuropause/shared';

/** Files/directories per protected domain, relative to the data directory. */
export const DOMAIN_FILES: Record<MaintenanceDomain, string[]> = {
  database: [],
  registry: ['registry.json'],
  configuration: [
    'telemetry.json',
    'crash-reporting.json',
    'update-prefs.json',
    'update-history.json',
    'window-state.json',
    'connectors.json',
    'onboarding.json',
    'feature-flags.json',
    'pilot.json',
    'license-status.json',
  ],
  workspace: ['enterprise-workspaces.json', 'enterprise-org.json'],
  knowledgeGraph: ['graph.json', 'unified-store.json'],
  aiWorker: ['workforce-registry.json', 'workforce-jobs.json', 'workforce-audit.json'],
  plugin: ['plugins.json', 'plugins', 'plugin-data'],
  aiMemory: ['memory.json'],
  timeline: ['timeline'],
  // The user's business records — every enterprise-module store, by prefix.
  business: [
    'enterprise-module-*',
    'executive-decisions.json',
    'enterprise-governance.json',
    'automations.json',
    'health-history.json',
  ],
  assistant: ['assistant-conversations.json', 'feedback.json'],
};

const ALL_DOMAINS = Object.keys(DOMAIN_FILES) as MaintenanceDomain[];

/** Domains that have at least one local file (everything except `database`). */
export const LOCAL_DOMAINS = ALL_DOMAINS.filter((d) => DOMAIN_FILES[d].length > 0);

/** True when a registry entry is a prefix pattern (trailing `*`). */
export const isPrefixEntry = (rel: string): boolean => rel.endsWith('*');
