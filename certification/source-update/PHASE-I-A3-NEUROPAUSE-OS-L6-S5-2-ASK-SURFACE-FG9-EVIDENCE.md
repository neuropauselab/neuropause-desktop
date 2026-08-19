# OS-track L6 · S5.2 · THE ASK SURFACE — FG-9 · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S5.2 / FG-9 CLOSED — TEST-VERIFIED, frozen bracket INTACT.** The confirm/ASK surface renders a certified
proposal's eight review fields verbatim. FREEZE INTACT. **MOCK-ONLY, zero real contact.**

## The token (quoted verbatim)
> AUTHORIZED: FG-9 — CapabilityProposeM365ActionResponse brainReview review fields, per gate doc

## Change-control choreography (proven)
- **INTACT #1** `BASELINE-bdd7aa037112` — clean checkpoint AFTER the non-frozen work (`BrainReviewCard` + truthful-surface
  ui-tests), BEFORE the frozen field.
- **Frozen diff (isolated commit)** — EXACTLY the additive optional field as presented: on the `ok:true` branch of
  `CapabilityProposeM365ActionResponse` (`packages/shared/src/ipc/contracts.ts`), one optional `brainReview?: { purpose,
  target, action, risk, evidenceRefs[], expectedEffect, verificationPlan, expiry }`. **No existing field removed, renamed,
  or retyped.**
- **INTACT #2** `BASELINE-0d4c1418ecdf` — re-recorded after the frozen field; full suites green.

## The pins (all honored)
- **ADDITIVE-ONLY + FALLBACK** — the field is optional; `BrainReviewCard` returns nothing when `review == null`, so the
  propose/confirm panel behaves exactly as today. Pinned (`brainReviewCard.test.tsx` fallback test).
- **DISPLAY-ONLY DATA** — `brainReview` carries the eight review fields VERBATIM from the certified Proposal artifact; no
  callable, no `confirmed`, no authority material. The renderer renders verbatim and NEVER re-derives or synthesizes a
  field (the Verification row shows the artifact string, never a stronger claim). Truthful-surface tests pin each displayed
  value to the prop. The confirm action still flows ONLY through the existing confirm → CST → admission path.
- **EXPIRY AT CONFIRM** — an expired proposal is not confirmable, enforced MAIN-SIDE in the execution boundary
  (`admitForExecution`'s `nowMs > expiry.expiresAtMs` → REFUSED, S5.1), not merely greyed in the UI. Pinned
  (`proposalExecutionBoundary.test.ts` "expired at confirm time → REFUSED"); carried into the S5.3 confirm handler.

## Proofs
`brainReviewCard.test.tsx` (3, ui) + `proposalExecutionBoundary.test.ts` (10) + full main (**850 files, 8942 passed /
3 skipped**) + ui (**38 files, 268 passed**) + typecheck node+web + lint clean.

## Gate registry
**FG-9 (closed):** `CapabilityProposeM365ActionResponse` additive optional `brainReview` field (`packages/shared/src/ipc/
contracts.ts`). Token honored; INTACT #1 `BASELINE-bdd7aa037112` → frozen → INTACT #2 `BASELINE-0d4c1418ecdf`. Additive-
only; display-only data; the confirm action is unchanged.

## Next (report-and-continue)
**S5.3 · the FULL mock loop, real-Electron e2e:** Brain state → proposal → ASK (the `brainReview` fields visible) → human
confirm → CST → mock executor → mock read-back → verification attaches to the ActionRecord → the five-state panel moves.
`VERIFIED_FAILURE` and `UNKNOWN → HOLD` each exercised. **ZERO real contact.** Then **⛔ HOLD** and present the **S5.4
runbook** — the first Brain-proposed real action is its own ceremony (fresh app registration + consent at the operator's
keyboard, allowlist + latch renewed), awaiting explicit go.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. S5.2 renders a proposal for human review; it reaches
no executor and makes no external contact.
