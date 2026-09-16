/**
 * P13C Phase I-A.3 (Step 2) — negative + positive controls for Boundary-A claim minting.
 *
 * Proves: only an approved consequential proposal with authoritative actor + tenant mints;
 * reject/advisory/null-actor/null-tenant/incomplete/non-canonical fail CLOSED; the minted
 * claim binds only the authoritative sources (renderer cannot influence actor or time);
 * and any change to a governed binding component changes the claim digest.
 */
import { describe, it, expect } from 'vitest';
import type { JobProposal } from '@neuropause/shared';
import { mintClaimForApprovedProposal, type MintContext } from './boundDecisionClaimMint';
import { verifyBoundDecisionClaim, type EffectBinding } from './boundDecisionClaim';

const NOW = 5_000_000;
const TTL = 15 * 60_000;

function proposal(over: Partial<JobProposal> = {}): JobProposal {
  return {
    id: 'prop-1',
    title: 't',
    summary: 's',
    sideEffects: true,
    risk: 'medium',
    evidence: [],
    payload: {},
    verdict: {
      requestId: 'req-1',
      workerId: 'worker:ops',
      skillId: 'exec',
      decision: 'require_approval',
      reasons: [],
      checks: [],
      evaluations: [],
      trustScore: 0.5,
      risk: 'medium',
      decidedAt: '2026-01-01T00:00:00.000Z',
    },
    approval: { decision: 'approved', decidedBy: 'user-abc-123', decidedAt: '2026-01-01T00:00:00.000Z', note: null },
    execution: { executor: 'm365', target: 'm365', accountId: 'acct-1', actionId: 'mail.send', params: { to: ['a@x.com'], subject: 'Hi', body: 'yo' } },
    ...over,
  } as JobProposal;
}

function ctx(over: Partial<MintContext> = {}): MintContext {
  return { proposal: proposal(), actor: 'user-abc-123', tenantId: 'org-test', nowMs: NOW, ttlMs: TTL, nonce: 'nonce-1', ...over };
}

/** The binding the mint is expected to produce, for cross-checking the digest via verify(). */
function expectedBinding(over: Partial<EffectBinding> = {}): EffectBinding {
  return {
    executor: 'm365',
    target: 'm365',
    accountId: 'acct-1',
    actionId: 'mail.send',
    params: { to: ['a@x.com'], subject: 'Hi', body: 'yo' },
    actor: 'user-abc-123',
    tenantId: 'org-test',
    decisionId: 'req-1',
    ...over,
  };
}

describe('Boundary-A mint — positive', () => {
  it('approved + valid binding ⇒ claim minted, bound to the exact effect and authoritative context', () => {
    const r = mintClaimForApprovedProposal(ctx());
    expect(r.minted).toBe(true);
    if (!r.minted) return;
    expect(r.claim.decisionId).toBe('req-1'); // verdict.requestId — no new identity
    expect(r.claim.issuedAt).toBe(NOW); // authoritative runtime clock (renderer cannot set)
    expect(r.claim.expiresAt).toBe(NOW + TTL);
    // The minted claim verifies against the exact expected binding at issuance time.
    expect(verifyBoundDecisionClaim(r.claim, expectedBinding(), NOW)).toEqual({ ok: true });
  });

  it('the claim binds the AUTHORITATIVE actor/tenant, not the proposal payload', () => {
    // A different context actor/tenant changes the binding — the proposal cannot supply them.
    const r = mintClaimForApprovedProposal(ctx({ actor: 'user-OTHER', tenantId: 'org-OTHER' }));
    expect(r.minted).toBe(true);
    if (!r.minted) return;
    expect(verifyBoundDecisionClaim(r.claim, expectedBinding({ actor: 'user-OTHER', tenantId: 'org-OTHER' }), NOW)).toEqual({ ok: true });
    // ...and NOT against the default actor/tenant.
    expect(verifyBoundDecisionClaim(r.claim, expectedBinding(), NOW)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('changing any governed binding field changes the claim (verify fails)', () => {
    const r = mintClaimForApprovedProposal(ctx());
    expect(r.minted).toBe(true);
    if (!r.minted) return;
    for (const delta of [
      { executor: 'infra' },
      { target: 'other' },
      { accountId: 'acct-2' },
      { actionId: 'mail.delete' },
      { params: { to: ['b@x.com'], subject: 'Hi', body: 'yo' } },
      { actor: 'user-zzz' },
      { tenantId: 'org-zzz' },
      { decisionId: 'req-2' },
    ]) {
      const reason = 'decisionId' in delta ? 'DECISION_MISMATCH' : 'BINDING_MISMATCH';
      expect(verifyBoundDecisionClaim(r.claim, expectedBinding(delta), NOW)).toEqual({ ok: false, reason });
    }
  });
});

describe('Boundary-A mint — negative (fail closed)', () => {
  it('rejected proposal ⇒ no claim (NOT_APPROVED)', () => {
    const rejected = proposal({ approval: { decision: 'rejected', decidedBy: 'user-abc-123', decidedAt: 'x', note: null } });
    expect(mintClaimForApprovedProposal(ctx({ proposal: rejected }))).toEqual({ minted: false, reason: 'NOT_APPROVED' });
  });

  it('undecided proposal (approval null) ⇒ no claim (NOT_APPROVED)', () => {
    expect(mintClaimForApprovedProposal(ctx({ proposal: proposal({ approval: null }) }))).toEqual({ minted: false, reason: 'NOT_APPROVED' });
  });

  it('advisory proposal (no execution binding) ⇒ no claim (NO_EXECUTION_BINDING)', () => {
    expect(mintClaimForApprovedProposal(ctx({ proposal: proposal({ execution: undefined }) }))).toEqual({ minted: false, reason: 'NO_EXECUTION_BINDING' });
  });

  it('incomplete binding (missing actionId/accountId/params) ⇒ no claim (INCOMPLETE_BINDING)', () => {
    for (const exec of [
      { executor: 'm365', target: 'm365', accountId: 'a', params: {} }, // no actionId
      { executor: 'm365', target: 'm365', actionId: 'mail.send', params: {} }, // no accountId
      { executor: 'm365', target: 'm365', accountId: 'a', actionId: 'mail.send' }, // no params
    ]) {
      expect(mintClaimForApprovedProposal(ctx({ proposal: proposal({ execution: exec as JobProposal['execution'] }) }))).toEqual({ minted: false, reason: 'INCOMPLETE_BINDING' });
    }
  });

  it('null/empty actor ⇒ no claim (NO_ACTOR) — no fallback identity', () => {
    expect(mintClaimForApprovedProposal(ctx({ actor: null }))).toEqual({ minted: false, reason: 'NO_ACTOR' });
    expect(mintClaimForApprovedProposal(ctx({ actor: '   ' }))).toEqual({ minted: false, reason: 'NO_ACTOR' });
  });

  it('null/empty tenant ⇒ no claim (NO_TENANT)', () => {
    expect(mintClaimForApprovedProposal(ctx({ tenantId: null }))).toEqual({ minted: false, reason: 'NO_TENANT' });
    expect(mintClaimForApprovedProposal(ctx({ tenantId: '' }))).toEqual({ minted: false, reason: 'NO_TENANT' });
  });

  it('non-canonicalizable params ⇒ no claim (NON_CANONICAL_PARAMS)', () => {
    const bad = proposal({ execution: { executor: 'm365', target: 'm365', accountId: 'a', actionId: 'mail.send', params: { when: new Date(0) as unknown as string } } });
    expect(mintClaimForApprovedProposal(ctx({ proposal: bad }))).toEqual({ minted: false, reason: 'NON_CANONICAL_PARAMS' });
  });
});
