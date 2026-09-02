# Changelog

All notable changes to NeuroPause are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).


## [Unreleased]

_No unreleased changes; the current build is `1.0.0-rc.22`._

## [1.0.0-rc.22] — first packaged artifact carrying S49+S50 procurement governance (2026-09-03)

Version bumped from `1.0.0-rc.21` because the rc.21 artifact predates ERP sessions 49–50: the
governed procurement UI closure (eight buy-side commands wired, PR/GR/vendor-payment edit
fences) and the procurement surface hardening (PO received/reversal/`convertedReceipt` fences,
census-backed reference pickers, the structured Lines editor replacing raw JSON). rc.22 is the
first shippable artifact to contain them; its packaged acceptance record is
`certification/SESSION51-PRODUCTION-PACKAGED-ACCEPTANCE.md` (signed, notarization pending
operator credentials).

## [1.0.0-rc.21] — release discipline, enforced by the suite (2026-08-31)

Version bumped from `1.0.0-rc.20` because **392 commits** shipped after the
rc.20 stamp. A build calling itself rc.20 today would not be the rc.20 whose
Windows installer hash (`e861228f…8bc90`) is on record — the same `da36851`
failure class this project has now caught three times, each catch later and
larger than the last (rc.17→rc.18, rc.19→rc.20, and this one at 392 commits).

### Added
- **The failure class is now caught by the suite, not by eye.**
  `releaseDiscipline.test.ts` treats a version as **spent** once a tag exists
  for it: if `v<version>` is bound to a commit and HEAD is not that commit, the
  tree is a version orphan and the test fails with the exact remedy. It also
  refuses a CHANGELOG that claims "no unreleased changes" while commits sit past
  the tag. `verify:release` structurally could not catch either — it compares an
  update feed to the binaries beside it, so a stale-version build is perfectly
  self-consistent and passes.
- **`verify:release` gained the version-parity check** it was missing: the
  update feed's version must equal the version the manifests declare.
- **`verify-acceptance-artifact.cjs`** — binds an acceptance artifact to the
  feature set the acceptance procedure assumes it has, so a machine session is
  never spent discovering a limitation of the build (Gate 20).

### Fixed
- **A tenant switch now refreshes what is on screen** (Gate 26). The shell
  remounted on a local *view* change but not on an *organization workspace*
  change, so after switching tenants every already-mounted surface kept
  rendering the previous tenant's data — the Business record counts, the Data
  import history, module screens — until the user happened to navigate. The
  view is now keyed on a tenant epoch driven by the existing
  `enterprise:event` broadcast, so the numbers become true while the sidebar,
  the active section and shell state all survive the switch. This was a display
  correctness defect, never a data-access one: the record store re-resolves
  scope on every call and fails closed, and the switch itself is
  membership-gated.

### Documentation
- Windows acceptance re-based on local-first mode: sign-in is a detour, not a
  precondition, so B3/B5/B6/B9 are drivable with no backend at all. The rc.20
  residuals were misattributed to a missing cloud backend when the real cause
  was that rc.20 predates local-first mode by three days.

## [1.0.0-rc.20] — the release gate: every tenant gets a protected owner (2026-08-15)

Program 13C rounds 35–40. Version bumped from `1.0.0-rc.19` because five
rounds of fixes shipped since the rc.19 stamp — a build calling itself rc.19
today would not be the rc.19 whose Windows installer hash is on record.

### Security
- **Provisioned organizations finally have a protected owner** (round 40, the
  last release blocker). The root-of-trust guards were keyed on the seeded
  literal `user-owner`, so in any runtime-created organization a Manager could
  re-role, suspend, re-email, or delete the creator, and an Admin could delete
  the Owner role (provisioning created every role `builtIn:false`).
  Provisioning now records `Organization.ownerUserId` in the same act that
  creates the owner and marks its spec-derived roles built-in; the user
  patch/delete guards key on the target org's recorded owner; legacy stores
  heal on load when the owner is unambiguous and say so when it is not.

### Fixed
- Boot-window races closed at their common root (rounds 36–39): the AI engine
  rebuilds its router when tenant resolution recovers (a local-only user with
  a running Ollama no longer boots into "No AI model"); the Assistant's
  conversation list retries once on the runtime-ready broadcast.
- The sidebar workspace switcher now fronts the real organization workspaces
  through the membership-gated switch; the local tab-set list is labeled
  "Views on this device"; the advertised ⌘1–9 shortcuts work.
- Onboarding resumes at its persisted step; Sign-In is a detour, not a
  forfeit; failed completion/skip writes are surfaced (round 36).
- Shutdown flush barrier + atomic, restart-enforcing restore (round 37).
- Administration, family dashboards, feature flags, subscriptions, trusted
  devices, and assistant list reads surface failures instead of rendering
  them as emptiness (rounds 36–38).

### Added
- End-to-end product journey suite (`productJourney.test.ts`, 8 phases) and
  the driven-UI acceptance evidence for Gates 18/26.
- `system:runtimeState` + ready broadcast; boot-window router fails closed.

## [1.0.0-rc.19] — AI providers: the privacy choice becomes real (2026-08-14)

Program 13C round 34. Version bumped from `1.0.0-rc.18` because an rc.18
binary was already built from `ee3da3d` — one version, one binary.

- **The onboarding "On this device" choice now changes routing.** The tenant
  AI preference was written and displayed for seventeen rounds while no
  request path ever read it — a fresh install with an environment API key
  routed to the cloud after the user chose local. The `min(platform, tenant)`
  law now clamps the route plan inside the single candidate-assembly site the
  router and the Settings surface share; the engine reconfigures when the
  preference changes and on every workspace switch. The routing display and
  the router also now compute the platform mode from the same resolution, so
  the first-run restriction warning fires when it is true.
- **OpenAI joins Anthropic and Ollama on the same provider contract.** One
  `ModelClient` implementation (`Bearer` auth, per-provider error naming for
  401/429), its own Secure Vault entry, per-provider key entry/test/removal in
  Settings, a routed external candidate that leads when selected and falls
  back under the same consent rules as Anthropic. No provider-specific
  architecture anywhere else.
- **Local AI setup distinguishes "install it" from "start it".** Detection now
  probes the Ollama binary and the service independently and reports models;
  Settings and first-run show the state with its own action — official
  download page link (explicit user action, no silent installs), `ollama
  serve` hint, or a model download list with sizes shown before any pull. A
  model pull runs only on explicit approval, through Ollama's own API.
- **Settings shows the organization preference** (read/set with tenant RBAC)
  beside the platform mode, with the effective mode named; the AI settings
  panel's actions no longer swallow refusals silently.

## [1.0.0-rc.18] — Tenant-resolution diagnostics and owner-row hardening (2026-08-14)

Program 13C rounds 31–32. Version bumped from `1.0.0-rc.17` because the rc.17
tag points at `e09df1e` and these changes landed after it — the same rule that
produced rc.17 itself: no two different binaries may claim one version.

- **W-10 — the tenant resolver now reports its own refusals.** Every refusal
  out of `resolveFull()` carries a redacted diagnostic (local email parts
  reduced to a length, domains kept) built from the values the resolution
  actually used. The transition is logged as `Tenant resolution LOST` with
  `msSinceLastSuccess`; steady-state refusals are throttled to one line per
  reason per minute with a suppressed-count; recovery closes the bracket with
  the outage duration. This is the instrumentation for the Windows
  `not_a_member` fault.
- **O-11 — a member edit that omitted a field erased it.** `updateUser` spread
  the handler's object-literal patch over the row, so an omitted `email`
  arrived as `undefined` and was written — persistently, since JSON drops
  `undefined` — removing the person from their own organization. The store now
  drops `undefined` keys (an explicit `null` still clears), and the resolver's
  membership predicate fails closed on non-string emails instead of throwing.
- **O-12 — the owner-claim path has its own narrow authority.** The claim rule
  moved inside `orgStore.claimOwnerIdentity`; cross-tenant safety is structural
  (the seeded org and owner id are compile-time constants) rather than
  caller-scope-dependent, so first-claim and same-account repair now run even
  while tenant resolution is refusing. A corrupt owner row is never claimable.
- **O-13 — the owner row's email is immutable through member edits.**
  `guardOwnerUserPatch` strips `email` alongside `roleIds`/`status`: membership
  is decided by that address, so an in-tenant rewrite was an ownership transfer
  wearing a profile edit. Handoff, when it exists, will be a dedicated flow.

## [1.0.0-rc.17] — Windows runtime and release-pipeline repair (2026-08-14)

Program 13C rounds 24–26. No feature work; every entry is a defect found with a
negative control taken from git rather than reconstructed.

- **O-8 — a restart re-fired automation rules.** The scheduler's
  once-per-occurrence guard lived only in memory, and an `interval` schedule
  reports due on every tick by construction, so relaunching inside the bucket
  re-executed an occurrence that had already fired — once per restart, and a
  crash loop is a restart loop. The claim is now persisted on the rule and
  written before the fire, so at-most-once means the same thing on both sides of
  a restart.
- **O-9 — the parked-reference retry ran as the wrong tenant.** One shared
  debounce timer, cleared and re-armed on every save on the install, executed
  the retry pass under whoever was signed in 400 ms later — and one tenant's
  save cancelled another's pending pass, so under sustained activity the queue
  was never drained by that path at all. Same shape Round 10 fixed in the graph,
  memory and scheduler call sites; this fourth one was missed.
- **W-1 — an audit write replaced the error it was recording.** A permission
  refusal raises a durable hold; a hold needs an owner; with no tenant scope
  that write threw and its exception escaped in place of the authorization
  error. Users saw "Cannot record a hold…" instead of the sentence naming the
  actual condition. Recording a refusal can no longer change the refusal.
- **W-2 — Windows received a frameless window.** `titleBarStyle: 'hiddenInset'`
  was applied unconditionally under a comment claiming it was ignored off macOS.
  Windows degrades it to `hidden`, producing a window with no close, minimise or
  maximise controls.
- **W-3 — both release workflows were unparseable.** A guard referenced the
  `secrets` context inside a step `if:`, which GitHub rejects at load time, so
  neither `windows-release` nor `macos-release` could be dispatched.
- **W-4 — CI now parses every workflow** and rejects unavailable contexts in
  `if:`, because nothing in the repository had ever validated a workflow file.
- **W-5 — eight tenant refusals reached callers as one sentence.** The resolver
  distinguishes `not_signed_in`, `not_loaded`, `no_workspace`,
  `workspace_orphaned`, `not_a_member`, `not_in_workspace`, `member_inactive`
  and `tenant_not_operable`, each with its own text; the authorization gate
  discarded all of them. Each now reaches the caller with its own message and a
  stable code.
- **O-10 — eight gate verdicts were recorded under the wrong identity**, because
  the repository's own `.git/config` named a different author. Corrected, and
  the divergence left visible in the certification record rather than erased.

Version bumped from `1.0.0-rc.16` because two different Windows binaries were
built under that version with different hashes, which makes release provenance
unresolvable.

## [1.0.0-rc.15] — Global Product RC: Pilot Readiness (2026-08-08)

The Global Product RC program (pilot-readiness track), layered on the Phase 7/8 hardening recorded below. RC, not GA.

- **Phase 1 — Pilot-credibility hardening:** the automation executor never reports success for a no-op; honest error and "Live" states in Business/Operations; in-view Preview banners; a state-model audit. (`claude/PHASE-1-PILOT-HARDENING.md`)
- **Phase 2 — Information architecture + Apple-grade UX:** ~40 surfaces regrouped and relabelled into one coherent product with progressive disclosure; route IDs preserved. Naming collisions resolved — e.g. `opscenter`→**Operations**, `operations`→**Runtime**, `workforce-center`→**Workforce Admin**, `commercial-center`→**Commercial Center**, `product-ops`→**Release Ops**, `knowledge-center`→**Enterprise Knowledge**.
- **Phase 3 — Desktop end-to-end certification:** auth, tenancy, authorization, AI Store, health, and failure/recovery certified against a real PostgreSQL 16 + Redis 7 + Express backend; established the local-first desktop / thin-cloud-plane architecture as documented truth.
- **Phase 4 — Documentation & product enablement:** a 33-document governed set across user/admin/developer/enterprise/product/support/downloads, with zero-dependency `docs:validate` + `docs:build` tooling and honest maturity labelling throughout.
- **Phase 5 — Enterprise pilot readiness:** legacy/operator documentation terminology reconciled to Phase-2 names (validator extended to cover it); pilot support runbook, acceptance criteria, test pack, feedback form, telemetry policy, and performance baseline; a product maturity matrix and release-blocker register; release-configuration, security, and version audits. Code signing, notarization, and update-feed hosting remain operator-credential-gated (documented, not faked).

### Phase 8 — Release Candidate Hardening (2026-08-07)

- **Data safety (Wave 1):** backup/restore now covers EVERY store — a store-path
  registry with prefix patterns protects all certified enterprise-module stores
  (present and future), executive decisions, governance, automations, assistant
  conversations and feedback; the pre-migration snapshot inherits the same
  coverage. New store envelope ends the parse-or-reset era: corrupt or
  future-versioned stores are QUARANTINED beside themselves (bytes preserved),
  never silently reset; stores stamp `schemaVersion` on write; migration 0002
  stamps existing stores (data version 2). Rotating application log
  (`logs/app.log`) — packaged builds finally produce runtime logs, picked up by
  every support bundle; crashes.log and audit.log are rotation-bounded; support
  bundles reveal in the file manager on generation.
- **Release discipline (Wave 2):** the `internal` update channel is no longer
  selectable (its feed was never published — a stored preference heals to
  `beta`), with a channel↔published-feed test lock; `scripts/bump-version.cjs`
  bumps both package.json files atomically; release verification runs in every
  local package script (not just CI); mac universal packaging script added;
  THIRD-PARTY-NOTICES generation wired into packaging; the current build's
  changelog section is baked into build-info and surfaced in Release
  Diagnostics.
- Removed the spurious root `recharts` dependency (v3) that collided with the
  desktop's v2 under the Phase 7 dashboards.

### Phase 7 — Product Experience (2026-08-07)

- Grouped sidebar (six labeled groups over 40 sections), status tokens regained
  hue, Business family registry corrected to 13 families, 104-module rail with
  type-to-filter, one shared EmptyState, Getting Started restored, dead design/
  module removed. Live real-data dashboards for all 13 business families on a
  validated chart kit (recharts). Details: `PHASE7-COMPLETION-REPORT.md`.

## [1.0.0-rc.14] — Enterprise Completion: the Final Wave (2026-08-07)

- **FW-1…FW-12:** modules 95 → **104 certified** across **13 families**. HR
  spine: attendance/LOP → payroll proration → statutory ECR; leave + holiday
  calendars; expense claims with GL accrual; shifts with expected-working-days;
  recruitment pipeline whose Hire creates the employee; OKRs with derived
  progress. Procurement: budget-gated AND vendor-contract-gated PO approval;
  auto-reordering from the immutable stock ledger. Finance: bank-reconciliation
  write-back (payments stamped as bank-evidenced), declining-balance
  depreciation, treasury positions (cash + open AR − approved AP).
- Certification lock updated 95 → 104; every increment additive with
  byte-identical-when-omitted proofs.

## [1.0.0-rc.2 … 1.0.0-rc.13] — Enterprise platform waves (2026-07-25 → 2026-08-06)

> Backfilled by Phase 8: these twelve tagged RCs shipped the enterprise module
> framework's growth (45 → 95 modules), the platform centers, knowledge/digital
> twin surfaces, and release-engineering hardening — tagged without changelog
> entries at the time. Program-level detail lives in the dated root reports and
> the git history of each tag.

## GA Execution Program (2026-07-24) — engineering milestone within the RC lineage

> Phase 8 correction: this section was originally headed `[1.0.0]`, but no 1.0.0
> was ever tagged or released — the version lineage is `1.0.0-rc.*`. The work
> below is real and landed; only the version label was wrong.

The **GA Execution Program**: engineering execution (not documentation) that closes
the remaining verified GA blockers with real code and passing regression tests. The
full evidence-based readiness decision is in
[`GENERAL-AVAILABILITY-REPORT.md`](GENERAL-AVAILABILITY-REPORT.md).

### Security (both former HIGH blockers closed)

- **TD-1 — Apple `id_token` is now cryptographically verified.** The Apple Sign In
  flow verifies the `id_token` signature against Apple's JWKS
  (`https://appleid.apple.com/auth/keys`) and checks issuer, audience, and expiry,
  with the algorithm pinned to **RS256**, before any identity claim is trusted. The
  previous `jwt.decode` (no signature check) is removed. New `verifyAppleIdToken()`
  on the live `fetchProfile` path. Evidence: `apps/backend/src/auth/providers/apple.test.ts`
  — 8 tests, rejecting forged-signature, wrong-audience, wrong-issuer, expired,
  no-subject, and non-RS256 (algorithm-confusion) tokens.
- **TD-2 — Marketplace package install is now fail-closed.** Unsigned or untrusted
  packages are refused in packaged (production) builds, and a tampered signature is
  **always** refused (even under the dev opt-in). Unsigned installs are permitted
  only in unpackaged dev, where the demo catalog is unsigned. Wired via
  `setAllowUnsignedInstalls(!app.isPackaged)` at platform bootstrap. Evidence:
  `apps/desktop/src/main/nps/signature.test.ts` — 5 tests.

### Release engineering

- **TD-4a — Per-PR desktop CI** (`.github/workflows/desktop-ci.yml`): typecheck,
  lint (`--max-warnings 0`), test, and build for `@neuropause/desktop` on every PR.
- **TD-4b — macOS release automation** (`.github/workflows/macos-release.yml`):
  build + package (`package:mac`) + tag-gated GitHub Release, with env-gated Apple
  code-signing/notarization (unsigned build if the certificate secrets are absent).
  *Residual:* the signed/notarized path cannot be exercised without a Developer ID
  certificate and a macOS runner, so it is verified only as far as the automation.

### Dependencies

- Added **`jose`** (JWKS-based JWT verification) to the backend; `npm audit --omit=dev`
  remains **0 production vulnerabilities** (a transitive `body-parser` advisory was
  fixed with a SemVer-safe bump in the same pass).

### Evidence re-validation

- Re-ran the measured benchmark harnesses against the live stack **with the TD-1/TD-2
  fixes compiled in**: backend cold-start-to-healthy **0.707 s**, HTTP load **24,000
  requests / 0 errors**, sub-millisecond database latency, pool 10/10/0 under load —
  confirming **no performance regression**. Raw results in `bench/results/`.

## [1.0.0-rc.1] — Enterprise Release Candidate

The first release candidate: a complete Enterprise AI platform across the desktop
(Electron + React) and backend (Node + Express + Postgres + Redis + Qdrant),
delivered incrementally and consolidated for production readiness. Anything modeled,
partial, or absent is labelled honestly — see
[`ENTERPRISE-GA-REPORT.md`](ENTERPRISE-GA-REPORT.md).

### Platform

- **Foundation & Experience** — secure Electron shell, backend-brokered OAuth (PKCE/RFC 8252), intent-native home.
- **Enterprise Business Platform, Modules & Certification** — family-grouped modules with a certification matrix.
- **Product Operations, Enterprise Administration, Enterprise Intelligence** — reuse-only control surfaces.
- **Knowledge, Automation, Collaboration, Federation, Commercial, Developer** platforms.
- **Enterprise AI Operating Platform** — the plan → reason → orchestrate → simulate → decide → govern → learn operating layer.
- **Enterprise Runtime, Cloud & Deployment** — backend Prometheus `/metrics`, real Kubernetes manifests + Helm chart, offline/air-gapped bundle, backend + deploy-validation CI.
- **Enterprise Platform Ecosystem (Extensibility)** — the platform-extensibility control plane.

### Enterprise GA hardening (this RC)

- **Security/authenticity:** gated the backend demo store seed behind `SEED_STORE_ON_BOOT` — production now starts with an empty catalog (no fabricated apps, ratings, or download counts).
- **Testing:** collected previously-orphaned renderer model tests into the standard test gate and fixed a stale assertion.
- **Documentation:** added the enterprise operator set — Administrator, Security, Operations, and Disaster Recovery guides, a release checklist, a documentation index, `LICENSE`, and a root `SECURITY.md` — and corrected a stale root `README` status.

### Known limitations (honest — as of rc.1; see 1.0.0 above for closures)

- ~~Apple `id_token` signature is not yet verified against JWKS; marketplace-app install accepts unsigned packages when the trust store is empty.~~ **Both closed in 1.0.0 (TD-1, TD-2) — see above.**
- Update rollback is advisory (data-side recovery is the real path); federation disaster recovery is modeled.
- No alert routing, distributed tracing, or capacity forecasting; ~~no macOS release automation;~~ **(macOS release automation added in 1.0.0 — TD-4b)** no coverage instrumentation; renderer component/E2E and accessibility tests are absent.

The full, evidence-based readiness classification (**Release Candidate**) is in
[`ENTERPRISE-GA-REPORT.md`](ENTERPRISE-GA-REPORT.md).

### Enterprise Validation Program (operational proof)

- Executed the RC evidence: stood up the real backend against real Postgres + Redis and **measured** it — HTTP load (24,000 requests, 0 errors), sub-ms database latency, intelligence-engine timings, Argon2id cost, and cold-start/restart — with reproducible harnesses in [`bench/`](bench/) and raw results in `bench/results/`.
- **Reliability/chaos** run against the live process: migration idempotency, exact backup/restore, restart recovery (0.46 s), Redis-down fail-open, and Postgres-down degrade-and-auto-reconnect — all passing.
- **Deployment validation** with real tools (`kubernetes-validate` strict PASS, `shellcheck` clean) and five reference **vertical validation** packs (Manufacturing, Healthcare, Agriculture, Financial, Government) — reference deployments + protocols with compliance **self-assessment mappings only** (no certifications, no named customers).
- Outcome: **Validated Release Candidate** (~76/100), documented in [`ENTERPRISE-VALIDATION-REPORT.md`](ENTERPRISE-VALIDATION-REPORT.md) with an evidence-tied path to GA. No features, no new platform.

### Scientific & Standards Program (formalization)

- Formalized the implemented platform into an internal **engineering-science reference** ([`docs/science/`](docs/science/README.md), 23 documents) — a documentation-only layer that adds no runtime and duplicates no system.
- Introduced an **evidence ladder** (L0 Proposed · L1 Modeled · L2 Implemented · L3 Measured · L4 Validated) applied to every concept, plus five scientific matrices (Capability, Evidence, Measurement, Validation, Standards).
- Eight framework sciences (Ontology, Observation, Measurement, Validation, Assurance, Prediction, Replication, Standards), a 65-row **reference-implementation matrix** (51 Implemented / 3 Partial / 2 Modeled / 8 Future / 1 not-claimed), a benchmark framework, and ten manuals.
- Honesty-preserving throughout: **no fabricated proofs, benchmarks, peer review, or certifications**; prediction is honestly held mostly **L0** (no statistical forecasting engine); standards are adopted-external/internal-convention with **no certification claimed**. Full report: [`SCIENTIFIC-STANDARDS-REPORT.md`](SCIENTIFIC-STANDARDS-REPORT.md).

### Global Ecosystem & Adoption Program (enablement)

- Built the **adoption surface** over the unchanged platform ([`docs/adoption/`](docs/adoption/README.md), 23 new artifacts) — eleven frameworks (Customer Success, Partner Ecosystem, Developer Ecosystem, Marketplace Growth, Research & Academic, Open-Source Strategy, Training & Education, Deployment Program, Documentation Architecture, Community Governance, Business Expansion) plus five adoption-readiness matrices.
- Added real, actionable contributor artifacts: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SUPPORT.md`, `CODEOWNERS`, and `.github/` issue + pull-request templates — grounded in the real quality gates and Conventional Commits.
- Honesty-preserving and independently reviewed: **no invented customers, certifications, market share, revenue, community metrics, or published papers**; open source is an explicitly **proposed** path (the license is proprietary); pricing is a framework over the real `trial/starter/professional/enterprise` plans with no set prices; maturity stated as Validated RC. No platform code changed. Full report: [`GLOBAL-ADOPTION-REPORT.md`](GLOBAL-ADOPTION-REPORT.md).

### Enterprise Operations & Scale Program (operations)

- Wrote the **internal operating manual** for running NeuroPause at scale ([`docs/operations/`](docs/operations/README.md), 11 frameworks) — enterprise operations, customer support, SRE, security operations, release operations, business operations, developer operations, executive operations, global scaling, compliance operations, and continuous improvement.
- Quantitative spine is **measured**: capacity math derives from the EVP benchmarks (one 2-vCPU replica ≈ 400–600 rps DB reads at 0 errors, ~230 MB RSS, ≤10 DB connections, Argon2 ~50 verifies/s/core, 0.46 s restart); fleet numbers are labelled projections; SLIs come from the real `/metrics`+`/health`+`audit_log` substrate.
- Honesty-preserving and independently reviewed: **there is no production fleet**, so SLOs are proposed targets and no achieved uptime/MTTR/availability exists; **no fabricated customers, revenue, KPIs, or operational metrics**; SOC 2 / ISO 27001 content is **readiness-mapping only** (not certified, no audit occurred); operational maturity is honestly early (Initial→Defined). No platform code changed. Full report: [`ENTERPRISE-OPERATIONS-REPORT.md`](ENTERPRISE-OPERATIONS-REPORT.md).

### Customer Deployment & Evidence Program (pilots)

- Wrote the **reference manual for running real customer pilots and collecting operational evidence** ([`docs/pilots/`](docs/pilots/README.md), 11 frameworks) — pilot methodology (entry/success/rollback/exit), evidence collection, customer feedback, deployment automation, operational learning, case-study templates, executive evidence, product evolution, research validation, deployment quality, and long-term product intelligence.
- The evidence-**generation** toolchain is real and proven (`bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`, the reliability procedures, `scripts/backup-db.sh`/`restore-db.sh`, `/metrics`+`/health`+`audit_log`); every checklist item is a real repo command; the knowledge base is seeded only with real proven patterns and real known failure modes.
- Honesty-preserving and independently reviewed (**zero defects**): **no pilot has run — 0 customers, 0 deployments** — so every customer-specific value ships **blank**; **no fabricated benchmarks, ROI, case studies, satisfaction/adoption numbers, or published research** (zero dollar figures, zero DOIs); the only real numbers are the labelled EVP 2-vCPU reference floor. No platform code changed. Full report: [`CUSTOMER-DEPLOYMENT-REPORT.md`](CUSTOMER-DEPLOYMENT-REPORT.md).

### Product Evolution & Release Governance Program (governance)

- Wrote the **official governance manual for how NeuroPause evolves after GA** ([`docs/governance/`](docs/governance/README.md), 11 frameworks) — product strategy, release governance, evidence-based prioritization, technical-debt governance, roadmap governance, innovation management, product analytics, risk governance, architecture stewardship, executive governance, and future vision.
- Every roadmap/decision item carries one honest label — **Implemented · Validated · Proposed · Future Vision**. The debt register is the real GA **TD-1…TD-10** and the risk register the real **PR-1…PR-8** (verbatim severities); the near-term roadmap is seeded only with the real seven open items, sequenced by dependency; breaking change is defined against the real contracts (604 IPC channels, the SDK resources, the `v1|v2` HTTP API, forward-only migrations); SemVer/Keep-a-Changelog/Conventional-Commits are the adopted policy.
- Honesty-preserving and independently reviewed (**zero defects**): **no GA declared, no release beyond `1.0.0-rc.1`, no customer, no production fleet**; **no fabricated customers, feedback, metrics, budgets, or roadmap progress** (product-analytics KPI values all blank; investment framework has no monetary figures); 2.x is explicitly **Future Vision — uncommitted**; GA is gated on closing the two High debts (TD-1, TD-2) plus release-engineering. No platform code changed. Full report: [`PRODUCT-GOVERNANCE-REPORT.md`](PRODUCT-GOVERNANCE-REPORT.md).

[1.0.0-rc.1]: https://github.com/dishantdobariya91-debug/neuropause-desktop
