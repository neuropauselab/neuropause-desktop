# P5 — Increment 12: Oracle Fusion Cloud ERP Enterprise Connector Family

**Status:** ✅ Production complete — all 6 validation gates green
**Scope:** Oracle Fusion Cloud ERP becomes **ONE** connector family (`oracle`). No standalone connectors, no new subsystems.
**Stop condition honored:** Work stops here. Microsoft Dynamics 365 has **not** been started.

---

## 1. Repository Recon (FIRST — never guess, never duplicate)

Recon was run before a single line was written, spawning a repository-intelligence pass plus an Oracle Fusion platform research sub-agent, and cross-reading the eight proven connector families already in the monorepo.

**Existing seams confirmed and re-used (NOT rebuilt):**

| Seam | File | How Oracle extends it |
|---|---|---|
| Adapter SDK (`ConnectorAdapter`/`AdapterResource`/`SyncContext`/`SyncPage`) | `apps/desktop/src/main/unified/sync/adapterSdk.ts` | `oracleAdapter` implements it; nothing in the engine changed |
| Adapter registry | `apps/desktop/src/main/unified/sync/adapters/index.ts` | one `registerAdapter(oracleAdapter)` line |
| Graceful per-service degradation | `apps/desktop/src/main/unified/sync/adapters/delta.ts` (`graceful`) | every resource wrapped; 403→unauthorized, 404→unprovisioned |
| Cursor codec | `adapters/util.ts` (`parseJsonCursor`/`toJsonCursor`) | opaque JSON cursor holds the high-water + offset state |
| Orchestrator paging loop | `sync/orchestrator.ts` (`MAX_PAGES_PER_RESOURCE = 50`, durable cursor) | adapter self-caps at 30 pages < 50 and commits the high-water |
| Manifest + OAuth engine | `connectors/manifests.ts`, `connectors/oauthEngine.ts`, `oauthTokens.ts` | one manifest entry; **zero** OAuth-engine changes |
| Env-derived per-tenant host | ServiceNow/SAP precedent (`SERVICENOW_BASE`, `SAP_BASE`) | two Oracle hosts (IDCS + Fusion) built the same way |

**The recon verdict:** Oracle needs the *generic-fallback* capability path (like Salesforce/ServiceNow/SAP), **not** a scope catalog — Fusion access is role/data-security governed, not per-object OAuth scope. So there is **no** `serviceCapabilities` branch and **no** `oracleServiceAvailability()`; `describeAdapter().resources` is already correct.

---

## 2. Architecture Decision

**Oracle Fusion Cloud ERP = ONE connector family.** One card, one OAuth token, one vault record, one health engine, one inspector — with **eleven** Fusion business objects each mounted as a `graceful()`-wrapped `AdapterResource` on the *same* authenticated session. This mirrors, exactly, how `microsoft-entra` hosts M365 and how `salesforce`/`hubspot`/`servicenow`/`sap` host their objects.

**Oracle-specific wrinkles, each resolved by extending an existing seam (never a new subsystem):**

1. **Two hosts.** Fusion splits OAuth (Oracle Identity Cloud Service — IDCS/IAM) from the data API (the Fusion applications pod). The manifest builds the authorize/token URLs from `NEUROPAUSE_ORACLE_IDCS_HOST` (the ServiceNow/SAP env-host precedent); the adapter builds data-call URLs from `NEUROPAUSE_ORACLE_FUSION_HOST`, read at call time (the `github.ts`/`sapBase()` precedent). The two hosts never diverge because each side owns its own env var.
2. **IDCS Basic client auth.** IDCS confidential clients authenticate at the token endpoint with HTTP Basic — the one auth-style difference from the body-credential ERP families. Handled by `tokenAuthStyle: 'basic'` in the manifest; **no** OAuth-engine change (the engine already supports Basic).
3. **`expires_in` (3600s) + `offline_access` refresh token** → the existing proactive-refresh path covers it with **no** synthesized TTL (like HubSpot/ServiceNow/SAP; unlike Salesforce).
4. **Role/data-security governed access** → generic-fallback capability, no scope catalog (like Salesforce/ServiceNow/SAP).
5. **Fusion REST shape** → `{items, hasMore, count}` envelope (an explicit `hasMore` boolean drives paging — no Link header), `limit`/`offset` paging, `onlyData=true` strips per-row link blocks, `q` finder filters (`LastUpdateDate >= '<ISO>'`), `orderBy` sorts.
6. **400 disambiguation** → a resource not on this pod/release, a non-queryable attribute, or a mandatory-finder resource all answer 400; degraded **visibly** as unprovisioned with a distinct reason (see §5, Finding 2).

**Incremental strategy** (the leapfrog-free ASC-resume proven in `salesforce.ts`/`servicenow.ts`/`sap.ts`):
- **8 delta objects** (change field `LastUpdateDate`): `q=LastUpdateDate >= <high-water>` + `orderBy=LastUpdateDate:asc,<full key>:asc` (a **total** order → stable `offset` paging even for compound keys), paging within a run via `offset`, resuming across runs via the durable epoch-ms high-water. A `MAX_PAGES` (30) cap commits the newest `LastUpdateDate` and the next run resumes from it. `>=` re-scans the boundary (store dedups). A saturated-boundary `offset` carry (the SAP `sat` fix) is retained as defense-in-depth against a pod that returns second-granular stamps.
- **3 full-list masters** (no reliably-queryable change field — Business Units LOV, Suppliers, Projects): a continuous `offset` walk that continues across runs and resets on drain.

---

## 3. Files Changed

**New (2):**

| File | Lines | Purpose |
|---|---|---|
| `apps/desktop/src/main/unified/sync/adapters/oracle.ts` | ~430 | The Oracle Fusion ERP family adapter — 11 specs, 11 mappers, uniform Fusion REST pull (delta high-water + full-list continuation), `ORACLE_SERVICES` catalog |
| `apps/desktop/src/main/unified/sync/adapters/oracleFamily.test.ts` | ~320 | 26 pure-node fake-HTTP tests |

**Modified (2):**

| File | Change |
|---|---|
| `apps/desktop/src/main/connectors/manifests.ts` | Added Oracle env consts (`ORACLE_IDCS_BASE`, `ORACLE_SCOPE`, `ORACLE_OAUTH_SCOPES`) + the `oracle` manifest entry (IDCS OAuth URLs, `tokenAuthStyle: 'basic'`, `offline_access`, loopbackPort **42827**, `multiAccount: false`) |
| `apps/desktop/src/main/unified/sync/adapters/index.ts` | `import { oracleAdapter }` + `registerAdapter(oracleAdapter)` |

**No other files touched.** No engine, OAuth, vault, health, inspector, timeline, memory, graph, or capability-subsystem changes.

---

## 4. Connector Family — the 11 objects

| Resource id | Fusion REST resource | apiRoot | UDM kind | Key (sourceId grain) | Incremental |
|---|---|---|---|---|---|
| `oracle_business_units` | `finBusinessUnitsLOV` | fscm | organization | BusinessUnitId | full-list |
| `oracle_suppliers` | `suppliers` | fscm | organization | SupplierId | full-list |
| `oracle_projects` | `projects` | fscm | project | ProjectId | full-list |
| `oracle_customers` | `accounts` | **crm** | organization | PartyNumber | LastUpdateDate |
| `oracle_items` | `itemsV2` | fscm | document | ItemId, OrganizationId | LastUpdateDate |
| `oracle_inventory` | `inventoryOnhandBalances` | fscm | document | Org, Item, Subinv, Locator, Lot, Serial, Revision | LastUpdateDate |
| `oracle_purchase_orders` | `purchaseOrders` | fscm | task | POHeaderId | LastUpdateDate |
| `oracle_receipts` | `receivingTransactionsHistory` | fscm | task | TransactionId | LastUpdateDate |
| `oracle_invoices` | `invoices` | fscm | document | InvoiceId | LastUpdateDate |
| `oracle_payments` | `payablesPayments` | fscm | document | CheckId | LastUpdateDate |
| `oracle_work_orders` | `workOrders` | fscm | task | WorkOrderId | LastUpdateDate |

Runtime pillar detection (Financials / Procurement / Supply Chain / Manufacturing / Projects / Inventory / Receivables / Payables) is driven by the per-module `graceful` degrade — a pod missing a pillar's objects degrades those modules, never the family. Every `sourceId` is object-type-prefixed (`invoice-`, `supplier-`, …) so Fusion surrogate keys that are unique only within an object type never collide across the unified store.

---

## 5. Security Review

- **Tokens never cross IPC.** No adapter code touches IPC; token handling stays inside the main-process OAuth engine (`getValidAccessToken`), untouched by this increment.
- **No secret in any DTO/entity/cursor/log.** The cursor holds only `{hw, offset, runAt, pending, page, sat}` — epoch numbers and a run clock. Mappers emit business fields only. No token, client secret, or Basic header is ever serialized.
- **safeStorage-only vault** — reused as-is; Oracle adds no new storage.
- **Least-privilege, read-only.** The adapter issues only Fusion REST **GET**s. The manifest requests the coarse Fusion resource scope + `offline_access`; least privilege is enforced by provisioning a read-only integration user with view-only duty roles (documented in the manifest comment). No write scope, no write path.
- **RBAC lock-out risk:** none — this increment adds no RBAC rule and no owner-gated grant.
- **IDCS Basic auth** is confined to the token endpoint via the existing engine setting; the client secret is read from `NEUROPAUSE_ORACLE_CLIENT_SECRET` at token time and never logged or stored in a DTO.
- **Adversarial review** (independent sub-agent, "silent data-loss" mandate) run before shipping — findings triaged and fixed below.

**Adversarial review outcome (4 of 5 findings actioned; the state machine cleared on every axis):**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | **CRITICAL** (confirmed) | Inventory keyed on `(item, org, subinventory)` — **not** the resource's real grain. Lot/locator/serial-controlled balances collapse to one `sourceId` and silently overwrite (most real onhand rows lost). | **Fixed.** Key expanded to the full physical grain `(OrganizationId, InventoryItemId, SubinventoryCode, LocatorId, LotNumber, SerialNumber, Revision)` — drives both the collision-free sourceId *and* the offset-paging total order. New regression test proves two balances differing only by locator/lot get distinct ids. |
| 2 | **HIGH** (confirmed) | Blanket 400→404 remap (copied from ServiceNow) masks a *malformed-query* 400 as a silent "unprovisioned" — but, unlike ServiceNow, Fusion **does** 400 on bad queries, so a systematic query bug would hit every delta object and be invisible. | **Fixed.** 400 now returns a **visible** degraded page with a **distinct reason naming the 400** (not masked as a native 404), preserving the cursor and keeping the family alive — a whole-surface query problem is now observable in module status, never a healthy-looking zero. |
| 3 | MEDIUM (speculative) | `oracleLiteral()` datetime format unverified; a mismatch would degrade all 8 delta objects. | **Mitigated + verified.** Oracle docs confirm `LastUpdateDate` is `x-queryable` (ISO-8601 `date-time`), `q` supports `>=` directly with **no finder**, and `+00:00` is an accepted offset. Format isolated in one function; Finding 2 makes any residual miss observable. Pod quote-style noted in §9. |
| 4 | MEDIUM (mechanism) | Fusion IDs arrive as JSON numbers; an id > 2^53 would lose precision before `String()`. | **Documented** (§9). FA surrogate keys are allocated below 2^53; the transport is shared and out of scope to change for one connector. Precision loss (if any) is stable-per-value. |
| 5 | LOW (hardening) | Offset advanced by fixed `PAGE`, not actual row count — a short page + more would skip the gap. | **Fixed.** Advance by `rows.length` in all three branches (within-run, sat, full-list), mirroring `sap.ts`. |

The reviewer independently **cleared** (traced, no bug): high-water monotonicity + `>=`/overlap correctness, the run-scoped offset guard for both delta and full-list, `pending` initialization across first-sync/same-run/sat, the saturated-boundary carry (engages only when the high-water can't advance; clears the instant it does), the MAX_PAGES cap commit (byte-for-byte equal to `sap.ts`), the `hasMore && rows.length > 0` guard, and every non-inventory key being a true unique key.

---

## 6. Performance Review

- **Bounded per run:** delta objects self-cap at 30 pages × 200 rows = 6,000 rows/run, then commit the high-water and resume forward next run — never a re-scan from zero, never a deep-offset crawl (offset resets when the high-water advances). Under the orchestrator's own 50-page ceiling.
- **`onlyData=true`** strips per-row link blocks → smaller payloads.
- **No `fields` projection** — deliberately omitted to avoid a 400 on per-release field-name variance; Fusion returns the data attributes and mappers select what they need. Slightly larger payloads, materially more robust.
- **Full-list masters** (Business Units/Suppliers/Projects) walk a continuous offset bounded by the orchestrator's 50-page cap, resuming across runs — no unbounded single-run walk.
- **Steady state:** an unchanged sync issues one `q=LastUpdateDate >= <hw>` returning zero rows and commits the high-water unchanged — O(1).

---

## 7. Regression Review

- **All 6 gates green** (see §9). Desktop suite **2217 tests / 253 files**, up from 2191 at Increment 11 — **+26** Oracle tests, **zero** regressions in the other 2191.
- The only shared files touched (`manifests.ts`, `adapters/index.ts`) were **append-only** — new consts + one manifest entry + one import/registration line. Existing manifests and adapters are byte-for-byte unchanged.
- Manifest lookup (`MANIFEST_BY_ID`) and `describeAdapter` capability projection pick up `oracle` automatically with no branch.

---

## 8. Tests Added (26, pure-node fake HttpClient)

Composition & catalog (2) · mappers — kinds, per-object id prefixes, ISO-offset parsing, compound keys, **inventory full-grain + no-collision regression**, stable-baseline stamping (7) · delta high-water — first-sync no-`q`, `>= '<+00:00>'` at hw-minus-overlap, within-run `rows.length` advance + drain, run-scoped offset guard (stale offset/pending dropped), compound-key full `orderBy`, missing-change-field safety, zero-rows steady state, MAX_PAGES cap commit, saturated-boundary carry (10) · full-list — offset continuation across runs + reset, prior-run offset honored, pathological hasMore-empty guard (3) · two-host/two-apiRoot split — customers on `crmRestApi`, ERP on `fscmRestApi` (1) · graceful degradation — 400 visible-degrade with distinct reason, 404/403 kinds, 5xx propagates (3) · manifest — IDCS OAuth URLs, Basic auth, `offline_access`, null revoke, port 42827, no TTL, single-account (1).

---

## 9. Build Status & Known Limitations

**Gates (real exit codes):**

| Gate | Command | Result |
|---|---|---|
| 1 | `npm run typecheck --workspaces --if-present` | ✅ exit 0 |
| 2 | `npm run lint` | ✅ exit 0 |
| 3 | `npm run test -w @neuropause/desktop` | ✅ exit 0 — 2217 passed |
| 4 | `npm run test -w @neuropause/sdk` | ✅ exit 0 |
| 5 | `npm run test -w @neuropause/cli` | ✅ exit 0 |
| 6 | `npm run build -w @neuropause/desktop` | ✅ exit 0 — built in 5.49s |

**Environment variables (register before connecting Oracle):**
- `NEUROPAUSE_ORACLE_IDCS_HOST` — IDCS/IAM host (e.g. `idcs-abc123.identity.oraclecloud.com`)
- `NEUROPAUSE_ORACLE_FUSION_HOST` — Fusion pod host (e.g. `mytenant.fa.us2.oraclecloud.com`)
- `NEUROPAUSE_ORACLE_SCOPE` — the deployment's Fusion resource scope
- `NEUROPAUSE_ORACLE_CLIENT_ID` / `NEUROPAUSE_ORACLE_CLIENT_SECRET`
- Register `http://127.0.0.1:42827/callback` as the confidential app's redirect URL.

**Known limitations (all pod-validation, none blocking):**
1. **`q` quote style is pod-testable.** The quoted `+00:00` ISO literal is a documented-valid Fusion form, but a given pod/release may prefer an unquoted or `Z` variant. Isolated in `oracleLiteral()` — a one-line change — and any mismatch now degrades *visibly* (Finding 2), never silently.
2. **Resource-name / attribute variance.** `receivingTransactionsHistory` and a handful of display attributes vary by Fusion release; a resource absent on a pod degrades *that module* as unprovisioned (never the family), and a missing display attribute maps to `null` (never a crash). Only key + `LastUpdateDate`/`orderBy` fields are load-bearing, and those are the documented queryable ones.
3. **`inventoryOnhandBalances` may mandate a finder** on some pods; if so it degrades visibly as unprovisioned until a finder is added — the graceful layer protects the rest of the family.
4. **JS number precision on Fusion IDs > 2^53** (FA surrogate keys are allocated well below this; changing the shared transport is out of scope for a single connector).
5. **No Fusion deep link** (`url: null`) — a Fusion UI deep link needs per-pod config, exactly as with SAP.

---

## 10. Next Increment

**Microsoft Dynamics 365 Enterprise Connector Family** — **NOT STARTED**, per the explicit stop condition. Oracle Fusion Cloud ERP is fully production complete with all validation gates green. Awaiting the go-ahead to begin Dynamics 365 as the next single connector family.
