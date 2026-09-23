import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* ==========================================================================================
 * THE PILOT SURFACE MAY NOT BE MOUNTED WITHOUT ITS GATE.
 *
 * This is a SOURCE invariant, not a behavioural one, and the distinction is the whole point.
 * A behavioural test asks the app that was built; it cannot fail for a mount that a future
 * edit removes, because the removal changes what is built. Only reading the mount statement
 * itself can fail on the edit.
 *
 * MEASURED CAUSE, not a hypothetical. On 23 Sep 2026 the deployable tree that the running
 * production compose project builds from (docker-compose.prod.yml, working_dir
 * ~/Desktop/neuropause-desktop) carried:
 *
 *     app.use('/pilot', requireAuth, createPilotRouter());     // app.ts:112 — NO GATE
 *
 * with no mount.ts in the tree at all (`createPilotMountGate` = 0 files; positive control
 * `createPilotRouter` = 3 files). That surface reaches an `enroll()` with no participant cap,
 * no stop control (`getControl` = 0 non-test hits), no environment gate and no mount gate.
 * The entire control apparatus exists only on this unpushed branch.
 *
 * Nothing pinned the gate: before this file, `pilotMountGate` occurred in app.ts and in NO
 * test anywhere in the tree. The gate was written, wired, and left unguarded against its own
 * removal — a control with no control over its own deletion.
 *
 * This test does not decide whether the pilot may run, who may authorize it, or what the gate
 * should permit. It asserts only that the surface cannot be mounted with the gate absent.
 * ========================================================================================== */

const APP_TS = join(__dirname, '..', 'app.ts');
const source = readFileSync(APP_TS, 'utf8');

/** The mount statement(s) for the pilot surface, whatever middleware they carry. */
const mountLines = (text: string): string[] =>
  text.split('\n').filter((l) => /app\.use\(\s*['"]\/pilot['"]/.test(l));

describe('the pilot surface cannot be mounted without its gate', () => {
  it('reads a non-empty app.ts (control: the file is actually being read)', () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("app.use('/pilot'");
  });

  it('finds exactly one pilot mount — a second mount would need its own gate', () => {
    expect(mountLines(source)).toHaveLength(1);
  });

  it('the mount carries pilotMountGate', () => {
    const [mount] = mountLines(source);
    expect(mount).toContain('pilotMountGate');
  });

  it('the gate runs BEFORE requireAuth, so an ungated environment is refused without consulting a credential', () => {
    const [mount] = mountLines(source);
    /*
     * BOTH INDICES ARE ASSERTED PRESENT FIRST, AND THAT IS NOT PEDANTRY.
     * `indexOf` returns -1 for an absent needle, and -1 is less than every real index — so
     * the bare ordering comparison PASSES when the gate has been deleted, which is the one
     * edit this file exists to catch. Measured: with the gate removed this assertion stayed
     * green and only the presence test above failed, i.e. the ordering check was
     * outcome-masked by its own sibling. A control whose failure is indistinguishable from
     * another control's failure is not independently load-bearing.
     */
    const gateAt = mount.indexOf('pilotMountGate');
    const authAt = mount.indexOf('requireAuth');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(gateAt).toBeLessThan(authAt);
  });

  it('the gate is constructed from the real factory, not stubbed inline', () => {
    expect(source).toMatch(/const pilotMountGate = createPilotMountGate\(\)/);
    expect(source).toMatch(/import .*createPilotMountGate.* from ['"]\.\/pilot\/mount['"]/);
  });

  /*
   * THE PIN MUST DISTINGUISH THE BUG FROM THE FIX.
   *
   * A regression test written against a masked defect tends to inherit the mask, so this
   * re-runs the classifier against the EXACT ungated statement measured in the deployable
   * tree. If the assertions above could not fail on that input, they pin nothing.
   */
  it('the classifier fails on the ungated mount measured in the deployable tree', () => {
    const ungated = "  app.use('/pilot', requireAuth, createPilotRouter());";
    const [mount] = mountLines(ungated);
    expect(mount).toBeDefined();
    expect(mount).not.toContain('pilotMountGate');
  });
});
