import { SIGNED_FIELDS } from './authoritySignature';

/* ==========================================================================================
 * H14 — SIGNED-FIELD COMPLETENESS CONTRACT.
 *
 * NP-037 measured the defect: a test asserted every entry of SIGNED_FIELDS has a mutation
 * test, and NOTHING asserted that SIGNED_FIELDS covers the table. The guard ran one way only,
 * so a future migration could add an authority-bearing column, the loader could be taught to
 * consume it, and no test would fail — an unbound field inside a signed envelope.
 *
 * This contract closes the reverse direction. Every column of `pilot_authority_decisions` must
 * appear in exactly one bucket below, and the accompanying test derives the column list FROM
 * THE MIGRATIONS rather than from a hand-kept copy — so the contract cannot silently drift
 * away from the schema it describes.
 *
 * A NEW COLUMN THEREFORE FAILS THE SUITE UNTIL SOMEONE CLASSIFIES IT. That is the point: the
 * decision "is this field authority-bearing?" is forced to be made and written down, rather
 * than defaulted to "unsigned" by omission.
 * ========================================================================================== */

/** Columns that carry authority meaning and are inside the signature. Source of truth is
 *  SIGNED_FIELDS itself, so the two cannot disagree. */
export const SIGNED_COLUMNS: readonly string[] = SIGNED_FIELDS;

/**
 * Columns deliberately outside the signature, each with the reason. A justification is
 * required by construction — the type demands one, so "unsigned" can never be a silent default.
 */
export const UNSIGNED_COLUMNS: ReadonlyArray<{ column: string; authorityBearing: false; why: string }> = [
  {
    column: 'id',
    authorityBearing: false,
    why: 'Surrogate row key, `gen_random_uuid()`. Never read by the authority path: the loader '
      + 'does not SELECT it and no evaluator branches on it. Signing it would bind an authority '
      + 'instrument to one physical row, so a legitimate re-insert of identical content would fail.',
  },
  {
    column: 'recorded_at',
    authorityBearing: false,
    why: 'Server-side insert timestamp (`default now()`), an audit convenience. The authority '
      + 'window is carried by effective_from / expires_at / revoked_at, all of which ARE signed. '
      + 'recorded_at is never consulted by any authorization decision.',
  },
];

/**
 * Columns that cannot be inside the signature because they carry it. Excluded by construction,
 * not by judgement — a signature cannot cover itself.
 */
export const UNSIGNABLE_COLUMNS: readonly string[] = ['signature', 'signer_key_id'];

/** The whole contract, as a lookup. */
export const classify = (column: string): 'SIGNED' | 'UNSIGNED_NON_AUTHORITATIVE' | 'UNSIGNABLE' | 'UNCLASSIFIED' => {
  if (SIGNED_COLUMNS.includes(column)) return 'SIGNED';
  if (UNSIGNED_COLUMNS.some((u) => u.column === column)) return 'UNSIGNED_NON_AUTHORITATIVE';
  if (UNSIGNABLE_COLUMNS.includes(column)) return 'UNSIGNABLE';
  return 'UNCLASSIFIED';
};

/** The table this contract governs. */
export const AUTHORITY_TABLE = 'pilot_authority_decisions';
