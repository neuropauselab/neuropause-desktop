# DECISION-MEMO-S122 — SLO objective for operational reliability verdicts (POLICY-OPEN)

**Date:** 2026-09-05 · **Session:** S122 · **Status:** POLICY-OPEN (no policy invented)

## Context
S122 activated **Operational Reliability Intelligence** — a pure, deterministic projection over the
existing tenant-scoped `DurableCommandJournal` records that reports the platform's delivery-reliability
posture (per-status and per-command-type counts, success / delivery-failure ratios, retry pressure,
recurring outbox error signatures). It also reuses the previously-harvested-but-unwired pure calculator
`operationsPlatform/errorBudget.ts` (`computeErrorBudget`) to optionally produce a **request-based
error budget** with a `healthy` / `at-risk` / `breached` verdict.

## The open question
An error-budget verdict requires a **success objective** (SLO target, e.g. 99%). Choosing that target
is a **business/operational policy decision** — it defines what counts as an acceptable failure rate for
governed command delivery, per tenant and potentially per command type. It is NOT definitional math.

## Decision
Per the standing rule *never invent business policy*:

1. The reliability read computes and returns only **definitional facts** by default — counts and ratios
   are arithmetic over the rows and require no policy.
2. The **error-budget verdict is computed ONLY when a caller explicitly supplies `objective ∈ [0,1]`**.
   With no objective supplied, no verdict/budget is produced (fail-closed to "no verdict"); the read
   never fabricates a target.
3. The **live operator UI supplies no objective** — the panel shows observed posture only. It does not
   display a healthy/breached SLO verdict, because no SLO objective policy has been ratified.

## What is NOT decided here (deferred to a future OPERATOR-GATED slice)
- The actual SLO objective value(s) (global vs per-command-type vs per-tenant).
- The at-risk burn banding threshold if a value other than the SRE-standard display default is desired.
- Whether/where an objective is persisted and by whom it may be configured.

Until an objective policy is ratified, the capability delivers real value as **observed reliability
intelligence** and the error-budget code path remains available and tested (exercised with an explicit
objective in the focused suite) but dormant in production. No policy is invented; nothing consequential
is executed.
