import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalBytes, keyIdFor, verifyAuthorityRow, SIGNED_FIELDS, CANONICAL_VERSION,
  type SignableAuthorityRow, type TrustedKey,
} from './authoritySignature';
import { parsePilotTrust, PILOT_TRUST_SCOPE } from './authorityTrust';

/* ==========================================================================================
 * NP-036 §11 — THE SIGNATURE MUST BIND EVERY SECURITY-RELEVANT AUTHORITY FIELD.
 *
 * §11 is explicit that a modified authority-bearing field which still verifies is a
 * SIGNATURE_BINDING_FAILURE and a stop condition. So every signed field is mutated here and
 * each mutation must DENY. A test that only checks the happy path would pass against a
 * signature over a constant.
 * ========================================================================================== */

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEY_ID = keyIdFor(PUB);
const TRUST = new Map<string, TrustedKey>([[KEY_ID, { keyId: KEY_ID, publicKeyPem: PUB, algorithm: 'ed25519' }]]);

const ROW: SignableAuthorityRow = {
  instrument: 'NP-PILOT-FIRST-EXEC-AUTH-001',
  authenticated: true,
  actions: ['pilot.stop', 'pilot.resume'],
  environment_class: 'PILOT',
  effective_from: '2026-09-01T00:00:00.000Z',
  expires_at: '2026-12-01T00:00:00.000Z',
  revoked_at: null,
};
const signRow = (r: SignableAuthorityRow, key = privateKey): string =>
  cryptoSign(null, canonicalBytes(r), key).toString('base64');
const SIG = signRow(ROW);

describe('T01 — a legitimately signed authority row verifies', () => {
  it('accepts', () => {
    expect(verifyAuthorityRow(ROW, SIG, KEY_ID, TRUST)).toEqual({ ok: true });
  });
});

describe('§11 / T07-T13 — every signed field, mutated, must DENY', () => {
  // Each entry mutates exactly one field away from ROW while reusing ROW's signature.
  const mutations: [string, SignableAuthorityRow][] = [
    ['instrument',        { ...ROW, instrument: 'NP-PILOT-FIRST-EXEC-AUTH-002' }],
    ['authenticated',     { ...ROW, authenticated: false }],
    ['actions (added)',   { ...ROW, actions: ['pilot.stop', 'pilot.resume', 'pilot.cap.set'] }],
    ['actions (removed)', { ...ROW, actions: ['pilot.stop'] }],
    ['actions (reorder)', { ...ROW, actions: ['pilot.resume', 'pilot.stop'] }],
    ['environment_class', { ...ROW, environment_class: 'PRODUCTION' }],
    ['effective_from',    { ...ROW, effective_from: '2020-01-01T00:00:00.000Z' }],
    ['expires_at',        { ...ROW, expires_at: '2099-01-01T00:00:00.000Z' }],
    ['revoked_at',        { ...ROW, revoked_at: '2026-09-02T00:00:00.000Z' }],
  ];
  it.each(mutations)('mutating %s is refused', (_label, mutated) => {
    expect(verifyAuthorityRow(mutated, SIG, KEY_ID, TRUST)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('the mutation set covers every field the module declares signed', () => {
    // Guards against a field being added to SIGNED_FIELDS without a mutation test.
    const covered = new Set(mutations.map(([l]) => l.split(' ')[0]));
    for (const f of SIGNED_FIELDS) expect(covered).toContain(f);
  });
});

describe('§12 — DELETING a field must not produce an admissible document', () => {
  it('null and empty-string are DISTINCT canonical encodings', () => {
    const asNull = canonicalBytes({ ...ROW, expires_at: null });
    const asEmpty = canonicalBytes({ ...ROW, expires_at: '' });
    expect(asNull.equals(asEmpty)).toBe(false);
  });
  it('T14 — dropping expires_at from a signed row is refused', () => {
    expect(verifyAuthorityRow({ ...ROW, expires_at: null }, SIG, KEY_ID, TRUST).ok).toBe(false);
  });
  it('dropping two fields is refused', () => {
    expect(verifyAuthorityRow({ ...ROW, expires_at: null, revoked_at: null }, SIG, KEY_ID, TRUST).ok).toBe(false);
  });
  it('dropping three fields is refused', () => {
    const three = { ...ROW, expires_at: null, revoked_at: null, actions: [] };
    expect(verifyAuthorityRow(three, SIG, KEY_ID, TRUST).ok).toBe(false);
  });
});

describe('canonical form is not delimiter-forgeable', () => {
  it('a value containing a field separator cannot impersonate a boundary', () => {
    // With a naive `join('|')` these two collide. Length-prefixing separates them.
    const a = canonicalBytes({ ...ROW, instrument: 'X', actions: ['true'] });
    const b = canonicalBytes({ ...ROW, instrument: 'X|true', actions: [] });
    expect(a.equals(b)).toBe(false);
  });
  it('the version is inside the signed bytes', () => {
    expect(canonicalBytes(ROW).toString('utf8')).toContain(CANONICAL_VERSION);
  });
});

describe('T28-T30 — signature, key id and root failures', () => {
  it('T28 signature mismatch (signed by a different key)', () => {
    const other = generateKeyPairSync('ed25519');
    expect(verifyAuthorityRow(ROW, signRow(ROW, other.privateKey), KEY_ID, TRUST))
      .toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });
  it('T29 wrong key id — names a key the trust file does not hold', () => {
    expect(verifyAuthorityRow(ROW, SIG, 'f'.repeat(64), TRUST))
      .toEqual({ ok: false, reason: 'SIGNER_KEY_NOT_TRUSTED' });
  });
  it('T30 wrong root — trust file holds a different key entirely', () => {
    const other = generateKeyPairSync('ed25519');
    const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const otherId = keyIdFor(otherPem);
    const t = new Map([[otherId, { keyId: otherId, publicKeyPem: otherPem, algorithm: 'ed25519' }]]);
    expect(verifyAuthorityRow(ROW, SIG, otherId, t)).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' });
  });
  it('a trust entry whose label disagrees with its key material is refused', () => {
    const other = generateKeyPairSync('ed25519');
    const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    // KEY_ID label, but somebody else's key bytes.
    const t = new Map([[KEY_ID, { keyId: KEY_ID, publicKeyPem: otherPem, algorithm: 'ed25519' }]]);
    expect(verifyAuthorityRow(ROW, SIG, KEY_ID, t)).toEqual({ ok: false, reason: 'SIGNER_KEY_ID_MISMATCH' });
  });
});

describe('T06 / T32 — absent and malformed inputs fail closed', () => {
  it('unsigned row', () => {
    expect(verifyAuthorityRow(ROW, null, KEY_ID, TRUST)).toEqual({ ok: false, reason: 'SIGNATURE_ABSENT' });
  });
  it('no signer key id', () => {
    expect(verifyAuthorityRow(ROW, SIG, null, TRUST)).toEqual({ ok: false, reason: 'SIGNER_KEY_ID_ABSENT' });
  });
  it('empty signature string', () => {
    expect(verifyAuthorityRow(ROW, '', KEY_ID, TRUST)).toEqual({ ok: false, reason: 'SIGNATURE_ABSENT' });
  });
  it('malformed base64 is rejected on length, not silently truncated', () => {
    expect(verifyAuthorityRow(ROW, 'not-base64!!', KEY_ID, TRUST))
      .toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
  });
  it('a short but valid-base64 signature is rejected', () => {
    expect(verifyAuthorityRow(ROW, Buffer.from('short').toString('base64'), KEY_ID, TRUST))
      .toEqual({ ok: false, reason: 'SIGNATURE_MALFORMED' });
  });
  it('an EMPTY trust map admits nothing — the no-ceremony posture', () => {
    expect(verifyAuthorityRow(ROW, SIG, KEY_ID, new Map()))
      .toEqual({ ok: false, reason: 'SIGNER_KEY_NOT_TRUSTED' });
  });
});

/* ========================================================================================== */

describe('§15 — trust scope: absence must not mean ALL', () => {
  const entry = (extra: Record<string, unknown>) =>
    JSON.stringify({ keys: [{ key_id: KEY_ID, algorithm: 'ed25519', public_key_pem: PUB, ...extra }] });

  it('a correctly scoped pilot key is admitted (positive control)', () => {
    const r = parsePilotTrust(entry({ scope: PILOT_TRUST_SCOPE }));
    expect(r.keys.size).toBe(1);
    expect(r.rejected).toEqual([]);
  });
  it('a key with NO scope is refused', () => {
    const r = parsePilotTrust(entry({}));
    expect(r.keys.size).toBe(0);
    expect(r.rejected[0].reason).toBe('KEY_SCOPE_ABSENT');
  });
  it('a production-release key is refused BY NAME', () => {
    const r = parsePilotTrust(entry({ scope: 'production-release' }));
    expect(r.rejected[0].reason).toBe('KEY_SCOPE_FORBIDDEN');
  });
  it('an unrecognised scope is refused — allow-list, not deny-list', () => {
    const r = parsePilotTrust(entry({ scope: 'some-future-programme' }));
    expect(r.rejected[0].reason).toBe('KEY_SCOPE_NOT_PILOT');
  });
  it('a key whose id does not match its material is refused', () => {
    const r = parsePilotTrust(JSON.stringify({
      keys: [{ key_id: 'a'.repeat(64), algorithm: 'ed25519', scope: PILOT_TRUST_SCOPE, public_key_pem: PUB }],
    }));
    expect(r.rejected[0].reason).toBe('KEY_ID_MISMATCH');
  });
  it('a non-ed25519 algorithm is refused', () => {
    const r = parsePilotTrust(entry({ scope: PILOT_TRUST_SCOPE, algorithm: 'none' }));
    expect(r.rejected[0].reason).toBe('KEY_ALGORITHM_UNSUPPORTED');
  });
  it('a malformed or empty trust file yields no keys', () => {
    expect(parsePilotTrust('{').fileFailure).toBe('TRUST_FILE_MALFORMED');
    expect(parsePilotTrust('{"keys":[]}').fileFailure).toBe('TRUST_FILE_EMPTY');
  });
});
