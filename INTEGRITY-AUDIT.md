# NeuroPause Product Integrity & Production Readiness — Repository Audit v1.0

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Program:** Product Integrity & Production Readiness v1.0 · Production Enterprise Release
**Phase:** Complete repository audit (no code changed — this is the pre-remediation audit the program mandates first)
**Date:** 2026-07-17
**Method:** Structural recon + five parallel read-only audit passes (renderer authenticity, main-process authenticity, feature/route inventory, tech-debt/duplication, security/backend-integrity), every finding traced to `file:line` evidence.

---

## Executive summary

NeuroPause is a genuinely substantial, largely authentic platform — far more real than most products at this stage. ~207,000 lines across five workspaces, 604 declared IPC channels behind a fail-closed RBAC bridge, 46 main-process subsystems, ~36 renderer sections, and — verified — real OAuth connectors, a real AI-workforce runtime with evidence-derived confidence, real encrypted credential storage, and read-only projection layers that faithfully re-serve whatever their stores contain. The newer layers (P14–P20, Experience, Intent) are exemplary: several literally refuse to render a value that has no real source.

The gaps that stand between it and a Fortune-500 handoff are **real, bounded, and concentrated**, not diffuse. They fall into four buckets: (1) **fabricated infrastructure/financial metrics** seeded into ~10 foundational `cloud/` and `federation/` stores that then cross real IPC channels and get honestly re-served as if live; (2) a class of **privileged IPC channels shipping ungated** because no authz annotator covers their namespace; (3) **duplicate and ungated navigation surfaces** (four "home" screens, several `X`-vs-`XCenter` pairs, two nav entries that are just tabs) all shown at once; and (4) **removable technical debt** (~1.4 MB of committed artifacts, orphaned modules, duplicated helpers). Fixing the ~10 seed stores cleans every downstream dashboard at once, because the projection layers on top of them are already honest.

**Current Launch Readiness Score: 72 / 100.** The engineering core is enterprise-grade; the blockers are fabricated seed metrics and ungated privileged IPC. Both are mechanical to fix. Target after remediation: **90+**.

---

## 1. Repository Recon

NeuroPause is an npm-workspaces monorepo (`packages/*`, `apps/*`, root `neuropause-desktop@1.0.0-rc.1`) with five workspaces: `packages/shared` (144 source `.ts` — the type + IPC-contract spine), `packages/sdk` (9), `packages/cli` (5), `apps/desktop` (the Electron product — 692 main `.ts` across 46 subsystems, 352 main test files, 246 renderer `.tsx`, 58 renderer `.ts`), and `apps/backend` (93 `.ts` — a Fastify auth/semantic service). Total source excluding tests is ~207k LOC; the desktop app is the overwhelming majority.

The desktop app is a standard three-tier Electron architecture: a main process (Node) that owns all runtimes, stores, and subsystems; a preload bridge; and a React 18 + Vite renderer. P1–P20 plus the Experience Program v1.0 (Decision Center) and Intent Experience Program v2.0 (Intent Home) are all present and wired.

---

## 2. Architecture Audit

Every renderer→main call flows through one of **two** `ipcMain.handle` front doors: the modern `ipc/secureBridge.ts` (the RBAC-gated path — declares `permission` + `requireAuth`, runs Zod on every payload, fails closed when a permission has no authorizer, enforces sender-trust) and a legacy `ipc/router.ts`. The composition root `runtimeCore.ts` instantiates every subsystem and pushes its handler defs, most wrapped in a `withXAuthz` annotator that maps each channel to a permission and **throws at startup if any channel in its namespace is unclassified** — a strong, test-locked "no unguarded channel" invariant. Fifteen namespaces have such an annotator (enterprise, workforce, cloud, ecosystem, federation, industry, strategy, twin, knowledge, orchestration, network, autoOps, commercial, experience, intent); `connectors` self-gates equivalently.

The dominant design pattern — used correctly across P11–P20, Experience, and Intent — is the **read-only projection layer**: a pure view-model built over an injected snapshot of real stores, memoized behind a short TTL, exposed through parameterless RBAC-gated channels, mutating nothing. This is why the newer platform is so authentic: the projection layers do not invent data; they reproject whatever their sources hold. The corollary, central to this audit, is that **any fabrication lives in the underlying stores, not the projections** — so the fix surface is small and upstream.

Dependency map (data flow): `renderer ipc.<subsystem>.<call>()` → preload → `secureBridge`/`router` (authz + Zod) → subsystem `service.accessor()` → `store`/`runtime` (the real state of record) → back out as a typed view-model. Shared types/contracts in `packages/shared` bind both ends. The renderer shell (`sections.ts` registry + `AppShell.tsx` route switch + `Sidebar.tsx`) maps sections to feature-dir views.

---

## 3. Feature & Route Inventory

Route integrity is sound: **every** `SECTIONS[]` id has a matching route case and vice-versa — no classic dead navigation and no unreachable view. The real issues are duplication and the absence of readiness gating (`Sidebar.tsx` renders all ~35 primary sections regardless of their `phase`, so a newer read-only overlay looks identical to a production surface).

Classification of the ~36 sections:

| Class | Sections |
|---|---|
| **Production (real data, canonical)** | organization, enterprise, operations, opscenter, workforce, workforce-center, connectors, memory, sandbox, store, marketplace, ecosystem, cloud, federation, developer, settings, + the 7 read-only P13–P18 centers (industry/strategy/twin/knowledge/orchestration/network/auto-ops) + commercial-center |
| **Incomplete / empty in prod** | home (empty dashboard until Phase 5, yet is the default landing), notifications (empty payload), infrastructure → Discovery tab stubbed ("Not configured (P6.1)") |
| **Duplicate / superseded** | decision-center (dup of intent-home), developer-center (read-only subset of developer), federation-center (partial dup of federation), control-plane (rollup dup of cloud); nav-only dups automations & analytics (just `WorkforceView` tabs) |
| **Redundant doorway** | welcome (duplicates the always-mounted OnboardingWizard) |
| **Complete but static** | workspace (functional local tab launcher over static `data/catalog.ts`) |
| **Orphaned files (0 importers, not routed)** | `views/AnalyticsView.tsx`, `views/AutomationsView.tsx`, `views/AutomationBuilder.tsx` (955 lines), `views/ModulePreview.tsx`, `screens/HomeScreen.tsx`, `operations/SoonPanel.tsx` |

Complementary pairs that should **both** stay (not duplicates): operations (local runtime operator console) vs opscenter (read-only enterprise-intelligence analyst view); workforce (operate) vs workforce-center (administer). These share some tab labels and should be relabeled, not merged.

---

## 4. Authenticity Report (the headline)

**Renderer: essentially clean.** Across ~110 triaged marker hits, exactly one genuine deception reaches a user — a fabricated green **"Connected"** account status for four AI apps (ChatGPT/Claude/Cursor/Notion-AI), sourced from a hardcoded `DEMO_CONNECTED` set (`store/lib.ts:114`) and `connected:true` flags (`data/catalog.ts:18,28,56,102`), surfaced at four sites (`store/StoreAppCard.tsx:69`, `store/AppDetail.tsx:250`, `views/workspace/AppLauncher.tsx:78`, `views/workspace/AppTabContent.tsx:38`). Everything else was a false positive: `Math.random` is absent from the renderer, the sample dashboard is dev-only behind an env flag, and every `catch` sets an empty/error state rather than fake data.

**Main process: fabrication is concentrated in ~10 foundational seed-stores**, mostly `cloud/` and `federation/`, which hard-seed operational/financial/adoption numbers that then cross real IPC channels and are faithfully re-served (sometimes relabeled "live") by honest downstream projections. The confirmed violations, most-deceptive first:

| # | Source (`file:line`) | Fabrication | Exposed via / laundered into |
|---|---|---|---|
| 1 | `cloud/tenancy/tenancyStore.ts:63` | 3 fake "demo tenants" (Helios/Aperture/Northwind) w/ hardcoded storage & members; `Math.random` createdAt | CloudTenants, ControlPlane directory/fleet/usage, commercial |
| 2 | `cloud/admin/admin.ts:119` | cross-tenant MRR (hardcoded tier prices) + synthesized user counts | CloudAdminOverview (root cause = #1) |
| 3 | `cloud/apiplatform/apiPlatformStore.ts:86` | fabricated SLA uptime (99.98/99.95) + p95 latency; never superseded by telemetry | CloudDeployments, FedObservability, **Digital Twin "99.88% uptime, live:true"** |
| 4 | `federation/exchange/exchangeStore.ts:54` | fabricated install counts (1,313 total) + star ratings, no disclosure | FedArtifacts, FedExchangeSummary, analytics |
| 5 | `federation/observability/observabilityStore.ts:48` | fabricated 14-day usage curve + named security events ("Okta", "Aperture Capital") | FedUsageSeries, FedSecurityEvents |
| 6 | `federation/dr/drStore.ts:82` | `Math.random` backup size/objects/duration, RPO/RTO, replication lag | FedBackups/Validations/CreateBackup |
| 7 | `cloud/apiplatform/apiPlatformStore.ts:106` | fabricated webhook deliveries (1284/3) + API rps (240/90/30) | CloudWebhooks, CloudPublicApis |
| 8 | `cloud/sync/syncStore.ts:77` | random seed versions feeding a usage KPI | ControlPlaneUsage, CloudAdminOverview |
| 9 | `cloud/identity/federationStore.ts:63` | seeded "Okta (SAML)" SSO shown `status:'active'` | CloudSsoConnections, commercial ssoActive |
| 10 | `federation/runtime/fedStore.ts:47` | fabricated peer-org topology (peers:3) | FedOrgs, FedSummary, graph/directory |
| 11 | `federation/governance/globalGovStore.ts:79` | fabricated audit entry + pending approval | FedAuditTrail, FedApprovals |
| 12 | `federation/index.ts:69` | hardcoded "measured" engine benchmarks | FedScalability |
| 13 | `ecosystem/exchange/packsStore.ts:112` & `partnersStore.ts:32` | `Math.random` pack installs; hardcoded partner listing counts | EcosystemPacksList, PartnersStats |
| 14 | `autonomousOps/index.ts:356` | falsely-healthy execution gauge (80/60 green) when real successRate is null | AutoOpsMonitoring/Analytics |

The downstream projection layers (`commercial/`, `controlPlane/`, `twin/`, `developerPlatform/`) are themselves **honest** — they re-serve whatever the seed stores emit — so remediating the ~10 stores cleans every dependent dashboard simultaneously. The cleanest subsystems (the correct pattern to copy) are enterprise, workforce, ai, memory, intelligence, recommendations, founder, intent, connectors, and the real telemetry readers.

---

## 5. Security Audit

**Storage, connectors, and workforce are SOLID and verified real.** Credentials use Electron `safeStorage` and per-account encrypted vaults (`0o600`); backend passwords are Argon2id; refresh tokens are SHA-256-hashed with reuse detection; no hardcoded secrets exist. Connectors implement real OAuth2/PKCE with network token exchange, skew-based refresh, live store-derived status, real error taxonomy/backoff/timeouts, and HMAC-timing-safe webhook verification. The AI workforce runs real skills with real status transitions, crash-orphan recovery, evidence-derived (not random) confidence, and an append-only governance audit.

**Two real gaps:**

*IPC/RBAC — a class of privileged base/core channels ships ungated* (no `requireAuth`/`permission`), riding on sender-trust alone because no annotator covers their namespace. Highest severity: **`execute:run`** (`runtimeCore.ts:1356`) — an ungated multiplexer that re-enters the otherwise-gated workforce and automation execution paths in-process, silently defeating `workforce:operate`. Also ungated: `plugins:*` lifecycle (installs code-bearing plugins + grants permissions), `automations:save/run`, `perms:grant/revoke`, destructive `releaseOps` (`migration:run`, `backup:restore`, `backup:delete`, `recovery:run`, `support:generateBundle`), `runtime:launch/stop/...`, and a set of org-state mutations and sensitive reads (`memory:*`, `decisions:setStatus`, `flags:setOverride`, `billing:checkout`, `devices:register/revoke`, `search:enterprise`, `executiveCenter:snapshot`). Input validation itself is comprehensive (every def has a Zod schema, `.strict()`, no `z.any()`).

*Secrets — one real leak:* the backend mailer logs password-reset/verify URLs (which embed single-use tokens) with no redaction and no env guard (`apps/backend/src/auth/mailer.ts:20`). Mitigated by 1-hour TTL, single-use, and rate limiting, but log-read access = account takeover.

The recommended fix is a `withRuntimeAuthz` annotator plus a **global test asserting every `RUNTIME_INVOKABLE_CHANNEL` is either classified or on an explicit public-reads allowlist** — extending the invariant the enterprise families already enjoy to the whole surface.

---

## 6. Technical Debt

High-confidence removable: **~1.4 MB of committed artifacts at the repo root** — 13 delivery `.zip` bundles (each a duplicate snapshot of in-tree source), 8 phase report `.md` files, 5 `MANIFEST*` files, 2 prototype `.html` files, and `audit.json` — none of which are source. Plus **7 orphaned modules** with zero importers (`views/AnalyticsView`, `views/AutomationsView`, `views/ModulePreview`, `operations/SoonPanel`, `screens/HomeScreen`, `main/unified/queryEngine.ts`, `backend/.../semanticHealthRouter.ts`) and two dead exports (`voiceRuntimeState.getLastVoiceActivityMs`, Card `@deprecated` props).

Consolidation opportunities (maintainability, not deletion): `relativeTime` reimplemented 4×, `formatBytes` 3×, `formatDuration` 3× — all foldable into the canonical `lib/format.ts`; `developer/primitives.tsx` duplicates `components/ui` Modal/Field/Input/Select; five parallel `primitives.tsx` kits partially overlap. The `renderer/src/design/` NPDS token subtree (7 files) has zero non-test consumers — verify before removing (it may be intended scaffolding). Minor: `.gitignore` has its ignore block triplicated.

---

## 7. Workflow Validation

Verified functional end-to-end: authentication (Argon2id + JWT + refresh rotation), organization/RBAC seeding and reconciliation, connector OAuth connect/refresh/sync/disconnect, AI-worker create/execute/approve/govern/retry/recover, marketplace/install lifecycle (real backend fetch, installs grow from 0), and the Decision/Intent read projections. Workflows that do **not** complete in production today (genuine gaps, not fakes): anything depending on Connectors "Phase 4" account-linking (the fake "Connected" status), the empty Home/Notifications dashboards (Phase 5), and infrastructure Discovery (P6.1).

---

## 8. Remaining Genuine Gaps

These are honest "not built yet" areas, correctly left unbuilt rather than faked (and mostly labeled as such in code): live app-account connections (Phase 4), the populated Home and Notifications dashboards (Phase 5), infrastructure cloud-discovery/CMDB (P6.1), and a handful of connector manifests without adapters (canva/figma/linear/zapier — labeled). The correct production posture is to **hide** these until real, not to simulate them.

---

## 9. Launch Readiness Score — 72 / 100

Real, enterprise-grade engineering core (+): fail-closed RBAC bridge, real connectors, real workforce, real encrypted storage, honest projection layers, comprehensive input validation, 3,198 passing tests. Deductions (−): fabricated infrastructure/financial metrics in ~10 seed stores that reach live dashboards (−12), ungated privileged IPC channels led by `execute:run` (−8), duplicate/ungated navigation surfaces and orphaned pages (−5), the reset-token log leak (−2), committed-artifact/tech-debt bloat (−1). None is architectural; all are mechanical. Closing buckets 1–3 lifts this to the low 90s.

---

## 10. Recommended Remediation Plan (pending your sign-off)

Ordered by trust impact. **No code has been changed yet** — several actions are destructive (removing/hiding features, deleting data seeds), so they need your decision before I proceed.

**Priority 1 — Authenticity (make every number real).** Neutralize the ~10 fabricating seed stores + the renderer "Connected" fake + the autonomousOps fallback, so every dashboard shows only real data or an honest empty state. *Fork to decide:* remove the demo seeds outright vs. gate them behind an off-by-default `dev-only` flag (both end the deception; the flag preserves them for local demos).

**Priority 2 — Security (gate the privileged surface).** Add `withRuntimeAuthz` + the global "every invokable channel classified" test; gate `execute:run`, `plugins:*`, `perms:*`, `automations:*`, destructive `releaseOps`, `runtime:*`, and the sensitive reads; fix the reset-token log leak.

**Priority 3 — Navigation integrity (one canonical surface per job).** Hide/merge the duplicate sections (decision-center, developer-center, federation-center, control-plane, automations, analytics, welcome) and remove the 6 orphaned view files. *Fork to decide:* which "home" is canonical (intent-home is newest/most coherent), and hide-vs-remove for the duplicates.

**Priority 4 — Tech debt & consistency.** Remove the ~1.4 MB root artifacts and dead modules; consolidate the duplicated helpers into `lib/format.ts`; de-triplicate `.gitignore`.

**Priority 5 — Validation.** Typecheck, lint, full test suite (with new tests locking the authenticity + authz invariants), production build, and a final adversarial review — the program's six gates — after each batch.

Every change will EXTEND the existing platform: no new runtime, engine, AI system, or database; nothing faked; anything not production-ready gets hidden, not simulated.
