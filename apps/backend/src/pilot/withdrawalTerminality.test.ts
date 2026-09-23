import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ==========================================================================================
 * WORK ITEM 4 — WITHDRAWAL TERMINALITY, pinned at source level.
 *
 * The BEHAVIOURAL proof is necessarily a database one and lives in the evidence package: with
 * a non-superuser, non-owner role — the pilot runtime's privilege class — a withdrawn
 * participant was revived by one UPDATE before the trigger, and 12/12 revival targets are
 * rejected after it.
 *
 * These tests pin what a unit suite CAN hold: that the migration still exists, still carries
 * the invariant, and that the application predicates guarding the same property were not
 * quietly removed once the database began enforcing it. A control that moves to the database
 * is a reason to keep the application check, not to drop it.
 * ========================================================================================== */

const MIGRATIONS = join(__dirname, '..', 'db', 'migrations');
const migration = (): string => {
  const f = readdirSync(MIGRATIONS).find((n) => n.includes('withdrawal_terminality'));
  expect(f).toBeDefined();                       // control: the file is actually present
  return readFileSync(join(MIGRATIONS, f!), 'utf8');
};

describe('the withdrawal-terminality migration exists and carries the invariant', () => {
  it('declares a BEFORE UPDATE row trigger on pilot_enrollments', () => {
    const sql = migration();
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+ON\s+pilot_enrollments/i);
    expect(sql).toMatch(/FOR\s+EACH\s+ROW/i);
  });

  it('refuses exactly the transition OUT of WITHDRAWN, and nothing wider', () => {
    const sql = migration();
    // The guard must key on OLD.state = WITHDRAWN and NEW.state differing.
    expect(sql).toMatch(/OLD\.state\s*=\s*'WITHDRAWN'/);
    expect(sql).toMatch(/NEW\.state\s+IS\s+DISTINCT\s+FROM\s+'WITHDRAWN'/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('does not touch product tables', () => {
    const sql = migration();
    for (const t of ['users', 'organizations', 'developers', 'auth_identities'])
      expect(sql).not.toMatch(new RegExp(`(TRIGGER|TABLE)\\s+[^;]*\\b${t}\\b`, 'i'));
    // control: it DOES reference the pilot table, so the absence above is meaningful
    expect(sql).toContain('pilot_enrollments');
  });

  it('is additive — it drops no constraint, column or index', () => {
    const sql = migration();
    expect(sql).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    // A DROP TRIGGER IF EXISTS of its OWN trigger is idempotency, not removal of another.
    const drops = sql.match(/DROP\s+TRIGGER[^;]*/gi) ?? [];
    for (const d of drops) expect(d).toContain('pilot_enrollments_withdrawal_terminality');
  });
});

describe('the application predicates were NOT removed when the DB took over', () => {
  const repo = readFileSync(join(__dirname, 'repository.ts'), 'utf8');
  it('the exit writers still refuse an already-exited row', () => {
    const guards = repo.match(/state NOT IN \('WITHDRAWN','TERMINATED','COMPLETED'\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });
  it('control: the file really was read', () => {
    expect(repo).toContain('UPDATE pilot_enrollments');
  });
});
