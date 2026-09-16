/**
 * NeuroPause OS — THE RECORD-FINGERPRINT AUTHORITY (one rule, one place).
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT (operator ruling D2, 21 Aug 2026) ───────────────────────────────────────
 * Two functions in this repository were named `fingerprint`, with DIFFERENT CODOMAINS and DIFFERENT JOBS, and the
 * collision is what made F-P39 look like a one-line fix for a day. They are now named apart
 * (ARCHITECTURE-MAPPING.md §5.0, eighth collision):
 *
 *   RECORD-FINGERPRINT  (this file)                     sha256(normalized).slice(0,16) — ONE-WAY HEX
 *     JOB: TAMPER-EVIDENCE. Proves a stored row was not altered, while guaranteeing the evidence file on disk
 *     holds NO subject or body text. That one-wayness is deliberate, pinned, and load-bearing for the privacy
 *     property of the evidence store — it is NOT a defect to be normalized away.
 *
 *   MATCH-KEY           (`verification/verifyEffect.ts` `fingerprint`)   lowercase → collapse → trim — PLAINTEXT
 *     JOB: COMPARISON. Lets an observed provider row be tested against a target.
 *
 * THE RULING, RECORDED SO IT IS NOT RE-LITIGATED: this is NOT a divergence and NEITHER SIDE IS NORMALIZED. Two
 * different jobs wearing one word. The consequence is accepted rather than engineered around — a comparison
 * driven from the evidence store is performed IN THIS CODOMAIN (hash the observation, compare hashes), never by
 * teaching the record to store comparable plaintext.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────────────────────
 * Because the alternative was a THIRD copy. The rule already existed privately in `connectors/actionRecord.ts`;
 * a read-back reconciler needs the identical rule to hash what it observes. Copying it would create two
 * definitions that agree today and drift silently — the exact shape F-N16-1 refused ("a third copy was refused →
 * ONE named authority"). `actionRecord.ts` now imports this, and its UNCHANGED, ALREADY-GREEN pins over the
 * persisted file are the byte-equivalence proof (the FG-11 move: move the rule, keep the pins, let them prove it).
 *
 * PURE: no I/O, no clock, no store, no Electron. Safe to import from anywhere, including the pure oracle side.
 */
import { createHash } from 'node:crypto';

/**
 * The normalization half, exposed separately because the two codomains share it exactly: MATCH-KEY *is* this
 * output, and RECORD-FINGERPRINT is the sha256 of it. Naming the shared half is what makes the relationship
 * between them checkable instead of coincidental.
 */
export function normalizeForFingerprint(text: unknown): string {
  return typeof text === 'string' ? text.toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

/**
 * RECORD-FINGERPRINT — the durable, one-way, tamper-evidence form.
 *
 * The empty case is NOT hashed: it returns `''`, so "no subject was supplied" stays distinguishable from
 * "the subject hashed to something". A record that fingerprinted the empty string would claim evidence it does
 * not have. Behaviour is byte-identical to the rule this replaces (`actionRecord.ts` pre-21-Aug).
 */
export function recordFingerprint(text: unknown): string {
  const norm = normalizeForFingerprint(text);
  return norm === '' ? '' : createHash('sha256').update(norm).digest('hex').slice(0, 16);
}
