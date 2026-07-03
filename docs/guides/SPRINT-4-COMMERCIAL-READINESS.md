# Sprint 4 — Commercial Readiness

This document covers Sprint 4: making NeuroPause sellable and operable as a commercial
SaaS. It delivers **billing on Razorpay** with a gateway-neutral schema, a **real
record-level cloud sync** system (backend and desktop), a **production deployment**
story (Docker image, Compose stack, backups), an honest **Admin Center recon** (the
spec was already implemented — documented, not rebuilt), and a **production-readiness
audit** across ten capabilities with the genuine gaps (feature flags, license
validation, renderer error forwarding) built to completion.

Every increment was applied and verified green on the development machine before the
next began. Per the Part 6 directive, work **stops after this sprint** pending
approval for Release Candidate / Early Access; the early-access onboarding wizard
(originally Part 5) was **not built** and is named plainly in the gaps below.

---

## 1. What was delivered

| Part | Outcome |
|---|---|
| 1 — Billing | Razorpay service layer, HMAC-verified webhook, org-scoped billing routes; gateway-neutral `provider_*` schema (migration 0008) |
| 2 — Cloud Sync | Shared LWW sync model, backend `sync_state` + push/pull API (migration 0009), full desktop engine (queue, mirror, scheduler, transport), IPC |
| 3 — Deployment | Multi-stage Docker image with self-contained migrations, `/live` + `/health` probes, `docker-compose.prod.yml`, backup/restore scripts, `docs/DEPLOYMENT.md` |
| 4 — Admin Center | Recon found the nine-section spec already implemented; mapped and documented instead of duplicated |
| 6 — Production readiness | Ten-capability audit: 7 already full, Error Reporting extended, Feature Flags and License Validation built end-to-end |

Verification snapshot at sprint close: **desktop 499 tests / 62 files**, **backend 168
tests / 17 files**, typecheck (node + web + backend) and lint (`--max-warnings 0`) all
clean.

---

## 2. Part 1 — Billing on Razorpay

Billing moved to Razorpay mid-part; the schema was made gateway-neutral at the same
time so a future provider change is a service-layer swap, not a migration ordeal.

- **Schema** — migration `0008_billing_provider.sql` renames `stripe_customer_id` /
  `stripe_subscription_id` to `provider_customer_id` / `provider_subscription_id`.
  Subscription types and repositories use the provider-neutral names.
- **Service** (`apps/backend/src/billing/`) — `plans.ts` maps plans to Razorpay plan
  ids from env; `service.ts` holds the pure `subscriptionPatchFromRazorpay`
  (status mapping: active/authenticated → active, created → trialing, pending/halted
  → past_due, cancelled/completed/expired → canceled; canceled falls to the free
  plan; seats clamp to ≥ 1).
- **Webhook** — `verifyRazorpaySignature` (HMAC-SHA256, timing-safe compare) over the
  **raw body**; the handler is mounted with `express.raw` *before* `express.json` at
  `POST /billing/webhook`, acks handled Razorpay errors with 200, and resolves the
  org from `entity.notes.orgId`.
- **Routes** (behind `requireAuth` + active membership) — `GET
  /billing/:orgId/subscription` (any member), `POST /billing/:orgId/checkout` and
  `POST /billing/:orgId/cancel` (owner/admin; enterprise is not self-serve).
- **Configuration** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_{STARTER,PROFESSIONAL,ENTERPRISE}` in
  `.env`; billing stays disabled until the key id and secret are set.

Tests: service 10, webhook 10 (real signatures), router 10 (stub gateway over real
HTTP). Honest limits: `razorpayGateway.ts` is a thin SDK wrapper that cannot be
unit-tested without live keys; plan changes are cancel + checkout (no dedicated
change-plan route); the razorpay package brings transitive npm-audit findings to
review before production.

---

## 3. Part 2 — Cloud Sync

A real record-level sync system, deliberately scoped to org-level configuration:
`organization`, `membership`, `workspace_settings`, `connected_account`,
`connector_config`, `org_prefs`. AI Memory, Timeline, and the Knowledge Graph remain
**local-first and excluded** — enforced by a database CHECK on entity type.

- **Shared model** (`packages/shared/src/types/sync.ts`) — versioned `SyncRecord`s
  with tombstones; `resolveSync` implements last-write-wins (version, then
  `updatedAt`, with exact ties resolved deterministically). LWW is a stated
  tradeoff: it does not field-merge concurrent edits.
- **Backend** — migration `0009_sync_state.sql` creates `sync_state` keyed
  `(org_id, entity_type, entity_id)` with a global sequence for cursors.
  `POST /sync/:orgId/push` (≤ 500 changes) and `GET /sync/:orgId/pull` sit behind
  auth + active membership; the service forces the route org onto every record
  (cross-tenant safety) and pull excludes the caller's `deviceId` to avoid echo.
- **Desktop** (`apps/desktop/src/main/cloud/livesync/`) — backoff/error
  classification, a timer-free `SyncEngine` (push → pull, never throws), the HTTP
  transport (injected base URL / token / fetch), a persistent queue + cursor store,
  a `LocalSyncMirror` as the applied-records landing zone, a `SyncScheduler` with
  injected timers, and the assembled `liveSyncService`. The singleton persists under
  `userData` with a stable generated device id and stays **inert until the renderer
  sets an active org**.
- **IPC** — `livesync:status`, `livesync:now`, `livesync:setOnline`,
  `livesync:setActiveOrg`, bound in the renderer under `ipc.cloud.liveSync*`.

This engine is distinct from the older `cloud/sync/` module, which is a local-only
simulation now superseded (its retirement is tracked follow-up). Tests: backend 27
(core 10, service 10, router 7, plus a real-Postgres smoke during development);
desktop 52 across the seven livesync modules.

---

## 4. Part 3 — Production deployment

Full operational detail lives in **`docs/DEPLOYMENT.md`**; the pieces are:

- **Image** — multi-stage `apps/backend/Dockerfile` (node:20-bookworm-slim,
  non-root). `tsup` builds two self-contained entries, so migrations run as
  `node dist/db/migrate.js` with no tsx or source in the runtime image; the SQL
  files are staged next to the compiled migrator.
- **Probes** — `/live` (liveness: always 200, no dependency checks, used by the
  container HEALTHCHECK) vs the existing `/health` (readiness: checks Postgres and
  Redis).
- **Stack** — `docker-compose.prod.yml` (separate from the dev-infra
  `docker-compose.yml`): backend + postgres:16-alpine + redis:7-alpine, health-gated
  `depends_on`, named volumes, `DATABASE_URL`/`REDIS_URL` injected at the service
  containers, everything else from `.env` (template augmented with the Razorpay
  block and `BACKEND_PORT`).
- **Backups** — `scripts/backup-db.sh` (in-container pg_dump, timestamped gzip,
  retention) and `scripts/restore-db.sh` (confirmation-gated restore).

Both the image build and the full Compose stack were validated on the development
machine (`docker build` and `docker compose -f docker-compose.prod.yml up -d --build`
→ all services healthy).

---

## 5. Part 4 — Admin Center: already implemented

Recon before building found every section of the Admin Center spec already shipped;
building it again would have duplicated working code, so the mapping is the
deliverable:

| Spec section | Implemented in |
|---|---|
| Org overview | `OrganizationView`, `cloud/AdminPanel`, `cloud/TenancyPanel` |
| Members | `OrganizationView` (OrgMembers), `AdminPanel` users (+ MFA status) |
| Subscription | Sprint 4 billing + `AdminPanel` billing/spend |
| Usage | `AdminPanel` 30-day usage, `AnalyticsView` |
| Connected apps | `ConnectorsView` |
| Audit | `federation/GovernancePanel` + memory/workforce/federation/gateway audit viewers |
| Security | `cloud/IdentityPanel` (SSO/MFA/SCIM), `AdminPanel` compliance |
| API keys | `cloud/ApiPlatformPanel`, `developer/GatewayPanel` |
| Support bundle | `main/support/supportBundle.ts` (tested), `operations/DiagnosticsPanel` |

---

## 6. Part 6 — Production readiness

Ten capabilities audited; existing implementations were left untouched.

| Capability | Status | Location |
|---|---|---|
| Error Reporting | Partial → **extended** | `ErrorBoundary` now forwards to the crash store via `crash:report` |
| Crash Reporting | Full | `main/services/crashReporter.ts` (opt-in, export, recommendations) |
| Health Dashboard | Full | `main/platform/diagnostics.ts`, `operations/DiagnosticsPanel` |
| Telemetry (opt-in) | Full | `main/services/telemetry.ts` — off by default, no-ops when disabled |
| Feature Flags | **Built** | shared core + `main/featureFlags/` + `flags:*` IPC |
| Version Reporting | Full | `main/buildInfo.ts`, releaseOps data-version |
| Release Channels | Full | `main/services/updater/updateChannels.ts` (tested) |
| License Validation | **Built** | shared core + `/license/:orgId` + `main/license/` + `license:*` IPC |
| Deployment Diagnostics | Full | `main/diagnostics/releaseDiagnostics.ts` + releaseOps |
| Operational Monitoring | Full | `OperationsView`, platformDiagnostics, releaseOps |

Crash and telemetry data are local, export-based stores by design — there is no
remote ingestion service.

**Error Reporting extension.** `ErrorBoundary.componentDidCatch` now fire-and-forget
forwards caught renderer errors over `crash:report` into the crash store (guarded so
reporting can never cascade a failure), making them visible in diagnostics and the
support bundle alongside main-process crashes.

**Feature Flags.** A catalog of five real flags (`cloud_sync`,
`automation_builder`, `ai_memory_search`, `advanced_analytics`,
`multi_workspace`), some gated by minimum plan tier. Pure `evaluateFlag` resolves
with precedence **override → plan gate → default** and reports the winning source.
The main-process `flagService` persists per-install overrides atomically; IPC is
`flags:get` / `flags:setOverride` / `flags:clearOverride` (mutations audited),
renderer-bound as `ipc.flags.*`. Tests: 6 core + 5 service.

**License Validation.** For a SaaS org the license **is** its subscription
entitlement — no parallel storage was invented. The shared `evaluateLicense` turns a
subscription snapshot plus a clock into `valid | grace | invalid` with a reason and
the **entitled plan tier** (falling to free when invalid): active subscriptions get a
7-day grace window (`GRACE_DAYS`) after the period end, past_due keeps its plan
through the same window, trials expire with no grace, and cancellation keeps the paid
plan only until the already-paid period ends. The backend issues status at
`GET /license/:orgId` (auth + membership; a subscription-less org is a valid free
license). The desktop `licenseValidator` persists the last-known-good license and
**re-evaluates the stored snapshot at read time**, so expiry and grace decay happen
even offline; failed refreshes fall back to the cache with the error instead of
throwing. IPC is `license:status` / `license:refresh` (`ipc.license.*`). Tests: 12
core + 6 router + 7 validator + 4 transport.

---

## 7. Reproducing the verification

From the repo root:

```
npm run lint
npm run typecheck -w @neuropause/desktop
npm test -w @neuropause/desktop
cd apps/backend && npm run typecheck && npm test
```

Expected at sprint close: desktop 499 passing tests, backend 168 passing tests, no
type errors, no lint warnings.

---

## 8. Honest gaps before Early Access

Named plainly, in rough order of importance:

1. **Onboarding wizard (original Part 5) was not built.** The early-access flow
   (welcome → create org → invite → connect sources → first brief) is entirely
   future work.
2. **Sync renderer integration.** The engine is complete and wired, but nothing
   drives it from the UI yet: the active-org hook (`liveSyncSetActiveOrg` from the
   cloud org provider), an online/offline driver for `setOnline`, a status
   indicator, and — the blocked part — **enqueue-on-edit**, which first requires
   edit surfaces for the synced entities (`org_prefs` has no UI; orgs/members are
   cloud-only). The old `cloud/sync` simulation also awaits retirement.
3. **Flags are not yet gating features.** No call site reads a flag, and the
   renderer currently supplies the plan tier per call; it should be sourced from
   the active org's subscription — or better, from the license validator's
   `entitledPlan`, which also closes the enforcement loop.
4. **License enforcement and cadence.** Nothing calls `ipc.license` yet (no UI, no
   automatic refresh on org switch or timer), `entitledPlan` is not enforced
   anywhere, the 401/403-on-refresh eviction policy is an open decision, and the
   validator trusts the local clock (tamper resistance would need signed server
   timestamps).
5. **Billing live-mode.** Real Razorpay keys, dashboard webhook configuration, and
   a live checkout round-trip are untested; review the razorpay transitive
   npm-audit findings.
6. **Per-entity sync authorization** is deliberately deferred until the desktop
   write-permission model exists (the route-level membership gate is in place).

Per the sprint directive, no Release Candidate or Early Access work begins until
these are reviewed and the next phase is approved.
