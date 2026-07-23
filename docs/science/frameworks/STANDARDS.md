# NeuroPause Engineering Standards — Standards Science

> An NSSP framework. This is **formalization over the platform that already
> exists**, not an engineering change. It records the engineering standards
> NeuroPause **adopts** from external bodies, the **conventions** it already
> enforces internally, and a small set of standards **proposed by this program**
> (evidence level L0). Every standard is traceable to a real file/artifact or is
> labelled Proposed.
>
> **Conformance posture (non-negotiable).** NeuroPause **holds no
> international-standard certification** and has **authored no external
> standard**. Nothing in this document claims conformance to, or certification
> against, ISO, IEC, NIST, or any external standards body. "Adopts" means the
> platform *uses* an external specification; it never means the platform is
> *certified* against it. See §14.

---

## 1. Purpose and scope

Standards science, in the NSSP sense, is the discipline of keeping the platform
**named, structured, measured, validated, documented, operated, and released
consistently** — and of stating honestly which of those rules come from an
external specification and which are house conventions. This framework does not
invent process; it *formalizes* the process already visible in the repository's
configuration, contracts, gates, and release checklist.

Each standard below carries four things, per the authoring mandate: a **statement**
(the rule), a **rationale** (why it exists), a **real anchor** (the file/artifact
that evidences it), and a **type tag** (adopted external / internal convention /
proposed internal). Standards that are enforced by an automated gate also carry an
evidence level from the ladder in [`_grounding.md`](../_grounding.md).

## 2. Standard taxonomy and tags

Every standard is exactly one of three types. The tags are used verbatim across
the NSSP so the reader always knows what may and may not be claimed.

| Tag (used in tables) | Full name | What it means | What we may claim | What we may **not** claim |
|---|---|---|---|---|
| **Adopted** | adopted external | An external spec the platform *uses* | "We use SemVer / RFC 8252 / Prometheus format" | "We are certified against it" |
| **Convention** | internal convention | A house rule already enforced in-repo | "Our codebase enforces this" | "This is an industry standard" |
| **Proposed (L0)** | proposed internal standard (L0) | A rule defined *by this program*, not yet in code | "The NSSP proposes this" | "The platform implements this" |

Evidence levels (from the ladder): **L4** Validated · **L3** Measured · **L2**
Implemented · **L1** Modeled · **L0** Proposed. Standard IDs use a category prefix
(`STD-NAM-1`, `STD-SEC-2`, …) so the manual in
[`../manuals/STANDARDS-MANUAL.md`](../manuals/STANDARDS-MANUAL.md) can reference
each rule by ID.

## 3. Engineering terminology (STD-TERM)

A single vocabulary keeps every NSSP document internally consistent. These terms
are used with exactly the meanings below throughout the frameworks and manuals.

| Term | Definition | Anchor |
|---|---|---|
| **Anchor** | A real file/artifact path (with line where useful) that evidences a claim | ladder in `_grounding.md` |
| **Evidence level** | L0–L4 rung recording how strongly a claim is backed | `_grounding.md` §Evidence Ladder |
| **Gate** | An automated check that must pass with a fixed threshold before merge/release | `package.json` scripts, `RELEASE-CHECKLIST.md` §2 |
| **Contract** | A Zod schema every inbound IPC payload is validated against | `packages/shared/src/ipc/contracts.ts:1-7` |
| **Scope** | An RBAC permission named `domain:action` | `packages/shared/src/ipc/channels.ts` |
| **Fail-closed** | Default-deny: an unclassified privileged surface is refused, not allowed | `apps/desktop/src/main/ipc/runtimeAuthz.ts:28-31` |
| **Reuse-only lens** | A read-only surface that composes existing IPC and mutates nothing, deep-linking to real editors | `ENTERPRISE-GA-REPORT.md:185` |
| **Metric series** | A `neuropause_*` Prometheus time series exposed at `/metrics` | `apps/backend/src/observability/metrics.ts` |
| **Honest reporting** | Publishing only re-measured numbers, never transcribed ones, and labelling absent evidence | `RELEASE-CHECKLIST.md:35-37` |
| **Degradation** | An honest partial-health state (`degraded`) rather than a binary up/down claim | `apps/backend/src/app.ts:88-96` |

> **STD-TERM-1 (Convention).** NSSP documents use the glossary above without
> synonyms. *Rationale:* terminology drift is the most common way an honesty
> framework quietly starts overclaiming. *Anchor:* this table.

## 4. Naming conventions (STD-NAM)

Consistent names are the cheapest form of architecture. The platform already
follows the conventions below; this section formalizes them.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-NAM-1 | Source files use camelCase for modules and PascalCase for React components/types (`enterpriseKpi.ts`, `AdministrationView.tsx`) | Predictable resolution; matches `forceConsistentCasingInFileNames` | `tsconfig.base.json:14`; `packages/shared/src/types/*.ts` | Convention |
| STD-NAM-2 | Exported types/interfaces are PascalCase and domain-grouped by file | 1,925 exported types stay navigable when grouped by domain | `packages/shared/src` (40+ domain files) | Convention (L2) |
| STD-NAM-3 | RBAC scopes are named `domain:action` (`automation:read`, `backup:create`, `cloud:manage`) | A flat, greppable authorization vocabulary the gate can enumerate | `packages/shared/src/ipc/channels.ts:704`; `runtimeAuthz.ts:47` | Convention (L2) |
| STD-NAM-4 | IPC channel names are `domain:verb` (`backup:create`, `intel:report`) | One namespace per platform area; channel = scope shape | `packages/shared/src/ipc/channels.ts:700-752` | Convention (L2) |
| STD-NAM-5 | Backend metrics are prefixed `neuropause_` in snake_case with a unit suffix (`_seconds`, `_bytes`, `_total`) | Prometheus naming guidance; a stable scrape contract | `apps/backend/src/observability/metrics.ts:51-79` | Convention + Adopted (L3) |
| STD-NAM-6 | Benchmark artifacts are `bench/results/<domain>.json` | One predictable, reproducible artifact per measured domain | `bench/results/*.json` | Convention (L3) |

## 5. Architecture standards (STD-ARCH)

The platform is an npm-workspace monorepo (desktop + backend + shared/sdk/cli)
with hard boundaries and a reuse-first surface discipline.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-ARCH-1 | Code is organized as npm workspaces (`packages/*`, `apps/*`); shared types live only in `@neuropause/shared` | One source of truth for cross-boundary types; no cyclic app-to-app deps | `package.json:11-14` | Convention (L2) |
| STD-ARCH-2 | Every inbound IPC payload is validated against a Zod contract in the main process before any work | Untrusted renderer input is never trusted by shape alone | `packages/shared/src/ipc/contracts.ts:1-7` | Convention (L2) |
| STD-ARCH-3 | New control surfaces are **reuse-only lenses**: they compose existing IPC, mutate nothing, and deep-link to the real editor | Prevents duplicate platforms/stores; keeps one authoritative implementation | `ENTERPRISE-GA-REPORT.md:185`; `administration/AdministrationView.tsx` | Convention (L2) |
| STD-ARCH-4 | Privileged runtime channels are default-deny: an unclassified channel throws at composition (`assertAllChannelsClassified`) | A new privileged channel can never ship silently unguarded | `apps/desktop/src/main/ipc/runtimeAuthz.ts:28-31` | Convention (L2) |
| STD-ARCH-5 | Liveness (`/live`) and readiness (`/health`) are distinct endpoints | An orchestrator must not restart on a transient dependency blip | `apps/backend/src/app.ts:81-96` | Convention + Adopted (L2) |

## 6. Measurement standards (STD-MEAS)

Measurement is only credible if its units, shape, and reporting rules are fixed
in advance. The platform's real measurement primitive is `DurationSummary`.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-MEAS-1 | Latency/duration is summarized as `{count, avg, p50, p95, max}` (`DurationSummary`); load benches also report p90/p99 | Percentiles, not just means, expose tail behavior | `perfMetrics.ts` (`DurationSummary`); `bench/results/http-load.json` | Convention (L3) |
| STD-MEAS-2 | Units are explicit and SI-consistent: time in `ms`/`s`, memory in `bytes`, throughput in `req/s`, errors as a `ratio`, everything else a `count` | Ambiguous units are the classic source of false comparison | Measurement Matrix §3; `bench/results/*.json` | Convention (L3) |
| STD-MEAS-3 | Reported numbers are **re-measured, never transcribed** from a prior release | Copying old numbers silently fabricates evidence | `RELEASE-CHECKLIST.md:35-37` | Convention (L4) |
| STD-MEAS-4 | Every measured claim cites a reproducible harness and its raw artifact | Measurement without a rerun path is an assertion, not a measurement | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh` → `bench/results/*.json` | Convention (L3) |
| STD-MEAS-5 | Metrics exposure is aggregate and non-sensitive only (no PII, paths, or secrets) | Observability must not become a data-exfiltration surface | `apps/backend/src/observability/metrics.ts:1-12` | Convention (L2) |

## 7. Validation standards (STD-VAL)

Validation standards fix the thresholds a change must clear and the evidence
level each mechanism yields.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-VAL-1 | The four release gates — `typecheck`, `lint`, `test`, `build` — must be green (0 errors) before a release is cut | A single objective bar; no "mostly passing" releases | `RELEASE-CHECKLIST.md:28-32`; `package.json:19-27` | Convention (L4) |
| STD-VAL-2 | Automated tests are the primary correctness evidence (3,856 tests / 442 files) and back all L4 claims | Executed tests are the strongest evidence rung the platform holds | Validation Matrix §4; `npm run test` | Convention (L4) |
| STD-VAL-3 | Deployment assets are schema-validated with real tools (`kubernetes-validate` strict, `shellcheck`) | Manifests are validated, not eyeballed | `CHANGELOG.md:40`; `deploy/kubernetes/*.yaml` | Adopted (L4) |
| STD-VAL-4 | A claim is published at the evidence level its cited artifact supports and no higher | The composite honesty rule — propose freely (L0), claim only what is cited (L2+) | `_grounding.md` §Authoring rules | Proposed (L0) |
| STD-VAL-5 | Absent validation (per-PR desktop CI, coverage, renderer E2E/a11y) is disclosed, not implied present | Silence about a missing gate reads as coverage that does not exist | Validation Matrix §4 "Not present (honest)" | Convention (L0-tracked) |

## 8. Documentation standards (STD-DOC)

Documentation is where honesty is won or lost. These rules govern how evidence is
labelled in prose.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-DOC-1 | Every scientific concept/row carries an evidence level (L0–L4) with a citation for L2+ | The reader can always separate fact from proposal | `_grounding.md` §Authoring rules | Proposed (L0) |
| STD-DOC-2 | "The platform does X" (cite a file) is written distinctly from "the framework proposes X" (label L0) | Prevents proposals from being read as shipped capability | `_grounding.md` rule 2; Matrices reading note | Proposed (L0) |
| STD-DOC-3 | No fabricated proofs, papers, peer review, certifications, or benchmark numbers | The program's founding constraint | `_grounding.md` rule 5 | Convention |
| STD-DOC-4 | Changelogs follow Keep a Changelog and keep an honest "known limitations" section current | Users must see the gaps beside the features | `CHANGELOG.md:1-5,29-32` | Adopted (L2) |
| STD-DOC-5 | Open security/operational gaps are stated inline where a reader might assume coverage | Disclosure at the point of reliance, not buried | `RELEASE-CHECKLIST.md:97-106` | Convention (L2) |

## 9. Operational standards (STD-OPS)

Operational conventions make the running system legible without overclaiming its
health.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-OPS-1 | `/health` returns a three-state honest readiness (`ok` / `degraded`) with per-component status and HTTP 200/503 | A dependency blip is reported as `degraded`, not a false `ok` | `apps/backend/src/app.ts:88-96` | Convention (L3) |
| STD-OPS-2 | Metrics are exposed in Prometheus text exposition format v0.0.4 at `GET /metrics` | Standard scrape contract; no bespoke format | `apps/backend/src/app.ts:99-103`; `metrics.ts:1-12` | Adopted (L3) |
| STD-OPS-3 | Security-relevant actions are recorded in an append-only, indexed `audit_log` | Tamper-evident operational history | `apps/backend/src/db/migrations/0001_init.sql:50,59-60` | Convention (L2) |
| STD-OPS-4 | `/metrics` is network-restricted in production (loopback/NetworkPolicy) | Operational signal is not a public endpoint | `metrics.ts:10-12` | Convention (L2) |

## 10. Security standards (STD-SEC)

Security standards are split into the **adopted cryptographic primitives** (real,
tested) and the **open-items discipline** — the house rule that known weaknesses
are tracked and disclosed rather than hidden.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-SEC-1 | Passwords are hashed with **Argon2id** (memoryCost 19456, timeCost 2, parallelism 1) | Memory-hard KDF at interactive parameters | `apps/backend/src/auth/passwords.ts:3-4` | Adopted (L2) |
| STD-SEC-2 | Supply-chain manifests are signed and verified with **Ed25519** | Authenticity of packages/manifests | `apps/desktop/src/main/nps/signature.ts`; `federation/exchange/signing.ts` | Adopted (L2) |
| STD-SEC-3 | Refresh tokens are rotated with reuse detection; stored as **SHA-256** hashes | Replay/theft detection without storing raw tokens | `_grounding.md` §Assurance | Adopted (L2) |
| STD-SEC-4 | Native OAuth uses **PKCE per RFC 8252**, backend-brokered | No client secret on the desktop; standards-based native auth | `apps/backend/src/auth/` PKCE flow | Adopted (L2) |
| STD-SEC-5 | Authorization is **fail-closed**: privileged IPC requires an existing scope; production ships 0 prod-dependency vulnerabilities | Default-deny; supply-chain hygiene | `runtimeAuthz.ts:28-31`; `npm audit --omit=dev` | Convention (L4) |
| STD-SEC-6 | Known weaknesses are **tracked and disclosed**, never silently shipped (Apple `id_token` not JWKS-verified; marketplace unsigned-install when trust store empty; rate limiter deliberately fails open on Redis loss) | Honesty about residual risk is itself a security control | `apps/backend/src/auth/providers/apple.ts:14-16`; `nps/packageService.ts:184`; `middleware/rateLimit.ts:37` | Convention (L2) |

> The open items in STD-SEC-6 are the security counterpart of the honesty rule:
> the rate-limiter fail-open is a **deliberate** availability-over-strictness
> choice documented in source; the Apple JWKS and marketplace-signing items are
> tracked HIGH hardening items, not undisclosed defects.

## 11. Release standards (STD-REL)

Releases are governed by SemVer and a concrete, non-aspirational checklist.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-REL-1 | Versions follow **Semantic Versioning**; pre-GA lines carry a `-rc.N` suffix (current `1.0.0-rc.1`) | Communicates compatibility intent unambiguously | `package.json:3`; `CHANGELOG.md:4-5` | Adopted (L2) |
| STD-REL-2 | Commit messages follow **Conventional Commits** (`feat`/`chore`/`fix(...)`) | Machine-readable history; changelog derivation | commit history; `_grounding.md` §Standards | Adopted (L2) |
| STD-REL-3 | Every release passes the `RELEASE-CHECKLIST` — versioning, four green gates, prod audit, packaging, migrations, post-release verification | One repeatable definition of "ready to ship" | `docs/guides/RELEASE-CHECKLIST.md` | Convention (L2) |
| STD-REL-4 | Production config gates are enforced: `SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false` | No fabricated catalog data; migrations run as a deliberate step | `RELEASE-CHECKLIST.md:68-74` | Convention (L2) |
| STD-REL-5 | Release notes attach the **real** gate output and the honest known-limitations list | The release record is evidence-tied | `RELEASE-CHECKLIST.md:82-84` | Convention (L2) |

## 12. Quality standards (STD-QUAL)

Quality standards are the always-on gates that keep the codebase in a shippable
state between releases.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-QUAL-1 | TypeScript runs in `strict` mode with `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | Maximal compile-time safety across all workspaces | `tsconfig.base.json:8-14` | Convention (L4) |
| STD-QUAL-2 | Lint runs under a **zero-warning** policy (`eslint . --max-warnings 0`) | A warning is a defect; the bar is zero, not "few" | `package.json:23`; `.eslintrc.cjs` | Convention (L4) |
| STD-QUAL-3 | Formatting is enforced by Prettier (printWidth 100, single quotes, trailing commas, LF) and checked in the gate | Removes style debate; diffs stay semantic | `.prettierrc`; `RELEASE-CHECKLIST.md:33` | Convention (L2) |
| STD-QUAL-4 | Production build must exit 0 for backend then desktop | Buildability is a release precondition, not an afterthought | `package.json:19`; `RELEASE-CHECKLIST.md:32` | Convention (L4) |

## 13. Evidence standards (STD-EVID)

The evidence ladder is itself the flagship internal standard this program
formalizes — the mechanism every other standard's evidence level is graded on.

| ID | Standard (statement) | Rationale | Anchor | Type |
|---|---|---|---|---|
| STD-EVID-1 | Every claim is graded L0–L4: L4 Validated, L3 Measured, L2 Implemented, L1 Modeled, L0 Proposed | One scale makes overclaiming visible and reviewable | `_grounding.md` §Evidence Ladder | Proposed (L0) |
| STD-EVID-2 | L2+ requires a source/artifact citation; L4 requires executed tests/gates/reliability runs with recorded evidence | Higher claims demand stronger, reproducible backing | `_grounding.md` ladder rows | Proposed (L0) |
| STD-EVID-3 | Absent evidence (peer review, certification, published papers, external-standard conformance) is recorded as **none — not claimed** | Naming the void is what keeps the framework honest | Evidence Matrix §2 last row | Proposed (L0) |

## 14. Conformance posture (honest)

This is the standard the whole framework is built to protect, restated as a rule.

- **STD-CONF-1 (Convention).** No NSSP document may claim NeuroPause is
  *certified against* or *conformant to* any external standard (ISO/IEC/NIST/etc.).
  The platform **adopts** external specifications (SemVer, RFC 8252/PKCE,
  Prometheus exposition, Conventional Commits, Keep a Changelog, Ed25519/Argon2id/
  SHA-256, the Kubernetes schema) and enforces **internal conventions**; it holds
  **no** international-standard certification and authored **no** external
  standard. *Anchor:* Standards Matrix §5 (last row: conformance **not claimed**);
  `_grounding.md` §Standards.

The distinction is load-bearing: "we validate manifests with `kubernetes-validate`"
is an adoption claim (true, L4); "we are Kubernetes-certified" would be a
conformance claim (false, never made).

## 15. Reading note and traceability

This framework elaborates row-for-row on **Standards Matrix §5** and reuses the
glossary and ladder from [`_grounding.md`](../_grounding.md); where it names an
evidence level it preserves the matrix's level and citation. The enforceable,
checkable form of every standard here — with the exact gate or tool that verifies
it — is [`../manuals/STANDARDS-MANUAL.md`](../manuals/STANDARDS-MANUAL.md). The
composite rule that binds all of it: **a standards framework may propose freely
(L0), but may only *claim* what a cited artifact supports (L2+), and may never
claim certification it does not hold.**
