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
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MigrationDefinition } from './migrationEngine';
import { STORE_SCHEMA_VERSION } from '../storage/storeEnvelope';

/** The data version a fresh install / successful migration run settles on. */
export const CURRENT_DATA_VERSION = 2;

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
  {
    // Phase 8 (RC hardening 8.3): stamp every readable top-level JSON store
    // with the store schema version, closing the parse-or-reset era. Files
    // that don't parse are LEFT UNTOUCHED — the envelope quarantines them at
    // load (preserved bytes beat a migration guessing at repairs). The engine
    // wraps this in its pre-run backup, which — after 8.2 — covers every
    // enterprise-module store too, so a mid-flight failure rolls business
    // data back intact.
    id: '0002-store-schema-stamp',
    domain: 'configuration',
    toVersion: 2,
    up: async (ctx) => {
      let stamped = 0;
      let skipped = 0;
      const names = (await fs.readdir(ctx.dataDir).catch(() => [] as string[])).filter(
        (n) => n.endsWith('.json') && !n.includes('.quarantined-') && n !== 'data-version.json' && n !== 'migration-audit.json',
      );
      for (const name of names) {
        const path = join(ctx.dataDir, name);
        try {
          const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>;
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            skipped += 1; // non-object payloads are not envelope stores
            continue;
          }
          if (typeof parsed.schemaVersion === 'number') continue; // already stamped
          const tmp = `${path}.tmp`;
          await fs.writeFile(tmp, JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION, ...parsed }), { mode: 0o600 });
          await fs.rename(tmp, path);
          stamped += 1;
        } catch {
          skipped += 1; // unreadable — left for the envelope's quarantine at load
        }
      }
      ctx.log(`Stamped schemaVersion ${STORE_SCHEMA_VERSION} on ${stamped} store(s); ${skipped} left untouched.`);
    },
  },
];
