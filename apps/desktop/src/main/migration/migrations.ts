/**
 * Registered data migrations and the current target data version.
 *
 * This is the first versioned release, so the only migration is the baseline
 * that stamps version 1 — but the engine that runs these is production-grade
 * (ordered execution, pre-migration backup, restore-on-failure, audit log).
 * Future cross-version migrations are added here as new MigrationDefinition
 * entries with an increasing `toVersion`; the engine picks up and orders them
 * automatically. Per-store schema versions (e.g. the registry's own
 * SCHEMA_VERSION) continue to own their internal upgrades; these app-level
 * migrations coordinate cross-cutting changes across domains.
 */
import type { MigrationDefinition } from './migrationEngine';

/** The data version a fresh install / successful migration run settles on. */
export const CURRENT_DATA_VERSION = 1;

export const MIGRATIONS: MigrationDefinition[] = [
  {
    id: '0001-baseline',
    domain: 'configuration',
    toVersion: 1,
    up: (ctx) => {
      // Baseline: establishes the versioned-data contract. Stores already persist
      // their own files; this records that the install is at data version 1 so
      // subsequent releases can migrate forward from a known floor.
      ctx.log('Applied baseline data migration (v1)');
    },
  },
];
