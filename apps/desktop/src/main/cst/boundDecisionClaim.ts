/**
 * P13C Phase I-A.3 (Step 1) — the pure Bound Decision Claim primitive.
 *
 * An IN-PROCESS, BY-REFERENCE decision claim that binds a governance decision to the
 * EXACT consequential effect it authorizes, so a future Boundary-B enforcer can detect
 * any substitution. This module is PURE: it computes and verifies the binding
 * correspondence; it does NOT sign, persist, reserve/consume, execute, or verify an
 * effect outcome.
 *
 * Frozen boundaries (do not collapse):
 *   claim VALIDITY  ≠  claim CONSUMPTION  ≠  EFFECT SUCCESS  ≠  effect VERIFICATION.
 * This primitive establishes only VALIDITY (decision-to-execution correspondence).
 * Consumption/replay (a durable execution-session step) and Boundary-B enforcement are
 * separate, later, separately-authorized gates. An UNKNOWN effect outcome must never be
 * turned into success or a retry authorization by anything here.
 *
 * Security model: in-process by-reference; the renderer cannot inject a binding (see
 * PHASE-I-A2 §18). This is NOT a bearer token — no Ed25519/HMAC, no serialized token, no
 * issuer-non-repudiation. It provides representation/binding integrity only.
 *
 * Binding fields (Phase I-A.3 v1 — EXACTLY EIGHT; nothing added): executor, target,
 * accountId, actionId, params, actor, tenantId, decisionId.
 *
 * `policyVersion` is DELIBERATELY EXCLUDED (I-A3-STEP2-FINDING-1): the workforce
 * `GovernanceVerdict` records no authoritative per-decision policy version, and the
 * policy set is unversioned, so a policy-version field could only be a weaker
 * (contract-level) substitute. NeuroPause must not represent weaker provenance as
 * stronger — so no policyVersion is carried. Per-decision policy provenance is a
 * separate future architectural gate.
 */
import { createHash } from 'node:crypto';
import { canonicalize } from '../util/canonicalJson';

/** The exact consequential effect a governance decision authorizes. */
export interface EffectBinding {
  readonly executor: string; // e.g. 'm365'
  readonly target: string; // connectorId
  readonly accountId: string;
  readonly actionId: string; // e.g. 'mail.send'
  readonly params: Record<string, unknown>;
  readonly actor: string; // authoritative approver principal (Boundary A, I-A.1 user.id)
  readonly tenantId: string;
  readonly decisionId: string;
  // NOTE: no `policyVersion` — see the module header (I-A3-STEP2-FINDING-1).
}

/**
 * An in-process decision claim. Carries the binding DIGEST (not the binding itself), a
 * single-use nonce (reservation is a future durable step — not implemented here), and an
 * authoritative validity window. Passed by reference; never serialized to the renderer.
 */
export interface BoundDecisionClaim {
  readonly decisionId: string;
  readonly nonce: string;
  readonly bindingDigest: string; // sha256 hex over canonicalize(EffectBinding)
  readonly issuedAt: number; // authoritative epoch ms (Boundary-A clock)
  readonly expiresAt: number; // authoritative epoch ms
}

export type ClaimRejectReason =
  | 'MISSING_CLAIM'
  | 'MALFORMED_CLAIM'
  | 'EXPIRED'
  | 'DECISION_MISMATCH'
  | 'BINDING_MISMATCH';

export type ClaimVerification = { readonly ok: true } | { readonly ok: false; readonly reason: ClaimRejectReason };

/**
 * The binding digest: sha256 hex of the CANONICAL binding (never `JSON.stringify`).
 * Throws `CanonicalizationError` (from canonicalJson) if `params` (or any field) is
 * outside the canonical value domain — the caller must supply a canonicalizable binding.
 */
export function computeBindingDigest(binding: EffectBinding): string {
  return createHash('sha256').update(canonicalize(bindingView(binding))).digest('hex');
}

/**
 * Mint a claim at Boundary A. PURE: no persistence, no reservation, no consumption. The
 * `nonce`, `issuedAt`, and `ttlMs` are supplied by the (future) authoritative caller;
 * this function does not read a clock or generate randomness.
 */
export function mintBoundDecisionClaim(args: {
  readonly binding: EffectBinding;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly ttlMs: number;
}): BoundDecisionClaim {
  return {
    decisionId: args.binding.decisionId,
    nonce: args.nonce,
    bindingDigest: computeBindingDigest(args.binding),
    issuedAt: args.issuedAt,
    expiresAt: args.issuedAt + args.ttlMs,
  };
}

/**
 * Verify a claim against the ACTUAL effect binding and the authoritative current time.
 * PURE structural/binding verification only — proves decision-to-execution
 * CORRESPONDENCE. It does NOT reserve/consume the claim, does NOT execute, and does NOT
 * establish effect success. Fail-closed: any problem ⇒ `{ ok:false, reason }`; only an
 * exact, unexpired, decision- and binding-matching claim returns `{ ok:true }`.
 */
export function verifyBoundDecisionClaim(
  claim: BoundDecisionClaim | null | undefined,
  actualBinding: EffectBinding,
  nowMs: number,
): ClaimVerification {
  if (claim === null || claim === undefined) return { ok: false, reason: 'MISSING_CLAIM' };
  if (!isWellFormed(claim)) return { ok: false, reason: 'MALFORMED_CLAIM' };
  if (nowMs > claim.expiresAt) return { ok: false, reason: 'EXPIRED' };
  // decisionId is ALSO part of the binding digest; the explicit check yields a precise
  // reason and catches a claim whose decisionId disagrees with its own digested binding.
  if (claim.decisionId !== actualBinding.decisionId) return { ok: false, reason: 'DECISION_MISMATCH' };
  let actualDigest: string;
  try {
    actualDigest = computeBindingDigest(actualBinding);
  } catch {
    // A non-canonicalizable actual binding cannot be verified ⇒ fail closed.
    return { ok: false, reason: 'BINDING_MISMATCH' };
  }
  if (actualDigest !== claim.bindingDigest) return { ok: false, reason: 'BINDING_MISMATCH' };
  return { ok: true };
}

/** Only the declared binding fields participate in the digest — nothing more. */
function bindingView(b: EffectBinding): Record<string, unknown> {
  return {
    executor: b.executor,
    target: b.target,
    accountId: b.accountId,
    actionId: b.actionId,
    params: b.params,
    actor: b.actor,
    tenantId: b.tenantId,
    decisionId: b.decisionId,
  };
}

function isWellFormed(claim: BoundDecisionClaim): boolean {
  return (
    typeof claim.decisionId === 'string' &&
    claim.decisionId.length > 0 &&
    typeof claim.nonce === 'string' &&
    claim.nonce.length > 0 &&
    typeof claim.bindingDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(claim.bindingDigest) &&
    typeof claim.issuedAt === 'number' &&
    Number.isFinite(claim.issuedAt) &&
    typeof claim.expiresAt === 'number' &&
    Number.isFinite(claim.expiresAt) &&
    claim.expiresAt >= claim.issuedAt
  );
}
