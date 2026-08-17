# NeuroPause OS — Wave 2 / Slice 7 — AI → Human Consent → Certified M365 Execution (First Vertical Slice)

**The human-consent → certified-execution half of the control plane is composed and TEST-VERIFIED: a NeuroPause-
validated M365 action is presented for human review, and the human's explicit confirmation — never the AI — drives
the EXISTING certified `M365ActionExecute` IPC (governedSend/CST → durable admission → executor). Renderer-only,
additive; the certified boundary is unchanged. The AI → structured-params PRODUCER remains the honest next gate. No
commit, no push.**
Labels: `SOURCE-PROVEN` · `TEST-VERIFIED` · `NOT LIVE-VERIFIED` · `DEFERRED`.

## Baseline `SOURCE-PROVEN`
HEAD `670b52e` (unchanged), branch `cert/data-import-cst-integration`, `git diff --check` clean; prior Wave-2 +
capability work preserved.

## Source trace `SOURCE-PROVEN`
- Certified human origin (Slice 6D): `M365ActionExecute` IPC (`connectors/index.ts:582-661`) → governedSend
  (`cst/sendTransition.ts:147`)/governedAction → CST → durable admission → executor. Actor bound `type:'HUMAN'`
  server-side (`runtimeCore.ts:481-484`); tenant server-resolved; the renderer supplies neither
  (schema `contracts.ts:465-471` = `{connectorId, accountId, actionId, params, confirmed}`).
- Renderer edge: `ipc.connectors.m365Execute(connectorId, accountId, actionId, params, confirmed)` (`ipc.ts:528-535`).
- `confirmed` gate: a mutating action with `confirmed!==true` is refused with zero effect (`m365/executor.ts:100-103`).
- Reusable surface: `M365WritePanel.tsx` — compose → two-step confirm → `m365Execute(...,confirmed:true)` → honest
  outcome (`m365Outcome.ts` ACKNOWLEDGED/OUTCOME_UNKNOWN). Non-frozen.

## Selected seam `SOURCE-PROVEN`
The existing `M365WritePanel` human-review→confirm→execute→honest-outcome loop, extended additively to accept a
NeuroPause-validated proposal for review. No new IPC channel, executor, governance, or store (Phase 20). The AI never
receives `run()`/executor/token/confirmation authority; it proposes, the human confirms.

## Files changed `SOURCE-PROVEN`
- **M** `apps/desktop/src/renderer/src/connectors/M365WritePanel.tsx` (NON-FROZEN) — optional `proposal?: {to?,subject?,
  body?}` prop: prefills the compose fields + a "Proposed by NeuroPause — review and confirm" provenance note. Confirm
  step + `m365Execute(...,confirmed:true)` + outcome rendering UNCHANGED.
- **A** `apps/desktop/ui-tests/m365HumanConsent.test.tsx` — 6 tests.
No frozen file, no `packages/shared`, no CST, no M365 IPC schema/handler/executor, no main code touched.

## Security invariants (Phase 19 at the composition boundary) `TEST-VERIFIED`
`m365HumanConsent.test.tsx` **6/6**:
- **Effect-before-consent = 0** — reaching the confirm step calls the IPC 0 times; only "Confirm send" executes.
- **Human is the sole consent** — the executed request has `confirmed:true` and carries NO
  `actor/actorId/tenant/tenantId/workspaceId/principal/token` (server-resolved; renderer non-authoritative).
- **No TOCTOU** — the action REVIEWED (proposed to/subject/body, shown with provenance) equals the action EXECUTED
  (`actionId:'mail.send'`, exact params).
- **Denial** — cancelling executes nothing.
- **UNKNOWN honest** — `data.outcome:'UNKNOWN'` → "Outcome unknown" + reconciliation banner, content retained, never
  "sent successfully"/"verified success".
- **ACKNOWLEDGED ≠ verified** — acknowledged never rendered as verified success.
- **AI draft ≠ send** — `m365Draft` fills the body; zero executes.

## AI boundary `TEST-VERIFIED`
`assistantAiBoundary.test.ts` **5/5** unchanged — the assistant still cannot dispatch a direct M365/connector write.
The AI's role here is limited to (future) proposing a capability + params for human review; it never confirms or
executes. This slice does not wire the assistant to emit M365 actions (see Remaining gaps).

## Human authority / tenant / capability `SOURCE-PROVEN`
Actor (`type:'HUMAN'`) + tenant resolved server-side (unchanged, Slice 6D); the renderer/AI cannot supply them
(schema omits them; `''` actor ⇒ DENY). The M365 write channel is RBAC-gated `connectors:manage`
(`connectors/index.ts:713-719`). Capability validity/account/tenant/governance-status are decided by NeuroPause
(catalog, Slices 1–6B) — SELECTED is not authorization.

## Admission / execution / UNKNOWN / evidence `SOURCE-PROVEN` (UNCHANGED, reused)
Durable idempotency admission, at-most-once certified executor, UNKNOWN → durable HoldStore
(`connectors/index.ts:427-446`), CST outcome evidence — all reused unchanged. Profile A: `VERIFIED_SUCCESS`
structurally unreachable; ACKNOWLEDGED ≠ verified.

## Regression `SOURCE-PROVEN`
New UI suite **6/6**. Full UI **242 passed / 31 files** (Slice-3 baseline 236/30; +6/+1, no regression). Full main
**8619 passed / 3 skipped / 816 files** (unchanged — renderer-only). Typecheck clean. Changed-file lint clean
(`--max-warnings 0`). `git diff --check` clean. (Pre-existing repo-wide lint error in
`cst/sendTransition.negative.test.ts` untouched — documented since Slice 1.)

## Frozen audit `SOURCE-PROVEN` — **CLEAN**
`git diff --stat` over `packages/shared`, `connectors/index.ts`, `connectors/m365`, `cst/*`, `runtimeCore.ts`,
`boundaryB.ts`, `executeEngine.ts` = **empty**. Only `M365WritePanel.tsx` (renderer, non-frozen) changed.

## Certification impact `SOURCE-PROVEN` — **NONE**
M365 IPC 29/29 CERTIFIED unchanged; CST unchanged; worker governance unchanged; Boundary-B unchanged; execution
semantics unchanged. The composition rides the certified path via its existing IPC.

## Live-validation status `NOT LIVE-VERIFIED`
Proven against the certified IPC through the UI-test harness (faked route), not a live signed-in tenant with a real
Graph effect. The development machine is not a clean pilot environment. `NOT PILOT-VALIDATED`.

## Remaining gaps `DEFERRED`
1. **AI → structured `{actionId, params}` PRODUCER** — the honest missing half: the assistant emits no concrete M365
   action (`AssistantPlanStep.input` is a single string; AI-boundary test forbids direct writes). Turning a natural-
   language request into a structured proposal is correctness-sensitive (mandate-enlargement risk); the human review
   this slice proves is the safeguard, but the producer itself is a separate slice.
2. **M365 param review schema** — M365 params are free-form `Record<string,unknown>` (no `InfraActionParamSpec`
   analog); this slice targets `mail.send` (reviewable to/subject/body) only. A generic review schema is future work.
3. **Live wiring of the proposal source** — the `proposal` prop is exercised by tests and is the composition seam; a
   production producer (AI turn or catalog-driven picker) feeds it in a later slice.
4. **Renderer reach to the capability model** — main-only, not IPC-exposed; a read-only bridge is future work.

## Next gate
Authorize the **AI → structured M365 action proposal producer** (main): natural-language request → validated
capability selection (Slices 4–6B) → concrete `{actionId, params}` proposal → deliver to `M365WritePanel.proposal`
for human review. Non-frozen; correctness-focused; human confirmation remains the safeguard.

---

## FINAL OUTPUT

- **STATUS:** IMPLEMENTED / TEST-VERIFIED (composition half). AI→params producer STOPPED as next gate.
- **HUMAN PRINCIPAL:** preserved (server-resolved `type:'HUMAN'`, renderer/AI cannot supply).
- **AI AUTHORITY:** absent (AI proposes only; never confirms/executes; AI-boundary 5/5 green).
- **CAPABILITY VALIDATION:** proven (Slices 4–6B; SELECTED ≠ authorization).
- **HUMAN CONFIRMATION:** proven (sole consent; effect-before-consent = 0; no TOCTOU).
- **M365 IPC:** unchanged. **CST:** unchanged.
- **ADMISSION:** existing (durable idempotency). **EFFECT:** governed (certified path).
- **UNKNOWN:** existing hold (honest OUTCOME_UNKNOWN, reconcile, no blind retry).
- **TENANT:** isolated (server-resolved; absent from request).
- **EVIDENCE:** correlated by authoritative ids (CST outcome + HoldStore); AI→proposal↔execution correlation deferred
  with the producer.
- **TESTS:** new UI 6/6; UI suite 242/242; main 8619/3-skipped; AI-boundary 5/5.
- **REGRESSION:** none. **FROZEN SURFACE:** only `M365WritePanel.tsx` (renderer, non-frozen).
- **CERTIFICATION:** NONE. **LIVE STATUS:** TEST-VERIFIED.
- **REMAINING GAPS:** AI→structured-params producer; M365 param review schema; live proposal wiring; capability IPC bridge.
- **NEXT GATE:** AI → structured M365 action proposal producer (main, non-frozen).

## STOP
First vertical slice's human-consent→certified-execution half implemented + TEST-VERIFIED, reusing the certified M365
path unchanged. No frozen surface, no new architecture, no live claim. HEAD `670b52e`; changes unstaged. No commit.
No push. STOP — do NOT start Wave 3.
