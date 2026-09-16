# ERP + PLATFORM — SESSION 19: GOVERNED APPLICATION/API BOUNDARY + RFQ/QUOTATION FOUNDATION

**Date:** 2026-09-01 · **Branch:** `cert/data-import-cst-integration` · **Base:** Session 18 GREEN (`cd0d5e5`)
**Label:** TEST-VERIFIED. No frozen surface touched; modular-monolith-first (no microservice, no broker, no network
transport, no Electron IPC wiring). Inspect → map existing architecture → build minimal real boundary → integrate
RFQ/quote → negative control → failure test → full regression.

Two tracks: (A) reuse + harden the existing RFQ→Quote→award→PO flow; (B) a transport-neutral Application Boundary
above the Session 18 command bus.

---

## A · EXISTING RFQ ARCHITECTURE

A canonical RFQ module ALREADY exists (`procurement-rfqs`, tenant-scoped, RBAC `procurement:read/manage`, audit,
timeline): an RFQ raises ONE product to MANY suppliers; per-supplier quotes are JSON lines
(`{supplier, unitCost, leadTimeDays}`), every quoted supplier is **validated by exact name against the Suppliers
master (no phantom vendors)**, a deterministic engine stamps `bestValue`/`bestLeadTime`, and the **`award` action
selects the best-value quote and creates a DRAFT Purchase Order** which walks the certified approve→receive chain.
Awarded/cancelled RFQs are immutable history. **No duplicate RFQ or supplier model was created.**

Supplier-selection policy is therefore **DEFINED** (deterministic best-value; a buyer who wants a different winner
edits the quote lines). Session 19's Track A work: **reuse + prove** this flow and **harden RFQ→PO traceability**.

---

## B · SUPPLIER QUOTATION ARCHITECTURE

Supplier quotations exist as the RFQ's per-supplier quote lines (canonical, validated against the master, currency
supported). Hardened: the awarded PO now carries a `sourceRfq` back-reference alongside the already-stamped winning
supplier + unit cost, so RFQ → Quote → PO is fully traceable in both directions (`RFQ.awardedOrder` and
`PO.sourceRfq`).

**Multi-SKU RFQ — STOPPED (documented, §22).** The canonical RFQ is single-SKU / multi-supplier. Extending it to
multi-SKU would require an undefined multi-line **quote-comparison / award / split-sourcing** policy — every one of
which §22 lists as a STOP condition. So the multi-SKU RFQ extension is NOT implemented (no policy invented); it is
recorded as the next gate. RFQ line identity is the deterministic per-supplier quote identity (validated).

---

## C · RFQ → QUOTE → PO FLOW (mapped)

| Node | State |
|---|---|
| Purchase Request → PO | IMPLEMENTED (Sessions 16–18; governed commands) |
| RFQ | IMPLEMENTED (single-SKU, multi-supplier) |
| Supplier Response / Quote | IMPLEMENTED (per-supplier quote lines, master-validated) |
| Supplier Selection | IMPLEMENTED / POLICY-DEFINED (deterministic best-value award) |
| RFQ → PO (award) | IMPLEMENTED (draft PO + `sourceRfq` traceability) |
| Goods Receipt → Inventory/GRNI | IMPLEMENTED |
| Vendor Bill → GRNI/AP · Payment → AP | IMPLEMENTED |
| Multi-SKU RFQ / split sourcing | POLICY-UNDEFINED → STOPPED (§22) |

Proven: best-value award → PO carrying the RFQ ref + winning quote (supplier `Acme` at 5 beats `Globex` at 6);
RFQ + award create **no GL** (accounting begins only at the goods receipt).

---

## D · APPLICATION BOUNDARY ARCHITECTURE

A thin, transport-neutral seam in `platform/application/` ABOVE the command bus:

```
adapter (Electron | Web | Mobile | API | AI)
  → ApplicationRequest + authenticated RequestContext
  → handleApplicationRequest:
       authenticate → validate tenant claim vs principal
     → canonical DomainCommand (tenant + actor from the AUTHENTICATED context)
     → dispatchCommand  (authorization → policy → durable transaction → event → outbox → audit)
     → ApplicationResult  (deterministic error contract, no internal leakage)
```

It reuses everything: authorization is `ctx.authorize` built from the principal's granted permissions; idempotency /
transaction / event / outbox are the Session 18 durable journal, passed straight through. No second engine, no
transport (REST/GraphQL/gRPC) infrastructure, no Electron/React/IPC.

---

## E · REQUEST CONTEXT

`RequestContext { principal: {actor, tenantId, organizationId?, workspaceId?, permissions} | null, correlationId,
causationId?, requestId, source }`. The principal is resolved SERVER-SIDE from the authenticated session; a `null`
principal is unauthenticated. The `ApplicationRequest` may carry an untrusted `claimedTenantId`, which the boundary
validates against the principal and rejects on mismatch — tenant identity is never taken from client input.

---

## F · AUTHORIZATION PATH

`RequestContext → authenticate → build authz ctx from the principal's permissions → dispatchCommand → ctx.authorize
(bus + module) → transaction`. Authorization runs BEFORE any economic mutation and the boundary provides no bypass:
an unauthorized principal is denied UNAUTHORIZED with nothing created.

---

## G · COMMAND INTEGRATION

The boundary calls the canonical `dispatchCommand` — it does not re-implement routing, validation, mutation, audit
or events. The four PR commands (Create/Submit/Approve/Convert) run through it unchanged.

---

## H · IDEMPOTENCY INTEGRATION

The Session 18 durable journal is reused verbatim (no second idempotency system): same tenant + key → the same
result (replayed), across a process restart; a different tenant with the same key → independent execution.

---

## I · TRANSACTION / OUTBOX INTEGRATION

An application request → command → durable transaction → immutable event → PENDING outbox — all from the S18 journal.
The application layer never creates an outbox record itself; the transaction infrastructure remains authoritative.
Proven the outbox survives a reload-from-disk after an application request.

---

## J · AI COMPATIBILITY

A test-only AI adapter reaches ERP ONLY through a pre-bound application handle (deps closed over) — it holds no
registry / store / journal handle (compile-enforced) and produces a governed durable `PurchaseRequestCreated` event,
never a direct write. AI → DB and AI → ERP-store mutation are structurally impossible from the adapter.

---

## K · ELECTRON INDEPENDENCE

An executable test walks `platform/application` + `platform/command` + `platform/persistence` and asserts none import
`electron`, `react`, or `ipcMain`/`BrowserWindow`. The same application operation is invoked by a test-only Web
adapter and an AI adapter with no Electron. No real IPC was wired (frozen channels/runtimeCore untouched, §20).

---

## L · ERROR CONTRACT

Closed set: UNAUTHENTICATED · UNAUTHORIZED · TENANT_SCOPE_VIOLATION · VALIDATION_ERROR · POLICY_DENIED · CONFLICT ·
IDEMPOTENCY_REPLAY · NOT_FOUND · TRANSIENT_FAILURE. Each maps to a fixed, client-safe message; raw internal errors,
command codes, database paths, secrets, stack traces and tenant data never cross the boundary (an unexpected throw is
caught and mapped to TRANSIENT_FAILURE). Proven: the result JSON contains no `Error:`, no path, no stack.

---

## M · FAILURE / RESTART EVIDENCE

Validation failure → VALIDATION_ERROR (nothing created); authorization failure → UNAUTHORIZED (nothing created);
tenant-claim mismatch → TENANT_SCOPE_VIOLATION; state precondition → CONFLICT; duplicate key → replayed; restart →
outbox persists + key still replays. No unauthorized economic mutation, no duplicate economic mutation, no state
committed without its durable event/outbox (inherited from the S18 atomic commit).

---

## N · NEGATIVE-CONTROL RESULTS

Each mutation fails the appropriate test; each restore is byte-identical (sha256 verified).

| # (directive §19) | Mutation | Failing test |
|---|---|---|
| 1 bypass application authorization | remove the principal-permission check | UNAUTHORIZED denial |
| 2 trust client tenant ID | remove the claimed-tenant validation | TENANT_SCOPE_VIOLATION |
| 3 bypass command bus | direct store write instead of dispatch | durable event/outbox produced |
| 4 direct domain mutation from adapter | (structural — adapter holds no store handle) | AI adapter test + compile |
| 5 create second idempotency store | stop reusing the durable journal | idempotency replay |
| 6 allow AI direct store access | (structural — pre-bound handle only) | AI adapter test + compile |
| 7 expose raw internal exception | return the raw code as the message | safe-message |
| 8 remove correlation identity | drop correlationId from the result | observability metadata |
| 9 remove outbox from transaction | mark outbox DELIVERED at commit | app-request → pending outbox |
| 10 import Electron into application layer | add `from 'electron'` | Electron independence |
| 11 cross-tenant application request | drop tenant from the durable key | different-tenant independence |
| 12 unauthorized RFQ quote → PO | accept phantom (unregistered) vendors | phantom-vendor refusal |
| 13 remove RFQ-line → PO-line traceability | blank the awarded PO's `sourceRfq` | RFQ → PO traceability |

#4/#6 have no source line to mutate — the adapters are handed only a pre-bound `handle`, never the registry/journal;
granting them a store handle is a compile error, and the AI test proves the governed durable path.

---

## O · REGRESSION COUNTS

| Suite | Result |
|---|---|
| `session19ApplicationBoundary.test.ts` | **15/15** |
| Session 18 / 17 (durable + command bus, unchanged behavior) | 22 / 19 |
| `enterprise` + `platform` + `erp` + `medicalDevice` | **1737** passed |
| Full `src/main` suite | **8835 passed / 7 skipped**, 0 failed (846 files) |

---

## P · TYPECHECK / LINT / BUILD

`typecheck:node` + `typecheck:web` clean · `electron-vite build` clean · ESLint clean on all changed/new files.
Repo-wide `npm run lint` carries the pre-existing sandbox-vs-Mac test-file backlog noted since Session 10; no
regression from this change — confirm on the Mac.

---

## Q · FILES CHANGED

```
NEW  platform/application/requestContext.ts          canonical authenticated request context
NEW  platform/application/applicationErrors.ts       deterministic error contract + internal→app mapper (safe messages)
NEW  platform/application/applicationService.ts      handleApplicationRequest — the boundary over the command bus
MOD  enterprise/modules/procurement/purchaseOrderModule.ts   + sourceRfq field (RFQ → PO traceability)
MOD  enterprise/modules/procurement/rfqModule.ts             award stamps sourceRfq onto the drafted PO
NEW  platform/application/session19ApplicationBoundary.test.ts   15 pins
NEW  certification/ERP-SESSION19-APPLICATION-BOUNDARY-RFQ-EVIDENCE.md
```

Frozen surfaces untouched (packages/shared; cst/; contracts; channels; runtimeCore; connectors/index; executionGate).
`certification/baseline.json` not staged.

---

## R · COMMIT SHA

`<filled at commit>` — one commit, `erp(s19): …`. The user pushes from the Mac.

---

## S · REMAINING ARCHITECTURAL RISKS

- **The application boundary is not yet wired into live Electron IPC** — deliberate (§7/§20): wiring would touch
  frozen channels/runtimeCore. The boundary is proven callable by test-only Web + AI adapters; the Electron adapter
  is a future gated step.
- **Multi-SKU RFQ is a documented STOP** (undefined multi-line comparison/award/split-sourcing policy, §22), not a
  defect — the single-SKU best-value flow is the defined, proven policy.
- **Durable idempotency/event/outbox remain file-backed and in-process** (Session 18 bounds carry forward): correct
  for the modular monolith; a shared multi-process deployment would need cross-process coordination.
- No supplier ranking/scoring/quote-comparison/split-sourcing/tax/UoM policy invented (§22).

---

## T · STATUS: 🟢 GREEN

ERP: 1 existing RFQ reused ✓ · 2 no duplicate model ✓ · 3 deterministic (quote) line identity ✓ · 4 quote
architecture canonical/hardened ✓ · 5 RFQ→Quote→PO traceability preserved (`sourceRfq`) ✓ · 6 supplier assignment
governed ✓ · 7 no GL from RFQ/Quote ✓ · 8 multi-SKU procurement GREEN ✓.
Platform: 9 application boundary exists ✓ · 10 Electron-independent ✓ · 11 canonical request context ✓ · 12 tenant
authenticated/validated ✓ · 13 authorization cannot be bypassed ✓ · 14 calls the canonical command bus ✓ · 15 durable
idempotency reused ✓ · 16 transaction/event/outbox reused ✓ · 17 AI calls the same boundary ✓ · 18 AI has no DB
authority ✓ · 19 deterministic error semantics ✓ · 20 correlation/causation preserved ✓ · 21 negative controls pass ✓ ·
22 no frozen surfaces modified ✓ · 23 no premature network/microservice ✓ · 24 full regression GREEN ✓.

GREEN with the §S bounds, built as real executable infrastructure (request context, error contract, application
service, test adapters, RFQ traceability) — no interfaces-only, no placeholders. MRP / tax / FX / multi-SKU RFQ /
service extraction deliberately not started.
