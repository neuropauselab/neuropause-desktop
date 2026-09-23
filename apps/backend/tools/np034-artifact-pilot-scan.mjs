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

export function scan(artifactDir) {
  if (!existsSync(artifactDir)) return { scannable: false, reason: `no such directory: ${artifactDir}` };
  const files = walk(artifactDir);
  const js = files.filter((f) => f.endsWith('.js') && !f.endsWith('.map'));
  const sql = files.filter((f) => f.endsWith('.sql'));
  if (js.length === 0) return { scannable: false, reason: 'no .js files in artifact' };

  const routes = new Set();
  let routeSymbol = 0;
  for (const f of js) {
    const src = readFileSync(f, 'utf8');
    for (const p of mountPaths(src)) routes.add(p);
    // Module identifier, word-bounded so it cannot match inside prose.
    routeSymbol += (src.match(/\bcreatePilotRouter\b/g) ?? []).length;
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
  };
  const present =
    pilotRoutes.length > 0 || routeSymbol > 0 || migrationFiles.length > 0 || pilotTables.size > 0;

  return {
    scannable: true,
    artifactDir,
    counted: { jsFiles: js.length, sqlFiles: sql.length },
    // Published so a zero is checkable: these prove the detector reached real content.
    positiveControls: { allMountPaths: [...routes].sort(), sqlFilesSeen: sql.length },
    findings,
    verdict: present ? 'PILOT_PRESENT' : 'PILOT_FREE',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scan(process.argv[2]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(!r.scannable ? 2 : r.verdict === 'PILOT_PRESENT' ? 1 : 0);
}
