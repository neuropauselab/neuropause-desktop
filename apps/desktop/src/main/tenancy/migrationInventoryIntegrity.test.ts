/**
 * PROGRAM 13C ROUND 3 — PHASE 5. THE INVENTORY MUST DESCRIBE THE CODE.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The migration inventory said the process-mining provider had "a ~2.5s TTL".
 * It never had one. That single inaccurate clause is the reason FIVE successive
 * adversarial sweeps read the entry, concluded the exposure was bounded, and
 * moved on — while the provider cached thirteen tenant-scoped stores' records
 * behind a record-count signature two tenants can match trivially.
 *
 * That is a specific and unpleasant lesson: an inventory is a liability exactly
 * in proportion to how much it is trusted. A reviewer who checks the code is
 * slowed down by a wrong entry; a reviewer who trusts it is STOPPED by one.
 *
 * So the inventory is now tested. Not for prose quality — for the handful of
 * factual claims a reader would act on:
 *
 *   • Does an entry claim a TTL that the file it names does not have?
 *   • Does it claim a store is keyed/bound when nothing binds it?
 *   • Does it name a file that no longer exists?
 *   • Does it still say BLOCKED about something that has been fixed?
 *
 * These are cheap checks and they cannot catch a subtly wrong narrative. They
 * catch the category of error that actually happened, which is the honest bar.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { UNENFORCED } from './migrationInventory';

const MAIN = join(__dirname, '..');

function source(rel: string): string {
  return readFileSync(join(MAIN, rel), 'utf8');
}

describe('the migration inventory describes real code', () => {
  /**
   * THE REGRESSION FOR THE ACTUAL FAILURE.
   *
   * Written as a specific claim rather than a general TTL scanner, because the
   * general version would need to parse prose. This asserts the two things the
   * old entry got wrong: that process mining has a TTL, and that these caches
   * are unkeyed.
   */
  it('does not claim the process-mining cache has a TTL it lacks', () => {
    const provider = source('enterprise/processMiningProvider.ts');
    const entry = UNENFORCED.find((e) => e.store.includes('process-mining'));
    expect(entry, 'the composed-model cache entry disappeared').toBeDefined();

    // The provider's real freshness mechanism is a count signature, and its real
    // boundary is a TenantMemo. Both must be present for the entry to be true.
    expect(provider).toContain('function signature()');
    expect(provider).toContain('new TenantMemo<ProcessCache>');

    /**
     * The entry may still MENTION the 2.5s TTL — it has to, because two of the
     * three caches really do have one and because the correction is worth
     * recording. What it may not do is leave the claim standing. So: if the note
     * says "2.5s TTL" anywhere, it must also say the process-mining provider
     * never had one.
     *
     * Asserting on the retraction rather than on the absence of the phrase is
     * the difference between a test that forces honesty and one that forces
     * silence. Deleting the history would pass a "phrase is absent" check and
     * lose the only durable record of how the finding stayed hidden.
     */
    const note = entry?.note ?? '';
    if (/2\.5s TTL/.test(note)) {
      expect(note, 'the TTL claim is stated without its correction').toMatch(/NEVER HAD ONE/i);
    }
  });

  it('says these caches are keyed only while they actually are', () => {
    const entry = UNENFORCED.find((e) => e.store.includes('process-mining'));
    if (/KEYED BY THE AUTHORITATIVE TENANT/.test(entry?.note ?? '')) {
      for (const rel of [
        'enterprise/processMiningProvider.ts',
        'enterprise/trustProvider.ts',
        'enterprise/relationshipProvider.ts',
      ]) {
        expect(source(rel), `${rel} does not hold a TenantMemo`).toContain('new TenantMemo');
        expect(source(rel), `${rel} has no bind seam`).toMatch(/bindScope|memo\.bindScope/);
      }
    }
  });

  /**
   * An entry that says a store is BOUND has to name a store something binds.
   * This checks the three added this round, because they are the three whose
   * claims are newest and therefore least worn in.
   */
  it('the stores claimed bound this round are bound at a composition root', () => {
    const root = source('ecosystem/index.ts');
    for (const store of ['developerStore', 'billingStore', 'gatewayStore']) {
      expect(root, `${store} is never bound`).toContain(`${store}.bindScope(activeTenantScope)`);
    }
  });

  /** A BLOCKED entry is a promise that nothing was done. Verify that is still true. */
  it('nothing is still marked BLOCKED after being fixed this round', () => {
    const blocked = UNENFORCED.filter((e) => e.status === 'BLOCKED').map((e) => e.store);
    // The three fixed this round must not appear.
    expect(blocked.join(' ')).not.toMatch(/process-mining|developer registry|billing/i);
    // The ones that remain are structural, and each is expected — an unexpected
    // new BLOCKED entry should be a deliberate decision, not a drift.
    expect(blocked.sort()).toEqual([
      'scheduled backup (backupManager)',
      'the filesystem itself',
    ]);
  });

  it('every entry names a store, a status and a substantive note', () => {
    for (const e of UNENFORCED) {
      expect(e.store.trim().length, JSON.stringify(e)).toBeGreaterThan(0);
      expect(['COMPLETE', 'PARTIAL', 'REQUIRES_MIGRATION', 'BLOCKED']).toContain(e.status);
      expect(e.note.trim().length, `${e.store} has a thin note`).toBeGreaterThan(80);
    }
  });

  /**
   * A file named in a note must exist. A stale path is how an entry quietly
   * stops describing anything at all.
   */
  it('every source file named in a note still exists', () => {
    const missing: string[] = [];
    for (const e of UNENFORCED) {
      for (const m of e.note.matchAll(/`([A-Za-z0-9_/.-]+\.ts)`/g)) {
        const rel = m[1] as string;
        if (rel.includes('/') && !existsSync(join(MAIN, rel))) missing.push(`${e.store}: ${rel}`);
      }
    }
    expect(missing, 'Inventory notes reference files that are gone.').toEqual([]);
  });

  /**
   * The surfaces fixed this round must APPEAR. An inventory whose omissions are
   * invisible is the same liability as one whose claims are wrong — the
   * developer registry, billing and the gateway audit were absent entirely
   * before this round, which is why no sweep ever checked them against it.
   */
  it('the H-3 surfaces are present, not silently absent', () => {
    const names = UNENFORCED.map((e) => e.store).join(' | ');
    expect(names).toMatch(/developer registry/i);
    expect(names).toMatch(/billing/i);
    expect(names).toMatch(/gateway audit/i);
    expect(names).toMatch(/startup gate/i);
  });

  /**
   * The gate's own entry must not overclaim. Round 2's report said the gate
   * covered six stores; it covered five. The entry now has to say what the
   * mechanism cannot do, and this asserts that caveat survives edits.
   */
  it('the startup-gate entry states its limit as well as its coverage', () => {
    const entry = UNENFORCED.find((e) => e.store.includes('startup gate'));
    expect(entry?.note ?? '').toMatch(/cannot see a store with no seam at all/i);
  });
});
