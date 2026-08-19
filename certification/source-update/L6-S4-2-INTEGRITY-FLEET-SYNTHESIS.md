# L6-S4.2 · Integrity Fleet — SYNTHESIS · EVIDENCE ARTIFACT

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## Provenance
Independent 9-attack adversarial fleet (12 read-only `Explore` lenses) run UNINTERRUPTED in a declared QUIET WINDOW per
**D-15**; **12/12 reported, 0 errors, ~616K subagent tokens, ~8 min.** Each lens tasked to FALSIFY the S4.1
by-construction claims — including attacking the derivation rules themselves. Full raw: `tasks/wg0p3vmh3.output`. The
fleet was decisively better than the by-construction claims: **it falsified nine defects across strong multi-lens
consensus.** All falsified findings were fixed **failing-test-first** (the HIGH set demonstrated RED→GREEN) and the suites
re-run (liveBrain 61, full main 849 files / 8931 passed / 3 skipped).

## FALSIFIED → FIXED (failing-test-first)
| # | Finding (severity, consensus) | Fix landed |
|---|---|---|
| **1** | **HIGH — scope escalation (≈8 lenses).** `request.scope`/`target.scope` were validated against EACH OTHER, never the STATE's proven scope; `LiveBrainState` exposed no scope. A request could claim `ws-EVIL` (matching its own target) while the state is proven `ws-A` → PROPOSED (cross-workspace confused deputy). | `LiveBrainState.tenantScope` now exposes the reconciled stamp scope; `buildProposal` REFUSES unless `request.scope === target.scope === state.tenantScope`. |
| **2** | **HIGH — cross-tenant EVIDENCE.** `request.evidence` was resolved by `resolveEvidence(ref)→boolean` with no tenant; a record from tenant B could enter a tenant-A proposal. | `resolveEvidence` now returns `{tenantId}\|null`; `buildProposal` BLOCKS an unresolvable ref AND any ref whose record tenant ≠ `state.tenantId`. |
| **3** | **HIGH — stale window request-controlled.** `freshnessWindowMs` was a REQUEST field; `MAX_SAFE_INTEGER` → never expires. | Moved to `ProposalDeps` as a GOVERNED policy constant; the request has no field to inflate it. |
| **4** | **MED — proposalId collision.** The id omitted params/account/target; two different sends aliased to one id (replay hazard). | The id now includes a stable canonical fingerprint of `{capabilityId, params, target, selectedOption}` (`stableStringify`, no crypto import). |
| **5** | **MED — reject-reason leak.** REFUSED/EXPIRED/BLOCKED reasons echoed tenantId/scope/capability — probing the state via reasons. | Reject reasons are now GENERIC (no identifiers); pinned by a no-leak test. |
| **6** | **HIGH — bridge maps global route membership.** `purposeBridge` mapped `ev.proposal.capability` if it was ANY route; an untrusted `propose()` naming e.g. `mail.deleteAllFolders` could map. | The bridge grounds to the purpose's OWN route (the single L4 route whose `purpose === ev.purpose`) AND requires `ev.proposal.capability` to MATCH it; a mismatch → NOT_READY. |
| **7** | **HIGH — authorityFor embedded unvalidated.** A crafted `deps.authorityFor` returning `requiresApproval:false` was embedded verbatim (attack-2's test even asserted adoption). | `buildProposal` BLOCKS if the derived authority does not require approval — the Brain never proposes an auto-approved action. |
| **8** | **HIGH — oracleFor embedded unvalidated.** A contradictory plan (`verifiable:'send-corroboration', oracleId:null, productionWired:true`) was embedded → a false VERIFIED-capable promise. | `buildProposal` BLOCKS an internally-inconsistent plan (verifiable ⇒ oracleId; unverifiable ⇒ needs). §2#14 honesty enforced at the artifact boundary. |
| **9** | **MED — empty evidence vacuous.** `evidence:[]` passed the resolve check and freshness trivially → an ungrounded "certified" artifact. | A proposal now REQUIRES ≥1 evidence record → else BLOCKED. |

**Reproduce-first (HIGH set):** with the scope, evidence-tenant, and authority guards reverted, the three attack tests
failed RED; restoring the fixes → GREEN, no residue. The fleet is recorded as the DISCOVERER.

## CONFIRMED under attack (positive verification — recorded)
- Cross-tenant **TARGET** (`target.tenantId ≠ state.tenantId`) → REFUSED; a mixed-tenant STATE → `tenantProvable=false` →
  REFUSED (the S4.0 tenant guard held).
- A **conflicted state** → BLOCKED; a tenant/evidence conflict always populates `state.conflicts` (lens 7 all CONFIRMED).
- Reject branches carry **NO proposal object** (structural, union type) — only the reason leaked (fixed).
- **state-hash change → EXPIRED** held; **determinism** (same input → same output) held; **prompt/model manipulation** —
  hostile narrative/params are inert DATA, the derived fields are untouched (held).

## Trust contracts recorded for S5 (not pure-function-falsifiable)
`deps.authorityFor` / `deps.oracleFor` / the state hashes are INJECTED — the pure engine cannot prevent a malicious
`deps`. The guarantee that holds structurally: the REQUEST (from reasoning/bridge/model) carries no authority/verification
field, so reasoning can never author them. The **production wiring (S5) MUST** supply `authorityFor` from RBAC/CST via L4,
`oracleFor` from the oracle registry, and the state hashes from the actual state — never from reasoning. The new
validation guards (requiresApproval, plan-invariant) are a backstop, but the derivation SOURCE is an S5 wiring contract,
recorded in the S5 review package.

## Bottom line
The independent fleet found what by-construction claims could not — nine real defects, seven of them the exact
confused-deputy / trust-boundary escalations the operator named. All fixed failing-test-first; the S4.1 engine is now
adversarially hardened. This is the evidence S4.3 certifies against.
