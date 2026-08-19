/**
 * S5.4 Phase 0 · project a certified L6 `Proposal` → the FG-9 `brainReview` display fields.
 *
 * DISPLAY-ONLY: strings the confirm panel renders VERBATIM. No callable, no `confirmed`, no authority
 * material. The shape matches the frozen `CapabilityProposeM365ActionResponse.brainReview` (FG-9) exactly,
 * so `capabilityProposeCore` can spread it into the `ok:true` response with no new frozen touch.
 */
import type { Proposal } from './proposal';

export interface BrainReviewFields {
  readonly purpose: string;
  readonly target: string;
  readonly action: string;
  readonly risk: string;
  readonly evidenceRefs: string[];
  readonly expectedEffect: string;
  readonly verificationPlan: string;
  readonly expiry: string;
}

export function toBrainReview(p: Proposal): BrainReviewFields {
  const plan = p.verificationPlan;
  const verificationPlan =
    plan.verifiable === false
      ? `UNVERIFIABLE today: needs ${plan.needs ?? 'an oracle'}`
      : `${plan.verifiable} (${plan.oracleId ?? '?'})${plan.productionWired ? '' : ' — not production-wired'}`;
  const recipients = Array.isArray((p.proposedAction.params as { to?: unknown }).to)
    ? ((p.proposedAction.params as { to: unknown[] }).to.map(String).join(', '))
    : '';
  return {
    purpose: p.purpose,
    target: `${p.target.connector} / ${p.target.account} / ${p.target.scope}`,
    action: `${p.proposedAction.capabilityId}${recipients ? ` → ${recipients}` : ''}`,
    risk: `${p.risk} (${p.reversibility})`,
    evidenceRefs: p.evidence.map((e) => `${e.kind}:${e.id}`),
    expectedEffect: p.expectedEffect,
    verificationPlan,
    expiry: `expires at ${new Date(p.expiry.expiresAtMs).toISOString()}`,
  };
}
