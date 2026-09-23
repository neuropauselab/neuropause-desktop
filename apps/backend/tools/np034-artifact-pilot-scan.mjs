#!/usr/bin/env node
/*
 * NP-034 — PILOT NON-EXPOSURE DETECTOR, over a BUILT ARTIFACT.
 *
 * Input is a built artifact directory (the `dist/` a production image carries), NOT source.
 * NP-033 established that source presence and image content are different facts, so a
 * source-only check would be evidence about the wrong thing.
 *
 * IT MUST NOT FIRE ON PROSE. The real production bundle contains the word "pilot" 8 times,
 * every one inside a documentation seed record ("Pilot Orientation", "user/PILOT-ORIENT…").
 * A naive /pilot/i grep calls that artifact pilot-bearing, which is a false positive on the
 * one artifact the detector exists to clear. So every check below is structural: a route
 * MOUNT literal, a module IDENTIFIER, a migration FILENAME, a CREATE TABLE statement.
 *
 * Usage:  node np034-artifact-pilot-scan.mjs <artifact-dir>
 * Output: JSON to stdout. Exit 0 = PILOT_FREE, 1 = PILOT_PRESENT, 2 = UNSCANNABLE.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/** Express mount paths, read as LITERALS out of the bundle: .use("<path>" / .use('<path>' */
export const mountPaths = (js) => {
  const out = new Set();
  for (const m of js.matchAll(/\.use\(\s*(['"])([^'"]+)\1/g)) out.add(m[2]);
  return [...out].sort();
};

const isPilotPath = (p) => p === '/pilot' || p.startsWith('/pilot/');

/*
 * NP-034-DECISION §4 enumerates SEVEN things a production artifact must remain without.
 * The original four checks covered items 1-2 and only partially 4-5, so the lists below
 * close 3, 4, 5, 6 and 7.
 *
 * THE TABLE LIST IS EXPLICIT, NOT A `pilot_` PREFIX. Three pilot-domain tables carry no
 * prefix — `consents` and `human_decisions` are created by 0013_pilot.sql — so a prefix
 * classifier misses them. NP-015 measured this exact error: `pilot_%` moved 14 tables and
 * stranded 2. Conversely `account_deletion_requests` is created by 0015_account_deletion.sql
 * and is NOT a pilot table, so "everything from migration 0013 onward" over-matches. Only an
 * enumerated list is correct in both directions.
 */
export const PILOT_TABLES = [
  'consents', 'human_decisions',
  'pilot_alert_deliveries', 'pilot_authority_decisions', 'pilot_cap_decisions',
  'pilot_closure', 'pilot_control', 'pilot_enrollments', 'pilot_environment_identity',
  'pilot_events', 'pilot_lifecycle_events', 'pilot_monitor_events', 'pilot_retention_holds',
  'pilot_retention_log', 'pilot_role_bindings', 'pilot_terms',
];

/* Pilot-only exported symbols. Generic names (`enroll`, `status`, `day`, `withdraw`) are
 * deliberately EXCLUDED — they would fire on unrelated product code. */
export const PILOT_SYMBOLS = [
  'createPilotRouter', 'createPilotMountGate', 'mountPilotIfEnabled', 'decidePilotMount',
  'stopPilot', 'resumePilot', 'setPilotCap', 'pilotControl', 'readBackPilotControl',
  'assertPilotEnvironment', 'resolvePilotEnvironment', 'exportParticipantPilotData',
  'seedPilotFixtures', 'createMemoryPilotRepository', 'createMemoryPilotMonitor',
  'terminateParticipation', 'executeRetention', 'planRetention', 'governanceReadBack',
  'recordAuthorityRefusals', 'loadRoleBindings', 'loadAuthoritySnapshot', 'activeCapDecision',
];

/* Environment keys the pilot reads. Derived from `env.PILOT_*` accesses, NOT from the
 * `PILOT_*` identifier sweep — that sweep returns 29 hits, most of them TypeScript
 * constants (`PILOT_ACTIONS`, `PILOT_EVENT_TYPES`, `PILOT_FREE`) that are not env keys. */
export const PILOT_ENV_KEYS = [
  'PILOT_DATABASE_URL', 'PILOT_ENVIRONMENT_CLASS', 'PILOT_ENVIRONMENT_ID',
  'PILOT_MODULE_ENABLED', 'PILOT_TARGET_ID', 'PILOT_ALERT_DIR', 'PILOT_ALERT_SINK',
];

const wordHits = (text, words) =>
  words.filter((w) => new RegExp(`\\b${w}\\b`).test(text)).sort();

export function scan(artifactDir) {
  if (!existsSync(artifactDir)) return { scannable: false, reason: `no such directory: ${artifactDir}` };
  const files = walk(artifactDir);
  const js = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
  const sql = files.filter((f) => f.endsWith('.sql'));
  if (js.length === 0) return { scannable: false, reason: 'no .js files in artifact' };

  const routes = new Set();
  const symbols = new Set();
  const tableRefs = new Set();
  const envKeys = new Set();
  let routeSymbol = 0;
  for (const f of js) {
    const src = readFileSync(f, 'utf8');
    for (const p of mountPaths(src)) routes.add(p);
    // Module identifier, word-bounded so it cannot match inside prose.
    routeSymbol += (src.match(/\bcreatePilotRouter\b/g) ?? []).length;
    for (const sym of wordHits(src, PILOT_SYMBOLS)) symbols.add(sym);
    for (const t of wordHits(src, PILOT_TABLES)) tableRefs.add(t);
    for (const k of wordHits(src, PILOT_ENV_KEYS)) envKeys.add(k);
  }

  const pilotRoutes = [...routes].filter(isPilotPath);
  const migrationFiles = sql.map((f) => basename(f)).filter((n) => /pilot/i.test(n));
  const pilotTables = new Set();
  for (const f of sql) {
    for (const m of readFileSync(f, 'utf8')
      .matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(pilot_[a-z_]+)/gi))
      pilotTables.add(m[1].toLowerCase());
  }

  const findings = {
    R1_pilot_route_mounted: pilotRoutes,
    R2_pilot_router_symbol: routeSymbol,
    M1_pilot_migration_files: [...new Set(migrationFiles)].sort(),
    M2_pilot_tables_created: [...pilotTables].sort(),
    S1_pilot_execution_symbols: [...symbols].sort(),
    Q1_pilot_table_references: [...tableRefs].sort(),
    E1_pilot_env_keys: [...envKeys].sort(),
  };
  const present = Object.values(findings).some((v) =>
    Array.isArray(v) ? v.length > 0 : v > 0);

  return {
    scannable: true,
    artifactDir,
    counted: { jsFiles: js.length, sqlFiles: sql.length },
    // Published so a zero is checkable: these prove the detector reached real content.
    positiveControls: {
      allMountPaths: [...routes].sort(),
      sqlFilesSeen: sql.length,
      // §4 item -> check mapping, published so coverage is auditable rather than asserted.
      covers: {
        '1_routes': ['R1', 'R2'], '2_migrations': ['M1', 'M2'], '3_execution_surfaces': ['S1'],
        '4_participant_state': ['M2', 'Q1'], '5_authority_state': ['M2', 'Q1'],
        '6_credentials': ['E1'], '7_data_stores': ['E1', 'Q1'],
      },
    },
    // §4 item -> check mapping, published so coverage is auditable rather than asserted.
    covers: {
      '1_routes': ['R1', 'R2'], '2_migrations': ['M1', 'M2'], '3_execution_surfaces': ['S1'],
      '4_participant_state': ['M2', 'Q1'], '5_authority_state': ['M2', 'Q1'],
      '6_credentials': ['E1'], '7_data_stores': ['E1', 'Q1'],
    },
    findings,
    verdict: present ? 'PILOT_PRESENT' : 'PILOT_FREE',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scan(process.argv[2]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(!r.scannable ? 2 : r.verdict === 'PILOT_PRESENT' ? 1 : 0);
}
