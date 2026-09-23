import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/* ==========================================================================================
 * OPTION_B — EXTERNAL CRYPTOGRAPHIC ROOT. The canonical form and its verification.
 *
 * NORMATIVE TEXT (recovered byte-identical from sealed NP-PILOT-FIRST-022
 * `13-authority-root-design-space.md`; NOT reconstructed from memory):
 *
 *   B — external cryptographic root
 *   - Smallest change: add `signature` and `signer_key_id` columns to
 *     `pilot_authority_decisions`, a pilot trust file scoped away from `production-release`,
 *     and verify in `loadAuthorityDecisions` BEFORE the snapshot is built.
 *
 * This module is the verification half. It holds no private key and cannot sign: signing is a
 * human key ceremony (see tools/np036-key-ceremony.mjs), which is what makes the root
 * EXTERNAL. A module that could both sign and verify would let the machine manufacture the
 * authority it is required to obey.
 * ========================================================================================== */

/** Bump only with a migration; the version is INSIDE the signed bytes, so v1 and v2 of the
 *  same field values produce different signatures and cannot be swapped for one another. */
export const CANONICAL_VERSION = 'np-pilot-authority-v1';

/**
 * Fields bound by the signature. This list is the security boundary: anything absent from it
 * is NOT protected, and §11 of NP-036 requires that to be stated rather than assumed.
 */
export const SIGNED_FIELDS = [
  'instrument',
  'authenticated',
  'actions',
  'environment_class',
  'effective_from',
  'expires_at',
  'revoked_at',
] as const;

export interface SignableAuthorityRow {
  readonly instrument: string;
  readonly authenticated: boolean;
  readonly actions: readonly string[];
  readonly environment_class: string;
  readonly effective_from: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
}

/**
 * LENGTH-PREFIXED, NOT DELIMITER-JOINED, AND THAT IS A SECURITY PROPERTY.
 *
 * A delimiter-joined form is forgeable by moving the delimiter: with `a|b` joining, an
 * instrument literally named `X|true` and an instrument `X` with authenticated=true produce
 * the same bytes, so one signature verifies both. Every element here is emitted as
 * `<byte-length>:<bytes>`, so no value can impersonate a field boundary.
 *
 * NULL IS ENCODED DISTINCTLY FROM EMPTY, which is what defeats the §12 field-deletion attack:
 * a removed `expires_at` (`~`) and an `expires_at` of `''` (`0:`) are different bytes, so
 * deleting a field cannot silently produce a document that a signature over the fuller
 * document still accepts.
 */
export const canonicalBytes = (row: SignableAuthorityRow): Buffer => {
  const part = (s: string | null): string => (s === null ? '~' : `${Buffer.byteLength(s, 'utf8')}:${s}`);
  const segments = [
    part(CANONICAL_VERSION),
    part(row.instrument),
    part(row.authenticated ? 'true' : 'false'),
    // The array is itself length-prefixed by element COUNT before its elements, so
    // ['a','b'] and ['a|b'] cannot collide either.
    part(String(row.actions.length)),
    ...row.actions.map((a) => part(a)),
    part(row.environment_class),
    part(row.effective_from),
    part(row.expires_at),
    part(row.revoked_at),
  ];
  return Buffer.from(segments.join(''), 'utf8');
};

/** Key id = sha256 of the SPKI DER, hex. The same derivation the release-side trust root uses. */
export const keyIdFor = (publicKeyPem: string): string =>
  createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex');

export type VerifyFailure =
  | 'SIGNATURE_ABSENT'
  | 'SIGNER_KEY_ID_ABSENT'
  | 'SIGNER_KEY_NOT_TRUSTED'
  | 'SIGNER_KEY_ID_MISMATCH'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_INVALID';

export interface TrustedKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly algorithm: string;
}

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * FAIL CLOSED AT EVERY EXIT. There is no path through this function that returns ok:true
 * without a cryptographic verification having succeeded against a key the trust file names.
 */
export function verifyAuthorityRow(
  row: SignableAuthorityRow,
  signature: string | null,
  signerKeyId: string | null,
  trust: ReadonlyMap<string, TrustedKey>,
): VerifyResult {
  if (!signature) return { ok: false, reason: 'SIGNATURE_ABSENT' };
  if (!signerKeyId) return { ok: false, reason: 'SIGNER_KEY_ID_ABSENT' };

  const key = trust.get(signerKeyId);
  if (!key) return { ok: false, reason: 'SIGNER_KEY_NOT_TRUSTED' };

  /*
   * THE KEY ID IS RE-DERIVED FROM THE KEY MATERIAL, NOT TAKEN ON TRUST.
   * Without this, a trust file whose `keyId` label disagrees with its `publicKeyPem` would
   * let a row name one key and be verified by another. The label is a lookup handle; the
   * binding must come from the bytes.
   */
  let derived: string;
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
    derived = keyIdFor(key.publicKeyPem);
  } catch {
    return { ok: false, reason: 'SIGNER_KEY_NOT_TRUSTED' };
  }
  if (derived !== signerKeyId) return { ok: false, reason: 'SIGNER_KEY_ID_MISMATCH' };

  let sig: Buffer;
  try {
    sig = Buffer.from(signature, 'base64');
    // Buffer.from is permissive: it silently drops invalid base64 rather than throwing, so a
    // length check is the only thing that rejects a malformed value. Ed25519 is always 64 bytes.
    if (sig.length !== 64) return { ok: false, reason: 'SIGNATURE_MALFORMED' };
  } catch {
    return { ok: false, reason: 'SIGNATURE_MALFORMED' };
  }

  try {
    return cryptoVerify(null, canonicalBytes(row), publicKey, sig)
      ? { ok: true }
      : { ok: false, reason: 'SIGNATURE_INVALID' };
  } catch {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
}
