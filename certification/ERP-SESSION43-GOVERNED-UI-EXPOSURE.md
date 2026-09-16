# ERP SESSION 43 — GOVERNED SALES ORDER UI EXPOSURE

**Gate:** S42-G1 · **Mode:** BUILD + INTEGRATE + ATTACK
**Classification:** **GREEN** (real production UI reaches the governed `CreateSalesOrder` path; all invariants pass)
**Baseline HEAD:** `fc3f627` (`docs(erp-s42): establish production readiness baseline`) · branch `cert/data-import-cst-integration`
**Frozen surfaces:** UNTOUCHED (0 changes; gate-detector `PROCEED` on both production files)
**External effects:** 0 · **Builds:** 1 (electron-vite, exit 0)

---

## 1 · BASELINE

- HEAD `fc3f627`, branch `cert/data-import-cst-integration`. Working tree at session start carried only the pre-existing `certification/baseline.json` modification (custody-protected, 3±3 lines, NOT staged) plus pre-existing untracked artifacts (`out-*`, `dist-seam-b13/`, `.claude/`, prior evidence docs) — none touched or staged.
- Typecheck (node + web) clean, lint clean before work.

## 2 · DISCOVERY (mandatory, before any code)

1. **S42 assessment** confirmed the exposure gap: the certified governed ERP spine was "correct but dark."
2. **The production UI that creates Sales Orders** is the generic descriptor-driven `EnterpriseModuleScreen` (`apps/desktop/src/renderer/src/enterprise/modules/EnterpriseModuleScreen.tsx`). There is no bespoke Sales Order screen; when the active module is the Orders module, this screen renders the create form. Its create branch (`submit()`, line ~379) called `ipc.enterpriseModules.create(module.id, input)` — the **non-governed** `enterprise:module.create` CRUD door.
3. **The governed `CreateSalesOrder` command** already exists (S21) and is reachable through `platform:command.dispatch` (S22 FG-ERP-LIVE-IPC). Its route (`commandBus.ts` `case 'CreateSalesOrder'`) takes the order fields as `cmd.payload`, **forces `status:'pending'`** (a client can never mint a shipped order), validates any `customerRef` against the caller's own tenant-scoped customer master (§16), then calls the same `EnterpriseModuleCreate` handler wrapped in the command bus. Response contract: `PlatformCommandDispatchResponse = { ok, data?:{id}, replayed?, error?:{code,message}, requestId, correlationId, operation }`.
4. **The current UI create path** (before S43): `EnterpriseModuleScreen.submit` → `ipc.enterpriseModules.create` → `enterprise:module.create` → module CRUD → durable module store. **Bypasses** the command journal, idempotency, intent-first recovery, outbox, and command-audit.
5. **The secure platform IPC path** already carries governed WRITEs: `platformCommandIpc.ts` routes non-read operations to `adapter.submit()` → Application Boundary → command bus → `ctx.authorize(PERMISSION_FOR_COMMAND[op])` → `journal.run` (durable intent + idempotency + event + outbox) → outbox drain → client-safe response. The renderer already uses `rawInvoke(IpcChannel.PlatformCommandDispatch, …)` for governed READS (S32/S34/S35).
6. **Smallest non-frozen integration point:** the `mode==='create'` branch of `EnterpriseModuleScreen.submit`, gated on `module.id === ORDERS_MODULE_ID`, plus one new renderer IPC helper. No frozen surface, no new channel, no new command.
7. **Reuse:** the existing `EnterpriseModuleScreen` form, the existing `platform:command.dispatch` channel, the existing `CreateSalesOrder` command, and the existing `PlatformCommandDispatchResponse` contract — all reused; nothing duplicated.

**STOP-check — every stop condition evaluated, none triggered:**
- **Permission alignment (decisive):** the Orders module declares `permissions: { read:'sales:read', write:'sales:manage' }`; `PERMISSION_FOR_COMMAND.CreateSalesOrder = 'sales:manage'`. **Exact match** — the governed path is authorized in precisely the place the CRUD create was. No user who could create before is refused now.
- **Field mapping is clean:** `formToInput` yields `{ fields: {...} }`; the governed payload is `input.fields`, and the route re-wraps it and injects `status`. Every Orders field maps directly; no field is undefined by the command.
- **No frozen contract change:** the request/response schemas already exist (FG-ERP-LIVE-IPC, S22). S43 adds only a renderer helper + a renderer branch.
- **Old-path separation is clean:** the create branch forks on `module.id`; the CRUD path is untouched for every other module and for Sales Order EDIT — no broader refactor, no double-write.
- **No undefined business policy** required. → **No decision memo needed; implementation proceeded.**

## 3 · EXACT UI PATH BEFORE S43

```
EnterpriseModuleScreen.submit (mode=create)
  → ipc.enterpriseModules.create(module.id, input)
  → enterprise:module.create  (secure bridge, requireAuth + module RBAC)
  → EnterpriseModuleRegistry create → EnterpriseRecordStore.put  (durable module store)
  ✗ NO command journal · NO idempotency · NO intent · NO outbox · NO command audit
```

## 4 · EXACT GOVERNED PATH (after S43, for the Sales Order create only)

```
EnterpriseModuleScreen.submit (mode=create, module.id === ORDERS_MODULE_ID)
  → ipc.platform.createSalesOrder(input.fields, stableIdempotencyKey)
  → window.neuropause.invoke('platform:command.dispatch', { operation:'CreateSalesOrder', payload, idempotencyKey })
  → secure preload → runSecureHandler (requireAuth) → platformCommandIpc handler
  → ElectronClientAdapter.submit → handleApplicationRequest (Application Boundary; principal + tenant server-resolved)
  → dispatchCommand (command bus) → ctx.authorize('sales:manage')
  → journal.run: durable intent (S40 intent-first) → CreateSalesOrder route → Sales Order module persistence (status forced 'pending')
     → durable command record + SalesOrderCreated domain event + PENDING outbox  (one atomic write)
  → outbox drain (S31 relay) → DeliveredEventLog
  → governance audit  (module.sales-orders.created)
  → client-safe response { ok, data:{id}, error } → UI success/error state
```

## 5 · INTEGRATION POINT SELECTED

The `mode==='create'` branch of `EnterpriseModuleScreen.submit`, gated on `module.id === ORDERS_MODULE_ID`. This is the single smallest non-frozen seam that makes the real production UI a real caller of the governed command, while leaving the generic CRUD path unchanged for every other module and for Sales Order edits.

## 6 · FILES CHANGED

**Production (2, both non-frozen renderer):**
- `apps/desktop/src/renderer/src/lib/ipc.ts` — new governed write helper `ipc.platform.createSalesOrder(fields, idempotencyKey)`; reuses `IpcChannel.PlatformCommandDispatch` + `rawInvoke` (the S32/S34/S35 read precedent). No new channel.
- `apps/desktop/src/renderer/src/enterprise/modules/EnterpriseModuleScreen.tsx` — imports `ORDERS_MODULE_ID`; a per-form-instance stable idempotency key (`useRef`); the `create && module.id===ORDERS_MODULE_ID` branch routes through the governed helper and maps the governed response into the existing success/error slots.

**Tests (2, new):**
- `apps/desktop/src/main/ipc/handlers/session43GovernedSalesOrderCreate.test.ts` — 12 handler-layer certifications of the UI-emitted operation.
- `apps/desktop/ui-tests/session43GovernedSalesOrderUI.test.tsx` — 5 UI-layer proofs incl. the old-path bypass proof.

## 7 · FROZEN-SURFACE RESULT

- `gate-detector.sh` on both production files → **PROCEED / PROCEED** (no authoritative frozen match).
- Neither file appears in `certification/frozen-surfaces.json`.
- `git status` shows **no** change under `packages/shared`, `cst/`, `contracts.ts`, or `channels.ts`.
- `certification/baseline.json` carries only its pre-existing modification and is **not** staged.
- **Conclusion: zero frozen surfaces touched; no FG gate required.**

## 8 · SUCCESSFUL END-TO-END UI PROOF

`session43GovernedSalesOrderUI.test.tsx` mounts the REAL `EnterpriseModuleScreen` for the Orders module, types into the REAL form, clicks the REAL **Create** button, and proves the click reaches `platform:command.dispatch` with `operation:'CreateSalesOrder'`, the typed fields as payload, and a real idempotency key — then the create modal closes from the governed success response. The handler-layer suite proves the SAME operation drives a durable persisted order + `SalesOrderCreated` event + PENDING outbox + `module.sales-orders.created` audit through the real secure pipeline (not a mock harness). **The UI is now a real caller of the governed command.**

## 9 · SECURITY / TENANT PROOF

- **UNAUTHORIZED before effect:** a principal with `sales:read` but not `sales:manage` → `ok:false, UNAUTHORIZED`, zero orders, zero journal records.
- **UNAUTHENTICATED fail-closed:** no principal → `UNAUTHENTICATED`, no order; the bridge auth gate rejects an unauthenticated session (`Sign in`) before any handler runs.
- **Tenant is server-resolved:** the renderer sends NO tenant (UI test asserts the envelope has neither `tenantId` nor `claimedTenantId`); a forged `claimedTenantId:'tenant-B'` → `TENANT_SCOPE_VIOLATION`, zero writes in tenant-B.
- **Untrusted payload sets no authority:** injected `actor`/`tenantId`/`confirmed`/`permissions` in the payload are ignored — the order is written under the resolved principal/tenant only.
- **Closed error contract:** refusals leak no path/stack/internal detail.

## 10 · IDEMPOTENCY / CONCURRENCY PROOF

- **Duplicate idempotency key → exactly one durable order** (the second REPLAYS: same id, `replayed:true`).
- **Concurrent same-key** (double-click / double-submit) → one order.
- **Concurrent different-key** → two independent orders.
- **UI retry reuses ONE stable key:** the form mints the idempotency key once per instance (`useRef`); the UI test proves a failed-then-retried create carries the SAME key on both attempts → replay-safe, never a duplicate order.

## 11 · EVENT / OUTBOX / AUDIT PROOF

The handler-layer success test asserts, on one governed create: exactly one durable journal record whose `event.type === 'SalesOrderCreated'`; exactly one PENDING outbox entry; a governance-audit entry `module.sales-orders.created`; and the order persisted in the Sales Order store with `status === 'pending'`. These are the same Session-18 journal + Session-31 relay + audit sink used in production — reused, not re-created.

## 12 · OLD-PATH BYPASS PROOF (the decisive result)

The UI test routes BOTH `platform:command.dispatch` and `enterprise:module.create`. On a Sales Order create it asserts the governed dispatch is called **once** and the CRUD create (`enterprise:module.create`) is **never** called (`expect(crud).not.toHaveBeenCalled()`), and `unroutedChannels()` is empty (no silently-swallowed call). The **CONTROL** test renders a non-Sales-Order (CRM) module, creates, and asserts the reverse: the CRUD door **is** used (`{ moduleId:'crm-customers' }`) and the governed dispatch is **never** called — proving the generic CRUD path is unchanged and the governed route did not hijack other modules. **The UI no longer performs the governed CreateSalesOrder operation through `enterprise:module.create`.**

## 13 · REGRESSION RESULTS

Sandbox constraint recorded honestly: this Linux workspace has **~3.9 GB RAM / 4 CPU**. The full 960-file main suite in one vitest process **exhausts memory here** (the run hung, then was OOM-killed at exit 137). It is not weakened or skipped — it is memory-bound in THIS environment and must be confirmed on the Mac (which recorded **960 files / 10056 passed / 7 skipped** at S42, unchanged base). Everything downstream of the change was run green here in memory-safe single-fork batches:

| Suite (memory-safe `--pool=forks --singleFork`) | Result |
|---|---|
| S43 handler test (isolated) | **12 / 12 passed** |
| S43 UI test (isolated) | **5 / 5 passed** |
| `src/main/ipc` + `src/main/enterprise` + `src/main/tenancy` + `src/main/platform/command` (incl. the S22/S31–S41 chain + the S43 handler test) | **290 files / 2986 passed** |
| `src/main/platform` + `src/main/ipc/handlers` + `src/main/enterprise/modules/sales` | **40 files / 440 passed** |
| Full UI suite `vitest.ui.config.ts` (incl. the S43 UI test) | **74 files / 419 passed** |
| typecheck (node + web) | **clean** |
| eslint (changed + new files) | **clean** |
| `electron-vite build` | **exit 0 (✓ built)** |

No existing test was weakened, skipped, or deleted. No existing UI test expected the CRUD path for the Sales Order create (the create is generic; the S43 branch forks only on `module.id`), so nothing was removed — the CONTROL test pins that the generic path is intact.

**Mac full-suite confirmation is the one external step (see §16).**

## 14 · REMAINING GAPS

- **Full 960-file main suite** must be run on the Mac (memory-bound in this sandbox). Expected unchanged base + the 12 new handler tests.
- **Scope fence honored:** only `CreateSalesOrder` is exposed. PO / GR / invoice / payment / shipment creates, and Sales Order lifecycle actions (ship/fulfil/close), still drive their existing paths — later gates.
- **Multi-line orders:** the `lines` JSON field flows through unchanged (the command derives the total); no new UI for line editing this session (out of scope).
- **AI → ERP execution** remains unwired (GRAY, by design) — AI is a client of the same governed adapter and never an authority.

## 15 · S43 CLASSIFICATION

**GREEN.** The real production UI reaches the governed `CreateSalesOrder` path; the old non-governed CRUD door is provably not used for this action; and every invariant — authorization-before-effect, tenant isolation, server-resolved identity, idempotency/replay, concurrency, event/outbox/audit, closed error contract — passes. Zero frozen surfaces touched. The single external step is the Mac full-suite confirmation (a run, not a fix).

## 16 · RECOMMENDED NEXT GATE (ONE, not implemented)

**S44 = Gate 2 — make HOLD / RECONCILIATION_REQUIRED operator-actionable.** With the governed create now reachable by real users, the intent-first crash-recovery HOLD state (S38/S40) can occur on a real user's order and today has **no operator surface to resolve it** — the highest-value operational gap now that exposure is closed. It reuses the existing S35 delivery-operations read surface and the governed command path; it invents no new policy. (Runner-up: extend the same governed-UI exposure to the next O2C write — `ShipSalesOrder`/`InvoiceSalesOrder` — up the ladder S43 just proved.)

---

*Evidence label: TEST-VERIFIED (handler + UI layers, real secure pipeline + real DOM). Full-main confirmation: PENDING on Mac (memory-bound in this sandbox). No external effects. No frozen surface touched.*
