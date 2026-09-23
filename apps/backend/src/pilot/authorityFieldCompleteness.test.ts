import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_TABLE, SIGNED_COLUMNS, UNSIGNED_COLUMNS, UNSIGNABLE_COLUMNS, classify,
} from './authorityFieldContract';

/* ==========================================================================================
 * H14 — the reverse-direction invariant.
 *
 * The existing suite proves: every SIGNED_FIELD has a mutation test.
 * This suite proves:        every COLUMN has a classification.
 *
 * The column list is parsed out of the migration SQL, so this is schema-linked. A hand-kept
 * copy of the schema would drift silently, which is the defect class being repaired.
 * ========================================================================================== */

const MIGRATIONS = join(__dirname, '..', 'db', 'migrations');

/** Columns of the authority table, derived from CREATE TABLE plus every later ADD COLUMN. */
export function columnsFromMigrations(dir = MIGRATIONS): string[] {
  const cols: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');

    const create = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${AUTHORITY_TABLE}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i',
    ).exec(sql);
    if (create) {
      for (const raw of create[1].split('\n')) {
        const line = raw.trim();
        // Skip table-level constraints; take the leading identifier of a column definition.
        if (!line || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|--)/i.test(line)) continue;
        const m = /^([a-z_][a-z0-9_]*)\s/i.exec(line);
        if (m) cols.push(m[1]);
      }
    }
    const add = new RegExp(
      `ALTER\\s+TABLE\\s+${AUTHORITY_TABLE}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_][a-z0-9_]*)`, 'gi',
    );
    for (let m = add.exec(sql); m; m = add.exec(sql)) cols.push(m[1]);
  }
  return [...new Set(cols)];
}

describe('H14 — every authority-table column is classified', () => {
  const columns = columnsFromMigrations();

  it('CONTROL: the parser actually found the table and its columns', () => {
    // Without this, an empty column list would make every assertion below vacuously true —
    // which is precisely the failure mode this whole suite exists to prevent.
    expect(columns.length).toBeGreaterThanOrEqual(9);
    expect(columns).toContain('instrument');
    expect(columns).toContain('signature');      // proves ALTER TABLE parsing works too
    expect(columns).toContain('signer_key_id');
  });

  it('every column has exactly one classification — no UNCLASSIFIED column may exist', () => {
    const unclassified = columns.filter((c) => classify(c) === 'UNCLASSIFIED');
    expect(unclassified).toEqual([]);
  });

  it('the buckets are disjoint', () => {
    const unsigned = UNSIGNED_COLUMNS.map((u) => u.column);
    for (const c of SIGNED_COLUMNS) {
      expect(unsigned).not.toContain(c);
      expect(UNSIGNABLE_COLUMNS).not.toContain(c);
    }
    for (const c of unsigned) expect(UNSIGNABLE_COLUMNS).not.toContain(c);
  });

  it('the contract describes no column that does not exist in the schema', () => {
    const declared = [...SIGNED_COLUMNS, ...UNSIGNED_COLUMNS.map((u) => u.column), ...UNSIGNABLE_COLUMNS];
    for (const d of declared) expect(columns).toContain(d);
  });

  it('every intentionally-unsigned column carries a written justification', () => {
    for (const u of UNSIGNED_COLUMNS) {
      expect(u.authorityBearing).toBe(false);
      expect(u.why.length).toBeGreaterThan(40);
    }
  });

  it('every column the loader SELECTs is classified', () => {
    const store = readFileSync(join(__dirname, 'authorityStore.ts'), 'utf8');
    /*
     * The capture must not span a PRIOR SELECT. A greedy `SELECT[\s\S]*?FROM <table>` starts at
     * the FIRST SELECT in the file — `loadRoleBindings`, on a different table — and sweeps the
     * intervening comment prose in as column names ("so", "or", "in", "would"...). Measured:
     * it yielded 21 "columns" including six English words. Excluding SELECT from the span fixes it.
     */
    const select = /SELECT((?:(?!SELECT)[\s\S])*?)FROM pilot_authority_decisions/.exec(store);
    expect(select).not.toBeNull();
    const selected = select![1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter((s) => /^[a-z_]+$/.test(s));
    expect(selected).toContain('instrument');            // control: the right SELECT was parsed
    expect(selected).not.toContain('subject_id');        // control: NOT the role-bindings SELECT
    expect(selected.length).toBeGreaterThanOrEqual(7);
    for (const c of selected) expect(classify(c)).not.toBe('UNCLASSIFIED');
  });

  /* §14 — ADVERSARIAL SCHEMA DRIFT.
   * Prove the invariant FAILS when a new authority-bearing column appears. Without this, the
   * suite above could pass because the contract happens to match today, and would keep passing
   * for a schema it no longer describes. */
  it('SCHEMA DRIFT: a new column added by a migration is UNCLASSIFIED and would fail the gate', () => {
    const synthetic = 'authority_scope_2';
    expect(classify(synthetic)).toBe('UNCLASSIFIED');

    // Simulate the migration adding it, using the real parser against a real SQL string.
    const drifted = [...columnsFromMigrations(), synthetic];
    const unclassified = drifted.filter((c) => classify(c) === 'UNCLASSIFIED');
    expect(unclassified).toEqual([synthetic]);   // the gate would fail — exactly as required
  });

  it('SCHEMA DRIFT: the parser picks up an ADD COLUMN it has never seen', () => {
    const sql = `ALTER TABLE ${AUTHORITY_TABLE} ADD COLUMN IF NOT EXISTS approval_state text;`;
    const re = new RegExp(
      `ALTER\\s+TABLE\\s+${AUTHORITY_TABLE}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_][a-z0-9_]*)`, 'i');
    const found = re.exec(sql)?.[1];
    expect(found).toBe('approval_state');
    expect(classify(found!)).toBe('UNCLASSIFIED');
  });
});
