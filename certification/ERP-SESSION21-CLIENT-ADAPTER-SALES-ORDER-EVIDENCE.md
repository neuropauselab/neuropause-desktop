# ERP SESSION 21 — API / CLIENT ADAPTER BOUNDARY + SALES ORDER FOUNDATION

**Baseline:** Session 20 GREEN — `10a9a4c`
**Tracks:** B (platform — the outermost client/API adapter boundary) · A (domain — Sales Order as another consumer of the same platform command path)
**Status:** 🟢 GREEN — TEST-VERIFIED
**Modular-monolith-first honored:** no microservice, no broker, no second authorization / transaction / event / audit / API engine, no Electron/IPC wiring, no frozen-surface modification.

---

## A · MANDATE

Give an untrusted client (Electron, Web, Mobile, HTTP API, or an AI agent) ONE governed way in, and make the Sales domain a first-class consumer of the exact platform primitives procurement already uses:

> Client Adapter ↓ Application Boundary ↓ CreateSalesOrder ↓ Authorization ↓ Policy ↓ Workflow (if required) ↓ Durable Transaction ↓ Sales Order state ↓ SalesOrderCreated event ↓ Outbox ↓ Audit.

Nothing new is invented where something exists: the adapter sits ABOVE the Session 19 application boundary (`handleApplicationRequest`) which dispatches through the Session 17/18 command bus + durable journal (idempotency + transaction + event + outbox) + the framework audit sink.

---

## B · INSPECTION (what already existed — reused, not rebuilt)

- **Customer master** = `crm-customers` (`crm/customerModule.ts`, `CUSTOMERS_MODULE_ID`), tenant-scoped, RBAC `crm:read`/`crm:manage`. **Reused verbatim** as the reference target for a Sales Order.
- **Sales Order** = `sales-orders` (`sales/orderModule.ts`, `ORDERS_MODULE_ID`), full lifecycle (pending/shipped/fulfilled/closed/cancelled), actions reserve/pickList/ship/fulfill/close/cancel/convert-to-invoice, RBAC `sales:read`/`sales:manage`. **Reused + extended** (multi-line + customer ref), not replaced.
- **Application boundary** (`platform/application/applicationService.ts` + `requestContext.ts` + `applicationErrors.ts`) — S19. Already forwards any `DomainCommandType` generically; needed only the new command wired into the contract + bus + a new closed error code.
- **Command bus + durable journal** (`platform/command/*`) — S17/S18. The single authorization + idempotency + transaction + event + outbox engine.
- Line helpers (`erp/procurementLines.ts`, S16) — the canonical `{sku,quantity,unitPrice}` line convention, reused for Sales Order lines.

## C · STOP-CHECK (undefined policy NOT invented)

Only DEFINED behavior was implemented. The following Sales policies are UNDEFINED in the repository and were **not** invented — they are explicitly out of scope this session and no code guesses them:

- **Pricing / discounting** — the order total is derived from supplied lines as `Σ quantity × unitPrice` (arithmetic, not a price list). No price book, no discount engine.
- **Tax determination** — no sales-tax/GST calculation on the order.
- **Credit limit / credit hold** — no customer credit check gates order creation.
- **Revenue recognition** — an order is a **commitment**; it posts **NO GL** (proven by test). Revenue/AR posting is a future session.
- **Sales approval policy** — no threshold/hierarchy exists for Sales Orders, so `CreateSalesOrder` requires no workflow gate today. The path is READY for one (see F): the `APPROVAL_REQUIRED` error code is now part of the closed contract so a future Sales approval policy surfaces deterministically.

## D · REPRODUCE (the gap this session closes)

Before S21, the Sales Order module was reachable only as a UI/conversion target — there was **no governed platform command** to create one. `dispatchCommand({ type: 'CreateSalesOrder', … })` fell through `validateEnvelope`'s `!EVENT_FOR_COMMAND[cmd.type]` guard → `UNKNOWN_COMMAND`, and the application/adapter layers had no Sales entry. Sales was therefore NOT a consumer of the command bus, durable transaction, event, or outbox. S21 closes that: Sales now flows through the identical governed path procurement uses, and the adapter is the single client entry above it.

---

## E · TRACK B — THE CLIENT / API ADAPTER BOUNDARY

`platform/adapter/clientAdapter.ts` (new, non-frozen). The outermost governed seam. Four structural invariants (each proven by test + isolated by a negative control):

1. **A `ClientRequest` is DATA.** It carries no store handle, no capability, no permission, no principal, no `confirmed`. `operation` is a bare `string` (untrusted → validated downstream, deny-by-default). Anything smuggled inside `payload` is ordinary command-field data to the module `validate` hook, never authority.
2. **The principal is resolved SERVER-SIDE** by an injected `Authenticator`, never from the request. A client-claimed tenant is validated against that principal and rejected on mismatch (in the application boundary).
3. **An AI agent is just another client** (`AIAdapter`, source `'agent'`). No special authority, no bypass; it provides only operation + payload, and `ctx.authorize` (built from the human principal's granted permissions) is the sole gate. No AI-specific allow/deny policy is invented — deny-by-default via the principal governs.
4. **Only the closed application error contract + a fixed safe message cross back out.** A misbehaving authenticator (or any unexpected throw) is caught and mapped to a safe `TRANSIENT_FAILURE`; no raw exception, path, secret, command code, or tenant data leaks.

Concrete adapters: `TestClientAdapter` (source `test`) and `AIAdapter` (source `agent`) differ ONLY in the attribution `source` — every governance-bearing step is identical, which is the point: one governed path.

## F · TRACK A — SALES ORDER OVER THE PLATFORM

- **Contract** (`platform/command/domainCommand.ts`): `CreateSalesOrder` added to `DomainCommandType`; `SalesOrderCreated` to `DomainEventType`; `EVENT_FOR_COMMAND.CreateSalesOrder = 'SalesOrderCreated'`; `PERMISSION_FOR_COMMAND` retyped to `Record<DomainCommandType, EnterprisePermission>` with `CreateSalesOrder: 'sales:manage'` (so Sales uses its OWN permission, not procurement's).
- **Route** (`platform/command/commandBus.ts`): a `CreateSalesOrder` case that (a) forces `status: 'pending'` on create — deny-by-default, a client cannot mint a shipped order; (b) validates a supplied `customerRef` against the **tenant-scoped** `crm-customers` store — a foreign-tenant customer is invisible (`store.get` applies `scopeOrDeny`, foreign≡absent≡`null`) → `CUSTOMER_NOT_FOUND`; (c) creates in `sales-orders` via the SAME `EnterpriseModuleCreate` handler; (d) provides a compensation `rollback` (soft-delete) for a failed durable commit. `validateEnvelope` updated so a create carries no `MISSING_TARGET` requirement.
- **Order module** (`sales/orderModule.ts`): additive `customerRef` (the CRM master ref; the free-text `customer` stays a display label) + `lines` (JSON, the S16 convention) fields; the `validate` hook derives `total` from lines (`Σ qty × unitPrice`) when present — single-product orders unchanged (backward compatible).
- **Error contract** (`platform/application/applicationErrors.ts`): `APPROVAL_REQUIRED` added to the closed `ApplicationErrorCode` set + safe message + mapping; `CUSTOMER_NOT_FOUND` mapped deterministically to `NOT_FOUND`.

No workflow gate is wired for Sales this session (no defined Sales approval policy). The application boundary already dispatches `CreateSalesOrder` generically, so Sales rides the S19 boundary with no boundary change.

## G · GOVERNANCE INVARIANTS (proven, not asserted)

- **One confirmation/authorization architecture** — Sales authorizes through the same `ctx.authorize` + command bus; no second engine.
- **Deny-by-default** — unknown operation → `VALIDATION_ERROR`; missing principal → `UNAUTHENTICATED`; lacking `sales:manage` → `UNAUTHORIZED`; foreign customer → `NOT_FOUND`; cross-tenant claim → `TENANT_SCOPE_VIOLATION`.
- **AI is untrusted data** (§6/§13) — the AI adapter reaches ERP only through the governed path, cannot self-grant, and payload-smuggled `confirmed`/`permissions`/`principal`/`tenantId`/`status` are inert.
- **Tenant authority from the principal** — never from the request; claimed tenant validated and rejected on mismatch; cross-tenant customer reference impossible.
- **Idempotency = one economic effect** — the durable journal single-flights and durably replays.

---

## H · TESTS — `platform/adapter/session21ClientAdapter.test.ts` (22, all green)

Driven through the REAL adapter classes, REAL registry, REAL durable journal, REAL Sales Order + Customer modules:

- **Governed flow:** CreateSalesOrder → `SalesOrderCreated` event + durable journal record + outbox entry + audit `module.sales-orders.created`; the order exists in `sales-orders`.
- **Multi-line total** derived as `Σ qty × unitPrice` (10×5 + 2×20 = 90).
- **Create is always pending** — payload `status:'shipped'` still lands `pending`.
- **Valid customerRef** in the caller's tenant is accepted and stamped.
- **No GL** on order creation (commitment, not accounting).
- **Error contract:** UNAUTHENTICATED / UNAUTHORIZED (no mutation) / VALIDATION_ERROR (unknown op + invalid payload) / safe-message-only (no leak) / **APPROVAL_REQUIRED in the closed set** / misbehaving authenticator → TRANSIENT_FAILURE (no secret leak).
- **Idempotency:** 100 concurrent same-key submits → exactly ONE order (single-flight coalescing); a subsequent same-key submit replays durably; restart (`journal.reload`) preserves outbox + replay.
- **Tenant isolation (§16):** TENANT_SCOPE_VIOLATION on a foreign tenant claim; a Sales Order cannot reference another tenant's customer (NOT_FOUND, no order minted); two tenants with the same key are independent.
- **AI governance:** AIAdapter stamps `agent` and rides the durable path; an AI for a principal without `sales:manage` → UNAUTHORIZED; payload-smuggled authority is inert (status forced `pending`, order in the authenticated tenant `A`, never payload-claimed `tenant-EVIL`).
- **Serializability + independence:** a `ClientRequest` JSON round-trips and still works; the adapter + application + command + persistence layers import no Electron / React / IPC (executable walk).

## I · NEGATIVE CONTROLS (each new guard proven load-bearing; byte-identical restore)

Method: back up the file, apply a single targeted mutation, run the matching test EXPECTING it to fail, restore from backup, verify sha256 round-trip. (One instrument correction recorded: NC-A first used a lowercase `-t` filter against an uppercase test name → 0 tests matched → false pass, per §2 #24; re-run with the exact-case filter, control-confirmed exactly 1 test matched.)

| NC | Guard mutated | File | Matched test | Result |
|----|---------------|------|--------------|--------|
| A | remove `status:'pending'` forcing | commandBus.ts | "…ALWAYS pending…" | 🔴 fails → guard load-bearing |
| B | disable `customerRef` tenant-scoped validation | commandBus.ts | "…cannot reference another tenant…" | 🔴 fails → guard load-bearing |
| C | disable claimed-tenant vs principal check | applicationService.ts | "TENANT_SCOPE_VIOLATION when the client claims" | 🔴 fails → guard load-bearing |
| D | weaken `CreateSalesOrder` perm to `sales:read` | domainCommand.ts | "UNAUTHORIZED when the principal lacks" | 🔴 fails → guard load-bearing |
| F | defeat idempotency key (unique per attempt) | clientAdapter.ts | "100 concurrent submits" | 🔴 fails → guard load-bearing |
| G | disable total-from-lines derivation | orderModule.ts | "…derives its total from the lines" | 🔴 fails → guard load-bearing |

All five touched files verified **byte-identical** (sha256) after restoration; git status clean for them before commit.

## J · REGRESSION COUNTS

- **Full main suite (sharded 4×, to fit the 178s per-call cap):**
  - shard 1/4 — 235 files, 2542 passed
  - shard 2/4 — 235 files, 2460 passed
  - shard 3/4 — 235 files, 2285 passed, 4 skipped
  - shard 4/4 — 235 files, 2569 passed, 3 skipped
  - **Total: 940 files · 9856 passed · 7 skipped · 0 failed**
- **UI suite:** 70 files · 405 passed (the `UNROUTED_CHANNEL` lines are expected ui-harness noise, not failures).
- **Focused S21 suite:** 22 passed.

## K · TYPECHECK / LINT / BUILD

- `typecheck:node` — clean.
- `typecheck:web` — clean.
- `typecheck:test` — zero errors mentioning any S21 file (the 63 pre-existing errors in unrelated test files are untouched, out of scope).
- `eslint` (changed files) — 0 errors / 0 warnings.
- `electron-vite build` — ✓ built (main + preload + renderer).

## L · FILES CHANGED

New (non-frozen):
- `apps/desktop/src/main/platform/adapter/clientAdapter.ts`
- `apps/desktop/src/main/platform/adapter/session21ClientAdapter.test.ts`

Modified (non-frozen):
- `apps/desktop/src/main/platform/command/domainCommand.ts` — CreateSalesOrder / SalesOrderCreated / permission mapping.
- `apps/desktop/src/main/platform/command/commandBus.ts` — CreateSalesOrder route + envelope create-exemption.
- `apps/desktop/src/main/platform/application/applicationErrors.ts` — APPROVAL_REQUIRED + CUSTOMER_NOT_FOUND mapping.
- `apps/desktop/src/main/enterprise/modules/sales/orderModule.ts` — customerRef + lines fields + total-from-lines.

## M · REUSE, NOT DUPLICATION

Customer master (`crm-customers`), Sales Order module, application boundary, command bus, durable journal (idempotency + transaction + event + outbox), audit sink, and the S16 line helpers are all reused. The only genuinely new code is the thin adapter seam (entry/exit shaping) + the Sales command wiring. No second authorization/transaction/event/audit/API engine exists.

## N · FROZEN-SURFACE & CUSTODY DISCIPLINE

- No frozen surface modified. All edits are in non-frozen `platform/*` and non-frozen `enterprise/modules/sales/*`.
- `certification/baseline.json` shows as modified in the working tree (pre-existing, custody-protected) and was **NOT** staged.
- Pre-existing untracked artifacts unrelated to S21 (`out-run/`, `out-seam-b20/`, `dist-seam-b13/`, `.claude/`, and other evidence files) were **NOT** staged. Only S21 files (+ this evidence) are in the commit.

## O · REMAINING RISKS / FUTURE WORK (recorded, not invented)

- Sales pricing, tax, credit, and revenue/AR posting remain STOPPED (undefined policy) — a future session, gated on a decision.
- No Sales approval policy is defined, so `CreateSalesOrder` currently requires no workflow gate; the `APPROVAL_REQUIRED` contract entry makes a future gate surface deterministically.
- `customerRef` is validated for existence-in-scope only (deny-by-default); a customer *status* gate (e.g. refuse `blocked` customers) is undefined policy and not invented.

## P · STATUS: 🟢 GREEN — TEST-VERIFIED

Sales is now a governed consumer of the same platform primitives as procurement, entered through a single serializable, authority-free client adapter that treats every client — including an AI agent — identically and fail-closed.
