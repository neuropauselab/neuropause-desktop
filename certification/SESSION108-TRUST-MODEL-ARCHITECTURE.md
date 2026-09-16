# SESSION 108 — TRUST MODEL ARCHITECTURE DECISION

**Harvest H2** (S107 backlog): the multi-signal explainable **TrustModel** from `packages/ckdl/src/trust.ts`, adapted into the canonical live NeuroPause intelligence layer. **Advisory intelligence only.** Source package remains intact; no `@neuropause/ckdl` import; no second AI runtime; no authority granted.

> **TRUST IS ADVISORY.** A trust score is an explainable heuristic indicator of *evidence quality* — it is **not** authority, **not** permission, **not** business approval, **not** authentication. It never authorizes a user, approves a transaction, or influences RBAC / tenancy / CST / the approval engine / the command bus / any ERP mutation.

## 0. Why intelligence/, not liveBrain/

The directive allows either. **`apps/desktop/src/main/intelligence/`** is chosen because the adversarial requirement (Phase 8: prove trust can never become an authority bypass) is *strongest when the module has no import path to any executor/gate*. `liveBrain/` contains the execution gate (`executionGate.ts`) and the proposal boundary that feeds the certified `mail.send` capability; placing a trust score there sits one hop from authority-relevant state. `intelligence/` has zero executor/CST/command-bus coupling, so the "trust ≠ authority" boundary is *structural* (no wire exists) rather than merely *conventional*.

## 1. Trust input model (`TrustSignals`)
Harvested verbatim from source semantics: `sourceReliability?` (0..1), `freshnessAt?` (ms timestamp), `verified?`, `humanApproved?`, `aiConfidence?` (0..1), `auditIntact?`, `completeness?` (0..1). Every field optional; an absent field produces a caveat, never a fabricated value.

## 2. Evidence model
`assessEvidenceTrust(evidence, extra, opts)` derives signals from a set of evidence items (`{at, verified, sourceConfidence?, type}`): `sourceReliability = verified-share`, `freshnessAt = newest`, `verified = share>0.5`, `humanApproved = any type 'human-input'`, `aiConfidence = mean of sourceConfidence`, `completeness = clamp01(count/3)`. Empty set → `assess({completeness:0})`. Mirrors `ckdl` `assessEvidence` exactly.

## 3–7. Signals (weights harvested verbatim, human > audit > AI)
- **Human-approval** weight **1.5** (highest — a model's certainty must never dominate).
- **verified** / **auditIntact** weight **1.2**.
- **sourceReliability** / **completeness** weight **1.0**.
- **freshness** weight **0.8**, decays `0.5^(age/30d)`; caveat "underlying data is stale" when ≤0.5.
- **aiConfidence** weight **0.6** (lowest).
- **Missing-evidence:** every absent signal appends a named caveat ("human approval unknown", etc.).
- **Caveat signal:** always appends "heuristic indicator — not a probability of correctness".

## 8. Explainability output (`TrustAssessment`)
`{ score: number, band: 'low'|'moderate'|'high', components: {signal,value,weight,note}[], caveats: string[] }`. **Bands are harvested verbatim** (`<0.4` low, `<0.7` moderate, else high) — no new band invented. No "insufficient evidence" band exists in source, so none is added; low-evidence simply yields a low score + completeness caveat. A display label helper renders `LOW/MODERATE/HIGH` uppercase without inventing thresholds.

## 9. Tenant boundary
The pure assessor holds **no cross-tenant state** — it operates only on the signals/evidence the caller passes in. Tenant isolation is the caller's responsibility and is preserved because the live adapter reads a single recommendation's own evidence (already tenant-scoped upstream by the recommendations engine's `intelligence:read` handler). The module reads no store, no graph, no cross-tenant data.

## 10. Audit behavior
The pure core does **not** write audit (source's optional `recordAssessment` governance hook is deliberately **omitted** from the harvest — it is not needed for an advisory read and would couple the module to governance). The live consumer is a read-only recommendations computation; no durable write occurs.

## 11. Relationship to AI recommendations
Consumer: `recommendations/recommendationEngine.ts` (read-only, stateless, `intelligence:read`, zero executor/CST coupling; 4 live renderer surfaces). The engine's existing `RecommendationEvidence[]` + kind + entity freshness map to trust signals. The assessment **explains** a recommendation's evidence quality; it never changes whether the recommendation is produced or ranked for authority.

## 12. Relationship to CST — NONE
No import path from `intelligence/trustModel.ts` to `cst/`. Trust cannot reach admission, the execution gate, or `governedSend`. A trust score can never admit, refuse, or alter a governed transition.

## 13. Relationship to RBAC — NONE
Trust does not read, set, or influence permissions/roles/tenancy. Low or high trust leaves every authorization decision byte-identical.

## 14. Relationship to the approval engine — NONE
Trust does not enter `erp/approvalEngine`, `canEnterStatus`, machine-owned status, or SoD. It cannot approve, un-approve, or lower an approval threshold.

## Frozen-surface boundary (Phase 13 STOP)
Surfacing the explainable assessment to the user requires an **additive optional field** on the **frozen** `Recommendation`/`RecommendationSet` type (`packages/shared`) plus a renderer display — a frozen change requiring an **FG gate + literal token + choreography**. Per Phase 13 this session does **not** touch the frozen surface: it lands the harvested TrustModel + the live adapter + full tests + adversarial proofs, proves the capability is genuinely computed over real recommendation evidence, and **prepares the FG gate** (exact diff + threat analysis + verification plan + real-Electron journey) for the user-visible hop — **STOP for the token**. This is the documented non-orphan integration blocker (Success Criterion 7, second branch).
