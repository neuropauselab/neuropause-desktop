import { readFileSync } from 'node:fs';
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
export function loadPilotTrust(path = process.env.PILOT_AUTHORITY_TRUST_FILE): TrustLoadResult {
  if (!path) return { ...EMPTY, fileFailure: 'TRUST_FILE_ABSENT' };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ...EMPTY, fileFailure: 'TRUST_FILE_ABSENT' };
  }
  return parsePilotTrust(raw);
}
