# Phase I-A.1 — Boundary-A Authority Strengthening: Evidence

**Status: IMPLEMENTED + VERIFIED — AWAITING REVIEW. Not committed.** Kernel,
`executor.ts`, `mail.ts`, `runBinding`, `governedSend`, `secureBridge.ts`, the
`GovernanceVerdict`/`ProposalApproval` contracts, and CST are unchanged.

## Identity Semantic Contract (frozen)
`actor()` in this change = **the authenticated approver principal identifier** (stable
`user.id`). It is **NOT** the complete NeuroPause Operational Identity (NOI):
```
NOI = PERSON + ACTIVE ROLE + ORGANIZATION + WORKSPACE + AUTHORITY + CAPABILITIES + POLICY CONTEXT
actor() ⊂ NOI   (the authenticated-principal component only)
```
This phase **does not** create, redesign, or complete NOI. `actor: string | null` is a
Phase I-A.1 implementation primitive, not the finished identity model.

## Approval ≠ Authority (frozen)
This change establishes **truthful provenance for the approval decision only**. It does
**NOT**: create an AuthorityLease · grant execution authority · authorize `runBinding`
or `M365Executor.execute` · satisfy the execution gate · resolve H-FINDING-3. Approval
remains *evidence of an admission decision*; execution authority is a separate
downstream control (AuthorityLease → technical qualification → ExecutionEnvelope →
ExecutionGate → atomic ExecutionClaim → idempotency → execution).

## What changed (implementation surface)
- **`workforce/index.ts`** — `actor: () => string | null` added to
  `WorkforceSubsystemDeps` (REQUIRED); both `WorkforceProposalApprove` and
  `WorkforceProposalReject` handlers resolve the authoritative approver and **omit
  `r.now`** (runtime clock applies).
- **`workforce/approverAuthority.ts`** (new) — `resolveAuthoritativeApprover(actor,
  action)`: returns the principal or **fails closed** (no fallback). Standalone so the
  fail-closed contract is unit-testable without the Electron module graph.
- **`runtimeCore.ts`** — wires `actor: () => authService…session.user.id` into
  `initWorkforce` (line 762), from the same identity authority the data-plane/connectors
  use.
- **Tests** — new `workforce/authorityStrengthening.test.ts` (5); +2 assertions in
  `workforce/runtime/workerRuntimeExecution.test.ts`.

## Security / provenance invariants (verified)
| ID | Invariant | Status | Basis |
|---|---|---|---|
| INV-ACTOR-01 | successful approval records the authenticated `user.id` | PASS | runtime test: `decidedBy==='alice'` (passed principal); handler passes `user.id` |
| INV-ACTOR-02 | renderer payload cannot determine `decidedBy` | PASS | handler reads only `deps.actor()`; `resolveAuthoritativeApprover` takes the accessor, never a payload |
| INV-ACTOR-03 | `actor()===null` ⇒ no authoritative approval | PASS | fail-closed test (throws before `approveProposal`) |
| INV-ACTOR-04 | literal `'user'` is never an identity fallback | PASS | no-fallback test; scan shows `'user'` gone from approve/reject |
| INV-TIME-01 | `decidedAt` from the trusted runtime clock | PASS | runtime test: `decidedAt===NOW` with `now` omitted |
| INV-TIME-02 | renderer `r.now` cannot determine `decidedAt` | PASS | scan: 0 `r.now` in approve/reject |
| INV-AUTH-01/02 | authorization unchanged, still vs the authenticated principal | PASS | `requireAuth`+`workforce:approve` untouched |
| INV-GOV-01/02/03 | no execution authority / AuthorityLease / token created | PASS | none added |
| INV-EXEC-01/02 | `runBinding` unchanged; no new consequential effect permitted | PASS | frozen-surface check |

## Test matrix
| # | Scenario | Coverage |
|---|---|---|
| A | authenticated approval ⇒ `decidedBy = user.id` | runtime test (`decidedBy==='alice'`) + handler passes `user.id` |
| B | renderer `actor=ADMIN`, auth=U ⇒ `decidedBy=U` | structural: handler ignores payload actor; `resolveAuthoritativeApprover` reads only the accessor |
| C | no actor ⇒ fail closed, no record | `resolveAuthoritativeApprover(()=>null)` throws (approval + rejection) |
| D | null ⇒ `decidedBy != 'user'` | no-fallback test (returns undefined on null, never a marker) |
| E | renderer `r.now` attack ⇒ `decidedAt` = runtime value | INV-TIME-01/02 (runtime clock; `r.now` dropped) |
| F | lacks `workforce:approve` ⇒ denied | authorization unchanged (`authzGate`) |
| G | rejection provenance = `user.id` | reject handler uses `resolveAuthoritativeApprover(...,'rejection')`; symmetric |
| H | worker isolation — approval ≠ execution authority | Approval≠Authority section; `runBinding` unchanged |
| I | existing regression | **794 files / 8272 tests pass, 3 skipped** |

## Approval state transition (fail-closed)
```
proposal → authenticated principal → authorization → approval attempt
  → authoritative actor capture → governance decision                (actor present)
  → actor unavailable → FAIL CLOSED → no authoritative approval        (actor null)
```
Never `actor unavailable → 'user' → approved`.

## Crash / restart
**Does this change alter crash/restart semantics? No.** It changes only *which string*
is recorded as the approver and *which clock* stamps `decidedAt`. No persistence, replay,
consumption, revocation, or recovery behavior is added or altered. Replay/consumption/
revocation/recovery remain for the future bound-token / effect-boundary gate.

## Negative-control source scan (affected workforce path)
- **Legacy `'user'` approver fallback:** **NOT FOUND** in the approve/reject handlers
  (they pass the resolved `approver`; remaining `'user'` at lines 97/388/402 are
  comments).
- **Renderer `r.now` as authoritative approval time:** **NOT FOUND** (0 occurrences in
  approve/reject).
- **New actor fallback:** **NOT FOUND** (`resolveAuthoritativeApprover` throws on null).
- **Sibling finding (RECORDED, out of scope — I-A1-NOTE-1):** `runJob` still defaults the
  **requester** field `requestedBy: r.requestedBy ?? 'user'` / `'user'`
  (`workforce/index.ts:359,528`). This is the *job requester*, a **different** provenance
  field on a **different** seam than the approval `decidedBy`. It is the *same class* of
  non-authoritative-provenance pattern and is **deferred** — I-A.1 scopes only the
  approval/rejection seam. Not fixed here (would broaden scope).

## Frozen surfaces (verified unchanged)
kernel (vendored tgz) · `connectors/m365/executor.ts` · `mail.ts` ·
`infrastructure/executor.ts` · `secureBridge.ts` · `cst/sendTransition.ts` (governedSend)
· `workforceJobs.ts` (`ProposalApproval`/`GovernanceVerdict`) · `workerRuntime.ts` ·
`runBinding` (runtimeCore ~2482; the only runtimeCore change is at line 762).

## Certification wording
**Permitted:** *"Boundary A captures the authenticated approver principal from the
main-process authentication authority and records authoritative runtime time.
Renderer-supplied identity and renderer-supplied governance time do not determine the
approval provenance."*

**NOT established:** complete NOI binding · execution authority · AuthorityLease validity
· Boundary-B enforcement · universal consequential-action coverage · governance-token
integrity · replay protection · complete path assurance. No "certified/secure/zero-bypass/
universal" claim.

## Status
- **I-FINDING-1: RESOLVED** (pending commit) — the approval boundary now binds an
  authoritative approver + authoritative time.
- **H-FINDING-3: REMAINS OPEN** — `runBinding` still lacks consequential-effect
  enforcement.

## Diff budget
Production: `workforce/index.ts`, `runtimeCore.ts` **+ `workforce/approverAuthority.ts`**
(one additional production file — justified: extracting the fail-closed helper into a
dependency-free module is the minimal way to unit-test it, because importing
`workforce/index.ts` loads `unified/storeInstance.ts` → Electron `app.getPath` at module
load, which is undefined under vitest). Tests: `authorityStrengthening.test.ts` (new) +
`workerRuntimeExecution.test.ts` (+2 assertions). No frozen surface changed.

## Decision gate
**READY FOR COMMIT — pending explicit authorization.** (PLAN → IMPLEMENT → VERIFY →
REVIEW → **STOP**. No commit until instructed.)
