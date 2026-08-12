/**
 * WHEN A TYPE AND ITS VALIDATOR ARE TWO DESCRIPTIONS OF ONE THING.
 * P13C ROUND 17.
 *
 * WHAT HAPPENED
 *
 * `ONBOARDING_STEPS` — the shared first-run catalog — lists six steps, with
 * `'legal'` (the EULA and privacy acknowledgement, Phase 8 / 8.13) SECOND.
 * `OnboardingCompleteStepRequest` listed five, hand-written, without it.
 *
 * The renderer calls `completeStep(step: OnboardingStepId)`. That typechecks —
 * the union has all six. At runtime the bridge answered:
 *
 *     WARN (secure-ipc) Invalid payload { channel: 'onboarding:completeStep', issues: 1 }
 *     IpcError: Invalid request for onboarding:completeStep
 *
 * on the second screen of the wizard, on every install, and there was no way
 * past it. TypeScript could not see the disagreement because a Zod enum and a
 * TS union are independent declarations that nothing compares.
 *
 * `ipc/responses.ts` opens with a long note about exactly this disease on the
 * RESPONSE side — *"The two ends of every channel were typed independently,
 * with nothing checking that they agreed — a cast is a claim, not a check."*
 * That was closed for responses. This is the same disease on the REQUEST side,
 * and it shipped a product that could not be set up.
 *
 * WHY THE FIX IS DERIVATION AND NOT "ADD THE MISSING WORD"
 *
 * Adding `'legal'` to the enum fixes today and leaves the mechanism intact for
 * the seventh step. The catalog is now the single source: `ONBOARDING_STEP_IDS`
 * is a const tuple, `z.enum()` consumes it, and `OnboardingStepId` derives from
 * it. That pattern already existed in the same file — `HELP_DOC_IDS` — which is
 * why this is a drift rather than a design gap.
 *
 * WHAT THIS TEST DOES THAT TYPES CANNOT
 *
 * It runs the real validator against every id in the real catalog. A future step
 * added to `ONBOARDING_STEPS` but not accepted by the schema fails here, at
 * build time, instead of on a user's second screen.
 */
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  OnboardingCompleteStepRequest,
} from '@neuropause/shared';

describe('P13C Round 17 — onboarding step catalog vs its request validator', () => {
  it('accepts every step the wizard can actually present', () => {
    const rejected = ONBOARDING_STEPS.filter(
      (s) => !OnboardingCompleteStepRequest.safeParse({ step: s.id }).success,
    ).map((s) => s.id);
    expect(
      rejected,
      `ONBOARDING_STEPS contains ${rejected.length} step(s) the bridge validator refuses. ` +
        `A user reaching one of them cannot continue, and no type error is produced ` +
        `because the union and the enum are separate declarations.`,
    ).toEqual([]);
  });

  it("accepts 'legal' — the step that was missing, and the one that records EULA consent", () => {
    expect(OnboardingCompleteStepRequest.safeParse({ step: 'legal' }).success).toBe(true);
  });

  it('the catalog and the id tuple describe the same set, in the same order', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([...ONBOARDING_STEP_IDS]);
  });

  it('still refuses a step id that does not exist — the enum is not now open', () => {
    expect(OnboardingCompleteStepRequest.safeParse({ step: 'not_a_step' }).success).toBe(false);
    expect(OnboardingCompleteStepRequest.safeParse({ step: '' }).success).toBe(false);
  });
});
