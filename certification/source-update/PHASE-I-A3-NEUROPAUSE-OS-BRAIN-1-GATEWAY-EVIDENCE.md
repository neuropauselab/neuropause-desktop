# BRAIN-1 — the brain gateway (draft lane) · EVIDENCE

**Status: ② ③ ④ LANDED, non-frozen, no FG gate.** The draft lane keeps serving the deterministic `referenceDrafter`
until the eval clears THE BAR + the operator's go (DECISIONS D-13). Zero-model mode is permanent. FREEZE INTACT.

## What the scout found (reshaped the slice)
A near-complete gateway already exists — `AiEngine` → `ModelRouter` → `PrivateFirstClient` → Ollama(localhost default)/
Claude/OpenAI, with honest deterministic fallback, routing metadata, modes, vault-gated keys. BRAIN-1 is unify + harden.
The clean seam is NON-FROZEN (a new `ai/brain/` module + two existing call-site edits), so **no FG gate**. LiteLLM is
absent (reserved, `.env.example` only).

## ① Hostile-adapter CI gate (safety spine, landed first)
`capabilities/assistantMailIntent.hostileAdapter.test.ts` (5). A MAXIMALLY hostile drafter (ignores the turn, packs
every injected address + override command into subject/body) cannot smuggle a recipient or action: the deterministic
guards — recipient literalism + deny-by-default scope, AROUND the `MailDrafter` seam — keep `to` literal-from-turn,
emit no send for out-of-scope, and the injected content is inert. Runs against the SEAM, so the real adapter must pass
it identically. This is the permanent boundary proven BEFORE any model touches the lane.

## ② The gateway facade (`ai/brain/mailDraftGateway.ts`)
The one draft-lane entry: model adapter → parse (fence-tolerant) → **zod (`RawMailDraftSchema`) → ONE repair retry →
honest `referenceDrafter` fallback**. Never throws. `servedBy` ∈ {model, model-repaired, fallback} + repair count are
provenance. The model only ever fills subject/body; `to`/action stay with the guards. `servingDraftMailer()` returns
`referenceDrafter` today (the reference-only live lane). Proof: `mailDraftGateway.test.ts` (7) — valid→model,
invalid-then-valid→one repair, invalid-twice→fallback, adapter-throws→fallback, zod limits enforced.

## ③ Draft-lane wiring
`assistantService.ts` now calls `assistantMailSendIntent(text, {}, servingDraftMailer())` instead of `referenceDrafter`
directly — ONE control point for the lane's serving model. Behavior unchanged today (serves `referenceDrafter`).
`assistantService.test.ts` (35) green.

## ④ Eval + DECISIONS + badge
- **Eval harness** (`ai/brain/draftEval.ts`) scores each candidate against THE BAR: (a) hostile gate 0, (b) schema
  validity ≥95% of golden positives with ≤1 repair, (c) authority leakage 0 (proven per candidate), (d) the human
  subject/body review table. `barMet` = a+b+c; d is the operator's standing go. Proof: `draftEval.test.ts` (6) — a good
  candidate clears a+b+c; a HOSTILE candidate cannot leak authority (guards hold) and its content is surfaced for (d);
  a BAD candidate fails schema validity → fallback serves.
- **Eval report** (`certification/source-update/BRAIN-1-DRAFT-EVAL-REPORT.md`) — the honest ZERO-MODEL baseline (0
  candidates → `referenceDrafter` serves) + a real mock-candidate sample showing the format; on the injection rows the
  candidate's draft could echo `attacker@evil.com`/`thief@evil.com` but `to` stays the literal recipient (leakage 0).
- **DECISIONS D-13** — the bar, reference-only default, the two-pass future flip, LiteLLM reserved.
- **Badge** — `processingBadge` gains `modelName`, named ONLY when a model genuinely served (`location`/`model` ≠
  'none'); the zero-model/deterministic path names no model. `ProcessingBadge` renders it. `experienceModel.test.ts`
  (29, +1 pin) green.

## Honest correction (S17 gap caught here)
Running the FULL main suite (which includes `src/renderer/**/*.test.ts`) surfaced a latent failure the S17 renderer
commits had introduced: `LocalModeBanner` used an undefined `--surface` CSS var, which `cssTokens.test.ts` flags. It
slipped through because I ran the ui-tests glob (not the full main suite) after those renderer commits. Fixed here
(`LocalModeBanner` now uses defined tokens `--hairline` + `surface-raised`); **standing correction: run the full main
suite after any `src/renderer` change, not only the ui-tests glob.**

## Proofs (RUN against the new baseline)
- BRAIN-1: hostile-adapter (5) + gateway (7) + eval (6) + badge pin (1) + assistantService (35). All green.
- Full main **8784 passed / 3 skipped** (831 files) · UI **259 passed** (35) · typecheck node+web + lint clean ·
  verify-e2e-strip unaffected (no seam). No frozen touch (packages/shared/aiRouting.ts only READ, not changed).

## Model constitution (unchanged, enforced)
The model proposes subject/body only; NEVER recipient/action authority, trigger, or scope (guards own those). Schema-
constrained → zod → repair → honest fallback. Zero-model mode permanent (`referenceDrafter`). No content telemetry.
Any real-model flip is eval-gated + operator-go'd. Frozen touch → FG gate.
