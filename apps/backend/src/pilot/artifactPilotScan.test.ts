import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM tool, deliberately not TypeScript: it must run in a bare CI step.
import { scan, mountPaths } from '../../tools/np034-artifact-pilot-scan.mjs';

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
});
