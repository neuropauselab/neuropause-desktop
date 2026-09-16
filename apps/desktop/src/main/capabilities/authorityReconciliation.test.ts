/**
 * F-N16-2 — AUTHORITY DETERMINATION (the reconciliation slice's mandated first
 * step, operator ruling 20 Aug 2026).
 *
 * The question: `deriveAuthority` yields `policyVersion: null` for
 * `calendar.create` while `cst/governedAction.ts` governs it under
 * `POLICY_VERSION = 'm365-action-policy-1'`. Is that a genuine semantic
 * conflict, two representations of one state, a missing source, or an
 * architectural divergence?
 *
 * This file is the DISCOVER → COMPARE step, run over the COMPLETE M365 action
 * catalog (never a one-item fixture) with both sides driven from live code.
 * It proposes nothing and changes nothing: it establishes what is true so the
 * classification in the evidence rests on observation rather than reading.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAuthority } from '../liveBrain/executionGate';
import { ALL_M365_ACTIONS } from '../connectors/m365';
import {
  GOVERNED_ACTION_COHORT1,
  GOVERNED_ACTION_COHORT2A,
  GOVERNED_ACTION_COHORT2B_I,
  GOVERNED_ACTION_COHORT2B_II,
} from '../cst/governedAction';

const TARGET = { connector: 'microsoft-entra', account: 'acct-1', tenantId: 'ws-1', scope: 'ws-1' };

/** The two literal values that exist in production, read from their own sources. */
const SEND_POLICY = 'm365-send-policy-1';
const ACTION_POLICY = 'm365-action-policy-1';

/** Which governed route does this action ACTUALLY take today? Read from the real cohort sets. */
function enforcementRoute(actionId: string): 'governedSend' | 'governedAction' | 'none' {
  if (actionId === 'mail.send') return 'governedSend';
  if (
    GOVERNED_ACTION_COHORT1.has(actionId) ||
    GOVERNED_ACTION_COHORT2A.has(actionId) ||
    GOVERNED_ACTION_COHORT2B_I.has(actionId) ||
    GOVERNED_ACTION_COHORT2B_II.has(actionId)
  ) {
    return 'governedAction';
  }
  return 'none';
}

/** The policyVersion that the enforcing path actually carries, by route. */
function enforcedPolicyVersion(actionId: string): string | null {
  const route = enforcementRoute(actionId);
  if (route === 'governedSend') return SEND_POLICY; // connectors/index.ts passes this literal
  if (route === 'governedAction') return ACTION_POLICY; // governedAction's module constant
  return null; // no governed route exists for this action today
}

describe('F-N16-2 · DISCOVER — the two sources, read from live code', () => {
  it('the DERIVED source answers per-capability, and only mail.send has a value', () => {
    const derived = ALL_M365_ACTIONS.map((a) => [a.id, deriveAuthority(a.id, TARGET).policyVersion] as const);
    const named = derived.filter(([, v]) => v !== null);
    expect(named).toEqual([['mail.send', SEND_POLICY]]);
    // …and every other action derives NULL — not a different value, an absence.
    expect(derived.filter(([, v]) => v === null).length).toBe(ALL_M365_ACTIONS.length - 1);
  });

  it('the ENFORCING sources are two literals living in two governed adapters', () => {
    const sendSrc = readFileSync(join(__dirname, '..', 'connectors', 'index.ts'), 'utf8');
    expect(sendSrc).toContain(`policyVersion: '${SEND_POLICY}'`);
    const actionSrc = readFileSync(join(__dirname, '..', 'cst', 'governedAction.ts'), 'utf8');
    expect(actionSrc).toContain(`const POLICY_VERSION = '${ACTION_POLICY}'`);
  });

  it('policyVersion is RECORDED, never compared — the kernel uses it to LABEL evidence, not to decide', () => {
    const kernel = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'node_modules', '@neuropause', 'cst', 'dist', 'src', 'kernel.js'),
      'utf8',
    );
    const uses = kernel.split('\n').filter((l) => l.includes('policyVersion'));
    // Exactly one use, and it is string interpolation into a verification scope label.
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain('scope:');
    expect(uses[0]).toMatch(/\$\{req\.action\}@\$\{req\.policyVersion\}/);
    // No comparison, no denial, no branch anywhere on it.
    expect(kernel).not.toMatch(/req\.policyVersion\s*[!=]==/);
  });
});

describe('F-N16-2 · COMPARE — both sides over the COMPLETE catalog (never a one-item fixture)', () => {
  const rows = ALL_M365_ACTIONS.map((a) => ({
    id: a.id,
    mutates: a.mutates,
    derived: deriveAuthority(a.id, TARGET).policyVersion,
    route: enforcementRoute(a.id),
    enforced: enforcedPolicyVersion(a.id),
  }));

  it('the catalog is the real one, and it is not small', () => {
    expect(rows.length).toBeGreaterThan(30);
  });

  it('mail.send is the ONLY action where derived and enforced AGREE', () => {
    const agree = rows.filter((r) => r.derived !== null && r.derived === r.enforced);
    expect(agree.map((r) => r.id)).toEqual(['mail.send']);
  });

  it('every action with a governed route OTHER than mail.send derives null while being enforced under the action policy', () => {
    const governedButUnnamed = rows.filter((r) => r.route === 'governedAction');
    expect(governedButUnnamed.length).toBeGreaterThan(15); // the real cohorts, not a sample
    for (const r of governedButUnnamed) {
      expect({ id: r.id, derived: r.derived, enforced: r.enforced }).toEqual({
        id: r.id,
        derived: null,
        enforced: ACTION_POLICY,
      });
    }
  });

  it('the disagreement is UNIFORM — never two different NAMED values for one action', () => {
    // The classification hinges on this: there is no action where derived and
    // enforced both name a policy and the names differ. Every disagreement is
    // NULL-vs-named, i.e. an absence on the derived side, not a contradiction.
    const bothNamedAndDifferent = rows.filter(
      (r) => r.derived !== null && r.enforced !== null && r.derived !== r.enforced,
    );
    expect(bothNamedAndDifferent).toEqual([]);
  });

  it('DISTRIBUTION (printed for the evidence — this is the observation, not an assertion of taste)', () => {
    const byRoute = { governedSend: 0, governedAction: 0, none: 0 } as Record<string, number>;
    for (const r of rows) byRoute[r.route] += 1;
    const ungovernedMutating = rows.filter((r) => r.route === 'none' && r.mutates).map((r) => r.id);
    // eslint-disable-next-line no-console
    console.log('CATALOG:', rows.length, 'mutating:', rows.filter((r) => r.mutates).length,
      'routes:', JSON.stringify(byRoute), 'ungoverned-mutating:', JSON.stringify(ungovernedMutating));
    expect(rows.length).toBe(byRoute.governedSend + byRoute.governedAction + byRoute.none);
  });

  it('EVERY mutating action has a governed route — no mutation escapes into an ungoverned path', () => {
    // Measured, not assumed: an earlier draft of this file assumed some mutating
    // actions were ungoverned. They are not. The absence of an ungoverned
    // mutation is a real property of today's catalog and is recorded as such.
    const ungovernedMutating = rows.filter((r) => r.route === 'none' && r.mutates);
    expect(ungovernedMutating.map((r) => r.id)).toEqual([]);
  });

  it('the only actions with NO governed route are READS, and both sides are honestly null for them', () => {
    const unrouted = rows.filter((r) => r.route === 'none');
    for (const r of unrouted) {
      expect(r.mutates).toBe(false);
      expect(r.derived).toBeNull();
      expect(r.enforced).toBeNull();
    }
  });
});
