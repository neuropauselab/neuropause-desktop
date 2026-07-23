# Validation Manual — NSSP Operational Companion

> The hands-on companion to [`frameworks/VALIDATION.md`](../frameworks/VALIDATION.md).
> Where the framework explains *what* validation means at each evidence level, this
> manual gives the *exact procedure* — the commands for each gate, the reliability
> and deployment steps, the acceptance checklists, and how to record a result with
> its evidence level. It is subordinate to the operational
> [Release Checklist](../../guides/RELEASE-CHECKLIST.md); where the two overlap, the
> Release Checklist is authoritative. Grounding and evidence ladder:
> [`_grounding.md`](../_grounding.md).

---

## 0. Environment

Run everything from the **repository root**. The recorded reference environment
(`bench/results/environment.json`) is Node v22.22.2, Postgres 16.13, Redis 7.0.15,
Ubuntu 24.04, 2 vCPU. Chaos and HTTP procedures require a running local backend
plus Postgres and Redis; the pure gates (§1) need only the toolchain.

---

## 1. Quality-gate procedure (acceptance floor — all L4)

Run in order. Each must meet its threshold before a build is acceptable
(Release Checklist §2–§3). Record the **actual** output — never copy a prior run.

| # | Command | Pass condition | Records |
|---|---|---|---|
| 1 | `npm run typecheck` | 0 TypeScript errors (all workspaces) | error count |
| 2 | `npm run lint` | 0 warnings (`eslint . --max-warnings 0`) | warning count |
| 3 | `npm run test` | all green — 3,856 tests, 0 failed | test + file count |
| 4 | `npm run build` | exit 0 (backend then desktop) | build time |
| 5 | `npm run format:check` | no Prettier drift | — |
| 6 | `npm audit --omit=dev` | **0 production vulnerabilities** | advisory count |
| 7 | `npm audit` (incl. dev) | note dev-only advisories (non-blocking) | advisory count |

Optional / infra-gated:

- `npm run db:migrate -w @neuropause/backend` — apply forward-only migrations
  (also the §2.1 idempotency check).
- `npm run test:integration -w @neuropause/backend` — the Postgres-gated
  integration suite (`__integration__/organizations.test.ts`); excluded from the
  infra-free default gate by design.

---

## 2. Reliability / chaos procedure

Reproduces `docs/validation/RELIABILITY-RESULTS.md`. Scenarios 1–2 are safe against
any migrated DB; scenarios 3–5 stop/start local Redis and Postgres and confirm
`/health` transitions and recovery. Record each as PASS/PARTIAL/FAIL with the
observed evidence.

### 2.1 Migration idempotency (expect PASS)
1. Confirm applied migrations in `schema_migrations` (reference: 12, `0001_init` … `0012_embedding_state`).
2. Re-run `npm run db:migrate`.
3. **Pass:** log prints "Migrations complete" with **zero** new "Applied migration" lines.

### 2.2 Backup & restore (expect PASS)
1. `pg_dump -Fc` → `/tmp/np_backup.dump` (reference size ~136 KB).
2. `createdb neuropause_restore`.
3. `pg_restore` → `neuropause_restore`.
4. **Pass:** restored row counts match source exactly — applications 20, versions 40, categories 14.

### 2.3 Backend restart recovery (expect PASS, ~0.46 s)
1. Send `SIGTERM` to the backend; poll `/health` → expect unreachable (`000`), i.e. a clean shutdown, not a hang.
2. Restart the process; poll `/health`.
3. **Pass:** `/health` healthy again **sub-second** (reference 0.46 s).

### 2.4 Redis-down fail-open (expect PASS)
1. `redis-cli shutdown nosave`; confirm `redis-cli ping` = DOWN.
2. `GET /store/apps` ×5.
3. **Pass:** all **200** (served through outage); `GET /health` = `{"status":"degraded","components":{...,"redis":"down"}}`; backend stays up. Restart Redis → `PONG` restored. (Note the tracked trade-off: rate limiting is not enforced while Redis is down — pair with an alert on `redis:"down"`.)

### 2.5 Postgres-down degradation + auto-recovery (expect PASS)
1. Baseline `/health` = `status:"ok"`.
2. `pg_ctl stop -m fast`.
3. Confirm backend process still alive; `/health` = `degraded/database:down`; `GET /store/apps` → clean **500** (fails fast, no hang).
4. Restart Postgres.
5. **Pass:** pool **auto-reconnects with no backend restart**; `/health` returns to `ok`, `/store/apps` to `200` within seconds.

### 2.6 Offline / air-gapped bundle (expect PARTIAL here)
1. `shellcheck scripts/build-offline-bundle.sh` → expect CLEAN.
2. Full `docker save`/`load` via `load-and-run.sh` (per `deploy/README.md`) requires a Docker daemon — record **PARTIAL** if none is available, as in the reference run.

---

## 3. Deployment-validation procedure (L4)

Mirrors `.github/workflows/deploy-validation.yml`; results recorded in
`bench/results/deployment.json`.

1. `yamllint -d "{extends: relaxed, rules: {line-length: disable, comments: disable, document-start: disable}}" deploy/kubernetes`
2. `helm lint deploy/helm/neuropause-backend`
3. `helm template np deploy/helm/neuropause-backend --namespace neuropause > /tmp/chart-rendered.yaml`
4. `kubeconform -strict -summary -kubernetes-version 1.29.0 deploy/kubernetes/backend.yaml deploy/kubernetes/optional.yaml deploy/kubernetes/secret.example.yaml`
5. `kubeconform -strict -summary -kubernetes-version 1.29.0 /tmp/chart-rendered.yaml`
6. `shellcheck` all deploy scripts.

**Pass:** `kubeconform` strict PASS on raw + rendered manifests; `helm lint` clean;
`shellcheck` CLEAN. (`helm` CLI may be unavailable locally — it renders in CI.)

---

## 4. Regression / benchmark procedure

Re-take the **L3** performance baselines and run the **L4** budget guard. Write each
result to `bench/results/*.json` (transcribe unaltered).

| Harness | Command | Produces | Guard |
|---|---|---|---|
| Engine budget guard | run `apps/desktop/src/main/__bench__/performance.test.ts` (Vitest) | `intelligence-engines.json` | each hot path **< 2,000 ms** |
| HTTP load | `node bench/http-load.mjs` | `http-load.json` | expect **0 errors** (ref 24,000 req) |
| DB latency | `node bench/db-latency.mjs` | `db-latency.json` | point-read p50 ~0.23 ms |
| Cold start | `bash bench/startup.sh` | `startup.json` | spawn → first `/health` 200 (ref 0.62–0.66 s) |

Interpret deltas with the model's rule (`classifyRegression`): **≤ 5 %** is
noise/improvement; **≥ 10 % / ≥ 25 % / ≥ 50 %** = minor / major / critical. A
regression degrades a certification run to `warning`.

---

## 5. Acceptance-criteria checklists

**Per-build (must all be true):**

- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → 0 warnings
- [ ] `npm run test` → all green (record test + file count)
- [ ] `npm run build` → exit 0
- [ ] `npm run format:check` → no drift
- [ ] `npm audit --omit=dev` → 0 production vulnerabilities

**Pre-release (adds, per Release Checklist):**

- [ ] Version + `CHANGELOG.md` + `README.md` status updated (SemVer; current `1.0.0-rc.1`)
- [ ] Reliability scenarios 1–5 re-confirmed PASS (§2)
- [ ] Deployment validation PASS (§3)
- [ ] Known-limitations list current and disclosed (Apple JWKS, marketplace unsigned install, no per-PR desktop CI, advisory-only rollback)
- [ ] Post-release: `/health` + `/metrics` respond; smoke sign-in succeeds; restore path understood by on-call

---

## 6. Recording a validation result with its evidence level

Every result is recorded with an **evidence level** and a **real anchor**. Use the
`bench/results/reliability.json` shape as the template for machine-readable runs:

```json
{ "id": "backend-restart-recovery", "result": "PASS",
  "evidence": "SIGTERM -> down -> restart -> healthy in 0.46s" }
```

Procedure:

1. **Run** the mechanism (§1–§4) and capture raw output.
2. **Write the artifact** to `bench/results/<name>.json` (measurements) or a
   PASS/PARTIAL/FAIL row in `docs/validation/RELIABILITY-RESULTS.md` (chaos).
   Transcribe numbers unaltered.
3. **Assign the level** using the framework's evidence requirements:
   - **L4** — executed test / gate / reliability / deployment run → cite the test
     file or gate output (e.g. `reliability.json`, `npm run typecheck` = 0).
   - **L3** — a reproducible measurement → cite the `bench/results/*.json` file.
   - **L2** — implemented + exercised → cite the source path.
   - **L1** — modeled + green pure-helper test → cite the type file.
   - **L0** — proposed only → **label it Proposed**, cite nothing.
4. **Never** promote a result above the level its artifact supports, and **never**
   record peer review, certification, or standard conformance — the platform holds
   none.

---

## 7. References

- [Release Checklist](../../guides/RELEASE-CHECKLIST.md) — authoritative ship gate.
- [`frameworks/VALIDATION.md`](../frameworks/VALIDATION.md) — validation science + evidence ladder.
- [`RELIABILITY-RESULTS.md`](../../validation/RELIABILITY-RESULTS.md) + `bench/results/reliability.json` — executed reliability.
- `continuousValidation.ts` + `sandbox/validation/*` — the continuous-validation model.
- `.github/workflows/*.yml` — CI (backend, deploy, windows). No per-PR desktop CI (tracked, GA report TD-4).
