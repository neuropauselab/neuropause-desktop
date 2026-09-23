import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM tool, deliberately not TypeScript: it must run in a bare CI step.
import { scan, mountPaths, PILOT_TABLES } from '../../tools/np034-artifact-pilot-scan.mjs';

/* ==========================================================================================
 * NP-034 — THE PILOT NON-EXPOSURE INVARIANT, AND THE CONTROLS THAT MAKE ITS ZERO MEAN SOMETHING.
 *
 * NP-033 measured a zero for /pilot in the production bundle using a classifier that ALSO
 * returned zero for /auth, /store and /health — routes that certainly exist. A zero beside
 * failing positive controls is not evidence. Every test here therefore pairs a pilot-negative
 * with a known-positive on the SAME fixture.
 *
 * The hardest case is deliberately built in: the real production bundle contains the word
 * "pilot" eight times, all inside a documentation seed record. The CLEAN fixture reproduces
 * that prose. A detector that calls it PILOT_PRESENT is wrong about the one artifact it
 * exists to clear.
 * ========================================================================================== */

const roots: string[] = [];
const artifact = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'np034-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** Mimics the shipped bundle: real routes, multi-line .use(, and the pilot PROSE. */
const CLEAN_BUNDLE = `
  app.use("/auth", createAuthRouter());
  app.use(
    "/store", createStoreRouter());
  app.use('/organizations', createOrgRouter());
  var docs = [{ slug: "pilot-orientation", title: "Pilot Orientation",
    description: "What the pilot includes and how to give feedback.",
    relativePath: "user/PILOT-ORIENTATION.md" }];
`;
const CLEAN_SQL = 'CREATE TABLE IF NOT EXISTS users (id uuid primary key);';

const clean = () => artifact({ 'index.js': CLEAN_BUNDLE, 'migrations/0001_init.sql': CLEAN_SQL });

describe('NP-034 pilot non-exposure invariant', () => {
  describe('T03 — the route detector finds known production routes', () => {
    it('extracts multi-line and both quote styles', () => {
      expect(mountPaths(CLEAN_BUNDLE)).toEqual(['/auth', '/organizations', '/store']);
    });
    it('reports them as published positive controls', () => {
      expect(scan(clean()).positiveControls.allMountPaths).toContain('/auth');
    });
  });

  describe('T10 — a clean artifact passes', () => {
    it('is PILOT_FREE despite containing the word pilot in prose', () => {
      const r = scan(clean());
      expect(r.verdict).toBe('PILOT_FREE');
      // The prose really is present — otherwise this test proves nothing about prose.
      expect(CLEAN_BUNDLE).toContain('Pilot Orientation');
    });
  });

  describe('T04 / T09 — a synthetic pilot ROUTE is caught', () => {
    it('detects an injected mount and fails the invariant', () => {
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\n  app.use("/pilot", requireAuth, createPilotRouter());`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.R1_pilot_route_mounted).toEqual(['/pilot']);
      expect(r.findings.R2_pilot_router_symbol).toBe(1);
      expect(r.positiveControls.allMountPaths).toContain('/auth'); // control still fires
    });
    it('detects a sub-path mount too', () => {
      const r = scan(artifact({ 'index.js': 'app.use("/pilot/enroll", h);', 'm/0001.sql': CLEAN_SQL }));
      expect(r.findings.R1_pilot_route_mounted).toEqual(['/pilot/enroll']);
    });
  });

  describe('T05 / T09 — a synthetic pilot MIGRATION is caught', () => {
    it('detects the migration by filename', () => {
      const r = scan(artifact({
        'index.js': CLEAN_BUNDLE,
        'migrations/0001_init.sql': CLEAN_SQL,
        'migrations/0013_pilot.sql': 'CREATE TABLE consents (id uuid);',
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.M1_pilot_migration_files).toEqual(['0013_pilot.sql']);
    });
    it('detects pilot DDL even when the filename is innocuous', () => {
      const r = scan(artifact({
        'index.js': CLEAN_BUNDLE,
        'migrations/0042_misc.sql': 'CREATE TABLE IF NOT EXISTS pilot_enrollments (id uuid);',
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.M2_pilot_tables_created).toEqual(['pilot_enrollments']);
      expect(r.findings.M1_pilot_migration_files).toEqual([]); // filename alone would have missed it
    });
  });

  describe('vacuity guards', () => {
    it('refuses to report PILOT_FREE for an unscannable directory', () => {
      const r = scan(artifact({ 'migrations/0001_init.sql': CLEAN_SQL }));
      expect(r.scannable).toBe(false);
      expect(r.verdict).toBeUndefined();
    });
    it('refuses a directory that does not exist', () => {
      expect(scan('/definitely/not/here').scannable).toBe(false);
    });
  });

  /* ----------------------------------------------------------------------------------------
   * NP-034-DECISION §4 enumerates SEVEN things a production artifact must remain without.
   * R1/R2/M1/M2 covered items 1-2 and part of 4-5. These pin 3, 5, 6, 7 and close 4.
   * -------------------------------------------------------------------------------------- */
  describe('§4 item 3 — pilot-only execution surfaces', () => {
    it('detects a pilot execution symbol with no route and no migration present', () => {
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\nasync function stopPilot(d, a, reason) { return null; }`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.S1_pilot_execution_symbols).toEqual(['stopPilot']);
      expect(r.findings.R1_pilot_route_mounted).toEqual([]); // fired on S1 alone
    });
    it('does NOT fire on generic names shared with product code', () => {
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\nfunction enroll(){} function status(){} function withdraw(){}`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.verdict).toBe('PILOT_FREE');
    });
  });

  describe('§4 items 4,5,7 — participant / authority state and data stores in RUNTIME SQL', () => {
    it('detects a pilot table queried by the bundle even with no migration shipped', () => {
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\nvar q = "SELECT * FROM pilot_role_bindings WHERE subject_id=$1";`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.Q1_pilot_table_references).toEqual(['pilot_role_bindings']);
      expect(r.findings.M2_pilot_tables_created).toEqual([]); // no DDL — Q1 alone caught it
    });
    it('detects the UNPREFIXED pilot tables a `pilot_` classifier would miss', () => {
      // NP-015 measured this: `pilot_%` moves 14 tables and strands consents + human_decisions.
      expect(PILOT_TABLES).toContain('consents');
      expect(PILOT_TABLES).toContain('human_decisions');
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\nvar q = "INSERT INTO human_decisions (actor_id) VALUES ($1)";`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.findings.Q1_pilot_table_references).toEqual(['human_decisions']);
    });
    it('does NOT list account_deletion_requests — 0015 is not a pilot migration', () => {
      expect(PILOT_TABLES).not.toContain('account_deletion_requests');
    });
  });

  describe('§4 item 6 — pilot credentials', () => {
    it('detects a pilot env key reference', () => {
      const r = scan(artifact({
        'index.js': `${CLEAN_BUNDLE}\nvar u = process.env.PILOT_DATABASE_URL;`,
        'migrations/0001_init.sql': CLEAN_SQL,
      }));
      expect(r.verdict).toBe('PILOT_PRESENT');
      expect(r.findings.E1_pilot_env_keys).toEqual(['PILOT_DATABASE_URL']);
    });
  });

  describe('coverage is published, not asserted', () => {
    it('maps every one of the seven §4 items to at least one check', () => {
      const covers = scan(clean()).positiveControls.covers;
      expect(Object.keys(covers)).toHaveLength(7);
      for (const checks of Object.values(covers)) expect((checks as string[]).length).toBeGreaterThan(0);
    });
  });

});
