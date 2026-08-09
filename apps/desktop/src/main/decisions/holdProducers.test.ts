/**
 * The seven remaining HOLD shapes.
 *
 * A hold's whole value is what it can tell a person, so these tests assert the
 * CONTENT contract rather than the mechanics: every producer answers what is
 * known, what is not, and what resolves it, using only facts the caller
 * supplied. There is no branch anywhere below that can invent a number, a
 * name, or a cause.
 *
 * The rule the suite exists to defend: **a hold is a control state, not a
 * confirmation dialog.** `dangerous_delete` is the only reason that offers a
 * way through, because only there is the consequence bounded, reversible, and
 * the actor's to accept. You cannot click past a missing permission.
 */
import { describe, expect, it } from 'vitest';
import type { HoldView } from '@neuropause/shared';
import {
  HOLD_REASON_LABELS,
  ambiguousIdentityHold,
  externalUnavailableHold,
  holdFromAssessment,
  insufficientEvidenceHold,
  permissionMissingHold,
  policyConflictHold,
  unresolvedDependencyHold,
  verificationUnavailableHold,
} from '@neuropause/shared';

const ALL: { name: string; hold: HoldView }[] = [
  {
    name: 'permission_missing',
    hold: permissionMissingHold({
      action: 'posting a journal entry',
      permission: 'finance:manage',
      heldPermissions: ['finance:read', 'crm:read'],
      actorLabel: 'Priya',
    }),
  },
  {
    name: 'policy_conflict',
    hold: policyConflictHold({
      action: 'Posting to 2025-03',
      policy: 'the accounting period close',
      facts: ['Period 2025-03 was closed on 2025-04-05.'],
      resolution: 'Post to an open period, or have finance reopen 2025-03.',
    }),
  },
  {
    name: 'insufficient_evidence',
    hold: insufficientEvidenceHold({
      objective: 'estimate the financial impact',
      available: ['12 purchase orders.'],
      missing: ['No supplier prices — impact cannot be computed.'],
      resolution: 'Import supplier price lists, or connect the procurement system.',
    }),
  },
  {
    name: 'unresolved_dependency',
    hold: unresolvedDependencyHold({
      action: 'Posting this receipt',
      dependencies: ['Purchase order PO-4471 is not approved.'],
      resolution: 'Approve PO-4471 first.',
    }),
  },
  {
    name: 'ambiguous_identity',
    hold: ambiguousIdentityHold({
      action: 'importing this payment',
      reference: 'ACME',
      candidates: ['Acme Ltd (cust_1)', 'Acme Holdings (cust_9)'],
    }),
  },
  {
    name: 'external_system_unavailable',
    hold: externalUnavailableHold({
      action: 'the nightly sync',
      systemName: 'Xero',
      observed: 'HTTP 503',
      lastSuccessAt: '2026-08-08T02:00:00Z',
    }),
  },
  {
    name: 'verification_unavailable',
    hold: verificationUnavailableHold({
      action: 'The stock adjustment',
      expected: 'the resulting on-hand quantity',
      because: 'the warehouse system did not respond',
    }),
  },
];

describe('every hold answers the five questions', () => {
  it.each(ALL)('$name', ({ hold }) => {
    expect(hold.why, 'no explanation').toBeTruthy();
    expect(hold.known.length, 'nothing known — the hold teaches nobody anything').toBeGreaterThan(0);
    expect(hold.unknown.length, 'nothing unknown — then why hold?').toBeGreaterThan(0);
    expect(hold.resolution, 'no way out').toBeTruthy();
    expect(HOLD_REASON_LABELS[hold.reason], 'reason has no human label').toBeTruthy();
  });

  it.each(ALL)('$name offers no "proceed anyway"', ({ hold }) => {
    // Only dangerous_delete does, and it is asserted separately below.
    expect(hold.ifProceeding).toBe('');
  });

  it('dangerous_delete is the ONE exception, and states the consequence', () => {
    const hold = holdFromAssessment(
      {
        risk: 'high_risk',
        recommendation: 'Do not delete.',
        evidence: [{ label: 'Linked as "Customer"', detail: '2 invoices resolve to it', count: 2 }],
        alternative: 'Archive instead.',
      },
      'customer "Acme Ltd"',
    );
    // Bounded, reversible, and the actor's to accept — so a route through
    // exists, and it says exactly what breaks.
    expect(hold.ifProceeding).not.toBe('');
    expect(hold.ifProceeding).toContain('stops resolving');
  });
});

describe('nothing is fabricated', () => {
  it('permission_missing distinguishes "wrong scopes" from "no membership"', () => {
    // These need different fixes — grant a scope vs. bind the account — so
    // collapsing them into one message would send someone down the wrong path.
    const withScopes = permissionMissingHold({
      action: 'x',
      permission: 'finance:manage',
      heldPermissions: ['finance:read'],
      actorLabel: 'Priya',
    });
    const withNone = permissionMissingHold({
      action: 'x',
      permission: 'finance:manage',
      heldPermissions: [],
      actorLabel: 'Priya',
    });
    expect(withScopes.known.join(' ')).toContain('1 scope');
    expect(withNone.known.join(' ')).toContain('not bound to an organization member');
    expect(withScopes.resolution).not.toEqual(withNone.resolution);
  });

  it('insufficient_evidence says so plainly when nothing at all is available', () => {
    const hold = insufficientEvidenceHold({
      objective: 'find opportunities',
      available: [],
      missing: ['No business records of any kind.'],
      resolution: 'Import data or connect a system.',
    });
    expect(hold.known[0]).toContain('Nothing relevant is present yet');
  });

  it('ambiguous_identity lists EVERY candidate and refuses to pick', () => {
    const hold = ambiguousIdentityHold({
      action: 'importing this payment',
      reference: 'ACME',
      candidates: ['Acme Ltd', 'Acme Holdings', 'Acme GmbH'],
    });
    expect(hold.known).toHaveLength(3);
    expect(hold.why).toContain('3 records');
    expect(hold.unknown.join(' ')).toContain('will not guess');
  });

  it('unresolved_dependency counts, and agrees with itself on singular/plural', () => {
    expect(unresolvedDependencyHold({ action: 'A', dependencies: ['one'], resolution: 'r' }).why).toContain(
      '1 thing that is',
    );
    expect(
      unresolvedDependencyHold({ action: 'A', dependencies: ['a', 'b'], resolution: 'r' }).why,
    ).toContain('2 things that are');
  });

  it('external_unavailable quotes what was OBSERVED, and admits it cannot diagnose', () => {
    const hold = externalUnavailableHold({
      action: 'the sync',
      systemName: 'Xero',
      observed: 'HTTP 401 invalid_grant',
      lastSuccessAt: null,
    });
    // The raw state matters: 401 and 503 need different actions.
    expect(hold.known[0]).toContain('HTTP 401 invalid_grant');
    expect(hold.known[1]).toContain('no record of a successful contact');
    expect(hold.unknown.join(' ')).toContain('cannot distinguish an outage');
  });

  it('verification_unavailable never claims the action failed', () => {
    const hold = verificationUnavailableHold({
      action: 'The stock adjustment',
      expected: 'on-hand quantity',
      because: 'the warehouse system did not respond',
    });
    // "Unverified" and "failed" are different claims about the world.
    expect(hold.unknown.join(' ')).toContain('Unverified is not the same as failed');
    expect(hold.resolution).toContain('The action itself is unchanged');
  });
});
