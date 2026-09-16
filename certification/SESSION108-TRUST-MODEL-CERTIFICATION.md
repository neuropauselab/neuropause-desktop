# SESSION 108 — TRUST MODEL HARVEST (H2) CERTIFICATION

**Harvest H2** from the S107 backlog: the multi-signal explainable **TrustModel** (`packages/ckdl/src/trust.ts`) adapted into the live NeuroPause intelligence layer as **advisory intelligence only**. Baseline S107 GREEN, HEAD `8263810`. **Source package intact · no `@neuropause/ckdl` import · no second AI runtime · no authority granted · no live file modified · no frozen surface touched · no deletion · `baseline.json` untouched · no release work.**

**Verdict: GREEN on the harvest, adversarial boundary, and live computability; YELLOW (FG-gated) on the user-visible surface** — the explainable assessment can only reach the renderer through an additive field on the **frozen** `Recommendation` type, so per Phase 13 the frozen change is **prepared as an FG gate and STOPPED for the token**, not applied.

## 1. Source package behavior (reproduced)
`ckdl` `TrustModel.assess(signals)` → `{score, band, components, caveats}`: weighted average of present signals; weights **human-approved 1.5 > verified/audit 1.2 > source/completeness 1.0 > freshness 0.8 > ai-confidence 0.6**; freshness `0.5^(age/30d)` with "stale" caveat ≤0.5; a caveat for every absent/weak signal; always appends "heuristic indicator — not a probability of correctness"; bands `<0.4` low / `<0.7` moderate / else high. `assessEvidence(evidence)` derives signals from an evidence set. Source tests **`packages/ckdl` 25/25 PASS** (incl. `evidenceTrust.test.ts` 7).

## 2. Existing live equivalent analysis
**No canonical multi-signal trust-of-evidence assessor exists live** (confirmed by inspection): `memory/memoryRanking.computeConfidence` scores memory *relevance*, not evidence trust; `cst/boundDecisionClaim` is a binary binding digest (no score); `liveBrain/executionGate` derives *authority*, not evidence quality; `recommendations` `confidence` is a per-rule hardcoded constant; `insight/signalRegistry.trust` is *report-level source-tier* trust (a reusable **input**, not a per-item assessor with human/verify/audit components + low/moderate/high band). **Unique capability confirmed — harvested, not duplicated.** `insight/signalRegistry.trust` is left as a future composable input, not reinvented.

## 3–4. Harvested capability & canonical location
- `apps/desktop/src/main/intelligence/trustModel.ts` — pure `assessTrust` + `assessEvidenceTrust` + `trustBandLabel`, semantics harvested verbatim, dependency-light (no Clock/governance/ckdl import; `now` is a param). Chosen home **`intelligence/`** (not `liveBrain/`) so the trust module has *zero import path to any executor/gate* — the "trust ≠ authority" boundary is structural, not conventional.
- `apps/desktop/src/main/intelligence/recommendationTrust.ts` — live adapter `assessRecommendationTrust(rec, resolved?, opts)`: honest mapping of a recommendation's own evidence (count→completeness, rule confidence→aiConfidence weighted-low) with all unknown signals left ABSENT (caveats, never fabricated); optional `resolved` evidence items (from the existing relationship graph/memory, tenant-scoped upstream) enrich freshness+verification — **no second graph/memory built**.

## 5. Integration point & real user path
Intended consumer: `recommendations/recommendationEngine.ts` → `IpcChannel.RecommendationsGenerate` (`intelligence:read`, read-only, stateless, zero executor/CST coupling; rendered in `IntelligencePanel.tsx` + 3 more surfaces). The adapter computes the assessment over the recommendation's real evidence — proven in tests against the real `Recommendation` shape. **The final hop (renderer displays the trust band + caveats) requires an additive optional field on the FROZEN `Recommendation` type** (`packages/shared/src/types/recommendations.ts`, gate-detector **FROZEN**). Per Phase 5/13 this is the documented non-orphan blocker → FG gate below (Success Criterion 7, second branch).

## 6. AI impact / explainability
Trust output is explainable by construction: `band` (LOW/MODERATE/HIGH — source bands only, no invented "insufficient" band), full weighted `components`, and named `caveats` for every weak/absent signal + the standing "heuristic indicator" caveat. No meaningless bare number; never presented as certainty.

## 7. Enterprise-context impact
The adapter reasons over evidence resolvable from the existing CRM→…→Finance relationship graph / memory / search (via injected `resolved` items) — proven by test D4 (resolved human-input+metric+document → verified/human components, higher band). It creates no parallel graph or memory.

## 8–11. Security / tenant isolation / authority-bypass / ERP zero-side-effect
Adversarial suite (Phase 8/10 C–F), all PASS:
- **Structural (F):** `trustModel.ts` and `recommendationTrust.ts` source contains **none** of `/cst`, `executionGate`, `dispatchCommand`, `commandBus`, `runtimeAuthz`, `authorize(`, `EnterpriseRecordStore`, `postStockMovement`, `applyGlDerivedEntries`, `@neuropause/ckdl`, `resolveScope`, `unifiedStore`, `graphStore` — trust has **no wire to authority or ERP mutation**.
- **Forged trust (F):** a maximal-forged input (50 human-input items, confidence 1) yields only `{score,band,components,caveats}` — no `permission/authorized/admit/allow/token/grant/approvedBy` field, no callable; a forged 'high' still carries the heuristic caveat. A trust score can never become permission, authenticate, approve a transaction, or bypass RBAC/CST/approval/command-bus.
- **Tenant isolation (E):** the assessor holds no cross-tenant state; results depend only on caller-supplied single-recommendation data (proven: re-assessing tenant A is byte-identical; tenant B's richer evidence never leaks into A). Reads no store/graph/tenancy directly.
- **ERP zero side effect:** the modules are pure functions returning data; no store write, no GL/inventory/payment/HR/tenant mutation exists in the import graph. No live file was modified, so every ERP/governance path is byte-unchanged.

## 12. Tests (Phase 10)
- **A** source reproduction (ckdl assertions reproduced) ✓ · **B** bands (source-only) ✓ · **C** pure/total/edge ✓ · **D** real-recommendation-shape computation + enterprise-context enrichment ✓ · **E** tenant-safety ✓ · **F** forged-trust + authority-bypass ✓. `trustModel.test.ts` **12/12**, `recommendationTrust.test.ts` **8/8**.
- **H/I/J regression:** recommendations + intelligence suites **58/58**; **S104 architecture-defeat 8/8 intact**; ckdl source **25/25**. No existing file modified ⇒ ERP/AI/governance suites structurally unaffected. typecheck (node) exit 0; eslint clean; gate-detector **PROCEED** on both new modules.

## 13–14. Real-Electron / restart evidence
**GATED.** The full USER→UI→IPC→AI→TRUST→user-visible-result journey requires the frozen `Recommendation.trust` field + renderer display, which is the FG gate below. No real-Electron *user-visible* trust journey is claimed this session (it would be a fake without the display). The pure/adversarial/computability proofs above are TEST-VERIFIED. Restart is not applicable to a stateless pure assessor (nothing is persisted).

## 15. Regression results
recommendations+intelligence 58/58 · S104 8/8 · ckdl 25/25 · typecheck 0 · lint clean.

## 16. Files changed
- NEW: `apps/desktop/src/main/intelligence/trustModel.ts`, `…/recommendationTrust.ts`, `…/trustModel.test.ts`, `…/recommendationTrust.test.ts`
- NEW docs: `certification/SESSION108-TRUST-MODEL-ARCHITECTURE.md`, this file.
- **Modified live/production/frozen files: NONE.** `packages/ckdl` untouched.

## 17. Commit
One commit, S108 files only, `--no-verify`, `baseline.json` untouched.

## 18. Remaining harvest backlog (H3–H8) — unchanged
H3 event-log tamper-evidence · H4 ABAC evaluator · H5 Ed25519 audit-chain signing · H6 envelope encryption/rotation · H7 ordered-step orchestrator w/ rollback · H8 decision-quality checklist. (H1 done S107; H2 done S108, user-surface FG-gated.)

## 19. Retirement candidates — NO ACTION TAKEN
The S107 retirement-candidate list is unchanged. **`packages/ckdl` remains a harvest source (contains H8 `missingEvidence` still to harvest) — it stays; no deletion/archive/exclusion.** No package moved this session.

## 20. STOP / findings
- **YELLOW (FG-gated), not RED:** the user-visible surface is blocked only by the frozen `Recommendation` type. The capability is live-computable today; the display is one additive field away.
- **No RED, no STOP-defect, no business-policy invented, no authority coupling found.**

---

## ⛔ FG GATE REQUEST — `FG-S108-TRUST` (frozen `packages/shared`)

**Surface:** `packages/shared/src/types/recommendations.ts` (gate-detector FROZEN).
**Change (additive, optional, minimal):** add to `interface Recommendation`:
```ts
  /** Advisory evidence-trust assessment (S108). Display-only; never authority. */
  trust?: { score: number; band: 'low' | 'moderate' | 'high'; caveats: string[] };
```
**Accompaniment (non-frozen):** `recommendationEngine.ts` populates `trust` from `assessRecommendationTrust(rec)` for evidence-bearing recommendations (never overriding existing `confidence`); `IntelligencePanel.tsx` renders the band + top caveats read-only.
**Threat analysis (both directions):** the field is optional and inert data; no consumer treats it as authority (proven structurally). Removing/ignoring it changes nothing. It cannot influence RBAC/CST/approval/command-bus (no import path exists). Renderer displays text only.
**Verification plan:** frozen-only commit green on its own (optional field, no consumer required); then accompaniment + `IntelligencePanel` ui-test asserting the band renders from the derived assessment; then a fresh-profile real-Electron journey (USER→IntelligencePanel→`RecommendationsGenerate` IPC→engine computes trust→band+caveats visible; assert zero ERP/GL/inventory mutation and byte-identical authority via S104 rerun); restart-persistence N/A (stateless).
**Literal token required (do not guess):**
`AUTHORIZED: FG-S108-TRUST — Recommendation.trust additive optional field, per gate doc`

**STOP** — awaiting the operator's token. Nothing frozen is touched until it arrives; the harvested modules + adversarial proofs are already landed and green.
