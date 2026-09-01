# ERP + PLATFORM — SESSION 17: PURCHASE REQUEST → GOVERNED PROCUREMENT COMMANDS + PLATFORM COMMAND SEAM

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 16 GREEN (`17c8032`)
**Label:** TEST-VERIFIED. No frozen surface touched; no accounting mapping changed; modular-monolith-first (no
microservice, no broker). Inspect → reproduce → design minimal seam → implement → negative control → ERP E2E →
platform E2E → full regression.

Two coupled tracks: (A) the governed multi-line Purchase Request → PO flow; (B) the first reusable Domain Command
seam so procurement is no longer Electron-specific business logic.

---

## A · CURRENT PROCUREMENT ARCHITECTURE

The live flow is User → PO → approval → Goods Receipt → Inventory/GRNI → Vendor Bill → AP → Payment (Sessions
10–16). A Purchase Request module already existed (`purchaseRequestModule`) with a single-product header, an
`approve` action, and a `convertRequestToPurchaseOrder` conversion — but no multi-line support, an incomplete
lifecycle (no submit/reject), and no reusable command boundary: every state change entered through the generic
Electron `enterprise:module.*` IPC handlers. There was **no** existing DomainCommand / command bus (Track B is
genuinely new); authorization, audit and lifecycle events already flow through the framework's
`createLifecycleEmitter`/`emitLifecycle` (reused, not rebuilt).

STOP-check (§17): partial PR→PO conversion is NOT supported and NOT invented — conversion is full 1:1. No budget
reservation, approval threshold, supplier selection, UoM conversion, delegation or commitment accounting is
introduced. Supplier is assigned at the PO stage (existing PO field), never selected on the PR.

---

## B · PR MODEL

Additive `lines` (the Session 16 line model) on the existing PR module — each line an item, quantity and unit price;
tenant/workspace scope and audit identity inherited from the framework store. The single-product header stays for
backward compatibility. No parallel PR object.

---

## C · PR APPROVAL LIFECYCLE

The conceptual lifecycle DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → CONVERTED_TO_PO maps onto the
existing status values (draft / pending / approved / rejected / ordered) — **no invented states** (§2). Added the
missing governed transitions as actions: `submit` (draft→pending) and `reject` (draft|pending→rejected), alongside
the existing `approve` (draft|pending→approved) and `createPurchaseOrder` (approved→ordered). Every transition is
authorized, audited, and emits a lifecycle event through the framework.

---

## D · PR → PO CONVERSION

`convertRequestToPurchaseOrder` carries the PR's `lines` **verbatim** to the PO, so PR line i ↔ PO line i is
deterministic and no quantity is inflated; `PO.sourceRequest = PR.id` preserves traceability; the PO subtotal
derives from the carried lines. The existing guards enforce the invariants: only an `approved` PR converts (rejected
/ draft refused), and `convertedOrder` blocks a duplicate conversion. Full conversion only — partial conversion is
neither supported nor invented (§3).

---

## E · COMMAND ARCHITECTURE (Track B)

A minimal, Electron-free, reusable seam in `platform/command/`:

```
client (Electron | Web | Mobile | API | AI agent)
  → DomainCommand (canonical envelope)
  → dispatchCommand:
       envelope validation
     → tenant DERIVED from the principal (command tenant is a CLAIM, validated)
     → authorization (ctx.authorize — the one engine)
     → idempotency (at-most-once per tenant+key)
     → governed transaction  ─┐ delegated to buildModuleHandlers
     → state change           │ (validate + mutate + audit + lifecycle event)
     → audit  ────────────────┘
     → domain event (internal DomainEventLog)
```

The four commands — `CreatePurchaseRequest`, `SubmitPurchaseRequest`, `ApprovePurchaseRequest`,
`ConvertPurchaseRequestToPO` (plus `RejectPurchaseRequest`) — route to the SAME module handlers the IPC layer uses,
so there is no second authorization engine, no second audit trail, and no second validation path. The bus adds only
what is new: the canonical envelope, principal-derived tenancy, idempotency, and named domain events. Proven
reusable by dispatching commands directly in tests (no Electron/IPC), i.e. as a Web/API/AI client would.

Files: `domainCommand.ts` (contract), `commandBus.ts` (dispatch + routing), `domainEventLog.ts` (append-only
tenant-scoped events), `commandIdempotency.ts` (single-flight at-most-once).

---

## F · AUTHORIZATION / POLICY PATH

Authorization is at the domain boundary, outside the Electron UI: `dispatchCommand` calls `ctx.authorize(procurement
:manage)` (fail-closed) and the delegated module handler authorizes again (defense in depth). The UI only *requests*;
the platform *enforces*. Policy hooks that already exist (budget/contract gates on the PO approve) are unchanged; no
approval-threshold policy is invented for the PR (§17).

---

## G · TRANSACTION BOUNDARY

The transaction is the governed module action (validate → store mutation → awaited `onChange` reconcilers → lifecycle
fan-out), owned by the enterprise framework and invoked once per command. The command bus never mutates a store
directly — a negative control proves that bypassing the handler with a direct write loses audit + events (governance).

---

## H · DOMAIN EVENTS

`PurchaseRequestCreated / Submitted / Approved / Rejected / ConvertedToPO`, appended to an internal, per-tenant,
append-only `DomainEventLog` on each successful command. Each event is immutable (`Object.freeze`), tenant-scoped
(bucketed by tenant, read back per tenant only), correlated (`correlationId`), and attributable (`actor`,
`aggregateId`). No Kafka / broker (§8). A full Create→Submit→Approve→Convert run produces exactly those four events in
order.

---

## I · AUDIT PROOF

Audit is the framework's existing trail (`ctx.audit` via `emitLifecycle`), reused — a governed command produces a
`module.procurement-requests.<action>` audit entry. Proven by asserting the audit spy captured the entry; a negative
control that removes the framework audit call, and another that bypasses the governed handler, both fail this proof.

---

## J · IDEMPOTENCY PROOF

At-most-once per (tenant, idempotency key): CreatePurchaseRequest twice → one PR (second `replayed`); Approve twice
(same key) → one transition, one event; Convert twice (same key) → one PO. Concurrent duplicate create → one PR
(single-flight). Convert via a NEW key is additionally refused by the domain guards (`convertedOrder` +
status→ordered). Only successes are memoised (a failed command stays retryable).

---

## K · TENANT-ISOLATION PROOF

Tenant is derived from the resolved principal, never the command envelope: a command claiming a different tenant is
rejected `CROSS_TENANT_CLAIM`; an unresolved scope denies `UNRESOLVED_TENANT`. Tenant A's PR converts to a Tenant A
PO; under a Tenant B principal the same PR is invisible and conversion is refused; Tenant B sees none of Tenant A's
domain events. Cross-tenant product / approval / conversion / command execution all fail closed via the tenant-scoped
store + the boundary check.

---

## L · AI COMPATIBILITY PROOF

A controlled test-only tool adapter (AI Agent → Tool Request → Policy Gateway → Domain Command) creates a PR **only**
through `dispatchCommand` — it holds no store handle and no DB authority; its call is authorized/validated/audited
exactly like any client and produces a governed `PurchaseRequestCreated` event. This proves the seam can accept an AI
agent without granting direct mutation authority (§10, §13 of the constitution: the Brain proposes, never reaches).

Event→workflow (§11): `PurchaseRequestSubmitted` is emitted and available for a workflow/policy consumer to evaluate
approval. The repository has **no generic approval-routing workflow engine** for procurement (approval is a manual
governed action), and building threshold-based auto-approval would require undefined approval-threshold policy
(§17) — so it is **documented as the missing capability, not built**. The safe default is "approval required".

---

## M · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified).

| # (directive §14) | Mutation | Failing test |
|---|---|---|
| 1 bypass authorization | remove the command-boundary `ctx.authorize` | unauthorized principal denied |
| 2 bypass approval | relax the `status==='approved'` convert guard | unapproved-draft convert refused |
| 3 convert rejected PR | (same guard as #2) | rejected-PR convert refused |
| 4 duplicate PR conversion | relax the `convertedOrder` guard | isolated re-conversion refused |
| 5 cross-tenant PR→PO | relax the `CROSS_TENANT_CLAIM` check | cross-tenant claim rejected |
| 6 alter PR quantity on convert | mutate the verbatim line carry | conversion determinism (lines identical) |
| 7 remove command idempotency | skip the idempotency cache | create twice → one PR |
| 8 bypass domain validation | ignore the validation-failure result | invalid payload refused |
| 9 bypass audit | remove the framework `ctx.audit` call | audit generated |
| 10 bypass event emission | skip the domain-event append | domain events emitted |
| 11 Electron directly mutates | direct store write, bypassing the governed handler | audit generated (governance lost) |

Duplicate conversion (#4) is protected by THREE independent layers (idempotency key, `convertedOrder` guard,
status→ordered transition); the isolating test forces status back to `approved` so the `convertedOrder` guard alone is
exercised — otherwise no single mutation could fail, which is the defense-in-depth working as intended.

---

## N · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session17ProcurementCommands.test.ts` | **19/19** |
| Session 16 / 15 / 14 / 12 / 11 (procurement, concurrency, tenant, P2P) | unchanged |
| `enterprise` + `platform` + `erp` + `medicalDevice` | **1700** passed |
| Full `src/main` suite | **8798 passed / 7 skipped**, 0 failed (846 files) |

---

## O · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the same pre-existing test-file backlog noted since Session 10 (sandbox-vs-Mac
config); no regression from this change — confirm on the Mac.

---

## P · FILES CHANGED

```
NEW  platform/command/domainCommand.ts          the canonical command + event contract
NEW  platform/command/commandBus.ts             dispatchCommand — tenant/authz/idempotency/delegate/event
NEW  platform/command/domainEventLog.ts         append-only, tenant-scoped, immutable events
NEW  platform/command/commandIdempotency.ts     at-most-once per (tenant, key), single-flight
MOD  enterprise/modules/procurement/purchaseRequestModule.ts   + lines; + submit/reject lifecycle actions
MOD  enterprise/modules/procurement/conversion.ts              PR→PO carries lines verbatim (deterministic, no inflation)
NEW  platform/command/session17ProcurementCommands.test.ts     19 pins (ERP E2E + platform seam + governance)
NEW  certification/ERP-SESSION17-PR-COMMANDS-PLATFORM-SEAM-EVIDENCE.md
```

Frozen surfaces untouched (packages/shared; cst/; contracts; channels; runtimeCore; connectors/index; executionGate).
The framework `moduleRegistry.ts` is REUSED, not modified. `certification/baseline.json` not staged.

---

## Q · COMMIT SHA

`<filled at commit>` — one commit, `erp(s17): …`. The user pushes from the Mac.

---

## R · REMAINING RISKS / BOUNDS

- **Idempotency + event log are in-memory / per-process** — correct and sufficient for a single-process modular
  monolith and to prove at-most-once within a process. A durable idempotency store + an outbox (for cross-process /
  restart durability) is a recorded follow-up, not needed now and explicitly not a microservice.
- **The command seam is not yet wired into the live Electron IPC.** It does not need to be for this session's goals
  (authorization is already outside the UI in the main process, and the seam is proven reusable by non-Electron
  dispatch). Routing the live IPC through `dispatchCommand` would touch frozen `channels`/`runtimeCore` and is a
  separate gated step — the existing IPC already delegates to the same governed module actions.
- **No approval-routing workflow engine** for procurement exists; documented as the missing capability (§11) rather
  than built (auto-approval thresholds are §17 undefined policy).
- **Supplier is a PO-stage field**, not selected on the PR (supplier selection is §17 undefined policy).
- Sessions 14–16 concurrency / multi-line / tenant guarantees carry forward unchanged.

---

## S · STATUS: 🟢 GREEN

ERP: 1 PR is a real multi-line domain object ✓ · 2 multiple lines ✓ · 3 approval governed ✓ · 4 deterministic
convert ✓ · 5 PR→PO traceability ✓ · 6 duplicate conversion impossible ✓ · 7 cross-tenant conversion impossible ✓ ·
8 existing multi-SKU P2P intact ✓ · 9 PR creates no accounting ✓.
Platform: 10 canonical command seam ✓ · 11 authorization outside the UI ✓ · 12 explicit transaction ownership ✓ ·
13 domain events emitted ✓ · 14 audit generated ✓ · 15 idempotency enforced ✓ · 16 tenant context at the boundary ✓ ·
17 reusable by Web/Mobile/API/AI ✓ · 18 no premature microservice ✓ · 19 no frozen surface modified ✓ · 20
regressions GREEN ✓.

GREEN with the §R bounds. MRP / manufacturing / advanced tax / FX / service extraction deliberately not started.
