# NeuroPause — Training & Education Program

> A GEAP adoption-enablement deliverable. It organizes the **existing**
> documentation, SDK, CLI, and validation harnesses into role-based curricula,
> hands-on labs, and exam blueprints. It **adds no runtime and no platform** — it
> is a learning map over what already ships. Every objective, lab step, and
> assessment item cites a real asset (`docs/guides/*`, `docs/DEPLOYMENT.md`,
> `packages/sdk`, `packages/cli`, `docs/runtime/PLUGIN-SDK.md`, `docs/validation/*`,
> `bench/*`).
>
> **Maturity anchor:** the platform is a **Validated Release Candidate**
> (`1.0.0-rc.1`, `ENTERPRISE-VALIDATION-REPORT.md`) — not GA. Training sets honest
> expectations, including documented open items (Apple `id_token` JWKS, unsigned
> catalog-app install when the trust store is empty, no macOS release CI).
>
> **Certification note (read first):** Section 6 is **exam-blueprint mapping
> only**. **NeuroPause issues no certification and none is implied.** The
> blueprints map exam domains to real, demonstrable skills so a partner or
> internal academy could _build_ an assessment — the program itself confers no
> credential.

---

## Conventions

| Convention               | Meaning                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| **Objective**            | An observable capability the learner can demonstrate.                         |
| **Module**               | A unit of study anchored to one or more real docs/source files.               |
| **Assessment checklist** | Pass/fail, demonstrable checks — not a graded score.                          |
| **Real tokens**          | Exact commands, endpoints, env vars, and file paths — quoted, never invented. |
| **Lab**                  | A hands-on exercise driven only by shipping commands (Section 7).             |

No learner counts, pass rates, or adoption metrics appear anywhere — this is a curriculum, not a report of outcomes.

---

## 1. Learning paths (role-based overview)

Four tracks, each mapped to a persona segment, real prerequisites, the shipping
assets it draws on, and its capstone lab. Tracks are independent; the **Architect**
track assumes the Operator track as background.

| Track             | Persona segment                               | Prerequisites                   | Primary real assets                                                               | Capstone lab                  |
| ----------------- | --------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| **Administrator** | Org/IT admin at an adopting enterprise        | Account + org; no code          | `ADMINISTRATOR-GUIDE.md`, `SECURITY-GUIDE.md`, `AUTHENTICATION.md`                | Lab 5 (governance + recovery) |
| **Developer**     | Integrator / ISV building on NeuroPause       | Node ≥ 20.11, TypeScript basics | `packages/sdk`, `packages/cli`, `docs/runtime/PLUGIN-SDK.md`, `docs/connectors/*` | Lab 4 + Lab 6                 |
| **Operator**      | SRE / platform engineer running the backend   | Docker + Compose v2, basic K8s  | `DEPLOYMENT.md`, `OPERATIONS-GUIDE.md`, `DISASTER-RECOVERY-GUIDE.md`, `bench/*`   | Lab 2 + Lab 3 + Lab 5         |
| **Architect**     | Solution architect / technical decision-maker | Operator track                  | `docs/validation/REFERENCE-ARCHITECTURES.md`, `docs/federation/*`, EVP reports    | Lab 2 (multi-topology)        |

**Shared foundation (all tracks):** every track opens with
`docs/guides/QUICK-START.md` (the 10-minute tour) and
`docs/guides/INSTALLATION.md` (RC1, macOS Apple Silicon) so learners share
vocabulary — Workspace, Connectors, AI Memory, AI Workforce, Operations →
Recovery/Release. Module ranges (A1–A5, D1–D5, O1–O5, R1–R4) and labs per track
appear in each curriculum below.

---

## 2. Administrator curriculum

**Audience:** org owners and administrators configuring tenancy, identity,
governance, and audit. **Source of truth:** `docs/guides/ADMINISTRATOR-GUIDE.md`
and `docs/guides/SECURITY-GUIDE.md`.

**Objectives — the learner can:**

- Model an organization and assign least-privilege roles from the **57-scope**
  RBAC model.
- Create a custom role and explain why role CRUD is gated by `governance:manage`
  (not `org:manage`).
- Configure identity (OAuth providers, SSO/SCIM/MFA org policy) and read what is
  **real vs modeled**.
- Operate approval chains, compliance rules, and the append-only audit trail.
- Read the compliance scorecard and map it to external control families.

| #   | Module                        | Real anchor                   | Key skills / real tokens                                                                                                                                                 |
| --- | ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Tenancy & the two-layer model | ADMIN §1, §3                  | Cloud tenancy vs Desktop Enterprise-OS; `WHERE org_id = $1` isolation; invite (SHA-256 hash, 7-day expiry)                                                               |
| A2  | RBAC & custom roles           | ADMIN §5                      | 6 built-in roles (`Owner/Admin/Manager/Member/Viewer/AI Worker`); `ALL_ENTERPRISE_PERMISSIONS` (57); role CRUD gated by `governance:manage`; suspend → revoke all        |
| A3  | Identity & access             | ADMIN §6, `AUTHENTICATION.md` | OAuth providers (`GOOGLE_/GITHUB_/MICROSOFT_/APPLE_*`); MFA policy (`totp`,`webauthn`, 7-day grace); **real vs modeled** SSO/SCIM                                        |
| A4  | Governance & compliance       | ADMIN §7–§8                   | 3 approval chains; 6 compliance rules; audit entry `{actor,action,target,summary,at}` capped 2000; scorecard → SOC 2 `CC6.1/CC7.2`, GDPR `Art.32/Art.17`, ISO `A.9/A.12` |
| A5  | Security posture for admins   | `SECURITY-GUIDE.md`           | Fail-closed IPC; Argon2id; OS-keychain secrets; **open items** (Apple JWKS, unsigned install when trust store empty)                                                     |

**Assessment checklist (A):**

- [ ] Creates an org, invites a member with `viewer`, then elevates to a custom role.
- [ ] Names three scopes and the task each unlocks; identifies the `governance:manage` gate.
- [ ] Configures one OAuth provider and states which SSO/SCIM features are **modeled**.
- [ ] Enables an approval chain and locates the resulting audit entries.
- [ ] Lists the documented security open items and their user-facing impact.

---

## 3. Developer curriculum

**Audience:** integrators and ISVs building against the API gateway, CLI, and
plugin/connector surfaces. **Source of truth:** `packages/sdk`, `packages/cli`,
`docs/runtime/PLUGIN-SDK.md`, `docs/connectors/connector-sdk.md`.

**Objectives — the learner can:**

- Authenticate a client and call the Enterprise API through the **official SDK**
  and the **CLI** (one typed front-end over the same gateway).
- Build a publishable `ListingManifest` with the SDK builders and publish a version.
- Sign and verify a webhook payload.
- Scaffold, validate, package, and Ed25519-sign a plugin with the `nps` CLI.
- Explain the connector model (data, not code) and its read-only scope discipline.

| #   | Module                        | Real anchor                              | Key skills / real tokens                                                                                                                                                         |
| --- | ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | SDK fundamentals              | `packages/sdk/src/{client,resources}.ts` | `new NeuroPauseClient({ apiKey, baseUrl })`; resources `marketplace/workers/connectors/usage/billing/oauth/enterprise`; `oauth.token({clientId,clientSecret,scope})`             |
| D2  | Enterprise API via SDK        | `sdk/src/generated/enterprise.ts`        | `enterprise.getModules()`, records CRUD, `getGraphCounts()`, `getTimeline()`, `getSearch()`, `getMetrics()`                                                                      |
| D3  | CLI workflows                 | `packages/cli/src/commands.ts`           | `neuropause login/whoami`, `modules`, `records <id> …`, `graph`, `search`, `diagnostics`, `publish`; env `NEUROPAUSE_API_KEY`, `NEUROPAUSE_BASE_URL`                             |
| D4  | Packages, builders & webhooks | `sdk/src/{builders,webhooks}.ts`         | `defineWorker/defineConnector/definePlugin/defineExtension`; `signWebhook/verifyWebhook` (HMAC-SHA256, `t=…,v1=…`, 5-min tolerance)                                              |
| D5  | Plugins & connectors          | `PLUGIN-SDK.md`, `connector-sdk.md`      | `neuropause.plugin.json`; kinds `background/automation/ai_agent/mcp_server/ui`; 11 host capabilities; `nps` CLI; `ConnectorManifest` (`oauth2_pkce/oauth2_confidential/api_key`) |

**Assessment checklist (D):**

- [ ] Instantiates the SDK client and lists the marketplace (`await np.marketplace.list()`).
- [ ] Runs `neuropause whoami` after `login`, then `neuropause records <moduleId> list`.
- [ ] Produces a manifest with `defineWorker(...)` and calls `marketplace.publishVersion`.
- [ ] Signs a payload with `signWebhook` and verifies it with `verifyWebhook`.
- [ ] Scaffolds a plugin (`nps init`), validates it, packs it, and signs it (Ed25519).
- [ ] Runs the package tests: `npm run test` in `packages/sdk` (15) and `packages/cli` (30).

---

## 4. Operator curriculum

**Audience:** SREs and platform engineers deploying and running the backend.
**Source of truth:** `docs/DEPLOYMENT.md`, `docs/guides/OPERATIONS-GUIDE.md`,
`docs/guides/DISASTER-RECOVERY-GUIDE.md`, `docs/validation/OPERATIONAL-RUNBOOKS.md`.

**Objectives — the learner can:**

- Configure, build, and run the production Compose stack and verify health.
- Wire liveness/readiness probes and scrape `/metrics` with Prometheus.
- Execute the backup/restore scripts and reason about RPO/RTO honestly.
- Work the operational runbooks (Redis down, Postgres down, restart, high latency).
- Explain what the platform does **not** do (alerting, tracing, forecasting, PITR).

| #   | Module                   | Real anchor                  | Key skills / real tokens                                                                                                                                                    |
| --- | ------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | Deploy the backend       | `DEPLOYMENT.md`              | `cp .env.example .env`; `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` (≥32, `openssl rand -hex 32`); `docker compose -f docker-compose.prod.yml up -d --build`                   |
| O2  | Health & migrations      | `DEPLOYMENT.md` §3–§4        | `/live` (no deps) vs `/health` (200/503); migrate step `node dist/db/migrate.js`; `RUN_MIGRATIONS_ON_BOOT=false` for multi-replica                                          |
| O3  | Observability            | `OPERATIONS-GUIDE.md`        | `/metrics` series `neuropause_backend_up`, `…_pg_pool_connections{state}`, `…_http_requests_total{method,status}`; **no latency histogram**; pino redaction; support bundle |
| O4  | Backup, restore & DR     | `DISASTER-RECOVERY-GUIDE.md` | `scripts/backup-db.sh` (gzip `pg_dump`, keep 14); `scripts/restore-db.sh <file>` (`ON_ERROR_STOP=1`); Recovery Center 8 actions; forward-only migrations                    |
| O5  | Runbooks & incident flow | `OPERATIONAL-RUNBOOKS.md`    | Detect→Triage→Contain→Collect→Recover; redis-down fail-open (`/health` degraded); db-down auto-reconnect; scale via HPA                                                     |

**Assessment checklist (O):**

- [ ] Boots the prod stack and gets `200` from `/live` and `/health`.
- [ ] Scrapes `/metrics` and identifies `neuropause_pg_pool_connections{state="waiting"}`.
- [ ] Runs `scripts/backup-db.sh`, then restores into a scratch DB and verifies row counts.
- [ ] Simulates Redis down, confirms `/health` degrades but reads still serve `200`.
- [ ] States the backend RPO ("age of the last operator-run dump") and names one absent control (PITR).

---

## 5. Architect curriculum

**Audience:** solution architects sizing and justifying deployments. **Source of
truth:** `docs/validation/REFERENCE-ARCHITECTURES.md`,
`docs/validation/PERFORMANCE-BENCHMARKS.md`, `docs/federation/*`, EVP reports.

**Objectives — the learner can:**

- Select among the three validated reference architectures and justify the choice.
- Read the EVP evidence (benchmarks, reliability) and cite it without inflation.
- Explain federation as a **single-node, in-process model** and its extension seams.
- Map capacity envelopes and the honest **real vs modeled** boundary for buyers.

| #   | Module                        | Real anchor                                            | Key skills / real tokens                                                                                                                                                      |
| --- | ----------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Reference architectures       | `REFERENCE-ARCHITECTURES.md`                           | Single-node (`docker-compose.prod.yml`, replicas 1, loopback); K8s + managed HA (replicas 2, HPA min2/max6@70%, `maxUnavailable:0`); air-gapped offline bundle (**PARTIAL**)  |
| R2  | Evidence for decisions        | `PERFORMANCE-BENCHMARKS.md`, `bench/results/*`         | Cold start `0.66s`; HTTP load conc 32, 24,000 req, 0 errors; DB p50 ~`0.23ms`; **cite the artifact or it does not exist**                                                     |
| R3  | Federation & governance       | `docs/federation/*`                                    | Phase 9·2 in-process model; Ed25519 org exchange; most-restrictive governance; capacity envelopes (orgs 50→500, events 2k→10k/s, nodes 5k→100k)                               |
| R4  | Scaling & the honest boundary | `REFERENCE-ARCHITECTURES.md`, `RELIABILITY-RESULTS.md` | Extension seams (Postgres/Redis adapter, JWKS validator, queue+workers); modeled-only: multi-region DR, blue-green, PITR; federation DR targets are **modeled, not achieved** |

**Assessment checklist (R):**

- [ ] Recommends an architecture for a given constraint and cites the deciding property.
- [ ] Quotes two EVP numbers with their `bench/results/*.json` source file.
- [ ] Explains why federation DR (`RPO 300s / RTO 900s`) must not be presented as achieved.
- [ ] Lists three extension seams that would turn the model into true multi-node scale.

---

## 6. Certification preparation (mapping only)

> **This is not a certification.** NeuroPause **issues no credential**, and nothing
> here should be represented as one. The tables below are **exam blueprints** — a
> control-mapping from candidate exam domains to real, demonstrable skills and the
> shipping asset that proves each. A partner academy or internal enablement team
> could use them to _build_ an assessment; the mapping alone confers nothing. This
> follows the GEAP rule that all certification content is roadmap/exam-preparation
> framing (`ADOPTION-MATRICES.md`, Partner Readiness row: "**Gap (mapping)**").

Each blueprint is: **domain → weight → mapped real skill → evidence asset → lab**.
Weights are planning proportions for a hypothetical exam, not scores.

**NPA — NeuroPause Administrator (blueprint, not a cert)**

| Domain             | Weight | Mapped skill                             | Evidence asset                 | Lab   |
| ------------------ | ------ | ---------------------------------------- | ------------------------------ | ----- |
| Tenancy & RBAC     | 30%    | Model org, assign 57-scope roles         | `ADMINISTRATOR-GUIDE.md` §3,§5 | Lab 5 |
| Identity & access  | 20%    | Configure OAuth/MFA; real-vs-modeled SSO | ADMIN §6, `AUTHENTICATION.md`  | —     |
| Governance & audit | 30%    | Approval chains, compliance rules, audit | ADMIN §7–§8                    | Lab 5 |
| Security posture   | 20%    | Fail-closed IPC, secrets, open items     | `SECURITY-GUIDE.md`            | —     |

**NPD — NeuroPause Developer (blueprint, not a cert)**

| Domain               | Weight | Mapped skill                          | Evidence asset                      | Lab   |
| -------------------- | ------ | ------------------------------------- | ----------------------------------- | ----- |
| SDK & auth           | 30%    | Client, OAuth token, enterprise calls | `packages/sdk/src/*`                | Lab 4 |
| CLI proficiency      | 20%    | Records, graph, search, publish       | `packages/cli/src/commands.ts`      | Lab 4 |
| Packages & webhooks  | 25%    | Builders, `sign/verifyWebhook`        | `sdk/src/{builders,webhooks}.ts`    | Lab 4 |
| Plugins & connectors | 25%    | `nps` lifecycle + Ed25519 signing     | `PLUGIN-SDK.md`, `connector-sdk.md` | Lab 6 |

**NPO — NeuroPause Operator (blueprint, not a cert)**

| Domain             | Weight | Mapped skill                      | Evidence asset               | Lab   |
| ------------------ | ------ | --------------------------------- | ---------------------------- | ----- |
| Deploy & configure | 25%    | Compose/K8s/Helm, config contract | `DEPLOYMENT.md`, `deploy/*`  | Lab 2 |
| Observe            | 20%    | Probes, `/metrics`, logs, bundle  | `OPERATIONS-GUIDE.md`        | Lab 3 |
| Backup & DR        | 30%    | Backup/restore, RPO/RTO, Recovery | `DISASTER-RECOVERY-GUIDE.md` | Lab 5 |
| Runbooks           | 25%    | Redis/PG down, restart, latency   | `OPERATIONAL-RUNBOOKS.md`    | Lab 5 |

**NPAR — NeuroPause Architect (blueprint, not a cert)**

| Domain                  | Weight | Mapped skill               | Evidence asset                         | Lab   |
| ----------------------- | ------ | -------------------------- | -------------------------------------- | ----- |
| Reference architectures | 30%    | Select & justify topology  | `REFERENCE-ARCHITECTURES.md`           | Lab 2 |
| Evidence literacy       | 25%    | Cite EVP without inflation | `PERFORMANCE-BENCHMARKS.md`, `bench/*` | Lab 3 |
| Federation              | 25%    | In-process model + seams   | `docs/federation/*`                    | —     |
| Honest boundary         | 20%    | Real vs modeled for buyers | EVP reports                            | —     |

**Blueprint integrity rules:** every exam item must map to a demonstrable skill on
a real asset; no item may assert a capability the code labels modeled; candidates
are taught the open items (Apple JWKS, unsigned install, no macOS CI) as first-class content, not footnotes.

---

## 7. Hands-on labs

All commands are **real and shipping** — from `package.json`, `docs/DEPLOYMENT.md`,
`bench/*`, the SDK/CLI, and the `nps` tool; nothing here is invented tooling. Run from the repository root unless noted. Prereqs: Node ≥ 20.11, Docker + Compose v2.

### Lab 1 — Install, migrate, and verify (Foundations)

**Objective:** stand up local infrastructure and a migrated backend.
**Steps:**

```
npm install
npm run infra:up                       # docker compose up -d (postgres:16, redis:7, …)
cp .env.example apps/backend/.env      # set JWT_ACCESS_SECRET via: openssl rand -base64 48
npm run db:migrate                     # applies the 12 forward-only migrations
npm run dev:backend                    # boots the API on :4000
```

**Verification:**

```
curl -fsS http://127.0.0.1:4000/live
curl -fsS http://127.0.0.1:4000/health
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM applications"   # after seeding
```

- [ ] `/live` and `/health` both return `200`; `/health` shows database + redis up.

### Lab 2 — Deploy the backend (Operator/Architect)

**Objective:** run the production stack, then render the Kubernetes/Helm path.
**Steps (Compose):**

```
cp .env.example .env                   # POSTGRES_PASSWORD + JWT_ACCESS_SECRET (≥32)
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

**Steps (K8s/Helm render — validate before applying):**

```
helm lint deploy/helm/neuropause-backend
helm template np deploy/helm/neuropause-backend > /tmp/chart-rendered.yaml
kubeconform -strict -summary -kubernetes-version 1.29.0 deploy/kubernetes/backend.yaml deploy/kubernetes/optional.yaml
```

**Verification:**

- [ ] `docker compose … ps` shows backend healthy; `/health` returns `200`.
- [ ] `kubeconform` reports a strict PASS for both manifests.

### Lab 3 — Run a benchmark (Operator/Architect)

**Objective:** reproduce EVP evidence with the shipping harnesses.
**Steps:**

```
bash bench/startup.sh                                            # writes bench/results/startup.json
node bench/http-load.mjs --base http://127.0.0.1:4000 --conc 32 --reqs 3000 --warmup 300
DATABASE_URL="$DATABASE_URL" node bench/db-latency.mjs --iters 2000
```

**Verification (compare to `docs/validation/PERFORMANCE-BENCHMARKS.md`):**

- [ ] Cold-start-to-healthy is on the order of `~0.6s` on a comparable host.
- [ ] HTTP load completes with `0` errors; DB p50 is sub-millisecond.
- [ ] Learner states the cardinal rule: _a number without a committed artifact does not exist._

### Lab 4 — Use the SDK and CLI (Developer)

**Objective:** authenticate and drive the Enterprise API two ways.
**Steps (CLI):**

```
export NEUROPAUSE_BASE_URL=http://127.0.0.1:4000
neuropause login --client-id "$ID" --client-secret "$SECRET" --scope "marketplace:read"
neuropause whoami
neuropause modules
neuropause marketplace list
```

**Steps (SDK, TypeScript):**

```ts
import { NeuroPauseClient, defineWorker, signWebhook } from '@neuropause/sdk';
const np = new NeuroPauseClient({
  apiKey: process.env.NEUROPAUSE_API_KEY,
  baseUrl: process.env.NEUROPAUSE_BASE_URL,
});
const listings = await np.marketplace.list();
const worker = defineWorker({
  name: 'Digest',
  version: '0.1.0',
  entry: 'index.js',
  role: 'research',
});
```

**Verification:**

- [ ] `neuropause whoami` prints the active identity + scopes.
- [ ] SDK call returns a typed listing array; `defineWorker(...).toManifest()` validates.
- [ ] `npm run test` passes in `packages/sdk` and `packages/cli`.

### Lab 5 — Reliability drill (Operator/Administrator)

**Objective:** prove recovery works before you need it.
**Steps:**

```
scripts/backup-db.sh                                            # timestamped gzip pg_dump → ./backups
docker compose -f docker-compose.prod.yml stop redis           # simulate Redis down
curl -s http://127.0.0.1:4000/health                           # expect degraded, redis:down
docker compose -f docker-compose.prod.yml start redis
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz   # into a scratch env
```

**Verification (against `DISASTER-RECOVERY-GUIDE.md` / `OPERATIONAL-RUNBOOKS.md`):**

- [ ] Reads still serve `200` while Redis is down (fail-open), no crash.
- [ ] Restore reports success; row counts match (applications/versions/categories).
- [ ] Learner states desktop RPO (up to 24h) vs backend RPO (age of last dump).

### Lab 6 — Build and sign a plugin (Developer)

**Objective:** scaffold, validate, package, and Ed25519-sign a plugin.
**Steps:**

```
npm run nps -- init my-plugin
npm run nps -- validate my-plugin
npm run nps -- pack my-plugin -o my-plugin.npkg
npm run nps -- keygen -o my-key
npm run nps -- sign my-plugin.npkg -k my-key.pem
```

**Verification (against `docs/runtime/PLUGIN-SDK.md`):**

- [ ] `validate` passes the manifest (`neuropause.plugin.json`, valid `kind`, `engine`).
- [ ] `pack` emits the `.npkg` + sha256 sidecar; `sign` prints a key id.
- [ ] Learner explains the empty trust store is an admin-registered store (open item).

---

## 8. Workshop material (facilitator outline)

A two-day, instructor-led format that threads the four tracks through the six
labs. Every session ends with the track's assessment checklist. **No outcomes or
attendance numbers are promised** — this is an agenda, not a report.

**Facilitator prep (before Day 1):**

- Provision one lab host per pair: Node ≥ 20.11, Docker + Compose v2, repo cloned.
- Pre-pull images to de-risk `infra:up` (`postgres:16-alpine`, `redis:7-alpine`).
- Set each pair's `apps/backend/.env` (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`).
- Print the relevant checklist(s) (A/D/O/R) and the open-items sheet (Apple JWKS, unsigned install, no macOS CI).
- Stage links to `docs/adoption/ADOPTION-MATRICES.md` and the four anchor guides.

| Day  | Session                    | Track focus            | Anchor                                 | Lab          |
| ---- | -------------------------- | ---------------------- | -------------------------------------- | ------------ |
| 1 AM | Foundations + orientation  | All                    | Quick Start, Installation              | Lab 1        |
| 1 PM | Deploy & observe           | Operator/Architect     | `DEPLOYMENT.md`, `OPERATIONS-GUIDE.md` | Lab 2, Lab 3 |
| 2 AM | Build on the platform      | Developer              | SDK/CLI, `PLUGIN-SDK.md`               | Lab 4, Lab 6 |
| 2 PM | Govern & recover           | Administrator/Operator | ADMIN + `DISASTER-RECOVERY-GUIDE.md`   | Lab 5        |
| 2 PM | Wrap: blueprints & honesty | All                    | Section 6, EVP reports                 | —            |

**Per-session structure (60–90 min):** (1) 10-min concept from the anchor doc →
(2) live demo of the real commands → (3) paired lab → (4) checklist review →
(5) "what's modeled vs real" debrief.

**Facilitator talking points (non-negotiable):**

- The platform is a **Validated Release Candidate**, not GA — say so.
- Every benchmark shown must be tied to a `bench/results/*.json` artifact.
- Section 6 is a **blueprint, not a certification** — repeat it when asked.
- Teach the open items as content, not caveats to hide.

---

_This program maps existing NeuroPause assets into learning paths. It creates no
new runtime, promises no outcomes, and issues no certification. Where this document and a shipping doc disagree, the shipping doc wins._
