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
    // Mobile M1-03 — paired companion devices + gateway on/off (envelope-backed).
    'companion-devices.json',
    // P13C Round 17 (D-5) — the per-organization AI preference. Customer state,
    // so it must be inside backup and inside pre-migration rollback like the rest.
    'tenant-ai-preference.json',
    // S17/FG-6 — the device-local principal. Its id must be stable across
    // restarts (owner claim + governed-actor correlation); backing it up lets a
    // restore recover the id rather than mint a fresh one.
    'local-principal.json',
    // P13C GATE 11 — the two SECRET vaults were outside backup: a corruption or
    // an accidental delete lost every credential with no restore path, and (with
    // the quarantine fix) a quarantined vault had no good copy to recover from.
    // Both hold ONLY safeStorage (OS-keychain) ciphertext — a backup copy is
    // undecryptable on any other machine, so including them adds same-machine
    // restore durability without widening the secret's blast radius. `vault.bin`
    // is the app refresh token + provider secrets; `connector-vault.bin` is the
    // per-workspace connector tokens.
    'vault.bin',
    'connector-vault.bin',
    // P13C Gate 11 (round 43) — customer-facing configuration/state stores that
    // were persisted but outside backup AND outside pre-migration rollback. Each
    // has exactly one production creator (verified). A file that does not exist
    // on a given install is simply skipped by `filesForPath`, so listing them is
    // purely additive.
    'experience-profile.json', // onboarding profile (resume + AI-mode choice)
    'ai-config.json', // provider/model configuration
    'ai-routing-usage.json', // per-location usage counters
    'identity.json', // device identity evidence
    'workspace-contexts.json', // per-user "views on this device"
    'webhooks.json', // configured inbound webhooks
    'delivery-preferences.json', // executive-summary delivery prefs
    'sync-state.json', // unified sync cursors/state
  ],
  workspace: ['enterprise-workspaces.json', 'enterprise-org.json'],
  knowledgeGraph: ['graph.json', 'unified-store.json'],
  aiWorker: ['workforce-registry.json', 'workforce-jobs.json', 'workforce-audit.json'],
  plugin: ['plugins.json', 'plugins', 'plugin-data'],
  aiMemory: ['memory.json', 'memory-audit.json'],
  timeline: ['timeline'],
  // The user's business records — every enterprise-module store, by prefix.
  business: [
    'enterprise-module-*',
    'executive-decisions.json',
    'enterprise-governance.json',
    'automations.json',
    'health-history.json',
    // P13C Gate 11 (round 43) — customer records, governed-action evidence and
    // audit trails that were persisted but outside backup + pre-migration
    // rollback. Losing any of these silently loses tenant data or the trail that
    // proves what happened to it.
    'decision-records.json', // governed decision records
    'holds.json', // governance holds awaiting resolution
    'opportunity-decisions.json',
    'outcome-revisions.json',
    'erp-document-lines.json', // ERP document line items
    'erp-approvals.json', // ERP approval trail
    'medical-device-traceability.json', // regulated traceability records
    'data-plane-provenance.json', // import provenance (the audit trail itself)
    'data-plane-mappings.json', // remembered column→field mappings
    'data-plane-relationships.json', // resolved cross-record relationships
    'notification-inbox.json',
    'action-records.json', // connector action evidence store
    'm365-governed-actions.json', // governed M365 action ledger
    'connector-controls.json',
    'enterprise-personalization.json',
    'platform-operators.json',
    'marketplace-policy.json',
    'documents.json', // document metadata
    'documents', // document blobs (directory)
    'sandbox', // sandbox workspaces/scenarios/executions/artifacts/datasets/validation/lab (directory)
  ],
  assistant: ['assistant-conversations.json', 'feedback.json'],
};

const ALL_DOMAINS = Object.keys(DOMAIN_FILES) as MaintenanceDomain[];

/** Domains that have at least one local file (everything except `database`). */
export const LOCAL_DOMAINS = ALL_DOMAINS.filter((d) => DOMAIN_FILES[d].length > 0);

/** True when a registry entry is a prefix pattern (trailing `*`). */
export const isPrefixEntry = (rel: string): boolean => rel.endsWith('*');
