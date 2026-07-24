# NeuroPause PERG — Release Governance

> **What this is.** The **governance layer over how NeuroPause versions, releases,
> supports, and retires itself** — the policy deciding _what a change is worth_, _what
> "breaking" means against the real contracts_, _how long a version is supported_, and
> _when it reaches end-of-life_. A PERG document; **no runtime, no architecture** — only
> rules, tables, and decision gates.
>
> **This elevates, it does not restate.** EOSP
> [`RELEASE-OPERATIONS.md`](../operations/RELEASE-OPERATIONS.md) is the _operating
> model_ (calendar, hotfix path, rollback, maintenance windows — **when and how** we
> ship); [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) is the per-release
> gate run **inside** every train. This sits **above both** as the **version,
> deprecation, and support policy** those mechanics execute — where EOSP gives a
> runbook, PERG gives the rule that governs it; the runbook is referenced, never copied.
>
> **Honesty banner (non-negotiable).** NeuroPause has cut exactly **one** version —
> `1.0.0-rc.1`, a **Validated Release Candidate** ([`CHANGELOG.md`](../../CHANGELOG.md)).
> **No GA, no post-GA release, and no version history beyond `1.0.0-rc.1` exists.**
> Every later identifier here (`1.0.0`, `1.0.1`, `1.1.0`, `1.0.0-rc.2`, `2.0.0`, an
> "LTS line") is an **illustrative forward slot to show the mechanics** — none has
> shipped or is claimed. This is the policy to **activate at GA**; today it governs
> the real backlog. **SemVer**, **Keep a Changelog**, and **Conventional Commits** are
> **real and in use** ([`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`CHANGELOG.md`](../../CHANGELOG.md)).

Evidence labels (per [`_grounding.md`](_grounding.md)): **Implemented** (runs today, cited) · **Validated** (verified by gates/tests) · **Proposed** (committed, near-term) · **Future Vision** (uncommitted).

---

## 1. Version policy

NeuroPause versions on **[SemVer](https://semver.org/) `MAJOR.MINOR.PATCH`** with an
optional `-rc.N` pre-release suffix, exactly as `CONTRIBUTING.md` and `CHANGELOG.md`
already use (**Implemented**). What each position **means for this product concretely**:

| Bump              | Trigger (Conventional Commit) | Concrete meaning for NeuroPause                                                                                                                          | Consumer obligation                               |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **MAJOR** `X.0.0` | `feat!` / `BREAKING CHANGE:`  | A **backward-incompatible** change to a public contract — the REST/API surface, the `@neuropause/sdk` public API, or the renderer↔main IPC contract (§2) | Consumer must change code / re-grant / re-package |
| **MINOR** `x.Y.0` | `feat`                        | **Additive, backward-compatible** surface — a new route, scope, SDK resource/method, optional field, IPC channel, or a new API version alongside the old | None — existing integrations keep working         |
| **PATCH** `x.y.Z` | `fix` / `perf`                | A fix, security remediation, dependency bump, or performance change **with no surface change**                                                           | None — safe drop-in                               |

**Pre-release `-rc.N`.** An `-rc.N` suffix marks a **stabilization iteration** of a
not-yet-final version (order `rc.1 < rc.2 < … < <final>`); a `-rc`/`-beta` tag is
**auto-marked _prerelease_** by `windows-release` on a `v*` tag push (**Implemented** —
`.github/workflows/windows-release.yml`). `-rc.N` is the only channel in use; `-beta` is CI-recognised but unused.

### Product line vs. package lines (real, and governed)

The product ships as **one versioned unit** — root `neuropause-desktop` and
`apps/desktop` are both **`1.0.0-rc.1`** — while the publishable packages carry
**independent SemVer lines**: `@neuropause/sdk` `0.1.0`, `@neuropause/cli` `0.3.0`,
`@neuropause/backend` `0.1.0`, `@neuropause/shared` `0.1.0` (**Implemented**, the
respective `package.json`).

- **P-VER-1.** The **product version** (`1.0.x` line) is the **release-train identity**
  — the tag, changelog section, and GA gate key to it.
- **P-VER-2.** The **SDK and CLI** version on **their own** SemVer lines against their
  own public API (§2.2); a product release does not force an SDK bump, nor the reverse.
- **P-VER-3.** SDK/CLI/backend/shared are **`0.x` today** — **SemVer §4 initial
  development**: their public API is not yet stable and may change in a MINOR.
  **Promoting a package to `1.0.0` is a deliberate governance act**, not a side effect
  of the product reaching GA.

### The `1.0.0-rc.1 → 1.0.0` GA path

Dropping the `-rc` suffix is a **governance decision, not a build step**: GA is declared
only when the **GA-gate checklist (§7)** passes with **no open blocker** — the two
**High** security items (**TD-1** Apple JWKS, **TD-2** signed-install) plus
release-engineering **TD-4**, per the **Release Readiness Matrix**
([`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md) §2). Until then the line iterates
`1.0.0-rc.1 → 1.0.0-rc.2 → …` (**Proposed** slots), each a full stabilization pass.

---

## 2. Semantic versioning — what counts as breaking

SemVer is only as meaningful as the public API it protects. NeuroPause has **three**
public contracts; per contract, a change is **breaking (MAJOR)** if a conforming consumer
that worked before would **fail, misbehave, or need to change code**. Tables are code-grounded.

### 2.1 REST / API contract

The public REST surface is versioned (`ApiVersion = 'v1' | 'v2'`), scope-gated (18
`ApiScope`s in `ecosystem.ts`), and **Zod-validated at the edge** (13 backend modules;
`validateBody` parses and replaces the body — `middleware/validate.ts`,
`store/schemas.ts`, `enterpriseApi.ts`). **Implemented.**

| Change to the API contract                                                                                                    | Impact    | Grounded in                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| Remove/rename a route, response field, or `ApiScope`; make a Zod field **required** or narrow its accepted set                | **MAJOR** | `ecosystem.ts` `ApiScope`; `store/schemas.ts` `SearchQuerySchema` et al. |
| Change an endpoint's auth/scope requirement; change the list envelope (`ApiListPage`) or error shape                          | **MAJOR** | `enterpriseApi.ts` `ApiListPage` / `EnterpriseApiResponse`               |
| Add a route, add an **optional** Zod field, add a scope, introduce a **new API version** (`v2` beside `v1`)                   | **MINOR** | `ApiVersion` union; additive Zod `.optional()` fields                    |
| Fix handler behaviour without changing request/response shape or scope; tighten input **validation of already-invalid input** | **PATCH** | `validateBody` contract unchanged                                        |

> **Deprecation is already modeled — govern it, don't reinvent it.** `ApiVersionInfo`
> carries `status: 'current' | 'beta' | 'deprecated' | 'sunset'` with `since`/`sunsetAt`
> (**Implemented** — `ecosystem.ts`). **P-SEM-1:** a breaking API change ships as a
> **new version** (`v2`), never by mutating `v1` in place; `v1` moves `current →
deprecated` (**non-null `sunsetAt`**) and only reaches `sunset` after the announced
> window (§6). Removing a `sunset` version is the MAJOR earning the next `X.0.0`.

### 2.2 SDK contract (`@neuropause/sdk`)

The SDK's public API is the `NeuroPauseClient`, its resource objects (`marketplace`,
`workers`, `connectors`, `usage`, `billing`, `oauth`, `enterprise`), their method
signatures, the **re-exported types**, and the **webhook verification contract**.
**Implemented** — `packages/sdk/src/{client,resources,index,webhooks}.ts`.

| Change to the SDK                                                                                                     | Impact    | Grounded in                                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| Remove/rename a resource or method; change a method signature or return type; remove a re-exported type               | **MAJOR** | `client.ts` resource wiring; `resources.ts` method signatures |
| Change `defaultVersion` (currently `'v1'`) or the webhook signature scheme (`t=…,v1=…`) in a non-compatible way       | **MAJOR** | `client.ts` `defaultVersion`; `webhooks.ts` `signWebhook`     |
| Add a resource, add a method, add an **optional** option to `NeuroPauseClientOptions`, widen a return type additively | **MINOR** | `NeuroPauseClientOptions`                                     |
| Fix a transport/pagination/serialization bug with no signature change                                                 | **PATCH** | `transport.ts`, `pagination.ts`                               |

> **P-SEM-2.** An **API MAJOR (§2.1) propagates** to an SDK MAJOR **only** for the
> resources that consume the changed surface — the SDK is not bumped for API changes it
> does not expose. While the SDK is `0.x` (**P-VER-3**) a breaking change may land in a
> **MINOR** with a `BREAKING CHANGE:` note; from `1.0.0` it forces the SDK MAJOR.

### 2.3 IPC contract (renderer ↔ main)

The renderer↔main boundary is a **first-class contract**: a centralized **`IpcChannel`
map (604 named channels)** with its `IpcChannelName` union and invokable/subscribable/
runtime lists, exposed through a preload bridge that **allowlist-checks every channel**
and permission-classifies via `RUNTIME_CHANNEL_PERMISSIONS` / `PUBLIC_CHANNELS` behind a
**fail-closed startup invariant**. **Implemented** — `ipc/channels.ts`, `preload/index.ts`, `main/ipc/runtimeAuthz.ts`.

| Change to the IPC contract                                                                                                        | Impact    | Grounded in                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| Remove/rename a channel; change a channel's request/response payload shape; drop a channel from an invokable/subscribable list    | **MAJOR** | `channels.ts` `IpcChannel`, `ALL_INVOKABLE_CHANNELS` |
| **Raise** the permission a channel requires, or move a channel from `PUBLIC_CHANNELS` to gated (breaks callers lacking the scope) | **MAJOR** | `runtimeAuthz.ts` `RUNTIME_CHANNEL_PERMISSIONS`      |
| Add a new channel (classified in the authz map or `PUBLIC_CHANNELS`); add an **optional** payload field                           | **MINOR** | `channels.ts`; `runtimeAuthz.ts` classification      |
| Fix a handler's behaviour behind an unchanged channel + payload + permission                                                      | **PATCH** | secure-bridge dispatch unchanged                     |

> **P-SEM-3.** A new channel is **never** shipped unclassified — the startup
> invariant fails closed, so "add a channel" is a MINOR **only** once it appears in
> the authz map or the vetted `PUBLIC_CHANNELS` allowlist. **P-SEM-4.** Because the
> product ships desktop + backend as one train, an IPC MAJOR **is** a product MAJOR.

### 2.4 Migrations as a contract boundary

Migrations are **forward-only** (no down-migrations; DR guide). **P-SEM-5:** a migration
reversible only by the **data-side restore** path (`pg_dump`/`pg_restore`, `BackupManager`
— EOSP §4) is **compatible** and does not force a MAJOR; a change leaving a **prior build
unable to read the new schema** **is** a MAJOR, shipping with migration notes.

---

## 3. Release cadence — **Proposed**

> **Proposed model, not a track record.** No cadence has run — the only cut is
> `1.0.0-rc.1`. The rhythm below elevates EOSP §1's release trains into governance as
> a **target to ratify once a team is staffed**, never a claimed frequency.

NeuroPause ships on **release trains gated by quality, not the calendar** — the
governing rule is **gates outrank dates**.

The **proposed rhythm** maps onto EOSP §1's release-train table (which pairs each tier
with its cut branch, gate depth, and changelog treatment — not restated here):
**major** on demand (announced ahead), **minor** a monthly train, **patch** as-needed
(≤ 2 weeks), **hotfix** out-of-band in hours under the reduced gate (§5). Each runs the
full [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md); this section governs the
**gating**, not the calendar.

- **P-CAD-1 (gate-gated, not date-gated).** A train cuts **only** when the quality-gate
  ledger is green — typecheck **0**, lint **0** (`--max-warnings 0`), **all tests
  pass** (RC baseline **3,856**, re-counted not transcribed), build **0**,
  `format:check` clean, `npm audit --omit=dev` **0 production vulns** — enforced by
  `backend-ci` / `windows-release` (**Validated**). A **red gate slips the train; it
  never ships on a date.**
- **P-CAD-2 (no version invented for a date).** A scheduled slot with nothing merged
  that passes the gate produces **no release** — an empty train is skipped, not
  filled with a number.
- **P-CAD-3 (platform-coverage honesty).** Tag-driven release automation exists for
  **Windows only** (`windows-release`); **macOS packaging/signing is manual**, and
  there is **no per-PR desktop CI** (**TD-4**, Proposed). A train that ships a macOS
  artifact must **budget the manual step** — the cadence does not assume automation
  that is not built.

---

## 4. LTS strategy — **Proposed**

> No release beyond `1.0.0-rc.1` exists, so **no LTS line is active**. This is the
> model to designate at/after GA.

**"Supported"** means a version **still receives PATCH releases** — security fixes
and critical correctness fixes — verified through the standard gate (§3). Everything
else (new features, non-critical fixes) lands only on the current line.

| Line type             | Definition (Proposed)                                   | Receives                                  |
| --------------------- | ------------------------------------------------------- | ----------------------------------------- |
| **Current**           | The latest released `x.Y` line                          | Features (MINOR), fixes, security (PATCH) |
| **LTS**               | A `x.Y` line **explicitly designated** LTS at release   | Security + critical fixes for its window  |
| **Maintenance**       | A prior non-LTS line, until the next line supersedes it | Security + critical fixes, short window   |
| **End-of-life (EOL)** | Past its support window                                 | Nothing — upgrade required                |

- **P-LTS-1.** **Not every MINOR is LTS** — LTS is a **conscious governance designation**
  (recorded in the changelog + support matrix §6), for lines meant to anchor long-lived deployments.
- **P-LTS-2.** An LTS line receives **only** security + critical-correctness PATCH
  backports — **never** a feature backport (that reintroduces risk into a line chosen for stability).
- **P-LTS-3.** LTS windows (**"N newer lines" or a duration**) are ratified with the
  cadence — **no window is asserted today**, since none can yet be honoured.

---

## 5. Hotfix policy

Elevates the EOSP hotfix **workflow** ([`RELEASE-OPERATIONS.md`](../operations/RELEASE-OPERATIONS.md)
§3 — the 10-step runbook, run unchanged) into the **governance policy** authorizing
it: **who may declare one, what qualifies, and what the expedited gate may waive.**

### Criteria — what qualifies as a hotfix

A hotfix is a **single, urgent `fix` to an already-released tag** that cannot wait
for the next train. **P-HOT-1:** a change qualifies **only** if it is **all** of:

- **Narrow** — one logical change, **no new surface** (route/scope/channel/field);
  anything additive is a normal patch train, **never** a hotfix.
- **Urgent** — a security regression, data-integrity bug, or a break in the core
  read/auth path.
- **PATCH-only** — bumps `x.y.z → x.y.z+1`, cannot be breaking; a fix achievable only
  by breaking a contract is a MAJOR and does **not** take the hotfix path.

### Approval — who authorizes

| Hotfix kind     | Declared by                             | Additional approver                    |
| --------------- | --------------------------------------- | -------------------------------------- |
| Security        | **Release Manager + Security Reviewer** | Code owner(s) of touched path          |
| Data-integrity  | **Release Manager + on-call/SRE**       | Code owner(s); DR owner if it migrates |
| Core-path break | **Release Manager**                     | Engineering Lead / code owner(s)       |

**P-HOT-2.** The declaration is **recorded** (reason + target tag) before code starts — a
hotfix is a decision on the record, not an ad-hoc push. Roles are **hats, not headcount** (EOSP §2).

### Expedited gate — what may be waived, on the record

**P-HOT-3.** The hotfix gate is **reduced, not skipped** — it runs EOSP §3's
_reduced-but-defined gate_ table (not a copy of it here), and **every waiver is
explicit and disclosed** in the release notes. The governance floor this policy fixes
over that table: typecheck / lint / build / `format:check` and a
**fails-before/passes-after regression test** stay **mandatory**; `npm audit
--omit=dev` is **mandatory for a security hotfix**; packaging and `deploy-validation`
are **scoped** to what the fix touched. **Narrowing tests to the changed workspace is
allowed only with a recorded rationale** — never a silent scope cut.

**P-HOT-4 (no silent divergence).** Every hotfix is **backported to `main` and any
active `release/x.y` the same day** (EOSP §3.10) so the next train cannot regress it,
and to **every other supported line** the fix applies to (§6). **P-HOT-5.** Rollback
readiness is a precondition: app-binary rollback is **advisory**; the real lever is
**data-side restore** (EOSP §4) — the on-call operator must be able to state the
restore path before the hotfix deploys.

---

## 6. Support lifecycle

Governs **which versions are supported, when they reach EOL, and how security fixes reach
them** — building on [`SECURITY.md`](../../SECURITY.md) + the [`SECURITY-GUIDE.md`](../guides/SECURITY-GUIDE.md) hardening backlog.

### Supported versions (today — honest)

**`1.0.0-rc.1`** (Validated Release Candidate) is the **only release and the only
supported version** — per `SECURITY.md`, "fixes applied to the latest release." `1.0.0`
(GA) is a **Proposed** forward slot pending the §7 gate; **nothing else exists** — no
fabricated history.

### EOL policy — **Proposed** (activates at GA)

- **P-SUP-1 (support window).** On GA the supported set is the **current line plus any
  designated LTS line(s)** (§4); at **EOL** a line receives **nothing** — the only remedy is an upgrade.
- **P-SUP-2 (announced, never silent).** EOL is **announced ahead** in the changelog +
  this matrix; API versions follow the in-code `deprecated → sunset` lifecycle with a
  **non-null `sunsetAt`** (§2.1, **P-SEM-1**) — the same discipline, in the contract.
- **P-SUP-3 (upgrade path required).** No line is marked EOL without a **supported
  upgrade target + migration notes** — no consumer is stranded.

### Security-backport policy

- **P-SEC-1 (private first).** Vulnerabilities are reported **privately** per
  [`SECURITY.md`](../../SECURITY.md) — never a public issue/PR — and fixed before
  coordinated disclosure. Verified controls (Electron hardening, fail-closed IPC +
  RBAC, PKCE/rotation auth, keychain vaults, SSRF guard, Ed25519 supply-chain
  signing) and the tracked backlog live in [`SECURITY-GUIDE.md`](../guides/SECURITY-GUIDE.md)
  (**Implemented/Validated**).
- **P-SEC-2 (backport to all supported lines).** A security fix is a **PATCH/hotfix
  (§5) backported to _every_ supported line** — current, LTS, and in-window
  maintenance — not just the newest. This is the concrete elevation of `SECURITY.md`'s
  "applied to the latest release" once more than one line is supported.
- **P-SEC-3 (disclosed pre-GA items).** The two **High** GA-blocker items (**TD-1** Apple
  `id_token` not JWKS-verified, **TD-2** marketplace unsigned-install bypass) are
  **disclosed in every release note** until closed (checklist §3;
  [`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md) §3). No posture is overstated; no CVE history is invented.

---

## 7. GA-gate checklist

The governed gate from **Validated RC → GA**, bound to the **Release Readiness
Matrix** ([`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md) §2). GA (`1.0.0`) is
declared **only** when every blocking line is checked; a red line is a **blocker**,
not a footnote. Roles are hats, not people (EOSP §2).

**Release-process gates (already Validated — the EOSP go/no-go ledger, §3 P-CAD-1):**

- [ ] Quality gate green: typecheck **0**, lint **0**, tests pass (re-count RC baseline
      **3,856**), build **0**, `format:check` clean, `npm audit --omit=dev` **0 prod vulns**;
      `deploy-validation` green.
- [ ] Version + `CHANGELOG.md` (Keep a Changelog) + `README` status cut; deploy hygiene
      (`SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false`, gated-Job migrations,
      backup confirmed — DR owner).

**GA blockers (Proposed — must close before dropping `-rc`):**

- [ ] **TD-1 — Apple `id_token` verified against JWKS** (`apps/backend/src/auth/providers/apple.ts`). **High. GA blocker.**
- [ ] **TD-2 — marketplace install refuses unsigned packages / empty trust store** (`apps/desktop/src/main/nps/packageService.ts`). **High. GA blocker.**
- [ ] **TD-4a — per-PR desktop CI** present and green (release-quality gate).
- [ ] **TD-4b — macOS release automation** in CI producing a **signed** GA artifact.

**Recommended pre-GA (disclose if unmet):**

- [ ] **TD-5 — automated rollback** drilled (app rollback stays advisory; data-side
      restore is the proven lever — EOSP §4); **TD-6 — alerting/tracing** wired so
      burn-rate alerts fire on the real `/metrics` + `/health` substrate.
- [ ] Target-hardware desktop benchmarks captured; first CDEP pilot evidence collected.

**Decision rule.** All **blocking** boxes checked → **GA GO**: drop `-rc`, tag `v1.0.0`,
ship via the EOSP train mechanics (§1). Any blocker unchecked → **NO-GO** — the line
stays `1.0.0-rc.(N+1)`. "Ready for GA" is the honest end of this list, never an assumed pass.

---

## Provenance & scope

- **Real and in use:** SemVer, Conventional Commits, Keep a Changelog, the quality
  gates, and CI (`backend-ci`, `deploy-validation`, `windows-release`) —
  `CONTRIBUTING.md`, `CHANGELOG.md`, `RELEASE-CHECKLIST.md`, `.github/workflows/*`.
- **Real contracts SemVer is grounded in:** the REST/API surface (`ApiVersion`
  `v1|v2`, 18 `ApiScope`s, `ApiVersionInfo` deprecation lifecycle, 13 Zod validation
  modules), the `@neuropause/sdk` public API (resources + webhook scheme), and the
  **604-channel** IPC contract (`IpcChannel`, preload allowlist, `RUNTIME_CHANNEL_PERMISSIONS`).
- **Elevated, not restated:** EOSP `RELEASE-OPERATIONS.md` (calendar, hotfix runbook,
  rollback, windows) and `RELEASE-CHECKLIST.md` (per-release gate) are the mechanics
  this policy governs; the Release Readiness / Technical-Debt matrices in
  `GOVERNANCE-MATRICES.md` are the registers §7 gates on.
- **Proposed (not history):** the cadence model, LTS lines, EOL windows, and every
  forward version identifier — **only `1.0.0-rc.1` has shipped**; no GA, no post-GA
  release, and no version history beyond it is claimed.
- **Advisory / data-side (honest):** app-binary rollback is **advisory**; real recovery
  is **data-side restore** (EOSP §4); **no PITR** in-repo.
- **No fabrication:** no invented release history, CVE, metric, customer, or LTS
  attainment — governance policy only, **no runtime, no architecture.**
