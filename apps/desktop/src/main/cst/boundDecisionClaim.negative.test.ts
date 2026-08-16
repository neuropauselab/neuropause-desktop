/**
 * P13C Phase I-A.3 (Step 1) — negative + positive controls for the pure Bound Decision
 * Claim primitive and its canonicalization. No wiring, no Boundary-A/B, no persistence.
 *
 * The decisive property: a valid claim becomes INVALID when ANY consequentially relevant
 * binding component changes (executor/target/account/action/params/actor/tenant/
 * policyVersion/decisionId), and is fail-closed on missing/malformed/expired claims.
 */
import { describe, it, expect } from 'vitest';
import { canonicalize, CanonicalizationError } from '../util/canonicalJson';
import {
  computeBindingDigest,
  mintBoundDecisionClaim,
  verifyBoundDecisionClaim,
  type BoundDecisionClaim,
  type EffectBinding,
} from './boundDecisionClaim';

const T0 = 1_000_000;
const TTL = 15 * 60_000;

function binding(over: Partial<EffectBinding> = {}): EffectBinding {
  return {
    executor: 'm365',
    target: 'm365',
    accountId: 'acct-1',
    actionId: 'mail.send',
    params: { to: ['a@example.com'], subject: 'Hi', body: 'yo' },
    actor: 'user-abc-123',
    tenantId: 'org-test',
    decisionId: 'dec-1',
    ...over,
  };
}

function claimFor(b: EffectBinding, over: Partial<BoundDecisionClaim> = {}): BoundDecisionClaim {
  return { ...mintBoundDecisionClaim({ binding: b, nonce: 'nonce-1', issuedAt: T0, ttlMs: TTL }), ...over };
}

describe('canonicalJson — deterministic canonical domain', () => {
  it('object key order is INSIGNIFICANT (a≡b)', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ x: { p: 1, q: 2 }, y: 3 })).toBe(canonicalize({ y: 3, x: { q: 2, p: 1 } }));
  });

  it('a changed value changes the canonical form', () => {
    expect(canonicalize({ a: 1, b: 2 })).not.toBe(canonicalize({ a: 1, b: 3 }));
  });

  it('array order is SIGNIFICANT', () => {
    expect(canonicalize(['A', 'B'])).not.toBe(canonicalize(['B', 'A']));
  });

  it('fails closed on unsupported values (no silent coercion)', () => {
    for (const bad of [undefined, NaN, Infinity, -Infinity, 10n, Symbol('s'), () => 1, new Date(0), new Map(), new Set(), Buffer.from('x'), new Error('e'), /re/, { a: undefined }]) {
      expect(() => canonicalize(bad as unknown)).toThrow(CanonicalizationError);
    }
  });

  it('supports the narrow domain (null/boolean/string/finite number/array/plain object)', () => {
    expect(() => canonicalize({ a: null, b: true, c: 'x', d: 1.5, e: [1, 2], f: { g: 0 } })).not.toThrow();
  });
});

describe('BoundDecisionClaim — positive controls', () => {
  it('exact binding verifies before expiry', () => {
    const b = binding();
    expect(verifyBoundDecisionClaim(claimFor(b), b, T0 + 1000)).toEqual({ ok: true });
  });

  it('reordered params keys produce the identical digest (verifies)', () => {
    const minted = claimFor(binding({ params: { subject: 'Hi', to: ['a@example.com'], body: 'yo' } }));
    const actual = binding({ params: { body: 'yo', to: ['a@example.com'], subject: 'Hi' } });
    expect(verifyBoundDecisionClaim(minted, actual, T0)).toEqual({ ok: true });
  });

  it('valid expiry verifies; boundary is inclusive at expiresAt', () => {
    const b = binding();
    expect(verifyBoundDecisionClaim(claimFor(b), b, T0 + TTL)).toEqual({ ok: true }); // now == expiresAt → not expired
    expect(verifyBoundDecisionClaim(claimFor(b), b, T0 + TTL + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('each governed field participates in the digest (changing it breaks verification)', () => {
    const b = binding();
    const claim = claimFor(b);
    const changed: Array<Partial<EffectBinding>> = [
      { executor: 'infra' },
      { target: 'other' },
      { accountId: 'acct-2' },
      { actionId: 'mail.delete' },
      { params: { to: ['b@example.com'], subject: 'Hi', body: 'yo' } },
      { actor: 'user-zzz' },
      { tenantId: 'org-other' },
    ];
    for (const delta of changed) {
      expect(verifyBoundDecisionClaim(claim, binding(delta), T0)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
    }
  });

  it('I-A3-STEP2-FINDING-1: policyVersion does NOT participate in the v1 digest (excluded, not fabricated)', () => {
    const b = binding();
    const digest = computeBindingDigest(b);
    // An extra policyVersion property on the input object is ignored by the binding view.
    const withPolicy = { ...b, policyVersion: 'm365-send-policy-1' } as unknown as EffectBinding;
    expect(computeBindingDigest(withPolicy)).toBe(digest);
    const withOther = { ...b, policyVersion: 'totally-different-policy-v999' } as unknown as EffectBinding;
    expect(computeBindingDigest(withOther)).toBe(digest);
  });

  it('array ordering in params is significant (recipient order change breaks the binding)', () => {
    const claim = claimFor(binding({ params: { to: ['a@x.com', 'b@x.com'], subject: 'Hi', body: 'yo' } }));
    const reordered = binding({ params: { to: ['b@x.com', 'a@x.com'], subject: 'Hi', body: 'yo' } });
    expect(verifyBoundDecisionClaim(claim, reordered, T0)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });
});

describe('BoundDecisionClaim — negative controls', () => {
  it('missing claim (null/undefined) ⇒ MISSING_CLAIM', () => {
    expect(verifyBoundDecisionClaim(null, binding(), T0)).toEqual({ ok: false, reason: 'MISSING_CLAIM' });
    expect(verifyBoundDecisionClaim(undefined, binding(), T0)).toEqual({ ok: false, reason: 'MISSING_CLAIM' });
  });

  it('malformed claim ⇒ MALFORMED_CLAIM', () => {
    const b = binding();
    const good = claimFor(b);
    for (const bad of [
      { ...good, bindingDigest: 'not-a-digest' },
      { ...good, bindingDigest: 'ABCDEF' },
      { ...good, decisionId: '' },
      { ...good, nonce: '' },
      { ...good, issuedAt: Number.NaN },
      { ...good, expiresAt: Number.POSITIVE_INFINITY },
      { ...good, expiresAt: good.issuedAt - 1 },
    ]) {
      expect(verifyBoundDecisionClaim(bad as BoundDecisionClaim, b, T0)).toEqual({ ok: false, reason: 'MALFORMED_CLAIM' });
    }
  });

  it('expired claim ⇒ EXPIRED', () => {
    const b = binding();
    expect(verifyBoundDecisionClaim(claimFor(b), b, T0 + TTL + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('wrong decisionId ⇒ DECISION_MISMATCH', () => {
    const claim = claimFor(binding({ decisionId: 'dec-1' }));
    expect(verifyBoundDecisionClaim(claim, binding({ decisionId: 'dec-2' }), T0)).toEqual({ ok: false, reason: 'DECISION_MISMATCH' });
  });

  it('tampered bindingDigest ⇒ BINDING_MISMATCH', () => {
    const b = binding();
    const tampered = { ...claimFor(b), bindingDigest: 'f'.repeat(64) };
    expect(verifyBoundDecisionClaim(tampered, b, T0)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('non-canonicalizable actual binding ⇒ BINDING_MISMATCH (fail closed, no throw escaping verify)', () => {
    const claim = claimFor(binding());
    const badActual = binding({ params: { to: ['a@example.com'], subject: undefined as unknown as string, body: 'yo' } });
    expect(verifyBoundDecisionClaim(claim, badActual, T0)).toEqual({ ok: false, reason: 'BINDING_MISMATCH' });
  });

  it('computeBindingDigest throws on a non-canonicalizable binding (caller must supply canonicalizable params)', () => {
    expect(() => computeBindingDigest(binding({ params: { bad: new Date(0) as unknown as string } }))).toThrow(CanonicalizationError);
  });
});
