# P5 — Increment 14: Workday Enterprise Connector Family

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Status:** ✅ Production complete — all 6 validation gates green
**Scope:** Workday becomes **ONE** connector family (`workday`). No standalone connectors, no new subsystems.
**Stop condition honored:** Work stops here. **AWS and Azure have not been started.**

---

## 1. Repository Recon (FIRST — never guess, never duplicate)

Recon ran before any code, via two parallel repository-intelligence sub-agents: (A) a repo-seam confirmation that the Workday family fits entirely inside three seams, and (B) a Workday-platform research pass cross-verified against Workday's REST/WQL/OAuth docs and multiple independent integration-vendor references.

**Existing seams confirmed and re-used (NOT rebuilt):**

| Seam | File | How Workday extends it |
|---|---|---|
| Adapter SDK / registry | `adapterSdk.ts`, `adapters/index.ts` | `workdayAdapter` implements it; one `registerAdapter` line |
| Graceful per-service degradation | `adapters/delta.ts` (`graceful`) | every object wrapped; 403→unauthorized, 404→unprovisioned |
| Cursor codec / HttpClient | `adapters/util.ts`, `sync/http.ts` | opaque JSON cursor; `getJson` URL-encodes `query`, injects the bearer token, maps 401/403→AuthError |
| Full-list offset walk | `adapters/oracle.ts` / `sap.ts` | Oracle's `offset`+`{total}` pattern, `hasMore = offset+rows < total` |
| Env-derived host+tenant | SAP host+client precedent | `NEUROPAUSE_WORKDAY_HOST` + `NEUROPAUSE_WORKDAY_TENANT`, read at call time |
| Manifest + OAuth engine | `connectors/manifests.ts`, `oauthEngine.ts` | one manifest entry (Basic-auth token endpoint); **zero** engine changes |
| Generic capability fallback | `sync/index.ts` (`describeAdapter().resources`) | role-governed → **no** `serviceCapabilities` branch |
| Store content tie-break | `unifiedStore.ts` (`upsertMany`, signature) | detects Workday content changes despite a stable `updatedAt` |

**Recon verdict:** a pure extension — a new `adapters/workday.ts`, one manifest object, one `registerAdapter` line, and a new test. `ConnectorId` is `string` (no union to edit), `MANIFEST_BY_ID` auto-derives, `credentials.ts` reads the manifest's env-var names generically, no count-based test to break, and `loopbackPort 42831` is the next free port. No engine, OAuth, vault, health, inspector, timeline, memory, graph, or capability-subsystem change.

---

## 2. Architecture Decision

**Workday = ONE connector family.** One card, one OAuth token, one vault record, one health engine, one inspector — with **twelve** Workday HCM objects each mounted as a `graceful()`-wrapped `AdapterResource` on the *same* authenticated session, read through the uniform Workday REST collection endpoints. Mirrors `microsoft-entra`/`salesforce`/`servicenow`/`sap`/`oracle`/`dynamics365`.

**Workday-specific wrinkles, each resolved by extending an existing seam:**

1. **Per-tenant host AND tenant name.** Every OAuth and REST URL embeds both the host and the tenant short-name (`.../ccx/api/{service}/{version}/{tenant}/…`). Both come from env — in the manifest (for the OAuth URLs) and the adapter (for data calls, read at call time), so auth and data never diverge (the SAP host+client precedent).
2. **HTTP Basic client auth + `expires_in` + refresh** → `tokenAuthStyle: 'basic'` in the manifest; the existing proactive-refresh path covers it with no synthesized TTL (like SAP/Oracle/Dynamics).
3. **ISU security-group governed access** (the functional-area scope is necessary but the Integration System User's security groups + domain policies are the real gate) → generic-fallback capability, no scope catalog.
4. **Uniform `{total, data}` + offset/limit REST** (max page 100), reference fields as `{id: WID, descriptor}`. **No `$select`** is sent (the endpoint returns the whole object) → the Oracle no-field-projection robustness (a per-tenant field-name variance never fails a query; mappers read whatever is present).
5. **Object-prefixed sourceId.** A WID is unique per *instance*, but the same instance surfaces in **more than one endpoint** (a supervisory org IS an organization; a department is an organization) and several endpoints share a UDM `kind` — so every sourceId is prefixed with its object type (the SAP/Oracle collision guard; see §5, Finding 1).

**Sync strategy** (leapfrog-free full-list, proven at `sap.ts`/`oracle.ts`): neither REST nor WQL exposes a universal modified-time filter (that is a SOAP `Get_Workers` transaction-log capability), so every object is a full `offset`/`limit` snapshot walk that **continues across runs** (bounded by the orchestrator's 50-page cap) and **resets on drain**. The store's content-signature tie-break detects content changes even though every row carries a stable `updatedAt` baseline. Per-object modified-time incremental via the SOAP transaction log / a RaaS updated-since prompt is a documented future enhancement.

---

## 3. Files Changed

**New (2):**

| File | Lines | Purpose |
|---|---|---|
| `apps/desktop/src/main/unified/sync/adapters/workday.ts` | ~380 | The Workday family adapter — 12 specs, 12 mappers, uniform REST `{total,data}` offset walk, `WORKDAY_SERVICES` catalog |
| `apps/desktop/src/main/unified/sync/adapters/workdayFamily.test.ts` | ~230 | 17 pure-node fake-HTTP tests |

**Modified (2):**

| File | Change |
|---|---|
| `apps/desktop/src/main/connectors/manifests.ts` | Added the Workday env consts (`WORKDAY_BASE`, `WORKDAY_TENANT`) + the `workday` manifest entry (host+tenant OAuth URLs, `tokenAuthStyle: 'basic'`, `scopes: []`, loopbackPort **42831**, `multiAccount: false`) |
| `apps/desktop/src/main/unified/sync/adapters/index.ts` | `import { workdayAdapter }` + `registerAdapter(workdayAdapter)` |

**No other files touched.** No engine, OAuth, vault, health, inspector, timeline, memory, graph, or capability-subsystem changes.

---

## 4. Workday Connector Family — the 12 objects

| Resource id | REST path (`/ccx/api/…`) | UDM kind | sourceId prefix |
|---|---|---|---|
| `workday_workers` | `staffing/v6/{tenant}/workers` | contact | `worker-` |
| `workday_organizations` | `common/v1/{tenant}/organizations` | organization | `organization-` |
| `workday_positions` | `staffing/v6/{tenant}/positions` | document | `position-` |
| `workday_jobs` | `staffing/v6/{tenant}/jobProfiles` | document | `job-` |
| `workday_departments` | `common/v1/{tenant}/departments` | organization | `department-` |
| `workday_supervisory_organizations` | `staffing/v6/{tenant}/supervisoryOrganizations` | organization | `supervisory_org-` |
| `workday_recruiting` | `recruiting/v4/{tenant}/jobRequisitions` | task | `requisition-` |
| `workday_candidates` | `recruiting/v4/{tenant}/candidates` | contact | `candidate-` |
| `workday_benefits` | `benefits/v1/{tenant}/plans` | document | `benefit-` |
| `workday_payroll` | `payroll/v1/{tenant}/payrollResults` | document | `payroll-` |
| `workday_learning` | `learning/v1/{tenant}/enrollments` | document | `learning-` |
| `workday_time_off` | `absenceManagement/v1/{tenant}/timeOffs` | event | `time_off-` |

Runtime module detection (HR / Payroll / Benefits / Recruiting / Learning / Time Tracking / Absence / Compensation) is driven by the per-module `graceful` degrade — an object whose module isn't provisioned (404) or whose REST version differs (400) degrades that module as unprovisioned; an ISU security-group gap (403) degrades it as unauthorized — never the family. Every sourceId is object-type-prefixed so a WID that surfaces in more than one endpoint (the organization trio especially) yields distinct, collision-free unified ids.

---

## 5. Security Review

- **Tokens never cross IPC.** No adapter code touches IPC; token handling stays inside the main-process OAuth engine (`getValidAccessToken`), untouched. The bearer token is injected by the orchestrator's `HttpClient` — the adapter never handles it.
- **Reuses the existing OAuth engine** — no new authentication system. Confidential API Client, HTTP Basic client auth at the token endpoint, `offline_access`-style refresh (optionally non-expiring), `expires_in` → the existing proactive-refresh path.
- **No secret in any DTO/entity/cursor/log.** The cursor holds only `{offset}` — a single integer. Mappers emit business fields only.
- **safeStorage-only vault** — reused as-is; Workday adds no new storage.
- **Least-privilege, read-only.** The adapter issues only REST **GET**s. Least privilege is a read-only Integration System User with **GET** domain security policies on only the domains synced; the request-time scope set is empty (access is ISU-governed).
- **RBAC lock-out risk:** none — no RBAC rule or owner-gated grant added.
- **Adversarial review** (independent sub-agent, "silent data-loss" mandate) run before shipping — findings triaged and fixed below.

**Adversarial review outcome (the full-list state machine was cleared on every axis; 1 HIGH fix + 1 hardening applied):**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | **HIGH** (confirmed mechanism) | sourceId used the raw WID with **no prefix** (copying Salesforce/Dynamics). But Workday endpoints **overlap**: the same org WID is returned by `organizations`, `departments`, AND `supervisoryOrganizations` — all kind `organization`. The unified id has no resource segment, so the same WID+kind collapses to one id and the three endpoints overwrite each other every run (masking two, inflating `conflicts` forever). Both SAP and Oracle prefix precisely to prevent this. | **Fixed.** Reinstated the per-object sourceId prefix (`worker-`, `organization-`, `department-`, `supervisory_org-`, …). New regression test proves the same WID across the org trio yields three distinct ids. |
| 2 | LOW (hardening) | `resp.data.data` would `TypeError` on an empty-body 200 (the HttpClient sets `data:null`) — escaping `graceful` and failing the whole account sync. Shared latent issue with SAP/Oracle, but cheap to fix here. | **Fixed.** Optional-chained to `resp.data?.data ?? []` / `resp.data?.total` → a clean drain instead of a crash. |
| 3 | LOW (documented) | The `total`-absent fallback (`rows.length === PAGE`) has no short-page safety net — if Workday ever returned a short non-final page WITHOUT `total`, the tail would be skipped. | **Documented** (§9). Requires Workday to violate its own `{total,data}` contract (`total` is always present). |

The reviewer **cleared** (traced, no bug): convergence across runs for large lists (offset strictly increases, always drains a finite list, then re-walks), the keyless-row filter not desyncing offset accounting, every offset/total edge case (total 0 / empty / shrunk-below-offset / exact-multiple / >limit page / empty final page), the `rows.length>0` guard, **the stable-timestamp choice** (updates flow through the store's `sameTimeButChanged` signature tie-break — a content change flips the signature → write; an unchanged row is byte-identical → deduped; `now` is not in the signature), the cursor having no run-clock (a full-list walk has no high-water to leapfrog; the orchestrator's per-account mutex prevents concurrent runs), and the full 400-visible / 403-unauthorized / 404-unprovisioned / 401-429-5xx-propagate wiring (including that a 403 arriving as `AuthError` is still caught by `graceful`).

---

## 6. Performance Review

- **Bounded per run:** the orchestrator caps at 50 pages × 100 rows = 5,000 rows/run; the offset continues across runs, so a large workforce is walked over several runs, then resets and re-walks. Bounded, no unbounded single-run walk.
- **Native page max (100)** is used as the `limit`; `offset` advances by the actual row count (never a fixed stride), so a short server-capped page never skips the gap.
- **No `$select`** — one round-trip per page returns whole objects; robust to field-name variance, at a modest payload cost.
- **429 + Retry-After** throttling (Workday's ~10 req/s tenant limit) is handled by the framework's existing rate-gated `HttpClient` and retry engine.
- **Steady state:** the store's content-signature tie-break means an unchanged full-list pass writes nothing (all rows dedup), so a re-walk of unchanged HCM data is O(reads), zero writes.

---

## 7. Regression Review

- **All 6 gates green** (see §9). Desktop suite **2257 tests / 255 files**, up from 2240 at Increment 13 — **+17** Workday tests, **zero** regressions in the other 2240.
- The only shared files touched (`manifests.ts`, `adapters/index.ts`) were **append-only** — new consts + one manifest entry + one import/registration line. Existing manifests and adapters are byte-for-byte unchanged.
- **No duplicate runtime / OAuth / vault / health / inspector / timeline / memory / graph.** Confirmed by the repo-intelligence agent: one adapter registry, one OAuth engine, one vault, one sync orchestrator — all reused. `MANIFEST_BY_ID` and `describeAdapter` pick up `workday` automatically with no branch.

---

## 8. Tests Added (17, pure-node fake HttpClient)

Composition & catalog — one connector, 12 resources in order, catalog↔resource id parity, kinds (2) · mappers — object-prefixed WID sourceIds, **the org-trio no-collision regression**, descriptor titles, nested-ref descriptors, all 12 kinds, Time Off → event with start/end timestamps, stable-baseline stamping (5) · host+tenant URL construction across three services (1) · full-list offset walk — offset 0/limit 100, advance by row count, continue-across-runs + reset-on-drain at `total`, `total`-absent full-page fallback, empty-page guard, keyless-row skip (5) · graceful — 400 visible-degrade + cursor preserved, 404/403 kinds, 5xx propagates (3) · manifest — host+tenant OAuth URLs, Basic auth, empty scopes, null revoke, port 42831, no TTL, single-account, confidential (1).

---

## 9. Build Status & Known Limitations

**Gates (real exit codes):**

| Gate | Command | Result |
|---|---|---|
| 1 | `npm run typecheck --workspaces --if-present` | ✅ exit 0 |
| 2 | `npm run lint` | ✅ exit 0 |
| 3 | `npm run test -w @neuropause/desktop` | ✅ exit 0 — 2257 passed |
| 4 | `npm run test -w @neuropause/sdk` | ✅ exit 0 |
| 5 | `npm run test -w @neuropause/cli` | ✅ exit 0 |
| 6 | `npm run build -w @neuropause/desktop` | ✅ exit 0 — built in 5.32s |

**Environment variables (register before connecting Workday):**
- `NEUROPAUSE_WORKDAY_HOST` — the tenant host (e.g. `wd2-impl-services1.workday.com`)
- `NEUROPAUSE_WORKDAY_TENANT` — the tenant short-name (e.g. `acme`)
- `NEUROPAUSE_WORKDAY_CLIENT_ID` / `NEUROPAUSE_WORKDAY_CLIENT_SECRET` — the API Client (set "Non-Expiring Refresh Token" for unattended sync)
- Register `http://127.0.0.1:42831/callback` as the API Client's redirect URI, and provision a read-only Integration System User with **GET** on the domains you sync.

**Known limitations (all tenant-validation, none blocking):**
1. **No universal incremental delta.** REST/WQL expose no "updated-since" filter, so every object is a full-snapshot walk + the store's content-dedup. A per-object modified-time delta needs the SOAP `Get_Workers` transaction log (`Updated_From`/`Effective_From`) or a RaaS updated-since prompt — a clean future increment.
2. **Deletes not observed.** A source deletion stops appearing but leaves a stale live row until disconnect (same as SAP/Oracle full-list; SOAP transaction log would capture it).
3. **Best-effort REST paths.** Workday's REST directory is version-scoped and auth-gated; the module `service/version/resource` paths (Recruiting/Benefits/Payroll/Learning/Absence especially) are best-effort and should be verified against the target tenant's API version — an unavailable path degrades that module *visibly* (404/400), never the family. The core HCM paths (workers, supervisoryOrganizations) are the most solid.
4. **`total`-absent fallback** assumes full pages (see §5 Finding 3) — safe under Workday's `{total,data}` contract.
5. **Stable timestamps.** With no uniform modified time, `createdAt`/`updatedAt` are a fixed baseline; content changes are still detected via the store's content-signature tie-break, but timeline ordering by `updatedAt` is not meaningful for Workday rows.

---

## 10. Next Increment

**AWS / Azure Enterprise Connector Family** — **NOT STARTED**, per the explicit stop condition. Workday is fully production complete with all validation gates green. Awaiting the go-ahead to begin the next single connector family.
