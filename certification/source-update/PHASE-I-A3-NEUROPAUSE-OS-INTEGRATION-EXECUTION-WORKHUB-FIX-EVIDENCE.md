# Phase I-A.3 — NeuroPause OS Integration Execution — Work Hub unified:query Fix + Connectivity Status

**Reality-first integration pass. One real, root-caused increment implemented + tested this turn; the broad
connectivity picture is reported honestly from source (no packages imported, no frozen surface touched, nothing
fabricated).** Baseline HEAD `634c9b7`. Labels: `[PROVEN]` `[VERIFIED]` `[IMPLEMENTED]` `[CONNECTED]` `[TESTED]`
`[LIVE-VERIFIED]` `[OPEN]` `[BLOCKED-ENV]` `[DEFERRED]` `[NOT PROVEN]`. No commit this turn (git discipline).

## 1. Current reality `[PROVEN]`
The connected product is `apps/desktop` (Electron). Committed Wave-1 (`634c9b7`) added honest M365 outcomes,
authoritative UNKNOWN→durable hold, and an operator model + evidence timeline over the certified M365 IPC path
(29/29, CST unchanged). This pass fixed a concrete real runtime bug in the Work Hub.

## 2. What was connected (this turn) `[IMPLEMENTED][TESTED]`
**Work Hub "today" feed → `unified:query` now sends a contract-valid request.** Root cause (traced Work Hub →
`ipc.unified.query` → `IpcChannel.UnifiedQuery` → `UnifiedQueryRequest` Zod schema → `unifiedStore.query`): the Hub
sent `limit: 2000`, but the schema caps `limit` at **500**, so the request was rejected pre-store and surfaced as
"Error invoking remote method 'unified:query': IpcError: Invalid request for unified:query". The `kinds`
(`calendar_event`/`event`/`task`/`message`) were all valid — the cap was the sole cause. **Fixed at the source (the
renderer request), not by hiding the error**: extracted the query to an exported, validated constant
`HUB_FEED_QUERY` with `limit: 500`. The Meetings/tasks/emails tiles now receive real entities (or an honest
unavailable/empty state via the existing `settleTile` model — NO_DATA / UNAVAILABLE / ERROR / SUCCESS preserved).
The frozen contract (`contracts.ts`) was **not** changed.

## 3. What was already connected `[CONNECTED]` (prior audits, source-verified)
auth (OAuth/PKCE + keychain) · AI engine + 3 real providers (Ollama/Anthropic/OpenAI) + privacy clamp · workspace/
tenant/actor scoping · assistant/Ask NeuroPause · understanding/holds/decision records/audit · M365 governed IPC
path (CERTIFIED) · Wave-1 honest outcomes + UNKNOWN→hold + operator model/evidence timeline · workforce/worker
pipeline (advisory-by-default, human-gated) · automation (create/execute/schedule, governance-gated) · 20 sync
connectors · persistence (~64 tenant-scoped stores + 2 keychain vaults) · backend (Postgres) · notifications/health.

## 4. What remains disconnected `[DEFERRED]`
~46 `@neuropause/*` packages are not imported by the desktop product (DISCONNECTED / DEFERRED / TOOLING /
DUPLICATE) — **not** wired in this pass (per the hard rule). `apps/cloud` is scaffold.

## 5. Canonical implementations selected `[PROVEN]`
The desktop in-tree implementations remain canonical (they are the connected, tested, and — for M365 — certified
path). No certified implementation was replaced by a package.

## 6. Duplicates left disconnected and why `[PROVEN]`
Packages named workforce/execution/runtime/security/persistence/connectors/automation/… duplicate concepts the
desktop already implements in-tree; connecting them would add coupling without product value and would risk
replacing certified code. Left disconnected (LEAVE DISTINCT).

## 7. Exact files changed `[PROVEN]`
- **M** `apps/desktop/src/renderer/src/hub/HubHost.tsx` — `HUB_FEED_QUERY` constant (limit 2000 → 500) + `UnifiedQuery`
  type import; query call uses the constant.
- **A** `apps/desktop/ui-tests/hubUnifiedQuery.test.tsx` — 4 contract-compliance tests.
No main/frozen/shared/package change.

## 8. Exact runtime connection created `[IMPLEMENTED]`
Work Hub feed → `unified:query` (contract-valid) → `unifiedStore.query` → real UnifiedEntity items → `hubModel`
(meetingsToday / prioritizeEmails / taskBoard). The dead-end IPC error is removed at its cause.

## 9. Tests added `[TESTED]`
`hubUnifiedQuery.test.tsx` (4): HUB_FEED_QUERY parses against the real `UnifiedQueryRequest`; limit ≤ 500; every
kind accepted; **regression** — the old `limit:2000` is rejected (documents the root cause).

## 10. Test results `[PROVEN]`
New test **4/4**. **Full main 8520 passed / 3 skipped** (808 files, unchanged). **UI 211 passed** (27 files) — was
207/26 → **+4 / +1 file**, no regression.
## 11. Typecheck `[PROVEN]` — clean (node+web).
## 12. Lint `[PROVEN]` — clean (`--max-warnings 0`, changed files).
## 13. Security results `[PROVEN]` — no authority/governance/tenant surface changed; the query respects the existing
main-process tenant scoping; renderer remains non-authoritative; the fix cannot bypass governance (it is a read
query).
## 14. Frozen-surface results `[PROVEN]` — none touched (contracts.ts/CST/governedAction/executor/executionStore/
runtimeCore/boundaryB/shared/package all unchanged; `git diff` on the frozen set blank).
## 15. Certification impact `[PROVEN]` — **NONE** (renderer read-query fix; M365 IPC 29/29 stays CERTIFIED).

## 16. Live UI verification `[BLOCKED-ENV]`
Not launched as a live GUI in this environment (dev machine, not a clean pilot env). The fix is proven at the
contract layer (the exact request the Hub sends now satisfies the main-process schema that previously rejected it),
which is the precise cause of the reported runtime error. A live click-through remains a clean-environment step.

## 17. Customer journey status `[CONNECTED / TESTED]` / `[LIVE-VERIFIED — NOT EXECUTED]`
The spine (login → workspace → AI proposal → governance → approval → admission → M365 effect → honest outcome →
UNKNOWN→hold→reconcile → evidence) is implemented + tested; the Work Hub feed dead-end is now removed. End-to-end
LIVE verification remains BLOCKED-ENV (clean machine, pilot M365 tenant, credentials).

## 18. Pilot blockers `[BLOCKED-ENV]` — signed+notarized artifact from `634c9b7`; clean machine; pilot M365 tenant;
five real users. None is a code/product defect.
## 19. Environment blockers `[BLOCKED-ENV]` — no disposable VM; no signing/notarization credentials; no live tenant.
## 20. Deferred frozen gates `[DEFERRED]` — worker OUTCOME_UNKNOWN preservation; ExecutionStore fail-closed.
## 21. Five-user acceptance status `[NOT EXECUTED]` — 0/5 (no artifact/env/users).
## 22. Final product readiness `[PROVEN]`/`[BLOCKED-ENV]`
**ENGINEERING READY / PILOT VALIDATION BLOCKED-ENV.** The product is more coherent (a real Work Hub dead-end fixed
at root cause, tested), full regression green, no frozen change, no certification impact. Pilot validation still
requires the empirical evidence this environment cannot produce. **NOT pilot-validated.**

## Master invariants (held) `[PROVEN]`
No consequential effect without governed admission · UNKNOWN ≠ success ≠ failure · no verified state without
observation · AI ≠ authority · renderer ≠ authority · hold-resolution ≠ execution · IMPLEMENTED ≠ CONNECTED ≠
LIVE-VERIFIED · CERTIFIED ≠ PILOT-VALIDATED · no disconnected packages imported without runtime purpose · failure
does not silently become success.

## STOP
One real increment (Work Hub `unified:query` root-cause fix) implemented + tested; no frozen surface, no package
import, no fabrication. No commit, no push. HEAD `634c9b7`; the fix is unstaged.
