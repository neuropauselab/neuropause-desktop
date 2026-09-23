/**
 * NP-PILOT-FIRST-015 — THE SECOND FORGE PATH, previously unrecorded.
 *
 * TEST CLASS: REAL signing and REAL verification (src/auth/jwt.ts), IN_MEMORY, no stub, no DB.
 *
 * Every seam from NP-011 to NP-014 measured the forge path that ends in `pilot_role_bindings`,
 * and NP-015 measured which SQL identities can write it. ALL OF THAT PROTECTS THE AUTHORITY
 * ROWS. None of it protects WHO THE ACTOR IS.
 *
 * `signAccessToken` uses HS256 - a SYMMETRIC algorithm - over `JWT_ACCESS_SECRET`
 * (src/auth/jwt.ts:65-66), and `verifyAccessToken` checks the same shared secret (:75-76). So
 * the holder of that one string can mint a token bearing ANY `sub`, and `sub` is the whole
 * identity chain:
 *
 *     sub -> req.userId (requireAuth.ts:65) -> DecisionContext.actorId -> subject_id lookup
 *
 * CONSEQUENCE FOR THE TRUST MODEL: none of the options O1-O5 closes this, INCLUDING the
 * projection model. They make the authority ROW unforgeable; an attacker who can become the
 * validly appointed, identity-verified subject does not need to forge a row - the genuine row
 * already names them. The evaluator then answers correctly about the wrong person.
 *
 * THIS TEST ASSERTS THAT A HOLE IS OPEN and is written to FAIL the day the access token is
 * bound to an asymmetric key, an audience-scoped key, or proof of possession. That failure is
 * the signal to update this file.
 */
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../auth/jwt';

// The subject a validly appointed First-Pilot Human Decision Authority would carry.
const BOUND_SUBJECT = 'cccccccc-0000-4000-8000-000000000001';

describe('the identity layer: a shared symmetric secret mints any actorId', () => {
  it('POSITIVE CONTROL: an honestly issued token verifies and carries its own subject', () => {
    const { token } = signAccessToken({ sub: BOUND_SUBJECT, email: 'holder@np015.invalid' });
    expect(verifyAccessToken(token).sub).toBe(BOUND_SUBJECT);
  });

  it('a token minted for an ARBITRARY subject verifies exactly as well', () => {
    // No database, no authority row, no appointment - just the secret.
    const forged = signAccessToken({ sub: BOUND_SUBJECT, email: 'not-the-holder@np015.invalid' });
    const claims = verifyAccessToken(forged.token);
    expect(claims.sub).toBe(BOUND_SUBJECT);       // <-- becomes req.userId, then actorId
    expect(claims.email).toBe('not-the-holder@np015.invalid');
  });

  it('nothing in the token binds it to the person: email and subject are independent', () => {
    // The evaluator reads actorId only. An attacker chooses both fields freely, so a token
    // that names the bound subject is indistinguishable from one the holder requested.
    const a = signAccessToken({ sub: BOUND_SUBJECT, email: 'a@np015.invalid' });
    const b = signAccessToken({ sub: BOUND_SUBJECT, email: 'b@np015.invalid' });
    expect(verifyAccessToken(a.token).sub).toBe(verifyAccessToken(b.token).sub);
  });

  it('the algorithm is symmetric, so verification cannot distinguish issuer from holder', () => {
    const { token } = signAccessToken({ sub: BOUND_SUBJECT, email: 'x@np015.invalid' });
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    // An asymmetric algorithm would let a verifier hold only a PUBLIC key, so possession of
    // the verification material would not confer the power to mint. That is the property
    // this system does not have.
    expect(['RS256', 'ES256', 'EdDSA']).not.toContain(header.alg);
  });
});
