/**
 * S39 · F-S17-1 — THE ONE LOCAL-FIRST STORY, reconciled.
 *
 * S17 left two local-first affordances coexisting: the first-run onboarding's "Try Free Locally" and the
 * in-shell `LocalModeBanner`. They are COMPLEMENTARY BY DESIGN — this module makes that design explicit and
 * SINGLE-SOURCED so the two surfaces can never drift apart:
 *
 *   THE DOOR (one-time welcome)  — "Try Free Locally". A door, not a claim: the user has not yet chosen
 *     processing, so the welcome NEVER asserts where data lives (the honest-copy rule pins this).
 *   THE STATE (persistent shell) — "Working locally — your data stays on this device." Shown ONLY in the
 *     renderer's `local` auth branch, where it is DERIVED TRUTH (no account, cloud clients fail closed,
 *     stores are device-local) — never decoration.
 *   THE WAY BACK — "Connect an account to sync": both surfaces route to the SAME real sign-in surface
 *     (never a fake one).
 *
 * CLAIM-PLACEMENT RULE (pinned by test): the claim phrase appears in the STATE line and nowhere in the door
 * copy. The shared term "locally" ties the story together — the door names the mode the state line proves.
 */
export const LOCAL_FIRST_STORY = {
  /** The one-time welcome door — never a claim. */
  door: 'Try Free Locally',
  doorSupporting:
    'Try NeuroPause free and experience AI that can work locally on your computer — for personal productivity or professional business work.',
  /** The derived-truth claim, valid ONLY inside the local auth branch. */
  claim: 'your data stays on this device',
  /** The persistent in-shell state line (LocalModeBanner). */
  stateLine: 'Working locally — your data stays on this device.',
  /** The single way back to the cloud — the real sign-in surface. */
  connectCta: 'Connect an account to sync',
} as const;
