# NeuroPause EOSP — Global Scaling & Regional Operations Manual

> **What this is.** The **execution** manual for the Enterprise Operations & Scale Program
> (EOSP) covering how NeuroPause is stood up **per region**, how localization is planned,
> how multi-region operations _would_ run, and how global support is structured. It adds
> **no runtime and no platform** — roles, cadences, checklists, and decision rules over the
> **real** deploy assets (`deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`,
> `scripts/build-offline-bundle.sh`) and the **measured** coefficients in `_grounding.md`.
>
> **Honesty banner (non-negotiable).** The **validated** topologies are **single-node,
> Kubernetes + managed datastores, and offline/air-gapped** — each is **single-region**
> (`REFERENCE-ARCHITECTURES.md`; `deploy/README.md:83`–`:90`). **Multi-region / regional
> federation is PROPOSED**, not shipped; **federation DR is MODELED** (a data model in
> `apps/desktop/src/main/federation/dr/drStore.ts`, no second cluster, no cross-region
> replication — `DISASTER-RECOVERY-GUIDE.md §7.1`). The UI is **not internationalized today**
> (§2). No region is claimed "live"; **no latency-by-region, uptime, or throughput-per-region
> value is asserted** — per-region capacity is a **projection from the measured 2-vCPU floor**.
> Everything here is **roles, not people**. Peers: `SRE.md` (reliability/capacity),
> `CUSTOMER-SUCCESS.md` §8–§9 (support/escalation/SLA framework).

---

## 1. Regional deployments

A **region** in NeuroPause is not a product feature — it is **one independent single-region
deployment** of a validated topology, standing on its own cluster (or host) with its own
managed datastores in a chosen jurisdiction. Standing up a region is the **existing**
`kubectl` / `helm` / offline flow, **parameterized per region**. Nothing new is built; the
region boundary is the **cluster + managed-datastore + ingress** boundary.

### 1.1 Region building blocks (validated — real assets only)

| Building block                                                 | Real asset                                                                 | Per-region note                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Namespace / ConfigMap / migrate Job / Deployment / Service     | `deploy/kubernetes/backend.yaml`                                           | `neuropause` namespace **per cluster**; isolation is at the cluster + datastore boundary, not namespace |
| HPA (min 2 / max 6 @ 70 % CPU) + Ingress (nginx, TLS)          | `deploy/kubernetes/optional.yaml`                                          | Ingress host is the **per-region** value (e.g. `api.<region>.neuropause.example`)                       |
| Parameterized chart (8 templates)                              | `deploy/helm/neuropause-backend/`                                          | Per-region overrides via `--set` (`values.yaml`); one release per region                                |
| Secret (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` ≥ 32) | `deploy/kubernetes/secret.example.yaml`                                    | Points at **in-region managed, HA** Postgres/Redis — created out-of-band                                |
| Gated forward-only migration                                   | `templates/migrate-job.yaml` (`node dist/db/migrate.js`, `backoffLimit 3`) | Runs once per region before pods serve; a bad migration **fails the region's rollout**                  |
| Air-gapped / sovereign bundle                                  | `scripts/build-offline-bundle.sh`                                          | For data-sovereign or disconnected regions (Gov/Healthcare/Financial overlays)                          |

**Config contract, identical in every region** (`REFERENCE-ARCHITECTURES.md`): the backend
refuses to start without `DATABASE_URL`, `REDIS_URL`, and `JWT_ACCESS_SECRET`; every region
sets `RUN_MIGRATIONS_ON_BOOT=false` and `SEED_STORE_ON_BOOT=false`. Only **`PUBLIC_BACKEND_URL`,
the ingress host, and the datastore endpoints** differ per region — everything else (image,
non-root uid 1001 hardening, `/live`/`/health` probes, `maxUnavailable: 0` rollout) is common.

### 1.2 Single-region VALIDATED vs multi-region PROPOSED

| Property          | Single-region (VALIDATED)                                                                              | Multi-region (PROPOSED — §3)                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Topology          | Compose / K8s+managed / air-gapped                                                                     | N of the above, one per region                                  |
| Validation status | Compose real; K8s kubeconform **strict PASS** (k8s 1.29); offline shellcheck CLEAN (save/load PARTIAL) | **Not validated** — no second cluster exists                    |
| Datastores        | In-region managed / HA (K8s) or on-host (Compose/offline)                                              | Per-region isolated; cross-region replication **not shipped**   |
| Routing           | Single ingress + DNS                                                                                   | Global routing tier **proposed** (§3.1)                         |
| DR                | Per-region backups + managed-PG PITR (real)                                                            | Federation DR **MODELED** only (§3.3)                           |
| Failover          | Manual, in-region (runbooks)                                                                           | **Not a capability** — do not present federation DR as failover |

### 1.3 Data residency considerations

Residency is a **placement discipline**, not a product control. Because there is **no
cross-region replication today**, single-region placement is itself the strongest residency
guarantee: data does not leave the region unless an operator moves it.

| Data plane                    | Where it lives                                    | Residency lever                                                                | Honest caveat                                                           |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Desktop client data           | On the user's device (local-first Electron)       | Device jurisdiction; nothing leaves the device unless the backend is connected | Local-first by default (`OPERATIONS-GUIDE.md`)                          |
| System of record              | In-region **managed Postgres** via `DATABASE_URL` | Provision the managed DB **in the target jurisdiction**                        | Backups are single-host by default unless off-host storage is in-region |
| OAuth-flow / rate-limit state | In-region **managed Redis** via `REDIS_URL`       | Provision Redis in-region                                                      | Rate limiter **fails open** on Redis loss (`_grounding.md`)             |
| Audit trail                   | `audit_log` table (in Postgres)                   | Follows Postgres residency                                                     | Append-only; export stays in-region                                     |
| Telemetry                     | `/metrics` scrape (in-cluster)                    | Keep scrape in-region; network-restrict `/metrics`                             | Unauthenticated by design — `NetworkPolicy` per region                  |
| Identity brokering            | External IdPs (Google/GitHub/Microsoft/Apple)     | **Outside residency control** — traffic egresses to the IdP                    | Microsoft directory via `MICROSOFT_TENANT`; document as a known egress  |

**Rule.** A residency claim is only as strong as the **weakest in-region placement** — pin the
managed datastores, backup target, and scrape endpoint to the jurisdiction, and treat IdP
brokering as a declared external egress. Any future cross-region replication (§3.2) **re-opens**
this review.

### 1.4 Region bring-up checklist (real commands)

Cloud region (Kubernetes + managed datastores — the horizontally-scalable shape):

- [ ] **Build & push** the image to the region's registry:
      `docker build -f apps/backend/Dockerfile -t <registry>/neuropause-backend:<tag> .`
- [ ] **Provision in-region managed Postgres + Redis** (HA/PITR); capture their endpoints.
- [ ] **Create the Secret out-of-band** (never commit real values):
      `kubectl -n neuropause create secret generic neuropause-backend-secrets \`
      `  --from-literal=DATABASE_URL='postgresql://user:pass@<in-region-pg>:5432/neuropause' \`
      `  --from-literal=REDIS_URL='redis://<in-region-redis>:6379' \`
      `  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)"`
- [ ] **Install the chart with per-region overrides**:
      `helm install np-<region> deploy/helm/neuropause-backend \`
      `  --namespace neuropause --create-namespace \`
      `  --set image.repository=<registry>/neuropause-backend --set image.tag=<tag> \`
      `  --set existingSecret=neuropause-backend-secrets \`
      `  --set config.PUBLIC_BACKEND_URL=https://api.<region>.neuropause.example \`
      `  --set ingress.enabled=true --set ingress.host=api.<region>.neuropause.example \`
      `  --set autoscaling.enabled=true`
- [ ] **Confirm the migrate Job succeeded** before trusting the rollout (`kubectl -n neuropause get jobs`).
- [ ] **Watch the rollout** — Helm prints the exact command in `NOTES.txt`
      (`kubectl -n neuropause rollout status deploy/np-<region>-neuropause-backend`).
- [ ] **Probe the region**: `curl -fsS https://api.<region>.neuropause.example/live` and `…/health`
      (expect `200` with `components.database`/`.redis` up).
- [ ] **Wire per-region observability**: point the in-region Prometheus at pod `/metrics`; add a
      `/health` blackbox probe (`SRE.md §2`); apply a `NetworkPolicy` restricting `/metrics`.
- [ ] **Schedule per-region backups** (`scripts/backup-db.sh` via cron/systemd) with an **in-region**
      off-host target; drill `scripts/restore-db.sh` into a scratch env (`DISASTER-RECOVERY-GUIDE.md §3`).

Sovereign / air-gapped region (disconnected or strict-residency):

- [ ] **Build the bundle** on a connected host: `scripts/build-offline-bundle.sh neuropause-backend:1.0.0`
      → `dist/offline-bundle/neuropause-offline-*.tar.gz`.
- [ ] **Transfer on physical media** to the in-region isolated host; extract.
- [ ] **Create `.env`** (`POSTGRES_PASSWORD` + `JWT_ACCESS_SECRET` ≥ 32) and run `./load-and-run.sh`.
- [ ] **Probe** `/live` and `/health` on loopback `:4000`; keep the same in-region backup discipline
      (single-host bundle is **not HA** — `REFERENCE-ARCHITECTURES.md` Arch 3).

---

## 2. Localization roadmap

### 2.1 Current i18n reality (honest — the UI is NOT internationalized)

A direct read of the codebase (both `apps/backend` and `apps/desktop/renderer`) shows there is
**no internationalization layer today**. This is stated plainly so no roadmap item is mistaken
for a shipped capability.

| Capability                                                       | Status today             | Evidence                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| i18n framework (i18next / react-intl / formatjs / lingui)        | **Absent**               | No such dependency in any `package.json`                                                                                                                                         |
| Translation catalogs (`locales/`, `.po`/`.pot`, `messages.json`) | **Absent**               | No catalog files anywhere in the tree                                                                                                                                            |
| Language selector / persisted locale / locale provider           | **Absent**               | No locale state in `renderer/src/providers`; no `changeLanguage`                                                                                                                 |
| Externalized UI strings                                          | **Absent**               | Copy is hardcoded inline in components/JSX                                                                                                                                       |
| Localized API messages                                           | **Absent**               | Backend throws **English** strings (e.g. `'An account with this email already exists'`); 38+ hardcoded error sites                                                               |
| Content negotiation (`Accept-Language` / `Content-Language`)     | **Absent**               | Backend performs no language negotiation                                                                                                                                         |
| RTL / bidi (`dir="rtl"`, mirrored layout)                        | **Absent**               | No `dir`/RTL handling in the renderer                                                                                                                                            |
| Locale-aware **number/date/currency formatting**                 | **Partial (incidental)** | `Intl.NumberFormat(undefined, …)` and `.toLocaleString()` in `store/lib.ts`, `developer/lib.ts`, `lib/format.ts` — keyed to the **host default locale**, one spot pins `'en-US'` |

**Net:** NeuroPause is an **English-only product**. The only locale-awareness is _incidental
formatting_ (numbers/dates/currency adapt to the operator's host locale via `Intl`) — it is
**not** localization of content. Treat i18n as **roadmap**, never as a present feature.

### 2.2 Phased localization roadmap (proposed)

Each phase is a discrete, testable increment. No phase is committed or dated here — the ladder
sets sequence and exit gates; scheduling is an org decision.

| Phase                       | Objective                             | Concrete work                                                                                                              | Exit gate                                                          |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **P0 — Baseline (today)**   | State reality honestly                | Confirm English-only; keep incidental `Intl` formatting                                                                    | This table published; no i18n claimed                              |
| **P1 — Externalize**        | Make strings translatable             | Add an i18n framework; extract renderer + backend copy into a default (`en`) catalog; add a string-extraction lint gate    | 0 hardcoded user-facing strings in new code; `en` catalog complete |
| **P2 — Locale plumbing**    | Let a locale be chosen and remembered | Language selector; persisted locale; wire backend `Accept-Language`/`Content-Language`; move error copy to keys            | A second (pseudo-)locale round-trips end-to-end                    |
| **P3 — Translate & format** | Ship real locales                     | Translate priority catalogs; standardize `Intl` number/date/currency on the **selected** locale (retire the `'en-US'` pin) | ≥1 real target locale passes UI review                             |
| **P4 — RTL & locale ops**   | Full bidi + sustainment               | RTL/mirroring; locale QA in CI; translation-update cadence tied to the release calendar                                    | RTL locale renders correctly; catalog updates gated per release    |

### 2.3 Honest guardrails

- **Formatting ≠ localization.** Numbers rendering in a local format does **not** mean the UI is
  translated. Do not let the incidental `Intl` behaviour imply i18n support.
- **Residency ≠ language.** Standing up a region (§1) localizes **data placement**, not the
  interface — a region is English-only until the P-ladder lands.
- **Backend copy counts.** API error strings are user-visible; P1/P2 must cover the backend, not
  just the renderer.

---

## 3. Multi-region operations (PROPOSED)

> **PROPOSED / MODELED — NOT SHIPPED.** Everything in §3 describes how multi-region _would_
> operate. There is **no second cluster, no cross-region replication, and no failover** in the
> repository (`deploy/README.md:85`–`:87`; `DISASTER-RECOVERY-GUIDE.md §7.1`). The section is
> grounded in the **real single-region assets** (§1) composed N times, plus **external**
> infrastructure the repo does not ship. No region is "live"; no per-region latency/uptime is
> claimed.

### 3.1 Routing (proposed)

Compose the validated single-region ingresses behind a **global routing tier** the repo does not
ship: authoritative DNS (optionally GeoDNS/latency or geo steering) → a global load-balancer →
each region's existing nginx **Ingress** (`optional.yaml`) → `Service :80` → pods `:4000`. Each
region keeps its own `PUBLIC_BACKEND_URL` and TLS secret (§1.1). Health-based steering uses each
region's real `/health` (200 vs 503). **Sticky routing to the home region is required** while
there is no cross-region data replication (§3.2) — a request served from a region without the
user's data would fail, so routing must not fan a user across regions.

### 3.2 Data replication considerations (proposed)

The application layer is **stateless** and scales horizontally within a region (`SRE.md §6`), so
the multi-region problem is **entirely a datastore problem**, and the datastores are **external
managed services** — not something these manifests replicate.

| Concern               | Reality today                          | Proposed path (external infra)                                                                                           |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Postgres cross-region | Single in-region managed DB per region | Managed **cross-region read replica** or logical replication — a managed-DB capability, tested failover; **not in-repo** |
| Redis cross-region    | In-region only; fail-open on loss      | In-region only (OAuth-flow/rate-limit state is ephemeral) — do **not** stretch Redis across regions                      |
| Write ownership       | Single writer per region               | **Single home-region writer** per tenant; avoid multi-master (conflict + residency risk)                                 |
| Residency impact      | No data leaves region (§1.3)           | Any replica **re-opens the §1.3 residency review** for the destination jurisdiction                                      |
| Migrations            | Gated Job per region                   | Run the migrate Job **per region**; schema drift between regions is an incident                                          |

**Decision rule.** Pursue cross-region continuity **in infrastructure** (replicated managed
Postgres + tested failover), never by presenting the modeled federation DR screen as replication.

### 3.3 DR posture — federation DR is MODELED, real DR is per-region

| Layer                                 | Status      | What it actually is                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Federation "Disaster Recovery" module | **MODELED** | `drStore.ts`: metadata records, decrementing lag counters, sandbox validations. **No bytes copied, no second cluster.** Target **RPO 300 s / RTO 900 s are modeled, not measured** (`DISASTER-RECOVERY-GUIDE.md §6`, §7.1). Fresh prod install defaults HA + multi-region **OFF** |
| Per-region backup/restore             | **REAL**    | `scripts/backup-db.sh` / `restore-db.sh` (proven pg_dump→restore, exact row match); managed-PG **PITR** where enabled                                                                                                                                                             |
| Rolling update                        | **REAL**    | `maxUnavailable: 0` + `/health` readiness = zero-downtime in-region deploys                                                                                                                                                                                                       |
| Cross-region failover                 | **ABSENT**  | Not a capability; requires the §3.1–§3.2 external infra first                                                                                                                                                                                                                     |

**Posture statement.** Until real cross-region infrastructure exists and is **drill-tested**, the
DR posture is **per-region**: in-region backups, managed-PG PITR, and the runbooks in
`OPERATIONAL-RUNBOOKS.md`. The federation DR screen is a **model** and must never appear in a DR
plan or an availability claim (`SRE.md §5`, caveat 3).

### 3.4 Per-region capacity (projections from the measured floor)

Per-region sizing is the **same arithmetic** as `SRE.md §6`, applied to each region's **own**
projected peak — reference that section for the full method; this is the per-region summary. Every
number is a **projection from the 2-vCPU reference measurement** (a conservative floor, so real
headroom is higher), never a per-region measurement.

| Measured coefficient (`_grounding.md`) | Value                                   | Per-region sizing use                                         |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| DB-backed read floor                   | **400–600 rps/replica** (blend **500**) | `replicas_serving = ceil(region_peak_rps / 500)`; add **N+1** |
| RSS under load                         | **≈ 230 MB/replica**                    | region RAM ≈ `replicas × 230 MB`; keep `limits.memory` 512Mi  |
| pg pool per replica                    | **auto-scales 1 → 10**                  | region DB connections ≈ `replicas × 10` + ~20 reserve         |
| Argon2id verify                        | **~50 verifies/s/core**                 | size **auth separately**: `ceil(region_logins_s / 50)`        |
| Restart → healthy                      | **0.46 s**                              | per-region recycle/rollout budget                             |

**Worked per-region example (projection).** A region peaking at **1,000 rps** of store reads and
**100 logins/s**: `ceil(1000/500)=2` read replicas; `ceil(100/50)=2` auth cores → `max(2,2)+1 = 3
replicas`; DB connections ≈ `3×10+20 = 50` (default Postgres `max_connections=100` suffices). The
shipped HPA (min 2 / max 6 @ 70 % CPU) **brackets** this, but its live scale-up under load is
**not measured** (`SRE.md §5`) — provision the steady-state count explicitly per region.

---

## 4. Global support model (follow-the-sun)

Follow-the-sun is expressed as **coverage windows and roles**, tied to the EOSP **support-org
manual** — the operations-program peer that extends `CUSTOMER-SUCCESS.md` §8 (severity → routing →
SLA framework) and §9 (support tiers). It **reuses**, does not restate, the SRE on-call model
(`SRE.md §1`) for incident execution. **Roles, not people**; no site is claimed staffed or live.

### 4.1 Coverage windows (a staffing template — roles, not people)

Three ~8-hour coverage cells hand the pager around the clock. The cells below are **longitude
bands in a staffing template**, **not** a claim that NeuroPause operates staffed sites in these
regions — an org staffs whichever cells its footprint supports.

| Coverage cell                   | Clock window (illustrative) | Primary role held                     | Hands off to |
| ------------------------------- | --------------------------- | ------------------------------------- | ------------ |
| **Cell A** (Asia-Pacific band)  | ~00:00–08:00 UTC            | Primary on-call (IC-eng) + Support L1 | Cell B       |
| **Cell B** (Europe/Africa band) | ~08:00–16:00 UTC            | Primary on-call + Support L1          | Cell C       |
| **Cell C** (Americas band)      | ~16:00–24:00 UTC            | Primary on-call + Support L1          | Cell A       |

Each cell fields the **same role set** (`SRE.md` on-call: Primary, Secondary/backup, Incident
Commander as a _hat_, Comms/Scribe) plus the support tiers from `CUSTOMER-SUCCESS.md §9`
(Community / Standard / Enterprise / Security). Coverage is **contiguous**: the active cell always
holds the pager; there is never a gap or an overlap owner.

### 4.2 Handoff cadence

At each cell boundary the outgoing Primary runs the **SRE handoff checklist** (`SRE.md §1`), not a
freeform note:

- [ ] Open incidents + current severity and owner.
- [ ] Error-budget burn state (`SRE.md §4`) and any active burn-rate alert.
- [ ] Any dependency running degraded (Redis fail-open / Postgres reconnecting) **per region**.
- [ ] Pending DR drill or maintenance window (`OPERATIONAL-RUNBOOKS.md` Runbook 5).
- [ ] Open enterprise support tickets above L1 and their SLA-clock state (`CUSTOMER-SUCCESS.md §8`).

Handoffs are logged to the incident timeline (`audit_log` narrative). A **weekly** Primary/Secondary
rotation per cell is the proposed default (`SRE.md §1`), tuned to headcount.

### 4.3 Escalation bridge (support ↔ SRE, per region)

Support tiers and incident on-call are **one escalation spine**, not two — the support-org manual
owns customer-facing routing/SLA, `SRE.md` owns incident command; the follow-the-sun cell is where
they meet.

| Signal / ticket                            | Owner (cell)                      | Bridges to                                         | Grounded in                           |
| ------------------------------------------ | --------------------------------- | -------------------------------------------------- | ------------------------------------- |
| S1 — backend down / data-loss risk         | Active-cell Primary + IC          | SEV1 incident (SRE) + vendor security if integrity | `CUSTOMER-SUCCESS.md §8`; `SRE.md §1` |
| S2 — major degradation (Redis/DB degraded) | Active-cell Primary               | SEV2 runbook (Runbook 1/4)                         | `OPERATIONAL-RUNBOOKS.md`             |
| S3 — localized/desktop issue               | Support L1 (support bundle)       | Next-cell backlog if unresolved                    | `CUSTOMER-SUCCESS.md §8`              |
| S4 — question / cosmetic                   | Support queue                     | —                                                  | `CUSTOMER-SUCCESS.md §9`              |
| **Sec** — suspected vulnerability          | Any cell → **private** disclosure | `SECURITY.md` path exclusively                     | root `SECURITY.md`                    |

**One real commitment, honestly.** The only **published** response commitment NeuroPause makes
today is the security-disclosure acknowledgment in `SECURITY.md` ("acknowledge within a few
business days"). Every other response target in the support tiers is a **framework to populate in
the enterprise agreement**, not an achieved SLA (`CUSTOMER-SUCCESS.md §8`–§9).

---

## Provenance & scope

- **Validated (real):** single-region topologies and their deploy assets — `deploy/kubernetes/*`,
  `deploy/helm/neuropause-backend/*`, `scripts/build-offline-bundle.sh`, `REFERENCE-ARCHITECTURES.md`,
  `deploy/README.md`. **Measured (real):** capacity coefficients — `_grounding.md`, `bench/results/*`.
- **Confirmed reality (code-read):** the UI is **not internationalized** (§2.1) — no i18n framework,
  catalogs, selector, or content negotiation; English-only copy with incidental `Intl` formatting.
- **Proposed (not shipped):** all multi-region routing, cross-region replication, per-region capacity
  projections, and the localization roadmap. **Modeled (not measured):** federation DR and its
  RPO/RTO — `DISASTER-RECOVERY-GUIDE.md §7.1`. No region is "live"; no per-region latency, uptime, or
  throughput is asserted anywhere in this document.
- **Peers (extended, not duplicated):** `SRE.md` (reliability, on-call, capacity), `CUSTOMER-SUCCESS.md`
  §8–§9 (support/escalation/SLA framework), `OPERATIONAL-RUNBOOKS.md` (incident execution — invoked),
  `OPERATIONS-GUIDE.md` (day-2 substrate), root `SECURITY.md` (the one published commitment).
