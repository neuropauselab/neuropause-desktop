# L6-S4 · Independent 12-Lens Fleet Audit — SYNTHESIS · EVIDENCE ARTIFACT

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## Provenance (the audit is itself evidence)
Run UNINTERRUPTED in a declared QUIET WINDOW per **DECISIONS D-15** (mechanism stated at launch: quiet window; the
operator held all messages until completion). **12/12 read-only `Explore` lenses reported, 0 errors, ~984K subagent
tokens, ~19 min.** Independent adversary (not the builder), tasked to FALSIFY each pin/claim. Full raw output:
`tasks/wjvn07kpf.output` (1165 lines). This synthesis records BOTH halves per the operator rule: CONFIRMED claims as
POSITIVE verification (surviving adversarial read is a result), FALSIFIED claims CORRECTED up front. Every correction that
touched a landed pin was fixed + the suite re-run before proceeding (full main **845 files / 8902 passed / 3 skipped**).

---
## PART A — LANDED CODE (S1/S2/S3): what the audit found and what I did

### A1 · CONFIRMED under adversarial attack (positive verification — recorded, not a non-event)
- **Pure join / no store (S1)** — synchronous, deterministic, no I/O; ActionRecord enters as a TYPE only; the disk-backed
  `actionRecord.query` is never called. Held under attack (grep for async/fs/query/clock/random all clean).
- **Zero-runtime-import (S1/S2/S3)** — all three modules import only `import type`; no value/side-effect import, no path
  into governance/execution. (The PIN itself was weak — see A2/F8 — but the PROPERTY held.)
- **CONFLICTING surfaced, never auto-reconciled (S1)** — each conflict keeps both claims; each conflicted section renders
  a CONFLICTING marker, never one side's data.
- **S2 provenance completeness + traceability** — every fact carries a non-empty {layer, evidence}; every DATA-fact
  evidence ref dereferences to a real input object; coherence with S1 is structural (both pure joins over identical
  inputs), pinned against the REAL `composeLiveBrainState`.
- **S3 NO-PROPOSAL boundary** — the strongest crossing input (a CONSENT_READY purpose with a formed proposal + routable
  caps + a verified action) yields only analysis; the fixed 8-key object literal cannot gain a 9th authority-bearing key;
  the L5 `PurposeProposal` never flows through S3.
- **Substrate re-grounding (independent)** — 6/6 grounding claims re-verified against real code (L1 shape+fail-closed,
  L2 four-states, L3 never-scan, L4 routes+gaps, L5 nine-state ladder, S34a chain+verification), and the **D-14
  correction CONFIRMED**: `actionRecord.query` is genuinely async + disk-backed, so S1 correctly takes injected
  `ActionRecord[]`.
- **§2#13 / §2#6** — the Brain only OBSERVES; no model feeds S1–S3; tenant/scope derive from the L1 read-model, never
  from any AI input.

### A2 · FALSIFIED / CORRECTED up front (fixes landed + suites re-run)
| # | Finding (severity) | Correction landed |
|---|---|---|
| **F1** | **HIGH — verification terminal vocabulary mismatch (fake-green).** The real send oracle emits `VERIFY_FAILED` (not `VERIFIED_FAILURE`); S1/S2 only matched `VERIFIED_SUCCESS`/`VERIFIED_FAILURE`, so a real verified-FAILURE and every unresolved terminal (`HOLD`/`UNKNOWN`/`VERIFY_PENDING`) were laundered into "no incidents / health observed / KNOWN". Tests passed only because they used a string the pipeline never emits. | Added a **canonical `classifyVerification`** (success=`VERIFIED_SUCCESS`; failure=`VERIFY_FAILED`\|`VERIFIED_FAILURE`; unresolved=HOLD/UNKNOWN/VERIFY_PENDING/**unrecognised→deny-by-default**) in S1 + the mirrored `verificationCertainty` in S2. Conflict-check 2, `incidents`, `evidence`, `pendingWork` all use it. **Tests rewritten to the REAL vocabulary** (`VERIFY_FAILED`, `HOLD`) so the pins bite. |
| **F2** | **MED — S1 discovery section launders UNKNOWN→KNOWN.** It read `KNOWN` on `results.length` without inspecting per-result state; an all-UNKNOWN L3 run read KNOWN/"observed". | `discoverySection` now mirrors `envSection`: any UNKNOWN result → UNKNOWN, any UNAVAILABLE → UNAVAILABLE, else KNOWN. Pinned. |
| **F3** | **MED — health rollup excluded incidents/pendingWork.** Health could read KNOWN/"observed" while a verified failure (incidents=CONFLICTING) or an unresolved verification (pendingWork=UNKNOWN) sat unflagged — a "green pixel with no proof". | `incidents` + `pendingWork` are now folded into the health rollup. A verified failure or unresolved verification pulls health down. Pinned (routed AND non-routed failure cases). |
| **F4** | **MED — S3 `could` scope-conflict leak.** A scope conflict (`about:'tenant scope resolution'`) didn't exclude routable caps from `could`, so a scope-disputed capability was offered as proposable — auto-picking one side. | `could` now returns `[]` when scope is disputed, and otherwise excludes the EXACT conflicted capability ids. Pinned. |
| **F5** | **MED — S3 `changeReport` had no subject-identity guard.** A prior from a different tenant/scope produced a field diff mislabeled `determinable:true` — a fabricated-looking temporal delta. | Guard added: `previous.tenantId !== current.tenantId` (or scopeResolved differs) → `determinable:false`, honest note, no changes. Pinned. |
| **F6** | **MED — §4 fiction comment.** The S1 header asserted "the production call-site does the query…" — no such caller exists. | Reworded to a **DESIGN CONTRACT** ("wherever L6 is wired the caller MUST…"), explicitly marking the wiring an open gate; §4's no-orphan rule satisfied via the NP_STATE gate, not a false claim. |
| **F7** | **LOW — `scopeResolved` read "settled" when disputed / tenantId null.** | `scopeResolved = !scopeConflict && (any resolves)` — a disputed scope is not resolved. Pinned. |
| **F8** | **LOW/HIGH-latent — zero-runtime-import pins missed bare side-effect imports AND dynamic `import()`/`require()`** (a live pattern in this repo). An adversary could keep static imports type-only and `await import('../cst/…')` at call time. | All three pins **hardened**: reject any top-level line that is not `import type …`, and reject `import(`/`require(`. |
| **F9** | **LOW — `routedCaps` not scope-guarded** (defense-in-depth). | `routedCaps` now built only when `capabilities.scopeResolved`. |
| **F10** | **LOW — `authority` section conflated the AUTHORITY power.** It was derived from L4 route existence, not principal permission, yet named `authority`. | **Renamed `authority` → `governedPaths`**; summary says "a governed PATH exists — not a per-principal permit". Pinned. |
| **F11** | **LOW — `could` conflict-exclusion used fragile substring `.includes()`.** | Replaced with exact capability-id parsing (`^capability "(.+?)"`) + set membership. |

### A3 · CONCERNS recorded for the substrate (not L6 fixes; noted for their owners)
- **L4 certified-only is guarded by `c.mutates`** — reads legitimately route without mutation-certification, so the CODE
  is correct but the header doctrine ("routable only when governed-certified") is too broad. Recommend tightening the L4
  header to "uncertified MUTATIONS are excluded" + a non-mutating-uncertified test. (Not a live breach: production wiring
  hardcodes `mutates:true`, so today's routable set is exactly `{mail.send}`.)
- **S34a `ActionRecordVerification.terminal` typed `string`** — recommend a union so S1/S2's comparisons are compiler-checked.
- **S34a `recordVerification` empty-`transitionId` mis-attribution + latest-ACKNOWLEDGED match** — recommend refusing an
  empty key and matching by a stable id. (Latent; the S16 chain ran once with a non-empty transitionId.)
- **S1 cross-namespace key assumption** (`actionId == capabilityId`) underpins conflict-checks 2/3; holds for `mail.send`
  today but is unproven for future capabilities → an S4 wiring test must drive real discovery-catalog ids, not literals.

---
## PART B — S4 DESIGN (feeds review-package items 3/4/5): findings the schema MUST honor

### B1 · TENANT BOUNDARY — the top precondition (HIGH)
The dual-authority case (a background principal in a quiet window vs the session-scoped catalog/accounts) can form a
proposal whose EVIDENCE is Tenant A and whose TARGET account is Tenant B — the L6 join does NO tenant-identity cross-check
and the L4/L2/L3/L5 snapshots carry no `tenantId` to check (only L1 does). **Required before S4:** (a) wire ALL six inputs
from ONE tenant authority; (b) add an authoritative `tenantId` to every snapshot and make a tenant mismatch a first-class
CONFLICTING (never a silent join); (c) S4 refuses to produce from any state whose evidence is not provably single-tenant;
(d) a two-tenant fixture test proving the refusal. *This is the #1 item S4 wiring must satisfy — recorded in item 5.*

### B2 · PROPOSAL SCHEMA authority containment
The DATA-only spine has a landed precedent (propose carries no `confirmed`/actor/tenant; execution is a separate
confirmed+authoritative-actor channel; params re-validated + capability re-resolved server-side). But three net-new fields
must be pinned as NON-BINDING data: **REQUIRED AUTHORITY** = a demand naming the GATE class (governance re-derives the real
approver and ignores the field); **EXPECTED RESULT** = inert prediction never consumed by the verifier; **VERIFICATION
PLAN** = a declarative `{oracleId, matchTupleRule, backoff}` — runtime injects deps post-effect; NO callable/oracle handle.
(Details → item 3 worked example, item 5 pins.)

### B3 · VERIFICATION PLAN realism
The S16 oracle exists ONLY for `mail.send`, corroborates a SINGLE recipient (`recipients.length === 1`), means
**send-corroboration (≤~37s, no NDR), NOT delivery**, and is **NOT production-wired** (`s16VerifyRun` is E2E-gated/
structurally absent from release; ~30 governed capabilities are UNOBSERVABLE — Profile A). So the field must be
**per-capability** ("independently verified WHERE POSSIBLE"), disclose the send-vs-delivery caveat, run **per-recipient**
for N>1, and mark HOLD→reconciliation as dependent on unbuilt **S22**. (→ item 3 worked example uses single-recipient
`mail.send` with honest labels.)

### B4 · S4 PRODUCER import isolation
A single-file types-only regex is INSUFFICIENT for S4: it misses dynamic `import()`/`require()` and multi-file transitive
closure. **Item-5 pins:** (1) hardened static import check (as F8, extended); (2) a behavioral test that the producer's dep
interface exposes NO executor/CST/admission (mirroring `capabilityProposeCore.test.ts`); (3) inherit the D-14 ActionRecord
negatives; (4) import only verifyEffect TYPES (never the value or `m365ReadBack`/`s16VerifyRun`).

### B5 · INJECTION / untrusted data
The landed S1→S2→S3 chain reduces external content to opaque fingerprints/counts (all injection claims FALSIFIED = GOOD).
**But** PROPOSED-ACTION params must NOT be sourced from S2 evidence (no recipient/body there) — they must inherit S13
recipient-literalism (recipients only from the operator's mandate). Narrative fields (OBSERVATION/DIAGNOSIS/EXPECTED
RESULT) are inert display data (control-stripped like `clean()`), and the confirmation UI foregrounds the authoritative
params so a persuasive proposal cannot socially-engineer the one human confirmation. (→ items 3/5.)

### B6 · L5 OPERATIONAL BRIDGE — sequencing
CONFIRMED proposal-adjacent → stays behind the S4 gate (its output IS the BRAIN→PROPOSAL step). Building it FIRST means
inventing an ungoverned proposal shape (circular — S4 defines the shape). Its `authority` seam must read a read-only POLICY
FACT (is-permitted), never the CST admission verdict; zero-value-import pin extended (no `@neuropause/cst`).
**Auditor recommendation to the operator: build bridge-WITH-S4 (behind the gate)** — the decision is yours at the review
(item 4).

---
## Bottom line
The independent fleet did exactly what a self-review could not: it falsified **two HIGH-severity fake-greens** (F1) plus
nine further landed-code corrections, all now fixed with the pins re-pointed at the REAL vocabulary and re-run green. The
S4 design is achievable on landed precedent, but only with the tenant-boundary precondition (B1) and the schema/isolation
pins (B2–B6). None of this is proposal code — it is the evidence the S4 gate reviews.
