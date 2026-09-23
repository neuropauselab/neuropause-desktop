import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { keyIdFor, type TrustedKey } from './authoritySignature';

/* ==========================================================================================
 * OPTION_B — "a pilot trust file SCOPED AWAY FROM `production-release`".
 *
 * The scope requirement is the half that is easy to drop and expensive to omit. A trust file
 * with no scope, or a scope that silently means "everything", turns a pilot authority root
 * into a production one the first time somebody reuses the key.
 * ========================================================================================== */

/** The only scope a pilot trust key may carry. Anything else is refused, including absence. */
export const PILOT_TRUST_SCOPE = 'np-pilot-first';

/** Explicitly refused, by name, because OPTION_B names it. */
export const FORBIDDEN_TRUST_SCOPES = ['production-release', 'production', 'release'] as const;

export type TrustLoadFailure =
  | 'TRUST_DIGEST_ABSENT'
  | 'TRUST_DIGEST_MALFORMED'
  | 'TRUST_DIGEST_MISMATCH'
  | 'TRUST_FILE_ABSENT'
  | 'TRUST_FILE_MALFORMED'
  | 'TRUST_FILE_EMPTY'
  | 'KEY_SCOPE_ABSENT'
  | 'KEY_SCOPE_FORBIDDEN'
  | 'KEY_SCOPE_NOT_PILOT'
  | 'KEY_ALGORITHM_UNSUPPORTED'
  | 'KEY_ID_MISMATCH'
  | 'KEY_MATERIAL_INVALID';

export interface TrustLoadResult {
  readonly keys: ReadonlyMap<string, TrustedKey>;
  /** Every key that was REFUSED, with why. Published so an empty trust map is explicable. */
  readonly rejected: readonly { keyId: string; reason: TrustLoadFailure }[];
  readonly fileFailure: TrustLoadFailure | null;
}

const EMPTY: TrustLoadResult = { keys: new Map(), rejected: [], fileFailure: null };

/* ==========================================================================================
 * H13 — OUT-OF-BAND DIGEST TRUST ANCHOR.
 *
 * Selected by human decision (24 Sep 2026) from the five mechanisms sealed in NP-038.
 * Recovered selection, verbatim: "out-of-band digest — whoever supplies the expected digest —
 * splits: file-writer can't forge without the digest-holder — digest re-issued separately".
 *
 * WHAT THIS CLOSES. NP-037 measured, and NP-038 re-measured, that an actor who could write the
 * trust file generated their own key, named it in a syntactically perfect file, signed any
 * authority they liked, and the verifier returned ADMITTED. The file WAS the root, and nothing
 * stood above it. The expected digest now stands above it: the file is only the root if a
 * separately supplied digest says so.
 *
 * WHAT THIS DOES NOT CLOSE, STATED PLAINLY. The digest arrives as configuration. If one party
 * controls BOTH the trust file and the digest channel, the split collapses and this is once
 * again a single-party root. The two-party separation is a DEPLOYMENT property — the digest
 * must reach the process through a channel the file-writer does not control — and no code here
 * can enforce that. Per the human decision, the digest-holder is the issuer (H1) and the
 * file-writer is the administrator (H2); keeping those channels distinct is an operational
 * obligation, recorded as such and not claimed as a technical control.
 * ========================================================================================== */

/** sha256 of the trust file's raw bytes, hex. Never derived from anything but the file itself. */
export const trustFileDigest = (raw: string): string =>
  createHash('sha256').update(raw, 'utf8').digest('hex');

/**
 * Constant-time compare of two hex digests. Not because a timing attack on a public digest is
 * a realistic threat here, but because a plain !== on a secret-adjacent comparison is the kind
 * of detail that gets copied into a context where it does matter.
 */
const digestMatches = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
};

export function parsePilotTrust(raw: string): TrustLoadResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ...EMPTY, fileFailure: 'TRUST_FILE_MALFORMED' };
  }
  const list = (doc as { keys?: unknown })?.keys;
  if (!Array.isArray(list)) return { ...EMPTY, fileFailure: 'TRUST_FILE_MALFORMED' };
  if (list.length === 0) return { ...EMPTY, fileFailure: 'TRUST_FILE_EMPTY' };

  const keys = new Map<string, TrustedKey>();
  const rejected: { keyId: string; reason: TrustLoadFailure }[] = [];

  for (const entry of list as Record<string, unknown>[]) {
    const keyId = typeof entry.key_id === 'string' ? entry.key_id : '<unnamed>';
    const scope = entry.scope;
    const pem = entry.public_key_pem;
    const alg = entry.algorithm;

    /*
     * ABSENCE OF SCOPE IS REFUSED, NOT TREATED AS UNIVERSAL — NP-036 §15 states the rule and
     * this is where it is enforced. A missing field is the most common way a scope check is
     * silently defeated, because the natural `if (scope === FORBIDDEN) reject` passes it.
     */
    if (typeof scope !== 'string' || scope.length === 0) {
      rejected.push({ keyId, reason: 'KEY_SCOPE_ABSENT' });
      continue;
    }
    if ((FORBIDDEN_TRUST_SCOPES as readonly string[]).includes(scope)) {
      rejected.push({ keyId, reason: 'KEY_SCOPE_FORBIDDEN' });
      continue;
    }
    // Allow-list, not deny-list: a scope nobody thought to forbid is still not the pilot's.
    if (scope !== PILOT_TRUST_SCOPE) {
      rejected.push({ keyId, reason: 'KEY_SCOPE_NOT_PILOT' });
      continue;
    }
    if (alg !== 'ed25519') {
      rejected.push({ keyId, reason: 'KEY_ALGORITHM_UNSUPPORTED' });
      continue;
    }
    if (typeof pem !== 'string' || pem.length === 0) {
      rejected.push({ keyId, reason: 'KEY_MATERIAL_INVALID' });
      continue;
    }
    let derived: string;
    try {
      derived = keyIdFor(pem);
    } catch {
      rejected.push({ keyId, reason: 'KEY_MATERIAL_INVALID' });
      continue;
    }
    if (derived !== keyId) {
      rejected.push({ keyId, reason: 'KEY_ID_MISMATCH' });
      continue;
    }
    keys.set(keyId, { keyId, publicKeyPem: pem, algorithm: 'ed25519' });
  }
  return { keys, rejected, fileFailure: null };
}

/** Reads the trust file named by PILOT_AUTHORITY_TRUST_FILE. Absence yields an EMPTY trust
 *  map, never a permissive one — with no trusted key, every row fails verification. */
export function loadPilotTrust(
  path = process.env.PILOT_AUTHORITY_TRUST_FILE,
  expectedDigest = process.env.PILOT_AUTHORITY_TRUST_DIGEST,
): TrustLoadResult {
  if (!path) return { ...EMPTY, fileFailure: 'TRUST_FILE_ABSENT' };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ...EMPTY, fileFailure: 'TRUST_FILE_ABSENT' };
  }

  /*
   * THE ANCHOR IS CHECKED BEFORE THE FILE IS PARSED, AND THAT ORDER IS THE CONTROL.
   * Parsing first would mean an unanchored file's contents had already been interpreted —
   * scopes read, key ids derived — before anything asked whether the file was the right file.
   * Every failure below yields the EMPTY key map, so an unanchored trust file admits nothing.
   */
  if (!expectedDigest) return { ...EMPTY, fileFailure: 'TRUST_DIGEST_ABSENT' };
  if (!/^[0-9a-f]{64}$/.test(expectedDigest)) return { ...EMPTY, fileFailure: 'TRUST_DIGEST_MALFORMED' };
  if (!digestMatches(trustFileDigest(raw), expectedDigest)) {
    return { ...EMPTY, fileFailure: 'TRUST_DIGEST_MISMATCH' };
  }

  return parsePilotTrust(raw);
}
