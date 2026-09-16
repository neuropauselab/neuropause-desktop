/**
 * P13C H-FINDING-4 — M365 GOVERNANCE COVERAGE REGRESSION INVARIANT (test-only).
 *
 * This is NOT runtime enforcement. It is a structural regression invariant derived from the
 * AUTHORITATIVE `ALL_M365_ACTIONS` registry: it fails the suite if the mutating M365 IPC action
 * surface ever drifts out of governance coverage. The IPC write handler routes `mail.send` to
 * `governedSend`, every governedAction-cohort member to `governedAction`, and ANYTHING ELSE to the
 * ungoverned `m365.execute` fallback — so a future mutating action registered WITHOUT cohort
 * membership would silently reach that fallback. This guard makes "every mutating action is
 * governedSend(mail.send) XOR exactly one governedAction cohort" a checked property.
 *
 * The mutating universe is DERIVED from the registry (`ALL_M365_ACTIONS.filter(a => a.mutates)`) — it
 * is never re-listed here, so the guard cannot drift from the registry. The governance policy it
 * checks against is the existing exported cohort sets + the single `mail.send`/governedSend literal
 * (the handler's own literal, `connectors/index.ts` `r.actionId === 'mail.send'`).
 *
 * What this proves: a test-time coverage invariant. What it does NOT prove: runtime universal
 * governance, worker/IPC governance equivalence, CST governance of the worker (Boundary-B) ingress,
 * provider idempotency, effect success, verification success, cross-process/power-loss durability,
 * renderer exclusion, or universal NeuroPause governance. IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.
 */
import { describe, expect, it } from 'vitest';
import {
  GOVERNED_ACTION_COHORT1,
  GOVERNED_ACTION_COHORT2A,
  GOVERNED_ACTION_COHORT2B_I,
  GOVERNED_ACTION_COHORT2B_II,
} from './governedAction';
import { ALL_M365_ACTIONS } from '../connectors/m365';

/** The single action governed by governedSend (NOT governedAction) — mirrors the IPC handler literal. */
const GOVERNED_SEND_ID = 'mail.send';

/** The governedAction cohorts, labelled so violation messages can name the offending cohort(s). */
type LabelledCohort = { readonly label: string; readonly set: ReadonlySet<string> };
const GOVERNED_ACTION_COHORTS: readonly LabelledCohort[] = [
  { label: 'Cohort-1', set: GOVERNED_ACTION_COHORT1 },
  { label: 'Cohort-2A', set: GOVERNED_ACTION_COHORT2A },
  { label: 'Cohort-2B-i', set: GOVERNED_ACTION_COHORT2B_I },
  { label: 'Cohort-2B-ii', set: GOVERNED_ACTION_COHORT2B_II },
];

/** Minimal action shape the invariant inspects (a subset of WriteAction). */
interface RegistryAction {
  readonly id: string;
  readonly mutates: boolean;
}

/** Which labelled cohorts contain `id`. */
function cohortsContaining(id: string, cohorts: readonly LabelledCohort[]): string[] {
  return cohorts.filter((c) => c.set.has(id)).map((c) => c.label);
}

/**
 * The PURE coverage audit. Returns every violation of the six invariants for the given registry +
 * cohorts + governedSend id. An empty result across all buckets means coverage holds. This function is
 * applied to the REAL registry (must be clean) and to SYNTHETIC fixtures (each must be flagged) — so the
 * invariant logic itself is proven to catch each future-regression scenario without mutating production.
 */
function auditCoverage(
  actions: readonly RegistryAction[],
  cohorts: readonly LabelledCohort[],
  sendId: string,
): {
  ungovernedMutating: string[]; // mutates:true, not sendId, in 0 cohorts (would hit the ungoverned fallback)
  multiCohort: Array<{ id: string; cohorts: string[] }>; // in >1 cohort
  readOnlyGoverned: Array<{ id: string; cohorts: string[] }>; // mutates:false but in a cohort
  sendInCohort: string[]; // sendId wrongly placed in a governedAction cohort
  unknownCohortIds: Array<{ id: string; cohorts: string[] }>; // cohort id absent from the registry
  sendNotMutating: boolean; // sendId is not registered as mutates:true
} {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const ungovernedMutating: string[] = [];
  const multiCohort: Array<{ id: string; cohorts: string[] }> = [];
  const readOnlyGoverned: Array<{ id: string; cohorts: string[] }> = [];

  for (const a of actions) {
    const inCohorts = cohortsContaining(a.id, cohorts);
    if (a.mutates) {
      if (a.id === sendId) continue; // the governedSend exception — accounted for separately
      if (inCohorts.length === 0) ungovernedMutating.push(a.id); // INVARIANT 1: 0 memberships → FAIL
      if (inCohorts.length > 1) multiCohort.push({ id: a.id, cohorts: inCohorts }); // INVARIANT 1/5: >1 → FAIL
    } else if (inCohorts.length > 0) {
      readOnlyGoverned.push({ id: a.id, cohorts: inCohorts }); // INVARIANT 3: read-only in a cohort → FAIL
    }
  }

  // INVARIANT 2: sendId must be mutating and must NOT be in any governedAction cohort.
  const sendAction = byId.get(sendId);
  const sendNotMutating = !sendAction || sendAction.mutates !== true;
  const sendInCohort = cohortsContaining(sendId, cohorts);

  // INVARIANT 4: every id in any cohort must be a registered action.
  const unknownCohortIds: Array<{ id: string; cohorts: string[] }> = [];
  const cohortIds = new Set<string>();
  for (const c of cohorts) for (const id of c.set) cohortIds.add(id);
  for (const id of cohortIds) {
    if (!byId.has(id)) unknownCohortIds.push({ id, cohorts: cohortsContaining(id, cohorts) });
  }

  return { ungovernedMutating, multiCohort, readOnlyGoverned, sendInCohort, unknownCohortIds, sendNotMutating };
}

describe('M365 governance coverage — regression invariant over ALL_M365_ACTIONS', () => {
  const audit = auditCoverage(ALL_M365_ACTIONS, GOVERNED_ACTION_COHORTS, GOVERNED_SEND_ID);
  const mutating = ALL_M365_ACTIONS.filter((a) => a.mutates).map((a) => a.id);
  const readOnly = ALL_M365_ACTIONS.filter((a) => !a.mutates).map((a) => a.id);

  it('INVARIANT 1 — every mutating action (except mail.send) is in EXACTLY ONE governedAction cohort', () => {
    // 0 memberships would silently reach the ungoverned m365.execute IPC fallback.
    expect(audit.ungovernedMutating).toEqual([]);
    // >1 membership is an ambiguous classification.
    expect(audit.multiCohort).toEqual([]);
    for (const id of mutating) {
      if (id === GOVERNED_SEND_ID) continue;
      expect(cohortsContaining(id, GOVERNED_ACTION_COHORTS)).toHaveLength(1);
    }
  });

  it('INVARIANT 2 — mail.send is mutating, governed by governedSend, and NOT in any governedAction cohort', () => {
    expect(audit.sendNotMutating).toBe(false);
    expect(audit.sendInCohort).toEqual([]);
    const send = ALL_M365_ACTIONS.find((a) => a.id === GOVERNED_SEND_ID);
    expect(send?.mutates).toBe(true);
  });

  it('INVARIANT 3 — every read-only (mutates:false) action is in ZERO governedAction cohorts', () => {
    expect(audit.readOnlyGoverned).toEqual([]);
    for (const id of readOnly) expect(cohortsContaining(id, GOVERNED_ACTION_COHORTS)).toHaveLength(0);
  });

  it('INVARIANT 4 — every id in a governedAction cohort is a registered ALL_M365_ACTIONS action', () => {
    expect(audit.unknownCohortIds).toEqual([]);
  });

  it('INVARIANT 5 — no action appears in more than one governedAction cohort', () => {
    // Independent of invariant 1: check overlap directly across the raw cohort sets.
    const seen = new Map<string, string[]>();
    for (const c of GOVERNED_ACTION_COHORTS) {
      for (const id of c.set) seen.set(id, [...(seen.get(id) ?? []), c.label]);
    }
    const overlaps = [...seen.entries()].filter(([, labels]) => labels.length > 1);
    expect(overlaps).toEqual([]);
  });

  it('INVARIANT 6 — complete accounting: {mutating} === {mail.send} ∪ {all cohort members}, set-equality', () => {
    const cohortMembers = new Set<string>();
    for (const c of GOVERNED_ACTION_COHORTS) for (const id of c.set) cohortMembers.add(id);
    const governedUniverse = new Set<string>([GOVERNED_SEND_ID, ...cohortMembers]);
    const mutatingSet = new Set(mutating);
    // Authoritative assertion: derived set-equality (NOT a hardcoded count).
    expect([...mutatingSet].sort()).toEqual([...governedUniverse].sort());
    // Secondary diagnostics only (document current inventory; a drift forces a conscious update).
    expect(mutating.length).toBe(29);
    expect(cohortMembers.size).toBe(28);
    expect(readOnly.length).toBe(5);
    expect(audit.ungovernedMutating.length).toBe(0);
  });
});

describe('M365 governance coverage — the invariant CATCHES each future-regression scenario', () => {
  // Synthetic fixtures exercise the pure audit; production data is never mutated.
  const base: RegistryAction[] = [
    { id: 'mail.send', mutates: true },
    { id: 'x.write', mutates: true },
    { id: 'x.read', mutates: false },
  ];
  const cohortsOf = (...pairs: Array<[string, string[]]>): LabelledCohort[] =>
    pairs.map(([label, ids]) => ({ label, set: new Set(ids) }));

  it('A — a NEW mutating action with no cohort is flagged as ungoverned (would hit the fallback)', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', []]), 'mail.send');
    expect(r.ungovernedMutating).toContain('x.write');
  });

  it('B — an UNKNOWN cohort id (not in the registry) is flagged', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', ['x.write', 'ghost.action']]), 'mail.send');
    expect(r.unknownCohortIds.map((u) => u.id)).toContain('ghost.action');
  });

  it('C — an action in TWO cohorts is flagged with both cohort labels', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', ['x.write']], ['Cohort-2A', ['x.write']]), 'mail.send');
    const multi = r.multiCohort.find((m) => m.id === 'x.write');
    expect(multi?.cohorts.sort()).toEqual(['Cohort-1', 'Cohort-2A']);
  });

  it('D — a read-only (mutates:false) action placed in a cohort is flagged', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', ['x.write', 'x.read']]), 'mail.send');
    expect(r.readOnlyGoverned.map((v) => v.id)).toContain('x.read');
  });

  it('E — mail.send accidentally added to a governedAction cohort is flagged', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', ['x.write', 'mail.send']]), 'mail.send');
    expect(r.sendInCohort).toContain('Cohort-1');
  });

  it('a fully-correct synthetic registry produces zero violations (audit is not vacuous)', () => {
    const r = auditCoverage(base, cohortsOf(['Cohort-1', ['x.write']]), 'mail.send');
    expect(r.ungovernedMutating).toEqual([]);
    expect(r.multiCohort).toEqual([]);
    expect(r.readOnlyGoverned).toEqual([]);
    expect(r.sendInCohort).toEqual([]);
    expect(r.unknownCohortIds).toEqual([]);
    expect(r.sendNotMutating).toBe(false);
  });
});
