/**
 * NP-PILOT-FIRST-013 — ENG-12: the invariant that would have caught the cap gap on day one.
 *
 * THE DEFECT THIS EXISTS FOR. `capGovernance.ts` asked `resolveAuthority` for `pilot.cap.set`
 * from NP-009 onward, while the literal appeared in neither `PILOT_ACTIONS` nor any
 * `ROLE_ACTIONS` row. `explainAuthority` step 5 therefore answered DENY/ACTION_NOT_AUTHORIZED
 * for every role, permanently — the governed path built to set the cap could never set it.
 *
 * It failed closed, so nothing was wrongly permitted. But forty tests and four mutants passed
 * over it, because every one injected `{ evaluate: () => 'ALLOW' }` and never asked the real
 * evaluator anything.
 *
 * SO THE PIN IS AT SOURCE LEVEL, NOT BEHAVIOURAL. A behavioural test only covers the actions
 * somebody remembered to write a test for — which is exactly the thing that failed. This reads
 * the ACTION STRINGS OUT OF THE SERVICE SOURCE and requires each to be routable, so a future
 * action added to a service fails here immediately rather than waiting for its first caller.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PILOT_ACTIONS, ROLE_ACTIONS, type PilotRole } from './authorityEvaluator';

const DIR = __dirname;

/** Every `action: '<literal>'` and `<NAME> = '<literal>'` action string in the pilot services. */
function actionLiteralsInSource(): { action: string; file: string }[] {
  const found: { action: string; file: string }[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const src = readFileSync(join(DIR, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/action:\s*'(pilot\.[a-z.]+)'/g)) found.push({ action: m[1], file: f });
    for (const m of src.matchAll(/_ACTION\s*=\s*'(pilot\.[a-z.]+)'/g)) found.push({ action: m[1], file: f });
  }
  return found;
}

describe('ENG-12 — every action a service requests must be routable', () => {
  it('the detector finds real action literals (vacuity guard)', () => {
    const found = actionLiteralsInSource();
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(new Set(found.map((f) => f.action)).size).toBeGreaterThanOrEqual(6);
  });

  it('EVERY action string used by a service is declared in PILOT_ACTIONS', () => {
    const declared = new Set<string>(PILOT_ACTIONS);
    const undeclared = actionLiteralsInSource().filter((f) => !declared.has(f.action));
    // A service asking for an action the evaluator does not know is unroutable by construction.
    expect(undeclared.map((u) => `${u.action} (${u.file})`)).toEqual([]);
  });

  it('EVERY declared action is reachable by at least one role', () => {
    const reachable = new Set<string>(Object.values(ROLE_ACTIONS).flat());
    const orphaned = PILOT_ACTIONS.filter((a) => !reachable.has(a));
    // An action no role carries can only ever answer DENY — the exact ENG-12 shape.
    expect(orphaned).toEqual([]);
  });

  it('no role carries an action that is not declared', () => {
    const declared = new Set<string>(PILOT_ACTIONS);
    for (const [role, actions] of Object.entries(ROLE_ACTIONS))
      for (const a of actions) expect(declared.has(a), `${role} carries undeclared ${a}`).toBe(true);
  });

  it('pilot.cap.set is carried by the decision authority and by NOBODY else', () => {
    // D05 lists "participant-cap changes" among the decision authority's powers; D04's operator
    // list does not, and D09 requires a new human decision to raise the cap.
    const carriers = (Object.entries(ROLE_ACTIONS) as [PilotRole, readonly string[]][])
      .filter(([, actions]) => actions.includes('pilot.cap.set'))
      .map(([role]) => role);
    expect(carriers).toEqual(['FIRST_PILOT_HUMAN_DECISION_AUTHORITY']);
  });

  it('still no wildcard, and no role gained a power it should not have', () => {
    expect(ROLE_ACTIONS.INDEPENDENT_PILOT_VERIFIER).toEqual(['pilot.control.read']);
    expect(ROLE_ACTIONS.PILOT_OPERATOR_TECHNICAL_OPERATIONS).not.toContain('pilot.cap.set');
    expect(ROLE_ACTIONS.PILOT_OPERATOR_TECHNICAL_OPERATIONS).not.toContain('pilot.resume');
    for (const actions of Object.values(ROLE_ACTIONS)) expect(actions).not.toContain('*');
  });
});
