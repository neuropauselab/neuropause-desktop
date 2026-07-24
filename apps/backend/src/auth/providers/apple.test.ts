import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { verifyAppleIdToken } from './apple';

// jose v6 no longer exports `KeyLike`; infer the key type from generateKeyPair.
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * TD-1 (GA blocker) regression: the Apple id_token MUST have its signature
 * verified against Apple's JWKS, plus issuer/audience/expiry, before any claim
 * is trusted. These tests inject a LOCAL JWKS (a key we control) so the real
 * verification path runs without contacting Apple. A forged, expired, or
 * mis-scoped token must be rejected.
 */

const ISSUER = 'https://appleid.apple.com';
const CLIENT_ID = 'com.neuropause.service';
const SUB = '001899.f3a1c0deadbeef.1234';

let privateKey: SigningKey;
let jwks: JWTVerifyGetKey;
let attackerKey: SigningKey;

async function makeToken(
  key: SigningKey,
  claims: {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    expiresIn?: string;
    kid?: string;
  } = {},
): Promise<string> {
  const jwt = new SignJWT({
    email: claims.email ?? 'user@example.com',
    email_verified: claims.email_verified ?? 'true',
  })
    .setProtectedHeader({ alg: 'RS256', kid: claims.kid ?? 'apple-test-key' })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? CLIENT_ID)
    .setSubject(claims.sub ?? SUB)
    .setIssuedAt();
  jwt.setExpirationTime(claims.expiresIn ?? '10m');
  return jwt.sign(key);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'apple-test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwks = createLocalJWKSet({ keys: [jwk] });
  // A second, untrusted keypair that is NOT published in the JWKS.
  attackerKey = (await generateKeyPair('RS256')).privateKey;
});

describe('verifyAppleIdToken (TD-1 GA blocker)', () => {
  it('accepts a correctly-signed, correctly-scoped token and returns its claims', async () => {
    const token = await makeToken(privateKey, { email: 'ok@example.com', email_verified: 'true' });
    const id = await verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks });
    expect(id.sub).toBe(SUB);
    expect(id.email).toBe('ok@example.com');
    expect(id.emailVerified).toBe(true);
  });

  it('REJECTS a token signed by a key not in the JWKS (forged signature)', async () => {
    const token = await makeToken(attackerKey);
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks })).rejects.toThrow(
      /verification failed/i,
    );
  });

  it('REJECTS a token with the wrong audience (not our client_id)', async () => {
    const token = await makeToken(privateKey, { aud: 'com.someone.else' });
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks })).rejects.toThrow(
      /verification failed/i,
    );
  });

  it('REJECTS a token with the wrong issuer', async () => {
    const token = await makeToken(privateKey, { iss: 'https://evil.example.com' });
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks })).rejects.toThrow(
      /verification failed/i,
    );
  });

  it('REJECTS an expired token', async () => {
    const token = await makeToken(privateKey, { expiresIn: '-5m' });
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks })).rejects.toThrow(
      /verification failed/i,
    );
  });

  it('REJECTS a token with no subject', async () => {
    // Build a token without a subject claim.
    const jwk = new SignJWT({ email: 'x@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt();
    jwk.setExpirationTime('10m');
    const token = await jwk.sign(privateKey);
    await expect(verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks })).rejects.toThrow(
      /missing subject/i,
    );
  });

  it('reports email_verified=false honestly', async () => {
    const token = await makeToken(privateKey, { email_verified: 'false' });
    const id = await verifyAppleIdToken(token, { clientId: CLIENT_ID, keySet: jwks });
    expect(id.emailVerified).toBe(false);
  });

  it('REJECTS a token signed with a non-RS256 algorithm even if its key is published (alg pin)', async () => {
    // Algorithm-confusion guard: publish an ES256 key in the JWKS and sign an
    // ES256 token with it. The key IS resolvable, so only the `algorithms: ['RS256']`
    // pin rejects this token — without the pin jose would accept it.
    const es = await generateKeyPair('ES256');
    const esJwk = await exportJWK(es.publicKey);
    esJwk.kid = 'es-key';
    esJwk.alg = 'ES256';
    esJwk.use = 'sig';
    const esJwks = createLocalJWKSet({ keys: [esJwk] });
    const esToken = await new SignJWT({ email: 'x@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: 'es-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject(SUB)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(es.privateKey);
    await expect(
      verifyAppleIdToken(esToken, { clientId: CLIENT_ID, keySet: esJwks }),
    ).rejects.toThrow(/verification failed/i);
  });
});
