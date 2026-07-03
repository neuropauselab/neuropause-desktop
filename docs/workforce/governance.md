# Governance Runtime

> The single gate every worker action passes through. Fails safe; audits everything.

## Four checks, most-restrictive wins

`evaluateAction(request, { worker, policies, now })` runs four checks over a
proposed action and returns the **most restrictive** outcome
(`deny` > `require_approval` > `allow`):

1. **permission** — every scope the action touches must be granted to the worker,
   else `deny`;
2. **trust** — side-effecting / higher-risk actions need trust ≥ a per-risk floor
   (`low 0 · medium 0.4 · high 0.7 · critical 0.9`), else `require_approval`;
3. **evidence** — a side-effecting action with no supporting evidence →
   `require_approval` (a worker may not act on nothing);
4. **policy** — declarative rules can `allow` / `deny` / `require_approval`.

The function is **pure** — worker, policies, and `now` are injected — so it
unit-tests from synthetic input with no Electron and no I/O.

## Default policies (conservative by design)

| Policy | Effect | Matches |
| --- | --- | --- |
| `pol:read-allow` | allow | read-only actions (no side effects) |
| `pol:external-approval` | require_approval | anything using `propose:message` / `propose:draft` |
| `pol:high-risk-approval` | require_approval | risk ≥ `high` |
| `pol:write-trust` | allow (trust-gated) | `write:memory` / `write:reminder`, only at trust ≥ `0.6` |

Higher priority wins; a trust-gated `allow` whose condition fails downgrades to
`require_approval`. The net effect out of the box: read-only analysis flows
freely, outbound proposals always need a human, high-risk actions always need a
human, and internal writes need a human until the worker has earned trust.

## The Governance Runtime and its audit log

`GovernanceRuntime` composes the pure core with a live policy set and the
**append-only audit log**. `evaluate(request, worker, now)` returns the verdict
**and** records a `WorkforceAuditEntry` (worker, skill, request, decision, risk,
time). There is always a complete, queryable record of what each worker was
permitted to do and why — `auditPage({ workerId?, decision?, limit?, offset? })`
pages it newest-first. Operators can replace the policy set via `setPolicies`.

## Naming note

These types gate actions *before* they happen and are intentionally distinct
from the Governance Trace™ types (Phase 5) that *explain* decisions after the
fact. They do not collide.
