/**
 * P13C I-A.3 Step 4 — Boundary B (consequential worker-execution enforcement).
 *
 * The independent enforcement check performed at the worker execution boundary, BEFORE the
 * consequential executor (`runBinding`) is reachable. It reconstructs the EXACT eight-field
 * binding from the ACTUAL execution request — the transported `binding`, the authoritative
 * `actor`/`tenantId` siblings (Step-3A), and `claim.decisionId` — and re-derives the digest via
 * the committed `verifyBoundDecisionClaim` primitive (which recomputes over canonical JSON). It
 * NEVER trusts `claim.bindingDigest` on its own.
 *
 * Scope of this function: claim presence + structural/temporal validity + exact-binding
 * correspondence + authoritative actor/tenant PRESENCE. It is SEMANTIC (in-process) verification
 * only — NOT cryptographic issuer authentication (the claim is not a bearer token). It does NOT
 * perform durable single-use consumption: that is the committed Step-5 mechanism inside the
 * ExecuteEngine (`decisionId` reserve → persist → executor), which runs first on the live path.
 * Boundary B is the semantic gate that must ALSO pass before `runBinding` runs.
 *
 * Fail-closed: any missing/malformed/expired/mismatched input ⇒ a DENY reason and NO effect.
 */
import type { ExecutionBinding, ExecutionRequest } from '@neuropause/shared';
import { verifyBoundDecisionClaim, type BoundDecisionClaim, type EffectBinding } from '../../cst/boundDecisionClaim';

export type BoundaryBDenyReason =
  | 'MISSING_CLAIM'
  | 'MISSING_ACTOR'
  | 'MISSING_TENANT'
  | 'MALFORMED_CLAIM'
  | 'EXPIRED'
  | 'DECISION_MISMATCH'
  | 'BINDING_MISMATCH';

export type BoundaryBVerdict =
  | { readonly ok: true; readonly decisionId: string }
  | { readonly ok: false; readonly reason: BoundaryBDenyReason };

/**
 * Verify a governed consequential worker request at Boundary B. `nowMs` is the authoritative
 * runtime clock (never a renderer timestamp). Returns ALLOW (with the governed `decisionId`) only
 * when the transported claim independently verifies against the actual binding + authoritative
 * actor/tenant + temporal validity; otherwise a precise DENY reason.
 */
export function verifyBoundaryB(req: ExecutionRequest, nowMs: number): BoundaryBVerdict {
  const params = req.params as Record<string, unknown> | undefined;

  // 1. A consequential worker binding MUST carry a claim. Absence ⇒ ungoverned ⇒ DENY.
  const claimRaw = params?.claim;
  const claim = claimRaw && typeof claimRaw === 'object' ? (claimRaw as BoundDecisionClaim) : null;
  if (!claim || typeof claim.decisionId !== 'string' || claim.decisionId.length === 0) {
    return { ok: false, reason: 'MISSING_CLAIM' };
  }

  // 2. Authoritative actor + tenant must be present (they are digest fields; never a fallback).
  const actor = params?.actor;
  if (typeof actor !== 'string' || actor.trim() === '') return { ok: false, reason: 'MISSING_ACTOR' };
  const tenantId = params?.tenantId;
  if (typeof tenantId !== 'string' || tenantId.trim() === '') return { ok: false, reason: 'MISSING_TENANT' };

  // 3. Reconstruct the exact eight-field binding from the ACTUAL request. An incomplete binding
  //    (missing account/action/params) cannot correspond to a minted governed decision ⇒ DENY.
  const binding = params?.binding as ExecutionBinding | undefined;
  if (!binding || binding.accountId === undefined || binding.actionId === undefined || binding.params === undefined) {
    return { ok: false, reason: 'BINDING_MISMATCH' };
  }
  const actual: EffectBinding = {
    executor: binding.executor,
    target: binding.target,
    accountId: binding.accountId,
    actionId: binding.actionId,
    params: binding.params,
    actor,
    tenantId,
    decisionId: claim.decisionId,
  };

  // 4. Independently re-derive + compare the digest (and check structure/expiry/decision) via the
  //    committed primitive. It recomputes sha256(canonicalize(actual)); it does not trust the claim.
  const verdict = verifyBoundDecisionClaim(claim, actual, nowMs);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  return { ok: true, decisionId: claim.decisionId };
}
