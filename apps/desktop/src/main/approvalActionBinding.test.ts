/**
 * SEAM-B.15 / GATE-R.9 · TARGET A — KERNEL APPROVAL-ACTION MISMATCH, pinned in-app.
 *
 * B.14 measured (§34 class 9): the kernel refuses an approval whose ACTION
 * differs from the request's — `a.action === req.action` is the FIRST conjunct
 * of scopeOk (kernel.js:147) — but no in-app pin varied the ACTION there (the
 * importTransition pin varies the RESOURCE; the BoundDecisionClaim pin covers
 * the claim layer, a different mechanism). This file closes that gap.
 *
 * §2 #17 — the REAL path: the REAL installed kernel (`CstKernel` from the same
 * deep import every adapter uses), driven with the in-app request/approval
 * construction shape copied from the non-frozen journalPostTransition adapter
 * (per-call SystemTime/PolicyStore/stores, C3, HUMAN actor, brand functions).
 * The app's own adapters mint approval.action === request.action BY
 * CONSTRUCTION (send/cohort/journal all couple them) — so the adapters carry
 * INDIRECT protection, and this pin makes the kernel's enforcement DIRECT:
 * approval(A) can never be consumed for action B, whatever constructs it.
 *
 * Constitutional property (B.15 §48): AUTHORIZATION MUST BE SPECIFIC —
 * APPROVAL(A) ≠ APPROVAL(B).
 */
import { describe, it, expect } from 'vitest';
import { CstKernel } from '@neuropause/cst/dist/src/kernel.js';
import {
  ClaimStore,
  EvidenceStore,
  IdempotencyStore,
  PolicyStore,
  ResourceStore,
  SystemTime,
} from '@neuropause/cst/dist/src/stores.js';
import {
  approvalId as brandApprovalId,
  idempotencyKey as brandIdempotencyKey,
  requestId as brandRequestId,
  transitionId as brandTransitionId,
  type Actor,
  type Approval,
  type TransitionRequest,
} from '@neuropause/cst/dist/src/types.js';

const ACTION_A = 'test.action.approved';
const ACTION_B = 'test.action.attempted';
const TENANT = 'org-b15';
const EXPECTED = { pinned: true };

interface RunResult {
  outcome: Awaited<ReturnType<CstKernel['run']>>;
  effectCalls: number;
}

/**
 * Drive the REAL kernel with the adapter-shaped construction. `requestAction`
 * is what the request asks for (and what the actor is GRANTED — so the policy
 * stage passes and the approval stage is the discriminating check);
 * `approvalAction` is what the attached approval was minted for; `withApproval`
 * false omits the approval entirely (the §24 row-3 control).
 */
async function run(requestAction: string, approvalAction: string, withApproval = true): Promise<RunResult> {
  const time = new SystemTime();
  const actor: Actor = { id: 'human-b15@np.test', type: 'HUMAN', tenantId: TENANT };
  const target = { tenantId: TENANT, resourceType: 'b15-resource', resourceId: 'res-1', version: 1 };
  const transitionId = brandTransitionId(`b15:${requestAction}:${approvalAction}:${withApproval}`);

  const approval: Approval | undefined = withApproval
    ? {
        approvalId: brandApprovalId(`appr:${String(transitionId)}`),
        transitionId, // binds to THIS transition — the transitionId check passes;
        approver: actor, // HUMAN, SoD inert (sodActions default empty);
        action: approvalAction, // ← the ONLY discriminating field in the mismatch case
        scope: { tenantId: TENANT, resourceType: 'b15-resource', resourceId: 'res-1' },
        resourceVersion: 1,
        purpose: 'B.15 Target A pin',
        policyVersion: 'b15-policy-1',
        issuedAt: time.now(),
        expiresAt: time.now() + 60_000, // not expired
        consumed: false, // not consumed
      }
    : undefined;

  const request: TransitionRequest = {
    transitionId,
    requestId: brandRequestId(`req:b15:${time.now()}`),
    actor,
    action: requestAction,
    target,
    purpose: 'B.15 Target A pin',
    intent: `attempt ${requestAction} carrying an approval for ${approvalAction}`,
    expectedPostState: EXPECTED,
    consequence: 'C3', // requiresApproval — the approval machinery is in play
    reversibility: 'REVERSIBLE',
    policyVersion: 'b15-policy-1',
    idempotencyKey: brandIdempotencyKey(String(transitionId)),
    evidence: [],
    ...(approval ? { approval } : {}),
  };

  // The actor IS granted the REQUEST's action — the policy stage passes, so the
  // approval stage is the check under test (kernel order: policy → approval).
  const policy = new PolicyStore(new Map([[actor.id, new Set([requestAction])]]), 'b15-policy-1');
  const resources = new ResourceStore();
  resources.put(target, { phase: 'pre' });

  let effectCalls = 0;
  const kernel = new CstKernel({
    time,
    policy,
    claims: new ClaimStore(),
    idempotency: new IdempotencyStore(),
    resources,
    evidence: new EvidenceStore(),
    reconcile: async () => ({ known: false }),
  });
  const outcome = await kernel.run(request, async () => {
    effectCalls += 1;
    resources.put(target, EXPECTED);
    return { accepted: true };
  });
  return { outcome, effectCalls };
}

describe('SEAM-B.15 · Target A — approval(A) cannot be consumed for action B (the kernel, in-app shape)', () => {
  it('CONTROL: approval(A) + request(A) → ALLOW, executed, VERIFIED_SUCCESS — the fixture is live', async () => {
    const { outcome, effectCalls } = await run(ACTION_A, ACTION_A);
    expect(outcome.verdict).toBe('ALLOW');
    expect(outcome.executed).toBe(true);
    expect(outcome.outcomeClass).toBe('VERIFIED_SUCCESS');
    expect(effectCalls).toBe(1);
  });

  it('THE PIN: approval(A) + request(B) → DENY APPROVAL_SCOPE_VIOLATION; the effect NEVER runs', async () => {
    const { outcome, effectCalls } = await run(ACTION_B, ACTION_A);
    expect(outcome.verdict).toBe('DENY');
    // The action limb lives INSIDE scopeOk (kernel.js:147, first conjunct) —
    // the reason is APPROVAL_SCOPE_VIOLATION, distinct from APPROVAL_MISMATCH,
    // which is exclusively the transitionId binding (kernel.js:142-144).
    expect(outcome.reason).toBe('APPROVAL_SCOPE_VIOLATION');
    expect(outcome.executed).toBe(false);
    expect(outcome.outcomeClass).toBe('NOT_ATTEMPTED'); // halted ≠ failed — nothing was attempted
    expect(outcome.verification).toBe('NOT_APPLICABLE');
    expect(effectCalls).toBe(0); // executor invocation count 0 — capability never became permission
  });

  it('§24 row 3: NO approval + request(B) at C3 → HOLD APPROVAL_REQUIRED; the effect NEVER runs', async () => {
    const { outcome, effectCalls } = await run(ACTION_B, ACTION_A, false);
    expect(outcome.verdict).toBe('HOLD');
    expect(outcome.reason).toBe('APPROVAL_REQUIRED');
    expect(outcome.executed).toBe(false);
    expect(effectCalls).toBe(0);
  });
});
