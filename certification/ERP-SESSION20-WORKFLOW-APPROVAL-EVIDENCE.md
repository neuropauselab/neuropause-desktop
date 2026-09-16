# ERP + PLATFORM — SESSION 20: GOVERNED WORKFLOW / APPROVAL RUNTIME + PROCUREMENT APPROVAL INTEGRATION

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 19 GREEN (`9a9b1ec`)
**Label:** TEST-VERIFIED. No frozen surface touched; no ERP module modified; modular-monolith-first (no microservice,
no broker, no Electron IPC wiring). Inspect → map existing policy → design minimal seam → build real durable workflow
→ integrate procurement → negative control → concurrency → failure/restart → full regression.

A reusable workflow/approval runtime that inserts a governed approval step between a submitted Purchase Request and
its conversion to a Purchase Order — reusing the Session 17/18/19 command bus, durable journal and audit.

---

## A · EXISTING APPROVAL / WORKFLOW ARCHITECTURE

Two distinct existing pieces were found and NOT duplicated: (1) the ERP **document-posting** approval engine
(`erp/approvalStore.ts` + `ApprovalStepView`) — per-document posting-approval steps, Electron-wired at its instance;
(2) the PR's governed `approve`/`reject` actions + `ConvertPurchaseRequestToPO`'s `status === 'approved'` gate
(Session 17). There was **no workflow approval-INSTANCE lifecycle** (a PENDING→APPROVED/REJECTED process object). Per
§4, Session 20 establishes that instance on the SAME durable primitive as the Session 18 journal
(`DurableJsonStore`) — it is not a second engine, and it is explicitly not the document-posting `ApprovalStore`
(different concern).

---

## B · PROCUREMENT APPROVAL POLICY

The DEFINED policy (deny-by-default, no threshold): a submitted Purchase Request requires a human approval before it
becomes a Purchase Order. This is the conservative default (Session 17 documented "approval required"), not an
invented threshold. §22 STOP conditions — thresholds, hierarchy, delegation, escalation, expiration, cancellation,
segregation of duties, self-approval, multi-level — are **all undefined and deliberately absent** (only
PENDING→APPROVED/REJECTED is modelled). "AI cannot approve itself" is enforced by AUTHORIZATION (the AI principal is
not granted the decide permission), not by an invented segregation rule.

---

## C · WORKFLOW CONTRACT

`WorkflowRequest → WorkflowDecision` (`ALLOW` | `DENY` | `REQUIRES_APPROVAL` + an opaque policy label — never a raw
policy object). `ApprovalInstance` carries id, tenant, workspace, target module/id, the gated domain command,
requester, approver, status (PENDING/APPROVED/REJECTED), created/decided timestamps, correlation. Transport-neutral,
Electron-free.

---

## D · APPROVAL STATE MODEL

PENDING → APPROVED / REJECTED only. No expiration / cancellation / delegation / escalation (undefined policy, §22 —
not invented). A contrary decision (approve after reject) is a deterministic CONFLICT; a repeat of the same decision
replays.

---

## E · AUTHORIZATION / POLICY SEPARATION (§9)

Kept strictly separate: **AUTHORIZATION** = `ctx.authorize` from the principal's permissions (the decide requires
`procurement:manage`); **POLICY** = `evaluateWorkflow` (pure — a submitted PR REQUIRES_APPROVAL); **WORKFLOW** = the
approval-instance lifecycle; **TRANSACTION** = the dispatched domain command through the bus. No layer is collapsed
into another; the runtime performs authorization BEFORE any transition.

---

## F · WORKFLOW → COMMAND INTEGRATION

An approval decision NEVER mutates ERP state directly. On APPROVE it dispatches `ApprovePurchaseRequest`; on REJECT,
`RejectPurchaseRequest` — both through the canonical command bus (authorization → durable transaction → event →
outbox → audit). The command is the authoritative mutation; the convert gate (`status === 'approved'`) then enforces
no bypass. Proven: pending/rejected PR → convert denied; approved PR → convert succeeds.

---

## G · DURABLE PERSISTENCE

`ApprovalInstanceStore` on the Session 18 `DurableJsonStore` (atomic file writes, survives restart), tenant-keyed on
every record. Idempotent creation (one open approval per gated target), idempotent + single-flight decision. Proven:
the approval and its decision survive a reload-from-disk; a re-decide after restart replays.

---

## H · IDEMPOTENCY PROOF

Approve twice → one transition, one durable domain event (`PurchaseRequestApproved`), one fresh audit entry (the
second replays). Reject twice → one transition. Approve after reject → CONFLICT. The gated command is dispatched with
a stable key (`approval:<id>:<decision>`), so the journal delivers one economic effect even on replay.

---

## I · CONCURRENCY PROOF

100 concurrent approvals of one approval → exactly one terminal transition, one `PurchaseRequestApproved` event, PR
approved once (single-flight on the approval id + the journal's per-key single-flight). Tenant isolation holds under
concurrency (each tenant's approvals keyed and read separately).

---

## J · FAILURE / RESTART PROOF (§18 A–I)

Approval creation persists durably (B: a failed persist → no approval); the decision persists (C/F: survives restart);
a duplicate decision is idempotent (G/H); the domain command after approval is idempotent, so a transaction failure
is retryable with no double effect (D); a pending approval carries no decision until one is made (E). No lost approval
state, no unauthorized mutation, no duplicate economic mutation, no decision without durable evidence.

---

## K · DOMAIN EVENTS

Reuses the canonical `PurchaseRequestApproved` / `PurchaseRequestRejected` domain events (from the dispatched command
via the Session 18 journal/outbox) — no duplicate business event. `approval.requested` is workflow evidence recorded
as audit + the durable approval record.

---

## L · AUDIT EVIDENCE

Every decision produces governance evidence via the reused audit sink: `approval.requested` / `approval.approved` /
`approval.rejected` with actor, tenant, target, decision and correlation. Audit is not a replacement for the domain
event — both are produced.

---

## M · AI GOVERNANCE PROOF

An AI principal (read-only agent) may REQUEST an approval but **cannot decide it** — the decide requires
`procurement:manage`, which the AI is not granted, so it is denied UNAUTHORIZED and the PR is not approved. The AI
holds no store/registry/journal handle (compile-enforced) and reaches ERP only through governed commands; it cannot
self-approve, bypass approval, or mutate approval/ERP state directly.

---

## N · ELECTRON INDEPENDENCE

An executable test walks `platform/workflow` + `platform/command` + `platform/persistence` + `platform/application`
and asserts none import `electron`, `react`, or `ipcMain`/`BrowserWindow`. The workflow is callable via a test
adapter with no Electron. No IPC wired (§20).

---

## O · TENANT ISOLATION

Every approval record is tenant-keyed; a foreign-tenant approval is invisible (`get` returns undefined → NOT_FOUND).
An approver in tenant B cannot decide tenant A's approval. Tenant is derived from the authenticated approver
principal, never from client input.

---

## P · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified).

| # (directive §19) | Mutation | Failing test |
|---|---|---|
| 1 bypass workflow | evaluate → ALLOW | submitted PR REQUIRES_APPROVAL |
| 2 approve without authorization | remove the decide permission check | unauthorized approver denied |
| 3 approve rejected request | disable the CONFLICT guards | approve-after-reject conflict |
| 4 approve pending twice | disable the replay guards | approve-twice → one (audit/effect) |
| 5 approve across tenants | drop the tenant check in `get` | cross-tenant decide NOT_FOUND |
| 6 directly mutate PO after rejection | relax the convert status gate | rejected → convert denied |
| 7 AI directly approve itself | (shares #2 — authorization) | AI-cannot-approve |
| 8 remove durable approval persistence | skip the approval `put` | durable PENDING approval |
| 9 remove approval event | emit the wrong domain event | APPROVED → PurchaseRequestApproved |
| 10 remove audit | blank the decision audit action | approval.approved audit |
| 11 bypass command bus after approval | drop the durable journal from dispatch | APPROVED → durable event |
| 12 workflow depends on Electron | add `from 'electron'` | Electron independence |
| 13 client tenant overrides authenticated | (structural — tenant from the approver principal) | tenant-isolation tests |

#7 shares #2's mechanism (the AI is denied by authorization); #13 has no source line — the runtime derives tenant
from the authenticated approver principal, with no client-tenant field to override.

---

## Q · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session20WorkflowApproval.test.ts` | **13/13** |
| Sessions 19 / 18 / 17 (bus, durable, app boundary — unchanged behavior) | green |
| `enterprise` + `platform` + `erp` + `medicalDevice` | **1750** passed |
| Full `src/main` suite | **8848 passed / 7 skipped**, 0 failed (846 files) |

---

## R · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all new files. Repo-wide
`npm run lint` carries the pre-existing sandbox-vs-Mac test-file backlog noted since Session 10; no regression from
this change — confirm on the Mac.

---

## S · FILES CHANGED

```
NEW  platform/workflow/workflowContract.ts        WorkflowRequest→Decision + ApprovalInstance (transport-neutral)
NEW  platform/workflow/approvalInstanceStore.ts   durable, tenant-keyed, idempotent + single-flight approval store (on the S18 primitive)
NEW  platform/workflow/workflowRuntime.ts         evaluate (policy) + requestApproval + decideApproval (authorize → transition → dispatch command → audit)
NEW  platform/workflow/session20WorkflowApproval.test.ts   13 pins
NEW  certification/ERP-SESSION20-WORKFLOW-APPROVAL-EVIDENCE.md
```

No ERP module was modified — the integration reuses the existing PR `approve`/`reject` and the convert gate. Frozen
surfaces untouched (packages/shared; cst/; contracts; channels; runtimeCore; connectors/index; executionGate).
`moduleRegistry.ts` reused, not modified. `certification/baseline.json` not staged.

---

## T · COMMIT SHA

`<filled at commit>` — one commit, `erp(s20): …`. The user pushes from the Mac.

---

## U · REMAINING RISKS

- **File-backed durable + in-process** (Session 18 bounds carry forward): correct for the modular monolith; a
  multi-process deployment would need cross-process coordination.
- **Concurrent identical decisions may each emit an audit entry** while producing exactly one transition + one
  economic effect (the single-flight collapses the transition; the journal collapses the effect). Sequential repeats
  audit once (replay-skipped). Documented, not a correctness issue.
- **No expiration/delegation/escalation/segregation** (§22 undefined) — deliberately absent, not invented; the
  workflow is single-level, deny-by-default approval only.
- **Not wired to live Electron IPC** (§20) — deliberate; the runtime is proven callable by a test adapter and reuses
  the application boundary's principal shape.
- Multi-SKU RFQ remains STOPPED (Session 19); accounting unchanged.

---

## V · STATUS: 🟢 GREEN

ERP: 1 existing approval policy identified ✓ · 2 no duplicate model ✓ · 3 PR approval governed ✓ · 4 pending → no
convert ✓ · 5 rejected → no convert ✓ · 6 approved → convert via the command path ✓ · 7 accounting unchanged ✓ ·
8 multi-SKU PO/GR GREEN ✓ · 9 RFQ single-SKU (policy-gated) ✓.
Platform: 10 reusable workflow runtime ✓ · 11 transport-neutral ✓ · 12 Electron-independent ✓ · 13 authorization vs
policy separated ✓ · 14 policy vs workflow separated ✓ · 15 workflow never mutates ERP directly ✓ · 16 approval state
durable ✓ · 17 idempotent ✓ · 18 concurrent-safe ✓ · 19 uses the command bus ✓ · 20 uses the transaction/event/outbox
system ✓ · 21 durable evidence ✓ · 22 AI cannot bypass approval ✓ · 23 tenant isolation ✓ · 24 negative controls
pass ✓ · 25 no frozen surface modified ✓ · 26 no microservice/broker ✓ · 27 full regression GREEN ✓.

GREEN with the §U bounds, built as real durable infrastructure (approval state, workflow evaluation, authorization,
command dispatch, domain events, audit, concurrency + failure/restart tests) — no interfaces-only, no placeholders.
MRP / tax / FX / multi-SKU RFQ / service extraction deliberately not started.
