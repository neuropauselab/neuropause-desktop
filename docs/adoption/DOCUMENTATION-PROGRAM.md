# NeuroPause — Documentation Program (Information Architecture)

The GEAP information-architecture deliverable. It adds **no new documentation
content** and **no platform** — it is the navigable structure, taxonomy, and
operating rules laid **over the 130+ documents that already exist** in `docs/`
and the root reports. Every document named here was verified to exist; nothing
absent is cited as present. The maturity anchor is **Validated Release
Candidate** (`1.0.0-rc.1`, [`ENTERPRISE-VALIDATION-REPORT.md`](../../ENTERPRISE-VALIDATION-REPORT.md));
the license anchor is **Proprietary** ([`LICENSE`](../../LICENSE)), so any
open-source or public-contribution path is **proposed**, not current.

This program builds on the existing index [`docs/README.md`](../README.md) (the
"Start here" table and the honesty labels) and the release gate
[`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md); it does not replace
them.

---

## 1. Documentation architecture (Diátaxis map)

The corpus is classified into the four [Diátaxis](https://diataxis.fr/) modes.
A document has **one primary mode** (where it is indexed) even when it spans
more — e.g. [`AUTHENTICATION.md`](../AUTHENTICATION.md) is _explanation_ (§1–2,
why backend-mediated OAuth), _how-to_ (§4, configuring providers), and
_reference_ (§3, token-model tables). Directory indexes (`README.md` per
domain) are the fan-out point; the table lists representative real docs.

| Mode                            | Reader intent                          | Real documents (primary home)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tutorials** (learning)        | "Get me productive, start to finish"   | [`guides/QUICK-START.md`](../guides/QUICK-START.md) (10-min tour), [`guides/INSTALLATION.md`](../guides/INSTALLATION.md) (install + first launch). _Thin quadrant — developer/onboarding learning paths are a GEAP gap._                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **How-to guides** (task)        | "Help me complete this specific job"   | [`AUTHENTICATION.md`](../AUTHENTICATION.md) §4, [`DEPLOYMENT.md`](../DEPLOYMENT.md), [`deploy/README.md`](../../deploy/README.md), [`guides/CONNECTOR-GITHUB.md`](../guides/CONNECTOR-GITHUB.md), [`guides/TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md), [`guides/RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md), [`validation/DEPLOYMENT-PLAYBOOKS.md`](../validation/DEPLOYMENT-PLAYBOOKS.md), [`validation/OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md), `launch/LAUNCH-01..04-*.md`, `windows/WINDOWS-{BUILD,RELEASE}.md`                                                                                    |
| **Reference** (information)     | "Tell me exactly what this is / does"  | [`validation/PERFORMANCE-BENCHMARKS.md`](../validation/PERFORMANCE-BENCHMARKS.md), [`validation/RELIABILITY-RESULTS.md`](../validation/RELIABILITY-RESULTS.md), [`validation/REFERENCE-ARCHITECTURES.md`](../validation/REFERENCE-ARCHITECTURES.md), [`runtime/PLUGIN-SDK.md`](../runtime/PLUGIN-SDK.md), [`connectors/connector-sdk.md`](../connectors/connector-sdk.md), the capability sets `enterprise/`, `ecosystem/`, `federation/`, `cloud/`, `workforce/`, `intelligence/`, `platform/`, `unified/`, `science/manuals/GLOSSARY.md`, [`CHANGELOG.md`](../../CHANGELOG.md), `packages/sdk` + `packages/cli` surfaces, `bench/results/*.json` |
| **Explanation** (understanding) | "Help me understand why / how it fits" | [`AUTHENTICATION.md`](../AUTHENTICATION.md) §1–2, `science/frameworks/*` (8 sciences), [`science/README.md`](../science/README.md) (evidence ladder), [`ENTERPRISE-GA-REPORT.md`](../../ENTERPRISE-GA-REPORT.md), [`ENTERPRISE-VALIDATION-REPORT.md`](../../ENTERPRISE-VALIDATION-REPORT.md), [`SCIENTIFIC-STANDARDS-REPORT.md`](../../SCIENTIFIC-STANDARDS-REPORT.md), `PHASE-2..5-REPORT.md`, `federation/final-platform-architecture.md`, `design/NPDS-FOUNDATION.md`                                                                                                                                                                           |

**Placement rules.**

1. A new document declares its mode in the front matter (`type:` — see §3) and
   is filed in the matching quadrant of its directory index.
2. Do not mix modes in one document without labelled section breaks
   (`AUTHENTICATION.md` is the reference example for how to do this well).
3. Evidence/measurement docs (`validation/`, `bench/results/`) are **reference**,
   never tutorials — they are cited, not walked through.
4. Program/assessment reports (root `*-REPORT.md`) are **explanation** and are
   provenance; the current state always lives in [`docs/README.md`](../README.md).

---

## 2. Navigation standards (audience entry points)

Every reader enters through one of five audience on-ramps. Each on-ramp is a
three-step path: **Start → Then → Go deep.** All targets are existing docs.

| Audience                 | Start (orientation)                                                                           | Then (do the job)                                                                                                                                                                                                                                               | Go deep (evidence / reference)                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer / evaluator** | [`docs/README.md`](../README.md) → [`ENTERPRISE-GA-REPORT.md`](../../ENTERPRISE-GA-REPORT.md) | [`guides/QUICK-START.md`](../guides/QUICK-START.md), [`guides/INSTALLATION.md`](../guides/INSTALLATION.md)                                                                                                                                                      | `validation/` evidence + `validation/verticals/*` reference deployments                                                                                                                             |
| **Operator**             | [`docs/README.md`](../README.md) "Operator guides"                                            | [`guides/ADMINISTRATOR-GUIDE.md`](../guides/ADMINISTRATOR-GUIDE.md), [`SECURITY`](../guides/SECURITY-GUIDE.md), [`OPERATIONS`](../guides/OPERATIONS-GUIDE.md), [`DISASTER-RECOVERY`](../guides/DISASTER-RECOVERY-GUIDE.md), [`DEPLOYMENT.md`](../DEPLOYMENT.md) | [`validation/OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md), [`validation/DEPLOYMENT-PLAYBOOKS.md`](../validation/DEPLOYMENT-PLAYBOOKS.md), `launch/LAUNCH-04-GO-LIVE-RUNBOOK.md` |
| **Developer**            | [`ecosystem/README.md`](../ecosystem/README.md)                                               | [`runtime/PLUGIN-SDK.md`](../runtime/PLUGIN-SDK.md), [`connectors/connector-sdk.md`](../connectors/connector-sdk.md), [`ecosystem/sdk.md`](../ecosystem/sdk.md)                                                                                                 | `packages/sdk` + `packages/cli`, [`AUTHENTICATION.md`](../AUTHENTICATION.md), [`ecosystem/developer-portal.md`](../ecosystem/developer-portal.md)                                                   |
| **Partner**              | [`ecosystem/partner-platform.md`](../ecosystem/partner-platform.md)                           | [`ecosystem/marketplace.md`](../ecosystem/marketplace.md), [`ecosystem/connector-marketplace.md`](../ecosystem/connector-marketplace.md)                                                                                                                        | `validation/verticals/*` (implementation reference), [`ADOPTION-MATRICES.md`](ADOPTION-MATRICES.md) partner matrix                                                                                  |
| **Researcher**           | [`science/README.md`](../science/README.md)                                                   | `science/frameworks/*`, `science/manuals/*`                                                                                                                                                                                                                     | [`science/BENCHMARK-FRAMEWORK.md`](../science/BENCHMARK-FRAMEWORK.md), [`validation/PERFORMANCE-BENCHMARKS.md`](../validation/PERFORMANCE-BENCHMARKS.md), `bench/results/*.json`                    |

**Navigation rules (enforceable).**

1. **Every domain directory carries a `README.md` index.** Present today for
   `enterprise/`, `ecosystem/`, `federation/`, `cloud/`, `workforce/`, `science/`.
   Gap to close: `validation/`, `intelligence/`, `platform/`, `connectors/`,
   `unified/`, `windows/`, `launch/` currently rely on `_grounding.md` or no
   index — add a `README.md` (or promote `_grounding.md`) so no directory is a
   dead end.
2. **"Start here" table on every index**, mirroring the pattern proven in
   [`docs/README.md`](../README.md) (task → link).
3. **Three-click rule:** any document is reachable in ≤3 hops from
   [`docs/README.md`](../README.md) via an index. Links resolve _downward_
   (index → guide → deep); a leaf doc links _up_ to its index, not sideways at
   random.
4. **Honesty labels surface in nav.** The `docs/README.md` taxonomy —
   **Verified / Modeled / Advisory / Absent** — is shown next to any capability
   link so readers never navigate into an overstated feature.
5. **Audience banner** at the top of each doc names its persona(s) so a reader
   landing from search knows whether they are in the right on-ramp.

---

## 3. Documentation taxonomy (categories, tags, naming)

### 3.1 Categories (map to real directories)

| Category                  | Directory                                                                                             | Primary mode            | Audience             |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | -------------------- |
| Getting started           | `docs/guides/` (INSTALLATION, QUICK-START)                                                            | Tutorial                | Customer             |
| Operator guides           | `docs/guides/` (`*-GUIDE.md`)                                                                         | How-to / Reference      | Operator             |
| Deployment                | `docs/DEPLOYMENT.md`, `deploy/`                                                                       | How-to                  | Operator             |
| Validation evidence (EVP) | `docs/validation/` (+ `bench/results/`)                                                               | Reference               | Customer, Researcher |
| Science (NSSP)            | `docs/science/`                                                                                       | Explanation / Reference | Researcher           |
| Capability / platform     | `enterprise/`,`ecosystem/`,`federation/`,`cloud/`,`workforce/`,`intelligence/`,`platform/`,`unified/` | Reference               | Developer, Operator  |
| Extensibility             | `runtime/`, `connectors/`                                                                             | Reference / How-to      | Developer            |
| Release & packaging       | `launch/`, `windows/`                                                                                 | How-to                  | Operator             |
| Design system             | `docs/design/` (NPDS)                                                                                 | Explanation / Reference | Developer            |
| Program reports           | root `*-REPORT.md`, `CHANGELOG.md`                                                                    | Explanation             | All                  |
| Adoption (GEAP)           | `docs/adoption/`                                                                                      | Framework               | All                  |

### 3.2 Tags (facets applied per document)

- **audience:** `customer` · `operator` · `developer` · `partner` · `researcher`
- **type:** `tutorial` · `how-to` · `reference` · `explanation`
- **maturity:** `verified` · `modeled` · `advisory` · `absent` (per `docs/README.md`)
- **domain:** `auth` · `deploy` · `ops` · `security` · `dr` · `marketplace` ·
  `connectors` · `workers` · `billing` · `science`
- **evidence-level** (science docs only): `L0`–`L4` (the NSSP ladder,
  [`science/README.md`](../science/README.md))

### 3.3 Naming conventions (codify what the repo already does)

The corpus already follows two consistent patterns; keep them, do not invent a
third.

| Kind                                                           | Convention                    | Real examples                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Getting-started, operator guides, root reports, EVP, verticals | `UPPERCASE-KEBAB.md`          | `QUICK-START.md`, `ADMINISTRATOR-GUIDE.md`, `ENTERPRISE-GA-REPORT.md`, `PERFORMANCE-BENCHMARKS.md`, `verticals/HEALTHCARE.md` |
| Domain / capability / platform docs                            | `lowercase-kebab.md`          | `connector-sdk.md`, `api-gateway.md`, `multi-tenant.md`, `ai-memory.md`                                                       |
| Directory index                                                | `README.md`                   | `ecosystem/README.md`, `science/README.md`                                                                                    |
| Internal anchor (not for external nav)                         | `_grounding.md` (leading `_`) | `validation/_grounding.md`, `science/_grounding.md`                                                                           |
| Ordered series                                                 | `PREFIX-0N-NAME.md`           | `LAUNCH-02-MAC-PACKAGING.md`, `RC1-02-DATABASE.md`, `NPDS-A2-COMPONENTS.md`                                                   |

Rules: ASCII only, no spaces, no camelCase in filenames; operator guides use the
`NOUN-GUIDE.md` suffix; one concept per file.

---

## 4. Versioning policy

Documentation is versioned **with the product line**, not per file. The line is
[SemVer](https://semver.org/); the current release is **`1.0.0-rc.1`**, and
pre-GA releases carry the `-rc.N` suffix ([`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md)
§1). The human-readable history is [`CHANGELOG.md`](../../CHANGELOG.md) in
[Keep a Changelog](https://keepachangelog.com/) format.

| Change                  | SemVer effect               | Documentation action                           | Changelog section          |
| ----------------------- | --------------------------- | ---------------------------------------------- | -------------------------- |
| Breaking API / behavior | MAJOR                       | Update reference + how-to; add migration note  | `Changed` / `Removed`      |
| New capability          | MINOR                       | Add reference doc + index link; label maturity | `Added`                    |
| Fix / clarification     | PATCH                       | Edit in place; no new file                     | `Fixed`                    |
| Pre-GA candidate        | `-rc.N` bump                | Refresh "as of" line on getting-started docs   | new `[x.y.z-rc.N]` heading |
| Deprecation             | flagged, removed next MAJOR | Mark deprecated, keep one release, then delete | `Deprecated` → `Removed`   |

**Rules.**

1. A doc describes the **shipped behavior of the tagged release**; anything
   modeled, advisory, or absent is labelled (never implied) per the
   `docs/README.md` honesty taxonomy.
2. Getting-started docs stamp their version (e.g. `INSTALLATION.md` states
   "Release Candidate 1 (`1.0.0-rc.1`)"); keep that line accurate on each bump.
3. The `CHANGELOG.md` **"known limitations"** block is part of the release, not
   an afterthought — it carries the honest pre-GA items forward every release.
4. Docs and the index disagree → the doc wins; open a correction
   ([`docs/README.md`](../README.md) closing rule).

---

## 5. Release documentation

What every release ships, built directly on [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md).
Each row is an artifact a release cannot omit.

| Release artifact                                                                                       | Built from                                                                      | Checklist section |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------- |
| Dated `CHANGELOG.md` entry (with `Known limitations`)                                                  | move items out of "unreleased"                                                  | §1                |
| Root `README.md` status blockquote matches version + class                                             | version bump                                                                    | §1                |
| Release notes with **real** gate output (test count, build time, bundle sizes)                         | `typecheck`/`lint`/`test`/`build`/`format:check`                                | §2                |
| Security-item disclosure (Apple JWKS, unsigned-install)                                                | `npm audit` + Security Guide backlog                                            | §3                |
| Packaging/signing note (macOS notarization is env-gated; mac release not in CI)                        | packaging review                                                                | §4                |
| Migration + seed/flag confirmation (`SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false`)        | migration review                                                                | §5                |
| Go-live record                                                                                         | [`launch/LAUNCH-04-GO-LIVE-RUNBOOK.md`](../launch/LAUNCH-04-GO-LIVE-RUNBOOK.md) | §6                |
| Post-release verification note (`/health`, `/metrics`, smoke sign-in, rollback readiness)              | post-release checks                                                             | §7                |
| Operational-gaps disclosure (no alert routing / tracing / capacity forecasting; federation DR modeled) | known gaps                                                                      | §8                |

**Rule (from §2):** never transcribe numbers from a previous release — re-run
the gate and copy the actual output into the notes. A release whose docs cannot
honestly check every box ships the box as a **disclosed limitation**, never as
an omission.

---

## 6. Knowledge base

The knowledge base is the **task-indexed operator layer** over the existing
guides and runbooks — it introduces no new procedures, it routes to the proven
ones. Structure it in six shelves.

| KB shelf                       | Backed by (real docs)                                                                                                                                            | Use when                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Incident runbooks              | [`validation/OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md) (Redis-down, Postgres-down, restart, high-latency, backup/restore)                 | Live backend incident                         |
| Deployment playbooks           | [`validation/DEPLOYMENT-PLAYBOOKS.md`](../validation/DEPLOYMENT-PLAYBOOKS.md), [`DEPLOYMENT.md`](../DEPLOYMENT.md), [`deploy/README.md`](../../deploy/README.md) | Rollout, upgrade, air-gapped install          |
| Recovery & DR                  | [`guides/DISASTER-RECOVERY-GUIDE.md`](../guides/DISASTER-RECOVERY-GUIDE.md) + Runbook 5                                                                          | Backup, restore, data-loss                    |
| Security operations            | [`guides/SECURITY-GUIDE.md`](../guides/SECURITY-GUIDE.md), root [`SECURITY.md`](../../SECURITY.md)                                                               | Hardening, disclosure                         |
| Vertical reference deployments | `validation/verticals/{MANUFACTURING,HEALTHCARE,AGRICULTURE,FINANCIAL,GOVERNMENT}.md`                                                                            | Segment-specific implementation               |
| Desktop end-user               | [`guides/TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md)                                                                                                      | App won't open, blank window, connector error |

**KB article shape** (adopt the runbook template already proven in
`OPERATIONAL-RUNBOOKS.md`): **Applies-to → Symptom → Signal (a real `/health`
field or `/metrics` series) → Action → Verification → Honest limits.** Every
article carries the §3.2 tags so it is findable by audience + domain + maturity.

---

## 7. FAQ

Answered honestly against the real platform; every answer cites a real doc.

| #   | Question                                          | Answer                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **What is the maturity — is this GA?**            | No. It is a **Validated Release Candidate** (`1.0.0-rc.1`, ~76/100), not GA and not "proven in production at scale." Classification: [`ENTERPRISE-GA-REPORT.md`](../../ENTERPRISE-GA-REPORT.md) / [`ENTERPRISE-VALIDATION-REPORT.md`](../../ENTERPRISE-VALIDATION-REPORT.md).                                                                                                                 |
| 2   | **What does the desktop app run on?**             | macOS 12+ on **Apple Silicon** (M1+), ~300 MB free ([`INSTALLATION.md`](../guides/INSTALLATION.md)). Windows build/release tooling exists (`docs/windows/*`); macOS release automation is **not yet in CI** ([`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) §4).                                                                                                                    |
| 3   | **How do I install it?**                          | Open the signed, notarized `NeuroPause-1.0.0-rc.1-arm64.dmg` from your pilot contact and drag it to Applications ([`INSTALLATION.md`](../guides/INSTALLATION.md)). An "unidentified developer" block means you have the wrong (unsigned) build.                                                                                                                                               |
| 4   | **How does sign-in work — is it secure?**         | Backend-mediated native OAuth (**PKCE / RFC 8252**, system browser + loopback). The desktop **never holds a client secret**; the refresh token is encrypted in the macOS Keychain; email passwords use **Argon2id** ([`AUTHENTICATION.md`](../AUTHENTICATION.md)).                                                                                                                            |
| 5   | **Which identity providers are supported?**       | Google, GitHub, Microsoft, Apple, and email/password. Providers are configured **server-side**; leaving a provider's env vars blank disables it ([`AUTHENTICATION.md`](../AUTHENTICATION.md) §4–5).                                                                                                                                                                                           |
| 6   | **Can I run offline / air-gapped?**               | The desktop **starts offline** — local surfaces (diagnostics, recovery, workspace, memory) work without the backend ([`INSTALLATION.md`](../guides/INSTALLATION.md)). Backend-dependent features need the service; deploy it air-gapped with [`scripts/build-offline-bundle.sh`](../../scripts/build-offline-bundle.sh) (`docker save`/`load`, [`deploy/README.md`](../../deploy/README.md)). |
| 7   | **How do I deploy the backend?**                  | Docker Compose (`docker-compose.prod.yml`), raw Kubernetes manifests, or the Helm chart; the stack is backend + Postgres 16 + Redis 7. Required config: `POSTGRES_PASSWORD` and `JWT_ACCESS_SECRET` (≥32 chars) ([`DEPLOYMENT.md`](../DEPLOYMENT.md), [`deploy/README.md`](../../deploy/README.md)).                                                                                          |
| 8   | **Is my activity sent to an AI model?**           | No. The timeline, knowledge graph, and AI Memory analysis run **on your device** and are deterministic — no content is sent to a model ([`QUICK-START.md`](../guides/QUICK-START.md) §4). Connectors use each provider's official OAuth and only granted scopes.                                                                                                                              |
| 9   | **Do AI workers act on my behalf automatically?** | No. Any side-effecting action is held for **human approval** in the Approval Center — nothing acts without a yes ([`QUICK-START.md`](../guides/QUICK-START.md) §5).                                                                                                                                                                                                                           |
| 10  | **What license — is it open source?**             | **Proprietary, All Rights Reserved** ([`LICENSE`](../../LICENSE)). It is **not** open source; any public-contribution / OSS path is a **proposed** future, not a current fact.                                                                                                                                                                                                                |
| 11  | **How is it priced?**                             | Tiers exist in code — **free · starter · professional · enterprise** (Razorpay billing, disabled until keys are set). Pricing is a **framework over these tiers**; there are no published or market-validated prices.                                                                                                                                                                         |
| 12  | **What are the known security open items?**       | Two disclosed pre-GA items: Apple `id_token` is **not yet JWKS-verified**, and marketplace **app** install accepts **unsigned packages when the trust store is empty** (worker install is fail-closed) ([`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) §3, [`AUTHENTICATION.md`](../AUTHENTICATION.md) §6).                                                                         |
| 13  | **Is there real performance evidence?**           | Yes, reproducible: 24,000 requests / **0 errors**, sub-ms DB reads, **0.46 s** restart recovery, exact backup/restore. Harnesses in `bench/`, raw results in `bench/results/*.json` ([`validation/PERFORMANCE-BENCHMARKS.md`](../validation/PERFORMANCE-BENCHMARKS.md), [`CHANGELOG.md`](../../CHANGELOG.md)).                                                                                |
| 14  | **How do I back up and restore?**                 | `scripts/backup-db.sh` / `restore-db.sh` (`pg_dump -Fc`); drill regularly. Limits: whole-dump only (**no PITR/WAL**); Redis has no dedicated backup — treat it as reconstructible ([`OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md) Runbook 5, [`DISASTER-RECOVERY-GUIDE.md`](../guides/DISASTER-RECOVERY-GUIDE.md)).                                                       |
| 15  | **How do updates work / can I roll back?**        | Updates **never install silently** (RC channel; review in Operations → Release → Updates). Binary rollback is **advisory** — the real recovery path is a data-side restore ([`INSTALLATION.md`](../guides/INSTALLATION.md), [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) §7).                                                                                                     |
| 16  | **Where do I report a problem?**                  | Generate a redacted **support bundle** from Operations → Release and categorize severity per the Feedback Program ([`TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md)); security issues go through root [`SECURITY.md`](../../SECURITY.md). Community files (`CONTRIBUTING.md`, `SUPPORT.md`) are **not yet present** — proposed GEAP artifacts.                                            |

---

## 8. Troubleshooting framework

One diagnostic shape spans the corpus: **Symptom → Signal → Action →
Verification** ([`OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md)).
Two tracks apply it — desktop (surface-driven) and backend (signal-driven).

### 8.1 Two tracks

| Track                  | Signal source                                                                                                                                                                                   | Entry doc                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Desktop / end-user** | **Operations → Release** (Component Health) and **Operations → Recovery** (Safe Mode, backups)                                                                                                  | [`guides/TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md)        |
| **Backend / operator** | Real endpoints only: `/live`, `/health` (`components.database`/`redis`), `/metrics` series (`neuropause_backend_up`, `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total`) | [`OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md) |

### 8.2 Symptom → entry point

| Symptom                                   | Signal                                     | First action (doc)                                                                                   |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| App won't open ("unidentified developer") | Wrong build                                | Request notarized DMG ([`TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md))                         |
| Blank window / crash on launch            | Recovery recommendations                   | Enable **Safe Mode** ([`TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md))                          |
| AI Store empty / features missing         | Component Health degraded                  | Confirm backend reachable ([`TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md))                     |
| API reads fail, process alive             | `/health` 503, `database:"down"`           | Runbook 2 (do **not** restart — auto-reconnect)                                                      |
| Rate-limit bypass / auth hiccups          | `/health` 503, `redis:"down"`              | Runbook 1 (fail-open by design)                                                                      |
| Slow responses                            | `pg_pool_connections{state="waiting"}` > 0 | Runbook 4 (scale; DB is sub-ms)                                                                      |
| Suspected data corruption                 | Backup checksum                            | Validate + restore ([`DISASTER-RECOVERY-GUIDE.md`](../guides/DISASTER-RECOVERY-GUIDE.md), Runbook 5) |

### 8.3 Escalation ladder & honest limits

1. Self-serve doc → 2. **Support bundle** (redacted; Operations → Release) →
2. Operator runbook → 4. Data-side DR restore → 5. **Disclosed gap**.

Severity is **Critical / High / Medium / Low**; data loss or crash-on-launch is
**Critical** ([`TROUBLESHOOTING.md`](../guides/TROUBLESHOOTING.md)). Do **not**
wait on capabilities the platform does not have: there is **no native
alerting/paging, no distributed tracing, no capacity forecasting** — author
alert rules externally (Prometheus + Alertmanager) on the shipped series, and
remember federation multi-region DR is **modeled**, not failover
([`OPERATIONAL-RUNBOOKS.md`](../validation/OPERATIONAL-RUNBOOKS.md) escalation
notes).

---

## Reading note

This document is IA over the **existing** corpus: it names only documents
verified to exist, labels maturity honestly (Validated RC, proprietary license,
disclosed security items), and turns each rule into something actionable — a
placement rule, a naming convention, a template, or a routing table. Where a
directory index or community file is missing, it is named as a **gap to author**,
never cited as present.
