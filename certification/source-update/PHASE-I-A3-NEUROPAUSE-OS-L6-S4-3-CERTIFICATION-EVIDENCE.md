# OS-track L6 · S4.3 · CERTIFICATION — "S4 CAN PROPOSE; IT CANNOT REACH EXECUTION" · EVIDENCE

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: S4 CERTIFIED — TEST-VERIFIED, non-frozen.** The proposal engine is certified against the ten proofs after an
independent adversarial fleet (S4.2) hardened it. FREEZE INTACT. **⛔ HOLD: S5 (governance ALLOW/ASK/DENY wiring + the
certified-executor-only path) is its own hard stop with its own review package — no execution wiring exists.**

## The certified constitutional line
**S4 CAN PROPOSE; IT CANNOT REACH EXECUTION.** A proposal is inert DATA that traces to evidence + policy; it holds no
callable, token, credential, or `confirmed`; the producer has no import path into governance or execution. A proposal
becomes an effect ONLY by entering the EXISTING proposal → human-confirm → CST → admission → executor → verification →
ActionRecord chain — which S5 wires, behind its own gate.

## The ten proofs — each to a landed test
| # | proof | how certified | test |
|---|---|---|---|
| **1 · schema** | the artifact is EXACTLY the reviewed 18-field set | `Object.keys` equality | `proposal.test.ts` "all 18 fields" |
| **2 · tenant** | forms ONLY from a provably single-tenant, single-scope state; cross-tenant target/state/evidence and scope escalation are REFUSED/BLOCKED | S4.0 binding fixture + S4.2 fixes | `s4TenantUnification.test.ts` (4) · `proposal.test.ts` 1/1b/3b/9 |
| **3 · authority** | `authorityRequired` is DERIVED (no request field) AND validated (a no-approval authority is BLOCKED) | derivation + backstop guard | `proposal.test.ts` 2 |
| **4 · prompt-injection** | hostile narrative/params are inert DATA; derived authority/verification untouched (DATA ≠ INSTRUCTION) | | `proposal.test.ts` 6 |
| **5 · evidence** | a proposal is grounded (≥1), every ref RESOLVES to a real record, and every record is in the state tenant | | `proposal.test.ts` 3/3b/3c |
| **6 · risk** | `risk` + `reversibility` are carried as inert data fields (irreversible `mail.send` flagged) | field-set + inert-JSON | `proposal.test.ts` "all 18 fields" / zero-authority |
| **7 · verification-plan** | DERIVED from the oracle registry; **UNVERIFIABLE when no oracle** (never a false VERIFIED); an inconsistent plan is BLOCKED (§2#14) | | `proposal.test.ts` 8/8b |
| **8 · zero-authority** | the proposal is inert JSON (fully serializable, no callable/executor/`confirmed`); the producer imports TYPES only (no path into governance/execution) | round-trip + import scan | `proposal.test.ts` zero-authority + zero-runtime-import |
| **9 · replay** | `proposalId` is collision-resistant (different params/account → different id) AND idempotent (same identity → same id) | fingerprint of the executable core + target | `proposal.test.ts` "does NOT collide" + determinism |
| **10 · determinism** | pure over `(request, deps)`; `nowMs` + state hashes injected; no hidden nondeterminism (D-14) | same input → identical proposal | `proposal.test.ts` DETERMINISTIC |

## What the certification does NOT claim (honest boundary)
- `deps.authorityFor` / `deps.oracleFor` / the state hashes are INJECTED; the pure engine cannot police a malicious
  `deps`. What holds structurally: the REQUEST (from reasoning/bridge/model) carries no authority/verification field, so
  reasoning can never author them; the validation guards backstop a bad `deps`. The **derivation SOURCE is an S5 wiring
  contract** (RBAC/CST · oracle registry · real state hash) — recorded in the S5 review package.
- HOLD → reconciliation is **S22** (unbuilt); the plan states this, never promises it.
- The oracle is `mail.send` / single-recipient / send-corroboration (not delivery) / **not production-wired** — the plan
  says so, per §2#14; the ~30 Profile-A capabilities are honestly UNVERIFIABLE.

## Non-frozen — no FG gate
Certification over landed pure `main` modules + tests; no shared-type change, no IPC channel, no frozen touch. Proofs:
`proposal.test.ts` (19) + `purposeBridge.test.ts` (5) + `s4TenantUnification.test.ts` (4) + full main (**849 files, 8931
passed / 3 skipped**) + typecheck node + lint clean. Fleet synthesis: `L6-S4-2-INTEGRITY-FLEET-SYNTHESIS.md`.

## Live boundary (standing)
M365 `mail.send` is the SINGLE live governed consequential capability. S4 forms a certified proposal ARTIFACT — it reaches
no human confirmation and no executor. That is S5, behind its own hard stop.
