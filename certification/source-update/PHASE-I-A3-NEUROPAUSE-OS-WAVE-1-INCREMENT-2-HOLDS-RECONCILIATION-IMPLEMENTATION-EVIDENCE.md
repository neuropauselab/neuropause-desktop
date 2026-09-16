# Phase I-A.3 — NeuroPause OS Wave 1 / Increment 2 — Holds + Reconciliation (BLOCKED at a frozen surface)

**Status: BLOCKED — a correct implementation requires modifying a FROZEN surface. Per Phase 10, STOPPED and
reported instead of modifying it or shipping a lower-fidelity workaround. No code changed this increment.**
Baseline HEAD `ffa2863`. Increment-1 changes preserved, untouched. Labels: `[PROVEN]` `[IMPLEMENTED]` `[VERIFIED]`
`[OPEN]` `[NOT PROVEN]` `[NOT CLAIMED]`.

## 1. Baseline HEAD `[PROVEN]`
`ffa2863`, branch `cert/data-import-cst-integration`. Working tree at start: Increment-1 present and unstaged
(`M M365WritePanel.tsx`, `A m365Outcome.ts`, `A ui-tests/m365Outcome.test.tsx`), no frozen change, diff-check clean.

## 2. Exact scope (intended) `[OPEN]`
Connect the certified M365 IPC `OUTCOME_UNKNOWN` / `HELD` outcomes → the **existing** durable hold ledger →
HoldsView → manual reconciliation, IPC-path only, no frozen change, no blind retry, no VERIFIED_SUCCESS fabrication.

## 3. Exact changed files `[PROVEN]`
**NONE this increment.** No production or test file was modified or created for Increment-2. Increment-1's three
files remain exactly as authorized. The only new file is this evidence/blocker report.

## 4. Existing hold infrastructure (inventoried, source-grounded) `[PROVEN]`
The existing hold/reconciliation subsystem is well-suited and would need **no new store**:
- **Durable hold store:** `apps/desktop/src/main/decisions/holdStore.ts`; single raise path
  `apps/desktop/src/main/decisions/raiseHold.ts` (`createHoldRaiser`) = `HoldStore.open → DecisionRecord → audit`.
- **Deterministic dedup:** `raiseHold` dedupes on `subject` — a repeated attempt at the same subject returns the ONE
  existing OPEN hold, not a second (satisfies Phase 5 for free, if `subject` = a stable canonical identity).
- **Perfect reason already exists:** `HoldReason` includes **`verification_unavailable`** ("Cannot verify the
  outcome") and **`external_unavailable`** ("A required system is unavailable") — both classified as ABSENCE
  reasons (not hazards) in `raiseHold.ts`. `verification_unavailable` is exactly M365 `OUTCOME_UNKNOWN`.
- **Authoritative + tenant-scoped:** `HoldRecord` carries `tenantId`/`workspaceId`/`actor`/`subject`/`decisionId`/
  `status`/`resolvedOutcome`; `raiseHold` deps require `actor: () => string | null` (**main-process authority**);
  `ipc.holds.list` is tenant-filtered (P12).
- **Operator UI already present:** `understanding/HoldsView.tsx` lists open holds (with `HOLD_REASON_LABELS`,
  including the two above), shows known/unknown/resolution/if-proceeding, and resolves via
  `ipc.holds.resolve(id, 'took_alternative'|'cancelled', note)` — and explicitly states "Resolving records who
  cleared this and why. It does not execute anything." (no execution from the UI — Phase 8/12 satisfied by design).
- **Renderer IPC surface:** `ipc.holds` exposes only `list` and `resolve` — **there is NO `raise`/`create` IPC**;
  holds are raised **internally in the main process** (`raiseHold` callers: `runtimeCore.ts`, `enterprise/index.ts`,
  `opportunities/index.ts`).

**Everything downstream of "raise the hold" is already built and works.** The single missing link is raising a hold
when the certified M365 IPC path returns `UNKNOWN`.

## 5. Outcome-to-hold mapping (intended contract) `[DESIGN]`
`ACKNOWLEDGED` → no hold · `DENIED` → evidence/audit, no hold · `EXECUTION_FAILED` → incident, no auto-retry ·
`APPROVAL_REQUIRED` → approval UI, no hold · **`OUTCOME_UNKNOWN` → durable hold, reason `verification_unavailable`,
reconciliation required** · **`HELD` → durable hold, reason `external_unavailable`/policy** · `ESCALATED` →
escalation + evidence. No `VERIFIED_SUCCESS` fabricated.

## 6. Reconciliation behavior (intended) `[DESIGN]`
Reuse `ipc.holds.resolve`. An operator resolution (`took_alternative`/`cancelled`) records WHO cleared it and why
and **executes nothing**. An `EFFECT_CONFIRMED_BY_OPERATOR` observation is **NOT** VERIFIED_SUCCESS — the repo has no
independent postcondition verification, so the state remains ACKNOWLEDGED/observed, never verified. `[NOT CLAIMED]`

## 7. No-blind-retry `[PROVEN by construction]`
HoldsView performs no execution; resolution only records. Any re-execution must go through the certified
governedSend/governedAction path (a new governed decision). No retry control exists that re-runs the original action.

## 8. Tenant/account isolation `[PROVEN — existing]`
`ipc.holds.list` is tenant-scoped (P12; unassigned holds visible to no tenant). A hold raised for account A would be
subject-scoped to {tenant, connector, account, action}. No change needed.

## 9-10. Tests / regression `[NOT RUN — no code changed]`
No Increment-2 tests were added and no regression was re-run for Increment-2, because no code changed. Increment-1's
suites remain green as of that gate (new outcome suite 11/11; full main 8511/3-skip; UI 194; certification 185/185).

## 11. Frozen-surface audit `[PROVEN]`
`git diff --name-only` = only Increment-1's `M365WritePanel.tsx` (unchanged since Increment-1) + untracked
Increment-1 files + this doc. **No frozen surface touched this increment.**

## 12. Certification impact `[PROVEN]`
None — no code changed. M365 IPC 29/29 stays CERTIFIED; worker parity NOT PROVEN.

## 13. THE BLOCKER (Phase 10 report) `[PROVEN]`
**Requested capability:** raise a durable, authoritative, canonical-identity-deduplicated hold when the certified
M365 IPC path returns `OUTCOME_UNKNOWN` (or `HELD`).
**Exact frozen file(s) that must change for a CORRECT implementation:**
1. `apps/desktop/src/main/connectors/index.ts` (FROZEN — M365 IPC routing). The `M365ActionExecute` handler is the
   ONLY site that holds, together: the authoritative tenant (`deps.workspaceId()`), authoritative actor
   (`deps.actor()`), the account/connector/action, the request params, and the actual `semanticOutcome` (via
   `mapSendOutcome`/`mapActionOutcome`). Raising the hold requires calling `raiseHold({...})` there on `UNKNOWN`/
   `HOLD`, and extending `ConnectorSubsystemDeps` to inject the hold raiser.
2. `apps/desktop/src/main/runtimeCore.ts` (FROZEN — composition root). To pass the already-constructed `raiseHold`
   into `initConnectors`.
**Why additive, non-frozen integration is insufficient:**
- **No outcome event exists to listen to.** `governedSend`/`governedAction` emit **no** outcome events — they call
  `action.run` directly (bypassing `M365Executor`, which is what emits `writeEvents`), specifically to preserve typed
  errors. So no non-frozen main-process subscriber can observe the authoritative M365 UNKNOWN outcome.
- **The renderer has no authority.** The renderer receives `OUTCOME_UNKNOWN` but does NOT hold authoritative tenant/
  actor (the security model excludes renderer authority; the request schema is `.strict()`). A renderer-initiated
  `holds.raise` would either (a) require the renderer to supply tenant/actor — violating the renderer-authority
  boundary (Phase 12) — or (b) round-trip to a new main IPC that re-asserts "the last action was UNKNOWN" **on the
  renderer's say-so**, which **decouples the hold from the authoritative outcome** (the main process never confirmed
  UNKNOWN to that handler) and could raise spurious holds not produced by governance. That breaks Phase 4's
  "preserve the original outcome / reconstructable relationship to the original consequential transition."
- Therefore a faithful outcome→hold link can only be created at the outcome site — the frozen handler.
**Certification impact of the required change:** additive within a frozen file; it raises an operational hold, does
NOT alter the governance verdict, canonical identity, admission, idempotency, or effect boundary. But because it
edits `connectors/index.ts` and `runtimeCore.ts` (both frozen, both governance-adjacent), it MUST be its own
certification gate with: exact diff, denial-before-effect re-proof (hold-raise must be strictly AFTER the outcome and
never affect `effectCalls`/`action.run`), coverage-guard + full regression, and frozen-surface sign-off.
**Proposed separate gate:** *"Wave-1 Increment-2A — M365 UNKNOWN→Hold raise (frozen: connectors/index.ts +
runtimeCore.ts)"* — a scoped frozen-surface certification gate that adds a post-outcome `raiseHold` call on
`UNKNOWN`/`HOLD` in the certified handler, injects the raiser, and re-proves the certified invariants. Everything
downstream (HoldsView, reconciliation, dedup, tenant scoping, `verification_unavailable` reason) is already present
and needs no change.

## 14. Limitations / remaining Wave-1 work `[OPEN]`
- Increment-2 is **BLOCKED** pending the proposed frozen gate (Increment-2A). Until then, the operator sees the
  honest `OUTCOME_UNKNOWN` + "Reconciliation required — do not blindly retry" guidance in the M365 write panel
  (delivered in Increment-1), but the UNKNOWN does not yet materialize as a durable ledger entry.
- Remaining Wave-1 (unchanged): unified operator console; evidence timeline; additive cross-boundary security tests;
  signed+notarized `ffa2863` artifact + clean-machine verification.
- Deferred frozen gates (unchanged): worker OUTCOME_UNKNOWN; ExecutionStore fail-closed.

## Handoff
- IMPLEMENTED + VERIFIED: **NO** (blocked; no code changed).
- COMMIT-READY: **NO** (nothing to commit for Increment-2; Increment-1 remains separately commit-pending).
- Decision: **STOP and report** the frozen-surface blocker, per Phase 10 — the correct implementation needs
  `connectors/index.ts` + `runtimeCore.ts` (frozen); a non-frozen workaround would break the authoritative
  outcome→hold link, which the program forbids.

## STOP
No frozen surface changed. No code changed. Increment-1 preserved. HEAD `ffa2863`. Nothing staged, committed, or
pushed. Awaiting authorization for the proposed frozen gate **Increment-2A** (or a different, explicitly-accepted
lower-fidelity approach).
