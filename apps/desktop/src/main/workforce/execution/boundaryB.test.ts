/**
 * P13C I-A.3 Step 4 — Boundary B pure verification controls.
 *
 * Proves the semantic gate: a governed consequential request is ACCEPTED only when the
 * transported claim independently verifies against the ACTUAL binding + authoritative
 * actor/tenant + temporal validity, and DENIED (with a precise reason) on every mismatch. The
 * digest is recomputed by the committed primitive — `claim.bindingDigest` is never trusted alone.
 */
import { describe, expect, it } from 'vitest';
import type { ExecutionBinding, ExecutionRequest } from '@neuropause/shared';
import { mintBoundDecisionClaim, type EffectBinding } from '../../cst/boundDecisionClaim';
import { verifyBoundaryB } from './boundaryB';

const ACTOR = 'user-approver-1';
const TENANT = 'org-authoritative';
const DECISION = 'req-decision-42';
const ISSUED = 1_000_000;
const TTL = 60_000; // expiresAt = 1_060_000
const NOW_OK = ISSUED + 5_000;

const APPROVED_BINDING: ExecutionBinding = {
  executor: 'm365',
  target: 'connector-1',
  accountId: 'acct-1',
  actionId: 'mail.send',
  params: { to: 'x@y.z', subject: 'hi' },
};

/** The exact eight-field binding the claim is minted over (matches APPROVED_BINDING + context). */
function effect(over: Partial<EffectBinding> = {}): EffectBinding {
  return {
    executor: 'm365',
    target: 'connector-1',
    accountId: 'acct-1',
    actionId: 'mail.send',
    params: { to: 'x@y.z', subject: 'hi' },
    actor: ACTOR,
    tenantId: TENANT,
    decisionId: DECISION,
    ...over,
  };
}

const claimFor = (b: EffectBinding = effect()) => mintBoundDecisionClaim({ binding: b, nonce: 'n1', issuedAt: ISSUED, ttlMs: TTL });

/** A well-formed governed request whose claim matches the binding + authoritative context. */
function req(over: { params?: Record<string, unknown> } = {}): ExecutionRequest {
  return {
    kind: 'connector',
    confirmed: true,
    params: { binding: APPROVED_BINDING, actor: ACTOR, tenantId: TENANT, claim: claimFor(), jobId: 'j', proposalId: 'p', ...over.params },
  } as ExecutionRequest;
}

describe('verifyBoundaryB — valid path', () => {
  it('18. a valid claim over the exact binding + authoritative actor/tenant, unexpired → ALLOW', () => {
    const v = verifyBoundaryB(req(), NOW_OK);
    expect(v).toEqual({ ok: true, decisionId: DECISION });
  });
});

describe('verifyBoundaryB — presence controls', () => {
  it('1. no claim → MISSING_CLAIM', () => {
    const r = { kind: 'connector', params: { binding: APPROVED_BINDING, actor: ACTOR, tenantId: TENANT } } as ExecutionRequest;
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'MISSING_CLAIM' });
  });

  it('missing actor → MISSING_ACTOR', () => {
    expect(verifyBoundaryB(req({ params: { actor: undefined } }), NOW_OK)).toEqual({ ok: false, reason: 'MISSING_ACTOR' });
  });

  it('empty actor → MISSING_ACTOR (no fallback identity)', () => {
    expect(verifyBoundaryB(req({ params: { actor: '   ' } }), NOW_OK)).toEqual({ ok: false, reason: 'MISSING_ACTOR' });
  });

  it('missing tenant → MISSING_TENANT', () => {
    expect(verifyBoundaryB(req({ params: { tenantId: undefined } }), NOW_OK)).toEqual({ ok: false, reason: 'MISSING_TENANT' });
  });

  it('16. incomplete binding (no accountId) → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { executor: 'm365', target: 'connector-1', actionId: 'mail.send', params: {} } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });
});

describe('verifyBoundaryB — structural / temporal controls', () => {
  it('2. malformed claim (bad digest) → MALFORMED_CLAIM', () => {
    const bad = { ...claimFor(), bindingDigest: 'not-a-64-hex-digest' };
    expect(verifyBoundaryB(req({ params: { claim: bad } }), NOW_OK)).toEqual({ ok: false, reason: 'MALFORMED_CLAIM' });
  });

  it('3. expired claim → EXPIRED', () => {
    expect(verifyBoundaryB(req(), ISSUED + TTL + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});

describe('verifyBoundaryB — exact-binding correspondence (recomputed digest, never trusted)', () => {
  it('5. target mismatch → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { ...APPROVED_BINDING, target: 'connector-EVIL' } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('6. action mismatch → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { ...APPROVED_BINDING, actionId: 'mail.delete' } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('7. account mismatch → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { ...APPROVED_BINDING, accountId: 'acct-OTHER' } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('8. executor mismatch → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { ...APPROVED_BINDING, executor: 'infra' } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('9. params mismatch → BINDING_MISMATCH', () => {
    const r = req({ params: { binding: { ...APPROVED_BINDING, params: { to: 'attacker@evil.z' } } } });
    expect(verifyBoundaryB(r, NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('10. actor mismatch (actor is a digest field) → BINDING_MISMATCH', () => {
    expect(verifyBoundaryB(req({ params: { actor: 'user-IMPOSTER' } }), NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('11. tenant mismatch (tenant is a digest field) → BINDING_MISMATCH', () => {
    expect(verifyBoundaryB(req({ params: { tenantId: 'org-OTHER' } }), NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('12. digest tampering (valid-shape but wrong digest) → BINDING_MISMATCH', () => {
    const tampered = { ...claimFor(), bindingDigest: 'a'.repeat(64) };
    expect(verifyBoundaryB(req({ params: { claim: tampered } }), NOW_OK)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });
});
