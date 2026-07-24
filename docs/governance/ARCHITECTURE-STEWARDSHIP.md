# NeuroPause PERG — Architecture Stewardship

> **What this is.** The **governance layer over architectural change**: who reviews a
> cross-cutting or contract-touching change, how a proposal moves from an idea to an
> immutable decision record, what counts as a **breaking change** on each **real**
> contract surface, and how compatibility is preserved across versions. It **adds no
> runtime, no platform, and no architecture** — it governs how the architecture is
> _allowed to change_, it does not change it. Every breaking example cites a real surface.
>
> **Elevate, do not restate.** The machinery already exists and is reused, not re-invented:
> GEAP [`GOVERNANCE.md`](../../GOVERNANCE.md) owns decision authority (lead maintainers,
> lazy consensus) and the _proposed_ advisory board; GEAP
> [`COMMUNITY-GOVERNANCE.md`](../adoption/COMMUNITY-GOVERNANCE.md) §2 owns the RFC state
> model elevated here into an **architecture-RFC**; EOSP
> [`DEVELOPER-OPERATIONS.md`](../operations/DEVELOPER-OPERATIONS.md) owns the review
> checklist, `CODEOWNERS` mapping, and the RFC-before-code gate;
> [`ROADMAP-GOVERNANCE.md`](ROADMAP-GOVERNANCE.md) §5 owns the **deprecation lifecycle,
> notice windows, and migration-guide gate**. This document does **not** re-derive them —
> it defines _what breaking means per surface_ and the _board that reviews it_. ADR format:
> [`PRODUCT-EVOLUTION.md`](../pilots/PRODUCT-EVOLUTION.md) §4.
>
> **Honesty banner (non-negotiable).** The platform is a **Validated Release Candidate**
> (`1.0.0-rc.1`) — **no GA, no post-GA release, no customer, no production fleet exists**
> (`_grounding.md`). The **Architecture Review Board (ARB)** below is a **_Proposed_**
> governance structure — a design to be chartered _at GA_, **not a staffed body**; it
> convenes existing code-owner roles and **recommends**, while decision authority stays
> with the lead maintainer(s) per `GOVERNANCE.md`. It names **no** people. Contract
> surfaces are **Implemented / Validated** (cited to files); the board, workflow, and
> the one worked example are **Proposed**. No RFC is fabricated: one blank template plus
> **one** grounded example (TD-1 Apple JWKS), whose resulting ADR is honestly `Proposed`.

---

## 1. Architecture Review Board (ARB)

**Charter (Proposed).** The ARB reviews changes with architecture-wide blast radius
_before_ they land, so review is about correctness and compatibility, not re-litigating
scope afterward. It is the architecture-stewardship elevation of the _proposed_ Security and
Developer-Experience working groups (`COMMUNITY-GOVERNANCE.md` §8), convened for cross-cutting
review. It **recommends**; it does not override the lead maintainer's final authority.

### 1.1 What the ARB reviews (the four standing triggers)

| Trigger                               | What it means (real surface)                                                                             | Why the ARB                                                                                                                                                                                        | Evidence                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Cross-cutting change**              | A change spanning **≥ 2 workspaces** — `apps/backend`, `apps/desktop`, `packages/shared`, `packages/sdk` | Blast radius exceeds one code owner; no single reviewer sees the whole seam                                                                                                                        | **Validated** (workspace layout, `tsconfig.base.json`)    |
| **New dependency**                    | A new **runtime** dependency added to any workspace (e.g. adding `jose` for JWKS)                        | Supply-chain, licence, and audit surface (`npm audit --omit=dev` = 0) all shift                                                                                                                    | **Implemented** (gate wall, `DEVELOPER-OPERATIONS.md` §4) |
| **Breaking change**                   | Any change meeting a §3 definition on a real contract surface                                            | A break forces a SemVer major and a migration guide; consumers must be protected                                                                                                                   | **Validated** (surfaces §3)                               |
| **Reuse-only / no-duplicate mandate** | A change that would define a contract **twice** instead of extending the canonical one                   | Contracts live **once**: IPC in `packages/shared/src/ipc`, types in `shared` (SDK re-exports them), the Enterprise resource **generated** from one manifest, channels in one `IpcChannel` registry | **Validated** (`resources.ts`, `channels.ts`, `index.ts`) |

The reuse mandate is the architecture-side of the **reuse-first test**
(`PRODUCT-STRATEGY.md` §5.2). The ARB's standing question: _does a canonical contract
already exist?_ If yes, the change **extends or is generated from** it; a second definition
is rejected unless the RFC justifies the fork and schedules the merge-back.

### 1.2 Composition (roles, never people)

Membership is drawn from the **real** `CODEOWNERS` roles, convened per proposal by the
touched paths — not a fixed roster:

| Seat               | Role handle (`CODEOWNERS`)        | Standing scope                                         |
| ------------------ | --------------------------------- | ------------------------------------------------------ |
| **Chair**          | `@neuropause/leads`               | Owns the decision per `GOVERNANCE.md`; breaks ties     |
| **Backend / data** | `@neuropause/backend-maintainers` | HTTP API, DB migrations, gateway                       |
| **Desktop**        | `@neuropause/desktop-maintainers` | IPC contracts, secure bridge, renderer                 |
| **SDK / DX**       | `@neuropause/sdk-maintainers`     | `@neuropause/sdk`, contract-versioning                 |
| **Security**       | `@neuropause/security`            | **Mandatory** for auth / IPC / trust / signing changes |
| **DevOps**         | `@neuropause/devops`              | CI gates, release/version mechanics                    |

> **Enforcement caveat (`DEVELOPER-OPERATIONS.md` §3).** Every `@neuropause/*` handle is a
> **placeholder**; until mapped to real teams, code-owner review does not actually gate
> merges. Mapping them is a **prerequisite** to standing up the ARB — an operating item.

### 1.3 Decision rules

- **Reversibility first.** Two-way-door (reversible) choices proceed by **lazy consensus**,
  no ARB unless a §1.1 trigger fires; one-way-door or trigger-hitting changes require an
  architecture-RFC (§2) — the decision-class split of `PRODUCT-STRATEGY.md` §3.3.
- **Board recommends.** With required approvals + green gates + no objection, a proposal is
  accepted; an **unresolved code-owner objection blocks** until addressed or overridden by
  the **Chair** with a **written rationale** (`GOVERNANCE.md`).
- **Security is blocking.** Any auth / IPC / trust-store / signing change needs the
  **security** seat's approval; it may not be waived (`DEVELOPER-OPERATIONS.md` §3).
- **Quorum by role, not headcount** — owning-path seat(s) + security seat (if relevant) +
  Chair, expressed as **roles present**, never a fabricated member count.

### 1.4 Cadence

No standing meeting is invented; the ARB convenes on **real** cadences:

1. **On-demand, async** whenever an architecture-RFC opens — a **≥ 7-day** comment window
   (elevated from `COMMUNITY-GOVERNANCE.md` §2).
2. **At each release cut** — an architecture check against the Release Checklist
   (`RELEASE-CHECKLIST.md`): no un-reviewed break entered the train.
3. **At each roadmap review** — the quarterly ritual (`ROADMAP-GOVERNANCE.md` §2) sequences
   deprecations and major-version intents.

---

## 2. Architecture-RFC workflow

An **architecture-RFC** is the deliberation record for a §1.1-triggering change; its
durable output is an **ADR**. It elevates the GEAP RFC state model — it does not fork it.

### 2.1 Lifecycle: draft → review → decision → ADR

| GEAP RFC state (`COMMUNITY-GOVERNANCE.md` §2) | Architecture-RFC state | What happens                                                                                                                                                           | Owning role                 |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Draft                                         | **Draft**              | Author opens the RFC (template §2.3); names surfaces touched + breaking assessment                                                                                     | Contributor                 |
| Review                                        | **ARB review**         | Seats comment across a **≥ 7-day** window; author revises; reuse + security checks applied                                                                             | ARB seats                   |
| Last call                                     | **Decision**           | Chair signals accept/reject; final objections raised and resolved                                                                                                      | Chair (`@neuropause/leads`) |
| Accepted / Rejected                           | **ADR authored**       | An **accepted** architecture-RFC crystallizes into an immutable **ADR** (`PRODUCT-EVOLUTION.md` §4) — the RFC's Decision/Consequences/Evidence populate the ADR fields | Chair + author              |
| Implemented                                   | **Implemented**        | Linked PRs land through the real gate wall; RFC marked `implemented`, ADR unchanged                                                                                    | Code owners                 |
| Superseded                                    | **Superseded**         | A later ADR supersedes; both are linked. ADRs are never edited                                                                                                         | ARB                         |

The one elevation over the GEAP flow: an architecture decision does **not** end at
"accepted" — it **must crystallize into an ADR**, so a future reader knows _why_ on _what
evidence_. No ADR ⇒ not durable (mirrors deprecation-as-ADR, `ROADMAP-GOVERNANCE.md` §5.5).

### 2.2 When an architecture-RFC is required (thresholds)

| Threshold                                                                      | Requires arch-RFC?            | Real surface                      |
| ------------------------------------------------------------------------------ | ----------------------------- | --------------------------------- |
| New / changed public contract (IPC channel, SDK method, HTTP route, DB schema) | **Yes**                       | §3 surfaces                       |
| New **runtime** dependency                                                     | **Yes**                       | `package.json` + `npm audit` gate |
| Any **breaking** change (per §3)                                               | **Yes — mandatory**           | §3                                |
| Cross-cutting change (**≥ 2 workspaces**)                                      | **Yes**                       | workspace layout                  |
| Security-relevant behaviour (auth / IPC / trust / signing)                     | **Yes** + security seat       | `secureBridge.ts`, `auth/`        |
| Risk of a duplicate contract definition                                        | **Yes** (justify or refactor) | reuse mandate §1.1                |
| Routine bug fix, docs, tests, self-contained change                            | **No** — issue + PR           | `COMMUNITY-GOVERNANCE.md` §2      |

### 2.3 Blank architecture-RFC template

```
# Arch-RFC: <short noun-phrase title>
- Status:        draft | review | accepted | rejected | implemented | superseded
- Author(s):     <handle(s)>            (roles, never external customer names)
- Created:       YYYY-MM-DD
- Tracking:      #<issue>               Target ADR: ADR-NNN

## Summary            One paragraph: what changes and why now.
## Motivation         Problem; persona/segment (never a named customer); backlog/TD ref.
## Contract surfaces  Which of {IPC Zod, SDK, HTTP API, DB migration, desktop↔backend}
                      this touches — cite the file(s).
## Design             The change; behaviour; which canonical contract it extends/generates
                      from (reuse check — is there already one?).
## Breaking?          Per §3, is any surface broken? If yes: which, and the SemVer tier.
## Compatibility plan  Version bump; deprecation window (ROADMAP-GOVERNANCE §5); migration
                      guide link; additive-migration path for any DB change.
## New dependencies   Any new runtime dep + licence + audit impact (empty if none).
## Alternatives       What else was considered, and why not.
## Rollout            Phasing; gate impact; honesty-label effect; docs.
```

---

## 3. Breaking-change policy

A change is **breaking** when a consumer that worked against the prior contract stops
working without a code change on their side; each real surface has its own definition.
**Every breaking change is a SemVer major** (`X.0.0` = `feat!` / `BREAKING CHANGE:` per
`RELEASE-OPERATIONS.md` §1), announced **≥ 1 major ahead**, and **cannot merge without a
migration guide** (the hard gate is `ROADMAP-GOVERNANCE.md` §5.4 — referenced, not
restated; for architecture-touching breaks the guide attaches to the deprecation ADR).

### 3.1 IPC Zod contracts — `packages/shared/src/ipc/{contracts.ts,channels.ts}`

The main process validates **all** inbound IPC against these `z.object().strict()` schemas
_before doing any work_ (`secureBridge.ts` step 4), so any tightening silently rejects
previously-valid renderer calls — that is what makes a schema change breaking.

| Breaking (major)                                                                                                                                                                                                                                    | Additive (minor)                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Remove / rename an `IpcChannel.*` key, or drop a channel from an allowlist (`INVOKABLE_CHANNELS`, `RUNTIME_INVOKABLE_CHANNELS`, `SUBSCRIBABLE_CHANNELS`) — the preload allows only the **union**, so an allowlist drop breaks even if the key stays | Add a new channel key **and** its schema, and add it to the right allowlist |
| Add a **required** field to a `.strict()` request (e.g. a new required key on `ExecuteRunRequest`)                                                                                                                                                  | Add an **optional** field (`.optional()`)                                   |
| Tighten a constraint — `.max(200)`→`.max(50)`, `.min(8)`→`.min(12)`                                                                                                                                                                                 | **Widen** a constraint                                                      |
| Remove an enum member that payloads carry — e.g. drop `'apple'` from `OAuthProviderIdSchema`                                                                                                                                                        | Add an enum member to an inbound request (main must handle it)              |

### 3.2 SDK — `@neuropause/sdk`

| Breaking (major)                                                                                                                                                                      | Additive (minor)                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Remove / rename a `NeuroPauseClient` resource (`marketplace`, `workers`, `connectors`, `usage`, `billing`, `oauth`, `enterprise`) or a method (`marketplace.list`, `billing.summary`) | Add a new resource or method                                             |
| Change a method signature (new required arg, reorder) or its return-type shape                                                                                                        | Add an **optional** parameter or a new return field                      |
| Change a method's required `scope` (e.g. `marketplace:read`→`marketplace:publish`)                                                                                                    | —                                                                        |
| Remove a type re-exported from `index.ts`; regenerate `EnterpriseResource` from a manifest that **drops/renames** a route method                                                      | Add a re-exported type; add a generated method from a new manifest route |
| Change the webhook payload shape or `signWebhook` / `verifyWebhook` semantics                                                                                                         | Add an optional webhook event field                                      |

### 3.3 HTTP API — `apps/backend/src/app.ts` (+ gateway `ApiVersion`)

| Breaking (within a version)                                                             | Additive (minor)                |
| --------------------------------------------------------------------------------------- | ------------------------------- |
| Remove / rename a route (`/billing/summary`, `/marketplace/listings`, `/organizations`) | Add a new route                 |
| Change a response body shape, or change/require different auth or scope                 | Add an optional response field  |
| Tighten request-body validation on an existing route                                    | Add an optional query parameter |

The compat mechanism is **version negotiation** (§4): an incompatible REST shape ships
under a **new prefix** (`v2`) while `v1` keeps serving through the window.

### 3.4 DB migrations — `apps/backend/src/db/migrations/` (forward-only)

The runner is **forward-only** (`migrate.ts`): each `.sql` applies **once**, in order, in a
transaction, recorded in `schema_migrations` — **no down-migrations**. So the _only_ safe
migration is **additive**; a destructive change is the breaking case with **no rollback**,
done as **expand → migrate → contract** across majors (§4.3), never in one step.

| Breaking (major, no clean rollback)                                                 | Additive (safe, minor)                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `DROP TABLE` / `DROP COLUMN`; rename a column; incompatible `ALTER COLUMN ... TYPE` | `CREATE TABLE IF NOT EXISTS` (proven: `0012_embedding_state.sql`) |
| Add `NOT NULL` **without** a `DEFAULT` to a populated table                         | `ADD COLUMN ... DEFAULT` (proven: `0004_auth_hardening.sql`)      |
| Tighten a `CHECK` constraint an older writer would violate                          | `CREATE INDEX IF NOT EXISTS`                                      |

### 3.5 Desktop↔backend protocol (two stacked contracts)

The renderer speaks **only** typed IPC channels, never the backend directly
(`secureBridge.ts`): renderer → **IPC channel (Zod)** → main → **backend HTTP route**.
Breaking **either** layer breaks the desktop:

- A backend route change (e.g. the `/store` catalog response shape) breaks the
  `catalog:*` IPC channels mapped onto it **even though the IPC schema is unchanged**.
- An IPC schema tightening breaks the renderer **even though the backend is unchanged**.

Both layers version and deprecate **together**; an arch-RFC touching one must state its
effect on the other (template §2.3).

---

## 4. Compatibility strategy

The goal: a consumer on version _N_ keeps working while _N+1_ ships, with a signposted path
off anything removed. The **lifecycle and windows are owned by** `ROADMAP-GOVERNANCE.md` §5
— cited, not duplicated; this section adds the _architecture mechanisms_ behind the window.

### 4.1 Backward-compatibility windows & the deprecation path

- `Active → Deprecated → Removed`, with **Removed only in a SemVer major**
  (`ROADMAP-GOVERNANCE.md` §5.2). Deprecation is a **minor** (the replacement lands
  alongside); removal is the **major**; every deprecation is an **ADR** (§2.1).
- A deprecated element is **parallel-served** across the whole notice period and removed
  **no earlier than the next major**; notice is **≥ 1 major cycle** ahead, in
  **cycles/waves, never dates** (`_grounding.md`; `ROADMAP-GOVERNANCE.md` §5.3).
  Announcement = `@deprecated` marker + `CHANGELOG.md` "Deprecated" entry + migration guide.

### 4.2 Contract-versioning approach

- **REST** carries a real version in the path — `ApiVersion = 'v1' | 'v2'`, sent as
  `/${version}${path}` with an echoed `x-api-version` header (`transport.ts`). The gateway's
  `ApiVersionInfo` is a real state machine — `status: 'current' | 'beta' | 'deprecated' |
'sunset'` with a `sunsetAt` (`ecosystem.ts`): an incompatible shape ships as `v2`
  (`beta`→`current`) while `v1` runs `current → deprecated → sunset`. The **only** surface
  with a path-version prefix.
- **IPC and SDK** have no path prefix, so their compat **is** the deprecation window +
  additive discipline: add the new channel/method, `@deprecate` the old, remove at the next
  major (§3.1–3.2).

### 4.3 The additive-migration rule — the real data-compat mechanism

Because the DB runner is **forward-only with no down-migrations**, data compatibility is
achieved **structurally, not by rollback**: every migration is **additive**, so an older
backend and a newer schema **coexist** during a rolling change. A schema element is never
mutated destructively in place — it follows **expand/contract**:

1. **Expand** — additive migration adds the new column/table (`ADD COLUMN ... DEFAULT`,
   `CREATE TABLE IF NOT EXISTS`); both shapes valid, old readers unaffected.
2. **Migrate** — code writes/reads the new shape; a backfill populates it.
3. **Contract** — the old column is dropped **only a major later**, after the window, once
   no reader depends on it.

This is the concrete data-compat guarantee (`migrate.ts`; `0004`, `0012`): there is no
down-migration to fall back on, so additivity _is_ the safety mechanism.

---

## 5. Worked example — Arch-RFC: Apple id_token JWKS verification (TD-1)

A real, architecture-touching change: it adds a **new runtime dependency** and changes
**security-relevant** auth behaviour (two RFC thresholds, §2.2), yet is **compat-neutral**
(breaks no §3 surface) — the clean case where the machinery governs a security hardening
that is _not_ a breaking change.

```
# Arch-RFC: Verify Apple id_token against Apple JWKS before trusting claims
- Status: accepted    Target ADR: ADR-00N    Author(s): <backend-maintainer + security>
- Tracking: TD-1 (High) / risk PR-1 (forged Apple token, High)

## Summary            Verify the id_token against Apple's JWKS before trusting its claims.
## Motivation         apple.ts:77 calls jwt.decode(idToken) and trusts sub/email unverified
                      (HARDENING TODO 14–16); a forged token could mint a session (PR-1).
## Contract surfaces  None public — internal to the provider; ProviderProfile unchanged.
## Design             Fetch/cache Apple JWKS; verify ES256 sig + iss/aud/exp, reject on
                      failure. Extends the existing provider — no new surface.
## Breaking?          No. No IPC/SDK/HTTP/DB change; OAuthProviderIdSchema keeps 'apple'.
## Compatibility plan  None needed (nothing removed).
## New dependencies   `jose` — ARB new-dependency review; keep `npm audit --omit=dev` = 0.
## Alternatives       Hand-rolled ES256 (rejected: reinvents a primitive — reuse §1.1);
                      trust-decode (rejected: is the defect).
## Rollout            Config-gated; add sig-verify + forged-token-reject test; wave W1.
```

Accepted, it crystallizes into an ADR (`PRODUCT-EVOLUTION.md` §4). Honest status is
**`Proposed`** — TD-1 is not yet shipped:

```
# ADR-00N: Verify Apple id_token signatures against Apple JWKS
Status:  Proposed        (TD-1 open; not yet implemented — GOVERNANCE-MATRICES §3)
Context: apple.ts:77 trusts jwt.decode() output with no signature check; a forged
         id_token is accepted (HARDENING TODO 14–16; PR-1, High).
Decision: Verify id_token against Apple's JWKS via `jose` (signature, iss, aud, exp)
         before trusting any claim; reject otherwise. ARB approves the `jose` dep.
Consequences:
  Positive: closes PR-1 and TD-1 (High); satisfies the RC→GA security gate.
  Negative: one new runtime dependency + a JWKS fetch/cache path to operate.
  Neutral:  revisit if Apple changes key-rotation or algorithm policy.
Evidence: apple.ts:77; GA report TD-1 / PR-1; GOVERNANCE-MATRICES.md §3–4 (W1).
Related:  TD-1 (High, Security); risk PR-1; roadmap wave W1.
```

---

## Provenance & scope

- **Real (cited, Implemented/Validated):** the IPC Zod contracts + channel registry and
  allowlists (`packages/shared/src/ipc/contracts.ts`, `channels.ts`); the secure-bridge
  pipeline (`apps/desktop/src/main/ipc/secureBridge.ts`); the SDK client/resources/transport
  (`packages/sdk/src/{client,resources,transport}.ts`); the HTTP routes (`app.ts`); the
  forward-only runner and its 12 additive migrations (`db/migrate.ts`, `migrations/`); the
  gateway `ApiVersion`/`ApiVersionInfo` (`ecosystem.ts`); and TD-1 (`apple.ts:77`).
- **Elevated, not restated:** the RFC state model (`COMMUNITY-GOVERNANCE.md` §2); decision
  authority + advisory board (`GOVERNANCE.md`); the review checklist + `CODEOWNERS` mapping
  (`DEVELOPER-OPERATIONS.md` §3); the deprecation lifecycle/windows/migration-guide gate
  (`ROADMAP-GOVERNANCE.md` §5); the ADR format (`PRODUCT-EVOLUTION.md` §4); the reuse-first
  test (`PRODUCT-STRATEGY.md` §5.2).
- **Proposed (labelled):** the ARB (roles, never people; recommends, does not decide), the
  architecture-RFC workflow, and the one worked example — chartered **at GA**; the example
  ADR is honestly `Proposed`.
- **No architecture changed.** This governs _how_ architecture may change; it adds no
  runtime, no platform, no new contract. Breaking-change definitions describe the
  **existing** surfaces; they do not modify them.
