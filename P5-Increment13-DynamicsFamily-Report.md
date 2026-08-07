# P5 — Increment 13: Microsoft Dynamics 365 Enterprise Connector Family

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Status:** ✅ Production complete — all 6 validation gates green
**Scope:** Microsoft Dynamics 365 becomes **ONE** connector family (`dynamics365`). No standalone connectors, no new subsystems.
**Stop condition honored:** Work stops here. **Workday has not been started.**

---

## 1. Repository Recon (FIRST — never guess, never duplicate)

Recon ran before any code, via two parallel repository-intelligence sub-agents (Microsoft OData v4 seams + no-duplication regression; Dynamics/Dataverse platform research cross-verified against Microsoft Learn) and a direct read of the closest sibling, `entra.ts` — Dynamics shares the *exact* Microsoft Entra identity platform.

**Existing seams confirmed and re-used (NOT rebuilt):**

| Seam | File | How Dynamics extends it |
|---|---|---|
| Microsoft Entra OAuth (identity platform v2.0, PKCE, offline_access) | `connectors/manifests.ts` (`ENTRA_AUTHORITY`) | Dynamics manifest builds the SAME `login.microsoftonline.com/{tenant}/oauth2/v2.0` authority — only the resource scope differs |
| Adapter SDK / registry | `adapterSdk.ts`, `adapters/index.ts` | `dynamicsAdapter` implements it; one `registerAdapter` line |
| Graceful per-service degradation | `adapters/delta.ts` (`graceful`) | every table wrapped; 403→unauthorized, 404→unprovisioned |
| Cursor codec / HttpClient | `adapters/util.ts`, `sync/http.ts` | opaque JSON cursor; `getJson` follows an absolute `@odata.nextLink` verbatim, injects the bearer token, maps 401/403→AuthError |
| OData v4 nextLink pattern | `entra.ts` / `m365.ts` (`@odata.nextLink` paging) | Dynamics pages Dataverse the same way (nextLink cursor) |
| Orchestrator paging loop | `sync/orchestrator.ts` (`MAX_PAGES_PER_RESOURCE = 50`) | adapter self-caps at 25 pages < 50 and commits the high-water |
| Generic capability fallback | `sync/index.ts` (`describeAdapter().resources`) | role-governed → **no** `serviceCapabilities` branch (like Salesforce/ServiceNow/SAP/Oracle) |

**Recon verdict:** a Dynamics family is a **pure extension** — one adapter file + one manifest entry + one `registerAdapter` line + one test. `ConnectorId = string` (no union to edit). No engine, OAuth, vault, health, inspector, timeline, memory, graph, or capability-subsystem change.

---

## 2. Architecture Decision

**Microsoft Dynamics 365 = ONE connector family.** One card, one OAuth token, one vault record, one health engine, one inspector — with **twelve** Dataverse tables each mounted as a `graceful()`-wrapped `AdapterResource` on the *same* authenticated session, read through the Dataverse Web API (OData v4). This mirrors, exactly, how `microsoft-entra` hosts M365 and `salesforce`/`servicenow`/`sap`/`oracle` host their objects.

**Dynamics-specific wrinkles, each resolved by extending an existing seam:**

1. **Same identity provider as Entra.** Dynamics authenticates through Microsoft Entra ID — the exact `oauth2/v2.0` endpoints the `microsoft-entra` connector already uses (PKCE public client, `offline_access` → refresh, `expires_in` → the existing proactive-refresh path, no synthesized TTL). The **only** difference is the resource scope: the per-org Dataverse URL. Handled entirely in the manifest.
2. **Per-org data host.** The Web API lives on `https://{org}.crm.dynamics.com`, built from `NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL` — in the manifest (for the OAuth resource scope) and in the adapter (for data calls, read at call time), so auth host and data host never diverge (ServiceNow/SAP/Oracle precedent).
3. **Security-role governed access** (the single `user_impersonation` scope unlocks the whole Web API) → generic-fallback capability, no scope catalog (like Salesforce/ServiceNow/SAP/Oracle).
4. **OData v4 shape** → `{value, @odata.nextLink}` envelope; pagination is a server-driven opaque `$skiptoken` cookie followed via `@odata.nextLink` **verbatim** (`$skip`/offset is **not** supported); page size via `Prefer: odata.maxpagesize`; status/option-set/money fields carry `…@OData.Community.Display.V1.FormattedValue` labels (requested via `Prefer`). Globally-unique GUIDs → raw GUID sourceId (no prefix, Salesforce precedent); every record deep-links to its model-driven-app form.

**Incremental strategy** (leapfrog-free ASC-resume, proven at `salesforce.ts`/`servicenow.ts`/`oracle.ts`, adapted to Dataverse's nextLink cursor):
- `$filter=modifiedon ge <high-water> $orderby=modifiedon asc`, paging **within** a run by following `@odata.nextLink`, resuming **across** runs via the durable `modifiedon` epoch-ms high-water. A `MAX_PAGES` (25) cap commits the newest `modifiedon` and the next run resumes from it. `ge` (inclusive, minus a 2-min overlap) re-scans the boundary — the store dedups.
- `modifiedon` is UTC `Edm.DateTimeOffset`; the `$filter` literal is **unquoted** ISO-8601 `…Z` (Dataverse rejects a quoted datetime — the key difference from Oracle's quoted `+00:00`).
- A saturated-instant `next` carry (the SAP/Oracle `sat` fix, here via the nextLink cursor) drains the extreme case of >MAX_PAGES×PAGE rows sharing one `modifiedon` instant — **with a self-healing 400 fallback** (see §5).

---

## 3. Files Changed

**New (2):**

| File | Lines | Purpose |
|---|---|---|
| `apps/desktop/src/main/unified/sync/adapters/dynamics.ts` | ~470 | The Dynamics 365 family adapter — 12 specs, 12 mappers, uniform Dataverse OData v4 pull (modifiedon high-water + nextLink paging + sat self-heal), FormattedValue reader, deep-link builder, `DYNAMICS_SERVICES` catalog |
| `apps/desktop/src/main/unified/sync/adapters/dynamicsFamily.test.ts` | ~300 | 23 pure-node fake-HTTP tests |

**Modified (2):**

| File | Change |
|---|---|
| `apps/desktop/src/main/connectors/manifests.ts` | Added Dynamics env consts (`DYNAMICS_ORG_URL`, `DYNAMICS_AUTHORITY`, `DYNAMICS_OAUTH_SCOPES`) + the `dynamics365` manifest entry (Entra v2.0 OAuth mirroring `microsoft-entra`, PKCE, no secret, per-org `user_impersonation` scope, loopbackPort **42829**, `multiAccount: false`) |
| `apps/desktop/src/main/unified/sync/adapters/index.ts` | `import { dynamicsAdapter }` + `registerAdapter(dynamicsAdapter)` |

**No other files touched.** No engine, OAuth, vault, health, inspector, timeline, memory, graph, or capability-subsystem changes.

---

## 4. Dynamics 365 Connector Family — the 12 tables

| Resource id | Dataverse entity set | UDM kind | Primary key (sourceId = raw GUID) | Name field | Solution |
|---|---|---|---|---|---|
| `dynamics365_accounts` | `accounts` | organization | accountid | name | core |
| `dynamics365_contacts` | `contacts` | contact | contactid | fullname | core |
| `dynamics365_leads` | `leads` | contact | leadid | fullname | Sales |
| `dynamics365_opportunities` | `opportunities` | task | opportunityid | name | Sales |
| `dynamics365_cases` | `incidents` | task | incidentid | title | Customer Service |
| `dynamics365_products` | `products` | document | productid | name | Sales |
| `dynamics365_salesorders` | `salesorders` | task | salesorderid | name | Sales |
| `dynamics365_purchaseorders` | `msdyn_purchaseorders` | task | msdyn_purchaseorderid | msdyn_name | Field Service |
| `dynamics365_invoices` | `invoices` | document | invoiceid | name | Sales |
| `dynamics365_projects` | `msdyn_projects` | project | msdyn_projectid | msdyn_subject | Project Operations |
| `dynamics365_assets` | `msdyn_customerassets` | document | msdyn_customerassetid | msdyn_name | Field Service |
| `dynamics365_users` | `systemusers` | contact | systemuserid | fullname | core |

Runtime app detection (Sales / Customer Service / Field Service / Project Operations / Business Central / Customer Insights) is driven by the per-module `graceful` degrade — a table whose first-party solution isn't installed returns a clean **404 (`0x8006088a`)** → that module degrades as unprovisioned, never the family. GUIDs are globally unique across tables, so the raw GUID is the collision-free `sourceId` (the `kind` segment in the unified id disambiguates same-kind tables), and every record carries a `main.aspx?pagetype=entityrecord&etn=…&id=…` deep link.

---

## 5. Security Review

- **Tokens never cross IPC.** No adapter code touches IPC; token handling stays inside the main-process OAuth engine (`getValidAccessToken`), untouched. The bearer token is injected by the orchestrator's `HttpClient` — the adapter never handles it.
- **Reuses the existing Microsoft Entra OAuth** — no new authentication system. PKCE public client (no client secret, like `microsoft-entra`; a desktop-loopback secret would trip AADSTS700025). `offline_access` yields the refresh token; `expires_in` arms the existing proactive-refresh path — no synthesized TTL.
- **No secret in any DTO/entity/cursor/log.** The cursor holds only `{hw, next, runAt, pending, page, sat}` — a watermark epoch, an opaque server nextLink, and a run clock. Mappers emit business fields only.
- **safeStorage-only vault** — reused as-is; Dynamics adds no new storage.
- **Least-privilege, read-only.** The adapter issues only OData **GET**s. The manifest requests the single Dataverse `user_impersonation` scope; least privilege is enforced by a read-only Dataverse **security role** on the integration user. No write scope, no write path.
- **RBAC lock-out risk:** none — this increment adds no RBAC rule and no owner-gated grant.
- **Adversarial review** (independent sub-agent, "silent data-loss" mandate) run before shipping — findings triaged and fixed below.

**Adversarial review outcome (the core ASC-resume state machine was cleared on every axis; 2 fixes + 1 invariant comment applied):**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | **MEDIUM** (confirmed) | The `sat` cross-run skiptoken carry had no self-heal: if a carried `@odata.nextLink` went stale and returned 400, the `sat` cursor (which has no `runAt`) would re-follow the poisoned token **forever** — a permanent per-table stall with a misleading "schema" reason. Oracle's offset-based sat recovers automatically; the nextLink carry did not. | **Fixed.** A 400 while following a carried `sat` token now **drops the token** and commits `{hw}`, so the next run rebuilds `modifiedon ge hw` fresh (a new skiptoken) — self-healing. Distinct, accurate degrade reason ("paging continuation expired"). New regression test. |
| 2 | MEDIUM (documented) | A `modifiedon` watermark does not observe **hard deletes** (a deleted row stops appearing; the store keeps it `active`). | **Documented** (§9). Consistent with `oracle.ts`/`servicenow.ts`. Delete detection would use Dataverse change-tracking (`Prefer: odata.track-changes` → `@odata.deltaLink`, which the existing `isExpiredCursorError(410)` machinery already fits) — a future increment. |
| 3 | LOW-MED (confirmed) | The 400→visible-degrade could mask a systematic curated-`$select` schema error as "unprovisioned." | **Verified safe + hardened.** The reviewer checked every curated `$select` list against Dataverse schema and found **no wrong field** (`products` has `price`; `systemusers` correctly omits `statecode`; the `msdyn_*` state-model entities carry `statecode`/`statuscode`; `msdyn_project` uses `msdyn_subject`). The 400 reason is already distinct/observable, and Finding-1's split makes the schema case even clearer. |
| 4 | LOW (confirmed) | `sourceId: guid ?? ''` — two keyless rows could coalesce and collide. Practically unreachable (Dataverse always returns the PK). | **Fixed.** Keyless rows are now skipped before mapping (never coalesced to `''`). New regression test. |
| 5 | LOW (family-wide) | A future-stamped `modifiedon` (clock skew) could advance the high-water past real changes. | **Documented** (§9). Identical exposure in `oracle.ts`/`servicenow.ts`/`salesforce.ts` — a known platform-wide limitation, kept consistent rather than diverging. |

The reviewer **cleared** (traced, no bug): between-run leapfrog/skip (none — `ge`+ASC+dedup is a value-based superset of positional resume), `hw` monotonicity and `pending` init, the nextLink run-scoped guard (stale prior-run nextLink dropped, live within-run nextLink never dropped), the `sat` engage/clear logic, the MAX_PAGES cap commit, the `hasMoreData` guard, the unquoted `dynLiteral` format, `withQuery` encoding of the `$filter` space/colons, and the no-prefix GUID sourceId (globally unique → same-kind tables can't collide). A latent invariant (adapter `MAX_PAGES` 25 < orchestrator cap 50) was pinned with a comment.

---

## 6. Performance Review

- **Bounded per run:** self-caps at 25 pages × 200 rows = 5,000 rows/run (under the orchestrator's 50-page ceiling), then commits the high-water and resumes forward — never a re-scan from zero.
- **nextLink cursor paging** is positional (a `$skiptoken` cookie), so it is inherently stable — no offset instability, and a saturated instant is drained by the cursor itself (with the `sat` cross-run carry for the extreme > 5,000-in-one-instant edge).
- **`Prefer: odata.maxpagesize=200`** keeps pages modest; **429 + Retry-After** throttling is handled by the framework's existing rate-gated `HttpClient` (Dataverse's 6,000-req/5-min service-protection limit).
- **Curated `$select`** (standard, stable logical names only) keeps payloads small without field-name-variance risk, and requests FormattedValue annotations only for the readable-label fields.
- **Steady state:** an unchanged sync issues one `modifiedon ge hw` returning zero rows and commits the high-water unchanged — O(1).

---

## 7. Regression Review

- **All 6 gates green** (see §9). Desktop suite **2240 tests / 254 files**, up from 2217 at Increment 12 — **+23** Dynamics tests, **zero** regressions in the other 2217.
- The only shared files touched (`manifests.ts`, `adapters/index.ts`) were **append-only** — new consts + one manifest entry + one import/registration line. Existing manifests and adapters are byte-for-byte unchanged.
- Manifest lookup (`MANIFEST_BY_ID`) and `describeAdapter` capability projection pick up `dynamics365` automatically with no branch.
- **No duplicate runtime / OAuth / vault / health / inspector / timeline / memory / graph.** Confirmed by the repo-intelligence agent: one `connectorService`, one `oauthEngine`, one `connectorVault`, one adapter registry, one sync orchestrator — all reused.

---

## 8. Tests Added (23, pure-node fake HttpClient)

Composition & catalog — one connector, 12 resources in order, OData version headers, catalog↔resource id parity, the non-obvious entity sets (incidents / msdyn_purchaseorders / msdyn_projects) (3) · mappers — kinds, globally-unique GUID sourceIds (no prefix), deep-link `etn` per table, FormattedValue status labels, `msdyn_subject` project name, `isdisabled`→user status, stable-baseline stamping (5) · delta high-water — first-sync no-`$filter`, unquoted `ge <ISO-Z>` at hw-minus-overlap, within-run **nextLink followed verbatim** (no query appended) + drain, run-scoped nextLink guard (stale prior-run nextLink dropped), missing-modifiedon safety, zero-rows steady state, MAX_PAGES cap commit, saturated-instant `sat` carry, **sat-token 400 self-heal**, pathological nextLink-empty guard, keyless-row skip (11) · graceful — 400 visible-degrade with distinct reason + cursor preserved, 404/403 kinds, 5xx propagates (3) · manifest — Entra v2.0 URLs, PKCE, no secret, `user_impersonation` + `offline_access`, port 42829, no TTL, single-account (1).

---

## 9. Build Status & Known Limitations

**Gates (real exit codes):**

| Gate | Command | Result |
|---|---|---|
| 1 | `npm run typecheck --workspaces --if-present` | ✅ exit 0 |
| 2 | `npm run lint` | ✅ exit 0 |
| 3 | `npm run test -w @neuropause/desktop` | ✅ exit 0 — 2240 passed |
| 4 | `npm run test -w @neuropause/sdk` | ✅ exit 0 |
| 5 | `npm run test -w @neuropause/cli` | ✅ exit 0 |
| 6 | `npm run build -w @neuropause/desktop` | ✅ exit 0 — built in 5.39s |

**Environment variables (register before connecting Dynamics):**
- `NEUROPAUSE_MICROSOFT_DYNAMICS_ORG_URL` — the Dataverse org URL (e.g. `https://myorg.crm.dynamics.com`); forms BOTH the OAuth resource scope and the Web API data host
- `NEUROPAUSE_MICROSOFT_DYNAMICS_TENANT_ID` — the Entra tenant (default `common`)
- `NEUROPAUSE_MICROSOFT_DYNAMICS_CLIENT_ID` — the Entra app registration (public client)
- Register `http://127.0.0.1:42829/callback` under the app's **"Mobile and desktop applications"** platform.

**Known limitations (all pod/org-validation, none blocking):**
1. **Hard deletes are not captured** by the `modifiedon` watermark (a deleted row stops appearing; the store keeps it active). Delete detection would use Dataverse change-tracking (`Prefer: odata.track-changes` → `@odata.deltaLink`) — a clean future increment, reusing the existing 410-expiry machinery.
2. **Solution-gated tables** (Leads/Opportunities/Products/Sales Orders/Invoices need Sales; Cases need Customer Service; Purchase Orders/Assets need Field Service; Projects need Project Operations) degrade visibly as *unprovisioned* on an org that hasn't installed them — the graceful layer protects the rest of the family.
3. **Curated `$select`** uses standard logical names; a heavily-customized org that removed a standard column would 400 that table, degrading it *visibly* (a distinct, observable reason) rather than silently.
4. **Clock-skew:** a future-stamped `modifiedon` advances the high-water (family-wide limitation, consistent with Oracle/ServiceNow/Salesforce).
5. **`$batch`** is not used — read-only per-table nextLink paging is sufficient and simpler; `$batch` is a write/transaction optimization.

---

## 10. Next Increment

**Workday Enterprise Connector Family** — **NOT STARTED**, per the explicit stop condition. Microsoft Dynamics 365 is fully production complete with all validation gates green. Awaiting the go-ahead to begin Workday as the next single connector family.
