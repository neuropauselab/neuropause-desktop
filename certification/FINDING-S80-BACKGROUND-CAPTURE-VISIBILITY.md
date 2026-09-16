# FINDING — S80 background KPI capture does not surface for the active (local-mode) principal

**Class:** genuine product finding (not a harness defect, not a security defect). **Severity:** the S80 live path does not demonstrate end-to-end as built. **Status:** STOPPED for an operator decision — NOT patched (no blind fix; the two real remedies exceed this gate). Discovered by the S80-MAC re-run: boot ✓, `capture service started` ✓, product-below-safety created ✓, then the exception never surfaced on `executiveCenter:snapshot` and the run was interrupted.

## Root cause (measured from source — the F-P45 writer/reader-key class)

- **Writer** — the governed background capture runs via `forEachTenantBackground` (`analyticsPlatform/kpiIntelligenceInstance.ts` → `tenancy/backgroundFanOut.ts`). The non-`perWorkspace` fan-out **enumerates orgStore organizations** (`backgroundFanOut.ts:23` `operable(deps.organizations())`, `:24` `if (orgs.length === 0) return []`) and stamps each pass `scope = { tenantId: organization.id, workspaceId: '' }` (`:131`). So snapshots/exceptions are keyed by **`organization.id`**.
- **Reader** — the executive-snapshot handler surfaces `readKpiIntelligence(currentPrincipal()?.tenantId ?? null)` (`enterprise/executiveCenterSubsystem.ts`), filtering by the **active principal's tenant id**.

In a fresh **local-mode** profile these two identities diverge:
1. **No org to iterate.** If the local profile has no orgStore organization row, `forEachTenantBackground` returns `[]` and **capture never runs** — the exception can never appear, at any wait.
2. **Key mismatch.** If an org row does exist, its `organization.id` is a different id-space from the device-local principal's tenant (`local-…@device.invalid`, D-12), so the reader's tenant filter matches **zero** rows written by the writer.

This is exactly the **F-P45** writer/reader-key mismatch already documented for `readBackReconciler` (the same fan-out, which "read zero" for the same structural reason). It is not fixed by waiting, and not caused by the harness (the harness fix to poll `executiveCenter:snapshot` is correct; the data simply is not there under the read's key).

## Why it was not caught earlier

The S80 core unit tests inject an explicit `scope` and assert idempotency/isolation on a **single, matching** tenant id — they never exercise the writer-identity-vs-reader-identity divergence, because the live wiring (fan-out on one side, active principal on the other) exists only in the running app. typecheck/lint/compose tests all pass because the types line up; the identities do not.

## Remedies (operator's decision — NOT implemented)

**Option A — governed on-demand capture trigger (recommended; needs a new FG).** Add a governed `kpi:capture` IPC channel (frozen `channels.ts`/`contracts.ts` = **a new FG gate, FG-S80b**) whose handler runs `captureForScope` for the **current principal** (the same identity the read uses). This makes the feature (a) **usable** — a user can force a KPI refresh — and (b) **deterministically E2E-testable** — capture-then-read under one identity. It also lets the background service stay as the periodic path. Requires a new frozen IPC channel → operator token + choreography.

**Option B — align the background capture identity to the read (non-frozen, but needs Mac verification).** Change the capture service to write under an identity the executive-snapshot read will match — e.g. capture for the active/local principal rather than (or in addition to) the orgStore fan-out. Risk: the fan-out-vs-active-principal divergence is structural (background work has no "active principal"); getting this correct without Electron to verify is exactly the kind of blind change this environment cannot validate, so it must be Mac-verified before claiming GREEN. It also does not, by itself, make the feature user-refreshable.

**Recommendation:** Option A (FG-S80b) — it is the honest fix for both the testability finding and the usability gap (no on-demand refresh), and it keeps tenant isolation intact by capturing under the caller's own principal. Option B alone leaves the "user cannot force a refresh" gap and carries un-verifiable-here risk.

## Status

**S80 = PARTIAL — NOT GREEN.** The live wiring compiles and is registered, but the governed KPI intelligence **does not surface for the active principal** in local mode (F-P45 class). No blind patch applied. Awaiting the operator's choice of Option A (new FG token for `kpi:capture`) or Option B (non-frozen identity alignment + Mac verification). Release track PAUSED; S81 not started.
