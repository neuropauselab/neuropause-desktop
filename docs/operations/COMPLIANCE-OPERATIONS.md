# NeuroPause EOSP — Compliance Operations Manual

> **What this is.** The compliance **execution** manual for the Enterprise Operations &
> Scale Program (EOSP): how NeuroPause runs a readiness program — who owns which control,
> on what cadence evidence is collected, how a data-subject request is worked, and where an
> assessor finds each artifact. It adds **no runtime and no platform**: roles, cadences, and
> decision rules over the **real** controls already inventoried in
> [`docs/guides/SECURITY-GUIDE.md`](../guides/SECURITY-GUIDE.md) and mapped per-vertical in
> [`docs/validation/verticals/`](../validation/verticals/) (`FINANCIAL.md §4`,
> `HEALTHCARE.md §7`, `GOVERNMENT.md §5.3`). Those documents map controls to frameworks; this
> one **operates** the readiness program over them and does not restate them.

> ## ⚠ NOT CERTIFIED — NO AUDIT HAS OCCURRED
>
> **NeuroPause holds no SOC 2 report, no ISO 27001 certificate, and no third-party
> attestation of any kind. No independent auditor has assessed the platform.** Every section
> below is **readiness self-assessment, control-mapping, and audit-preparation only.** Posture
> ratings are NeuroPause's honest self-view of the shipped code (`1.0.0-rc.1`, Release
> Candidate), never an external finding. Gaps are carried openly as **readiness gaps**, not
> hidden. Certification, the surrounding organizational controls the platform cannot provide,
> and the assessment decision remain entirely the deploying organization's responsibility.

## 1. Compliance operating model

Compliance operations is the discipline of keeping the **evidence** current and the
**readiness posture** honest, so that a deploying organization can scope and run _its own_
audit without first reverse-engineering the platform. EOSP owns the program; it does not, and
cannot, issue a certification.

### Roles — hats, not people

Every role is a **hat**, staffable by any qualified operator. EOSP names the accountability
structure; headcount and named individuals are an org decision. **No individual is named.**

| Role (hat)                   | Owns                                                                                        | Engaged                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| **GRC lead**                 | Readiness register, framework scoping, the evidence-collection calendar (§5)                | Continuous; drives the quarterly review |
| **Security control owner**   | The technical controls in `SECURITY-GUIDE.md`; the hardening backlog burn-down              | Per-release + on any new gap            |
| **Evidence custodian**       | Collecting, timestamping, and filing each artifact per cadence into the evidence index (§6) | Per the calendar (§5)                   |
| **Privacy owner (DPO hat)**  | Data inventory, retention posture, data-subject-request handling (§4)                       | On any DSR; quarterly inventory review  |
| **Control owner** (per area) | One control family's evidence freshness and remediation                                     | When its evidence ages or a gap opens   |

### Readiness posture legend

Every mapped row carries one honest posture. This legend is used in §2 and §3.

| Posture       | Meaning                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supported** | The platform provides the technical control; evidence is a real artifact.                                                                                                                  |
| **Partial**   | A real technical seam exists, but an operational or organizational piece (policy, review cadence, IdP wiring, off-box measurement) must be added by the operator to satisfy the criterion. |
| **Gap**       | A named readiness gap — the control is absent or a known hardening item is open. Tracked, not hidden.                                                                                      |

### What this manual is not

It is **not** a re-mapping of controls to verticals — that is the EVP packs' job
(`FINANCIAL.md`, `HEALTHCARE.md`, `GOVERNMENT.md`). It is **not** the control inventory — that
is `SECURITY-GUIDE.md`, cited here by reference. It is the **program**: readiness register,
evidence cadence, DSR workflow, and evidence index that sit _over_ those assets.

## 2. SOC 2 readiness (self-assessment)

> **⚠ NOT CERTIFIED — NO AUDIT HAS OCCURRED.** A SOC 2 report can be issued **only** by a
> licensed CPA firm after an independent examination. None has occurred. The table below is a
> **program-level readiness register** across all Trust Services Criteria categories, extending
> the selective per-vertical TSC mappings in `FINANCIAL.md §4.1` and `HEALTHCARE.md §7.2` — it
> does not restate them. It adds the two operational columns an evidence program needs: the
> **evidence artifact** that would be pulled for that criterion, and the honest **readiness
> gap**. Controls are cited to `SECURITY-GUIDE.md`; posture is self-assessed.

**Common Criteria (Security) — CC1–CC9**

| TSC                                 | Real control (see `SECURITY-GUIDE.md`)                                                                                             | Evidence artifact                                                              | Posture   | Readiness gap                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| **CC1** Control environment         | RBAC role model (owner/admin/manager/member/viewer/AI-worker seed); `CODEOWNERS` / `CONTRIBUTING.md` governance                    | `enterprise/org/seed.ts`; repo governance files                                | Partial   | Org-level policy, tone-at-top, and org chart are operator-owned; not a code artifact                     |
| **CC2** Communication & information | Structured logging with secret redaction; `/metrics`; `SECURITY.md` disclosure policy                                              | `/metrics` scrape; `SECURITY-GUIDE.md` "Reporting a Vulnerability"             | Partial   | Internal control-communication process is operator-owned                                                 |
| **CC3** Risk assessment             | `npm audit` scanning; documented risk/technical-debt register                                                                      | `ENTERPRISE-GA-REPORT.md` risk register; `npm audit --omit=dev` output         | Supported | Scanning + documented risks present; recurring org risk-assessment cadence is operator-owned             |
| **CC4** Monitoring activities       | `/health`, `/live`, `/metrics` series; append-only `audit_log`                                                                     | `/health` + `/metrics` snapshot; `audit_log` export                            | Partial   | **No alert routing / paging / tracing** — monitoring is manual (SRE.md §4)                               |
| **CC5** Control activities          | Fail-closed RBAC IPC gate; Zod validation on every payload; `assertAllChannelsClassified` boot invariant                           | `ipc/secureBridge.ts:93-117`; `runtimeAuthz.ts:347-355`                        | Supported | Enforced by construction; owner holds all scopes in single-user installs                                 |
| **CC6** Logical & physical access   | **57-scope RBAC**; **PKCE** (S256) OAuth; **Argon2id**; refresh rotation + reuse detection; Keychain at-rest; strict CSP + sandbox | `enterprise.ts:72-142`; `auth/pkce.ts`; `auth/passwords.ts`; `auth/session.ts` | Partial   | **Apple `id_token` not JWKS-verified** (HIGH); **no formal periodic access reviews**; MFA is IdP-side    |
| **CC7** System operations           | Telemetry (`/metrics`,`/health`,`/live`); executed reliability drills; `audit_log`                                                 | `bench/results/reliability.json`; `audit_log` export                           | Partial   | No alerting/tracing/capacity forecasting; incident detection wired by operator                           |
| **CC8** Change management           | 12 forward-only idempotent migrations; CI quality gates (3,856 tests); **Ed25519** signing; kubeconform strict                     | CI run logs; migration idempotency log; `deploy-validation.yml`                | Partial   | **Unsigned catalog-app install when trust store empty** (HIGH); **no per-PR desktop / macOS release CI** |
| **CC9** Risk mitigation             | **SSRF egress guard**; auth rate limiting; proven backup/restore + DB-down auto-recovery                                           | `webhooks/urlGuard.ts`; `bench/results/reliability.json`                       | Partial   | Rate limiter **fails open** on Redis loss (deliberate) — make alertable                                  |

**Category-specific criteria — Availability, Processing Integrity, Confidentiality, Privacy**

| TSC                          | Real control                                                                                                                               | Evidence artifact                                                        | Posture           | Readiness gap                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------ |
| **A1** Availability          | Redis fail-open; PG pool auto-reconnect; restart→healthy 0.46 s; proven `pg_dump`/`pg_restore`                                             | `bench/results/reliability.json`; restart timing                         | Partial           | HPA live scale-up **unmeasured**; federation DR **modeled**; rollback advisory (SRE.md §5) |
| **PI1** Processing integrity | Zod validation on every IPC/API payload; typed shared contracts; migration idempotency                                                     | `bench/results/*` (0 errors / 24k req); typecheck 0; 3,856 tests         | Supported         | Integrity of controls proven at reference scale; re-measure off-box                        |
| **C1** Confidentiality       | Keychain (`safeStorage`) at-rest; **SHA-256-only** token storage; RBAC scoping; **`SEED_STORE_ON_BOOT=false`**; **0 prod npm-audit vulns** | `secureStore.ts`; `auth/session.ts`; prod config; `npm audit --omit=dev` | Supported         | TLS termination is a deployment responsibility                                             |
| **P1–P8** Privacy            | Data minimization (no plaintext tokens/passwords); append-only `audit_log`; proposed DSR process (§4)                                      | `audit_log` export; data inventory (§4)                                  | Partial → **Gap** | **No in-platform DSR tooling, consent, or privacy-notice management** — see §4             |

Per-vertical scoping (finance SoD, PCI-adjacent areas, HIPAA safeguard split) lives in the EVP
packs and is **not** duplicated here; pull it from `FINANCIAL.md §4` / `HEALTHCARE.md §7` when
scoping a regulated tenant.

## 3. ISO 27001 readiness (self-assessment)

> **⚠ NOT CERTIFIED — NO AUDIT HAS OCCURRED.** No ISO/IEC 27001 certificate exists; no
> certification body has assessed NeuroPause. This is a readiness mapping of the platform's
> real controls to **Annex A (ISO/IEC 27001:2022) themes**, so an operator can populate its own
> Statement of Applicability. It asserts no certification.

**The ISMS management system (clauses 4–10) is operator-owned.** The ISMS itself — context,
scope, risk-assessment methodology, Statement of Applicability, management review, internal
audit programme, and continual improvement — is an **organizational** management system, not a
code artifact. EOSP defines the **roles (§1) and the evidence cadence (§5)** that feed it; the
platform cannot satisfy clauses 4–10. This is stated plainly, not implied away.

**Annex A themes (2022, four themes) → real control → readiness gap**

| Annex A theme               | Representative controls                                                                                                                               | Real NeuroPause control                                                                                                                                                                                                             | Posture                    | Readiness gap                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.5 Organizational** (37) | A.5.15 access control; A.5.19–23 supplier/cloud security; A.5.24–28 incident management                                                               | 57-scope RBAC access model; connector RBAC; Ed25519 supply-chain signing; incident runbooks (`OPERATIONAL-RUNBOOKS.md`) + `SECURITY.md` disclosure                                                                                  | Partial                    | Access-control **policy**, supplier register, and IR **plan** are operator-owned; runbooks exist, the governing policies do not ship                  |
| **A.6 People** (8)          | A.6.1–6.6 screening, terms, awareness, disciplinary process                                                                                           | _(none — outside the software boundary)_                                                                                                                                                                                            | Gap (operator-owned)       | Screening, training, awareness, and sanctions are **entirely operator-owned**; the platform provides no control here                                  |
| **A.7 Physical** (14)       | A.7.1–7.14 facility, equipment, media                                                                                                                 | Desktop runs sandboxed on the user workstation; secrets in OS Keychain (`secureStore.ts`)                                                                                                                                           | Not applicable to platform | Facility, equipment, and media controls are **operator-owned**; NeuroPause has no facility footprint                                                  |
| **A.8 Technological** (34)  | A.8.2/8.3/8.5 privileged & info access, auth; A.8.15 logging; A.8.16 monitoring; A.8.24 crypto; A.8.25–28 secure development; A.8.9 config management | RBAC fail-closed gate; PKCE + Argon2id + refresh rotation/reuse; append-only `audit_log`; `/metrics`; Ed25519 + SHA-256 + Keychain crypto; CI gates (3,856 tests) + forward-only migrations + Zod; IaC + `SEED_STORE_ON_BOOT=false` | Partial                    | **Apple JWKS (A.8.5)**, **unsigned catalog-app install (A.8.25/8.28)**, **no alerting under A.8.16**, MFA IdP-side (A.8.5) — all open readiness items |

The bulk of NeuroPause's real, testable controls land in **A.8 Technological**; the
Organizational, People, and Physical themes are dominated by controls only the operator's ISMS
can own. An operator's SoA should mark A.6 and A.7 controls as its own responsibility and cite
the A.8 rows above (with their gaps) for the technological baseline.

## 4. Privacy operations

> **⚠ NOT CERTIFIED — NO AUDIT HAS OCCURRED.** No privacy audit, no GDPR/CCPA certification, and
> no Data Protection Impact Assessment has been performed. This section defines a **proposed
> operating process** over the platform's **real** data schema. Lawful-basis determination,
> privacy notices, consent, cross-border transfer, and any DPIA remain the operator's (as data
> controller) responsibility; the NeuroPause operator is typically a **processor**.

### 4.1 What personal data the platform actually handles

The inventory is the **real schema** (`apps/backend/src/db/migrations/*.sql`) — not an
aspiration. NeuroPause is a decision/knowledge platform, **not** a store of regulated special
categories by design; the personal data it actually holds is **authentication identity and
session** data, plus whatever the operator routes through connectors/knowledge (operator-owned).

| Data category            | Store (real)                                             | Personal data held                                                                        | Protection (real control)                                | Erasure behaviour                            |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Account identity         | `users` (`0001_init.sql`)                                | email (CITEXT), display name, avatar URL, `password_hash` (Argon2id; null for OAuth-only) | Argon2id — **no plaintext password**; unique email index | root of the subject                          |
| Federated identity       | `auth_identities`                                        | provider (`google`/`github`/`microsoft`/`apple`), `provider_user_id`, email               | `ON DELETE CASCADE` from `users`                         | auto-erased with user                        |
| Sessions                 | `auth_sessions`                                          | **SHA-256 `token_hash` only**, `user_agent`, timestamps                                   | no plaintext token at rest; rotation + reuse detection   | `ON DELETE CASCADE` from `users`             |
| Membership / invitations | `memberships`, invitations (`0003_organizations.sql`)    | `invited_email`, `invite_token_hash` (SHA-256)                                            | hashed invite token; partial unique index                | operator-configured                          |
| Audit trail              | `audit_log` (`0001_init.sql`)                            | `user_id`, `action`, `detail` (JSONB), **`ip` (INET)**                                    | append-only; `user_id` `ON DELETE SET NULL`              | **row survives, linkage severed** (see §4.3) |
| Connector tokens         | connector vault (desktop, `0006_connector_accounts.sql`) | third-party OAuth access tokens                                                           | `safeStorage` (Keychain), refuses plaintext              | operator-controlled                          |

**Data-minimization posture (real).** Tokens are stored as **SHA-256 hashes only**; passwords
as **Argon2id** (never plaintext, and `null` for OAuth-only accounts); the logout audit event
records only a **12-char token-hash prefix**; production ships **`SEED_STORE_ON_BOOT=false`** so
no fabricated personal data is seeded. These are shipped controls, not policy aspirations.

### 4.2 Data inventory approach (operating process)

The inventory is kept current by **deriving it from the schema**, not by hand:

1. On every migration touching a personal-data-bearing table, the **Privacy owner** re-derives
   the inventory table above from `apps/backend/src/db/migrations/*.sql` (the schema _is_ the
   inventory source of truth).
2. Classify each new column: identifier / contact / credential-hash / metadata / free-form
   (`detail` JSONB and connector payloads are the free-form risk surface).
3. Record the protection control and erasure behaviour (CASCADE vs SET NULL) per column.
4. File the refreshed inventory into the evidence index (§6) with the migration hash as its
   version stamp.

### 4.3 Data-subject-request (DSR) workflow — **proposed process**

> There is **no shipped DSR endpoint or automation**. The workflow below is a **proposed manual
> runbook over the real schema** — a named readiness gap, executed today by SQL under the
> Privacy owner. It is presented so an operator can adopt it, not as a delivered capability.

| DSR type                    | Proposed operating steps (over real schema)                                                                                                                                                                                 | Honest constraint                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Access / portability**    | Resolve subject in `users`; export their `users` / `auth_identities` / `auth_sessions` (hashes only) / `memberships` / `audit_log` rows via SQL `COPY … TO … CSV HEADER` (same export shape as the EVP evidence procedures) | Connector-side data is operator-owned and out of this export |
| **Rectification**           | `UPDATE users` (email/display name) under audit; identity re-link handled at next OAuth sign-in                                                                                                                             | Provider-held identity is corrected at the IdP, not here     |
| **Erasure**                 | `DELETE FROM users WHERE id = :subject` → `auth_identities` + `auth_sessions` **cascade-deleted**; `audit_log.user_id` set **NULL** so the security record survives with linkage severed                                    | See erasure-vs-retention tension below                       |
| **Restriction / objection** | Suspend the membership (`status='suspended'` → holds **no** permissions via `effectivePermissions`) to halt processing without deletion                                                                                     | Reversible; not an erasure                                   |

**Erasure-vs-audit-retention tension (stated honestly).** `audit_log.user_id` is
`ON DELETE SET NULL` by design: erasing a user **preserves the append-only security record** but
**de-links** it from the subject. This is the standard tension between an erasure right and a
legitimate-interest / legal-obligation retention basis for security logs. The operator (as
controller) must decide, per its lawful basis, whether the de-linked record is acceptable or
whether `detail`/`ip` must be additionally scrubbed. NeuroPause enforces neither policy — it
provides the SET-NULL mechanism and leaves the basis decision to the controller.

**Privacy readiness gaps (carried openly):** no DSR tooling/UI, no consent management, no
privacy-notice surface, no automated retention/rotation on `audit_log`, and no built-in
scrubbing of `detail`/`ip`. All are operator-supplied at the application/DB layer today.

## 5. Audit readiness — evidence collection cadence

Audit readiness is a **cadence discipline**: evidence is collected on a schedule against the
**real** artifacts so that at any point an assessment window can be served without a scramble.
This extends the per-vertical evidence _procedures_ (`HEALTHCARE.md §6`, `GOVERNMENT.md §6`) into
a standing **calendar** with owners — it does not restate those commands.

### 5.1 Evidence-collection calendar (proposed cadence)

| Evidence class      | Real artifact / source                                                               | Cadence                                 | Owner (hat)            |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------- |
| Quality gates       | typecheck 0, lint 0, **3,856 tests**, build 0                                        | **Per PR / per release**                | Security control owner |
| Dependency posture  | `npm audit --omit=dev` → **0 prod vulns** (11 dev-only)                              | Per release + on advisory               | Security control owner |
| Deploy validation   | kubeconform strict PASS; `helm lint`/`template` (`deploy-validation.yml`)            | Per release                             | Evidence custodian     |
| Performance floor   | `bench/results/http-load.json`, `db-latency.json`                                    | Per release + on target hardware        | GRC lead               |
| Reliability drills  | `bench/results/reliability.json` (backup/restore, restart, DB-down, Redis fail-open) | **Quarterly** re-run                    | Control owner (SRE)    |
| Migration integrity | 12 forward-only migrations; idempotency re-run applies **0 new**                     | Per migration                           | Security control owner |
| Audit trail         | `audit_log` export (`COPY … WHERE created_at ∈ window`)                              | **Monthly** + on-demand for a window    | Evidence custodian     |
| Live telemetry      | `/metrics`, `/health`, `/live` snapshots                                             | Continuous scrape; snapshot **monthly** | Control owner (SRE)    |
| Risk register       | `ENTERPRISE-GA-REPORT.md` gap catalog; hardening-backlog burn-down                   | **Quarterly** review                    | GRC lead               |
| Access review       | role/membership assignment vs `effectivePermissions`                                 | _(proposed — see gap)_                  | GRC lead               |

### 5.2 Evidence integrity and honest gaps

- **Source code is primary evidence.** Because every control is cited to `file:line` in
  `SECURITY-GUIDE.md`, the versioned repository _is_ the control-design evidence; the artifacts
  above are the operating-effectiveness evidence over it.
- **`audit_log` is append-only at the app layer only** — the writer performs `INSERT` only and
  swallows failures (non-blocking). It is **not hash-chained**, has **no built-in retention**,
  and ships **no SIEM forwarder** (`SECURITY-GUIDE.md` backlog #5). Immutability (deny
  `UPDATE`/`DELETE` grants, WORM archival) and forwarding are operator-supplied.
- **`audit_log` coverage is currently auth-events-only.** The schema/writer are generic and
  support privileged-mutation events (role/permission change, billing, backup/restore), but
  those call sites are **not yet wired** (`FINANCIAL.md §2.2`). Extending coverage is a
  pre-assessment task for a complete accountability chain.
- **No formal periodic access reviews (named gap).** The platform can _compute_ effective
  permissions (`effectivePermissions`, active-members-only), but there is **no scheduled
  attestation process**. The §5.1 access-review row is a **proposed cadence**, not a shipped
  capability — this is the honest access-governance gap.
- **Collection is manual.** No automated evidence pipeline or alerting exists; the custodian
  runs the calendar by hand until that wiring is added (SRE.md §1 toil register).

## 6. Compliance documentation — the evidence index

The evidence index is the single sheet an operator hands an assessor: each evidence class, its
**real** location, the frameworks it serves, and its freshness. It is the map, not a copy, of
the assets.

| Evidence class                | Real location                                                    | SOC 2                | ISO 27001 Annex A  | Privacy           | Freshness (§5)      |
| ----------------------------- | ---------------------------------------------------------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| Control inventory (file:line) | `docs/guides/SECURITY-GUIDE.md`                                  | CC5–CC9, C1          | A.5, A.8           | §4 minimization   | On code change      |
| Vertical control mappings     | `docs/validation/verticals/{FINANCIAL,HEALTHCARE,GOVERNMENT}.md` | CC6–CC8, A1, PI1, C1 | A.8                | HIPAA/PCI scoping | On release          |
| Readiness register            | this doc §2–§3                                                   | all TSC              | all Annex A themes | P1–P8             | Quarterly           |
| Quality-gate output           | CI logs; `backend-ci.yml`                                        | CC8, PI1             | A.8.25–28          | —                 | Per PR/release      |
| Dependency audit              | `npm audit --omit=dev`                                           | CC3, CC9             | A.8.8              | —                 | Per release         |
| Performance evidence          | `bench/results/http-load.json`, `db-latency.json`                | A1, PI1              | A.8.6              | —                 | Per release         |
| Reliability evidence          | `bench/results/reliability.json`                                 | A1, CC7              | A.8.13, A.8.14     | —                 | Quarterly           |
| Deploy validation             | `deploy-validation.yml`; kubeconform strict                      | CC8                  | A.8.9, A.8.32      | —                 | Per release         |
| Audit-trail export            | `audit_log` via `COPY`                                           | CC4, CC7             | A.8.15             | §4 DSR access     | Monthly / on-demand |
| Telemetry snapshot            | `/metrics`, `/health`, `/live`                                   | CC4, CC7, A1         | A.8.16             | —                 | Monthly             |
| Data inventory                | this doc §4.1 (derived from migrations)                          | P1–P8                | A.5.34             | primary           | On migration        |
| Risk register                 | `ENTERPRISE-GA-REPORT.md`; hardening backlog                     | CC3                  | A.5.7, A.8.8       | —                 | Quarterly           |
| Incident/DR procedures        | `OPERATIONAL-RUNBOOKS.md`, `DISASTER-RECOVERY-GUIDE.md`          | CC7, A1              | A.5.24–30          | —                 | On drill            |

**Standing readiness gaps carried in the index (nothing hidden):** Apple `id_token` not
JWKS-verified (HIGH); unsigned catalog-app install with empty trust store (HIGH); no
alerting/tracing/capacity forecasting; no formal periodic access reviews; `audit_log`
coverage auth-only, not hash-chained, no retention/forwarder; DSR is a manual proposed process;
rate limiter fails open on Redis loss; federation DR modeled; rollback advisory; no per-PR
desktop / macOS release CI. Each maps to an owner (§1) and a remediation path in the source
risk register.

## Provenance & scope

- **Real (shipped)**: every control cited — RBAC 57 scopes, PKCE, Argon2id, Ed25519, SSRF
  guard, `audit_log`, `SEED_STORE_ON_BOOT=false`, 0 prod npm-audit vulns — is inventoried with
  `file:line` in `SECURITY-GUIDE.md` and mapped per-vertical in `docs/validation/verticals/*`.
  The data inventory (§4.1) is derived from the real migrations (`0001_init.sql`,
  `0003_organizations.sql`, `0006_connector_accounts.sql`).
- **Proposed (operator-supplied)**: the DSR workflow, the evidence-collection calendar, the
  access-review cadence, and every posture rating are **readiness self-assessment** — to be
  ratified by the operator's own audit. Alerting, hash-chaining, retention/forwarding, and DSR
  tooling are **absent**, not shipped.
- **NOT CERTIFIED — no audit has occurred.** No SOC 2 report, ISO 27001 certificate, privacy
  certification, or third-party attestation exists or is implied anywhere in this document.
  Certification and the organizational controls the platform cannot provide remain the
  deploying organization's responsibility.
