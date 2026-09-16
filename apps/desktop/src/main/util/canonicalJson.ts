/**
 * P13C Phase I-A.3 — deterministic canonical JSON for governance binding equality.
 *
 * A dependency-minimal, deterministic canonicalizer over a NARROW value domain, so a
 * governance binding digest is stable and representation-independent. Unsupported
 * JavaScript values **FAIL CLOSED** (throw `CanonicalizationError`) rather than being
 * silently coerced — a governance binding must never depend on a lossy or ambiguous
 * serialization.
 *
 * Value domain (CanonicalValue):
 *   null | boolean | string | finite number | CanonicalValue[] | { [k]: CanonicalValue }
 *
 * Rules:
 *   • Objects — keys sorted (order-INDEPENDENT): `{a:1,b:2}` ≡ `{b:2,a:1}`.
 *   • Arrays — order PRESERVED (order is SIGNIFICANT): `["A","B"]` ≢ `["B","A"]`.
 *   • Numbers — finite only; `NaN`/`Infinity`/`-Infinity` are REJECTED.
 *   • Rejected: `undefined`, `bigint`, `symbol`, `function`, and any non-plain object
 *     (Date/Map/Set/Buffer/typed arrays/Error/RegExp/class instances). An object field
 *     whose value is `undefined` is rejected (absent ≠ present-with-undefined — the
 *     caller must OMIT the field, not set it to `undefined`).
 *   • Strings — NOT normalized (no NFC/case/whitespace folding): distinct Unicode
 *     representations remain distinct, by design (no silent semantic change).
 *
 * No dependency on crypto, signing, or any subsystem — this is representation only.
 */

export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/** Only `Object.prototype`- or null-prototyped objects are plain dictionaries. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function normalize(value: unknown, path: string): CanonicalValue {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean') return value as boolean;
  if (t === 'string') return value as string;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError(`non-finite number at ${path} (NaN/Infinity/-Infinity are not canonicalizable)`);
    }
    return value as number;
  }
  if (t === 'undefined') throw new CanonicalizationError(`undefined at ${path} is not canonicalizable`);
  if (t === 'bigint') throw new CanonicalizationError(`bigint at ${path} is not canonicalizable`);
  if (t === 'symbol') throw new CanonicalizationError(`symbol at ${path} is not canonicalizable`);
  if (t === 'function') throw new CanonicalizationError(`function at ${path} is not canonicalizable`);

  // typeof value === 'object' (and not null)
  if (Array.isArray(value)) {
    return value.map((element, i) => normalize(element, `${path}[${i}]`));
  }
  if (!isPlainObject(value as object)) {
    throw new CanonicalizationError(
      `non-plain object at ${path} (Date/Map/Set/Buffer/Error/RegExp/class instances are not canonicalizable)`,
    );
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, CanonicalValue> = {};
  // Insert in sorted key order; JSON.stringify then serializes in that order.
  for (const key of Object.keys(obj).sort()) {
    out[key] = normalize(obj[key], `${path}.${key}`);
  }
  return out;
}

/**
 * Deterministic canonical JSON string. Throws `CanonicalizationError` on any value
 * outside the CanonicalValue domain (fail closed). Two semantically-equivalent inputs
 * that differ only in object key order produce the identical string; any change to a
 * value, an array's order, or a key produces a different string.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value, '$'));
}
