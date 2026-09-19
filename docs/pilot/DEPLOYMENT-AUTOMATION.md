# NeuroPause — CDEP Deployment & Acceptance Checklists

The **execution instrument** for standing the platform up at a customer and
proving it works. This is the fill-in checklist a deployment lead runs during a
**real** pilot; it is not a record of a deployment that happened. **No pilot has
run yet** — every box below is blank until an operator checks it against real
output from the customer's own instance.

It **builds on**, and does not restate, the narrative walkthroughs:
`docs/validation/DEPLOYMENT-PLAYBOOKS.md` (Playbooks A–D), `deploy/README.md`
(what deploys what), and `docs/guides/RELEASE-CHECKLIST.md` (the ship gate). Where
one of those covers the "why" and the full prose, this file gives the terse,
checkable "did it pass". Reliability evidence referenced here lives in
`docs/validation/RELIABILITY-RESULTS.md` and `bench/results/*.json`.

## How to use this checklist

- Run every command **from the repository root**. `$VAR` placeholders
  (`<registry>`, `<tag>`, `<host>`) are replaced with the pilot's real values.
- Each item is `☐ command → expected result`. Check the box only when you have
  seen the expected result in **real output** — never transcribe a number from
  this document or a previous pilot.
- **Reference floor vs. customer result.** Any measured number quoted here (e.g.
  `/store/apps` 610 rps) is the **EVP 2-vCPU reference floor — our own number,
  not a customer result** (`docs/validation/_grounding.md`). The customer's
  numbers do not exist until the harnesses in §4.2 run on their hardware. Record
  theirs; do not expect them to match ours.
- Pick **one** deploy track in §1.2 (A Compose · B K8s raw · C Helm · D
  air-gapped). The other sections apply to all tracks.

---

## 1. Deployment checklist

### 1.1 Pre-flight (all tracks)

- ☐ **Node toolchain present** — `node -v`
  → **Expected:** `≥ v20.11.0` (`.nvmrc` pins `20.11.0`; `package.json` engines `>=20.11.0`).
- ☐ **Workspaces install cleanly** — `npm install`
  → **Expected:** completes with exit 0; no peer/resolution errors.
- ☐ **Backend image builds from the real Dockerfile** — `docker build -f apps/backend/Dockerfile -t <registry>/neuropause-backend:<tag> .`
  → **Expected:** image built, exit 0 (`deploy/README.md` "Build the image").
- ☐ **Secrets prepared** — set `JWT_ACCESS_SECRET` (`openssl rand -hex 32`, ≥ 32 chars), `DATABASE_URL`, `REDIS_URL`.
  → **Expected:** all three set; the loader/app refuses to boot without a ≥ 32-char secret.
- ☐ **Prod safety flags off** — confirm `SEED_STORE_ON_BOOT=false` and `RUN_MIGRATIONS_ON_BOOT=false` in the target env.
  → **Expected:** both `false` — catalog starts empty (no fabricated apps), migrations run as a deliberate step (`RELEASE-CHECKLIST.md §5`; defaulted off in `docker-compose.prod.yml`, `deploy/kubernetes/backend.yaml`, Helm `values.yaml`).
- ☐ **Pre-deploy backup exists** — see §2.1 (mandatory before any migration on an existing DB).
  → **Expected:** a fresh `backups/neuropause-db-*.sql.gz` (`RELEASE-CHECKLIST.md §5`).

### 1.2 Deploy — pick ONE track

**Track A — Docker Compose (single host / private cloud)** — full prose: `DEPLOYMENT-PLAYBOOKS.md` Playbook A.

- ☐ `cp .env.example .env` then set `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`.
  → **Expected:** `.env` present with real values.
- ☐ `docker compose -f docker-compose.prod.yml up -d --build`
  → **Expected:** `postgres`, `redis`, `backend` all `Up`/healthy; the Dockerfile `CMD` applies pending migrations then serves.

**Track B — Kubernetes, raw manifests** — full prose: `DEPLOYMENT-PLAYBOOKS.md` Playbook B; `deploy/README.md`.

- ☐ Create the Secret (edit `deploy/kubernetes/secret.example.yaml` first, or out-of-band):
  `kubectl -n neuropause create secret generic neuropause-backend-secrets --from-literal=DATABASE_URL='postgresql://user:pass@managed-pg:5432/neuropause' --from-literal=REDIS_URL='redis://managed-redis:6379' --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)"`
  → **Expected:** `secret/neuropause-backend-secrets created`.
- ☐ `kubectl apply -f deploy/kubernetes/backend.yaml`
  → **Expected:** namespace, ConfigMap, migrate `Job`, Deployment, Service created.
- ☐ `kubectl apply -f deploy/kubernetes/optional.yaml`
  → **Expected:** HPA (needs metrics-server) + Ingress (needs a controller) created.
- ☐ `kubectl -n neuropause rollout status deploy/neuropause-backend`
  → **Expected:** `deployment "neuropause-backend" successfully rolled out`; migrate `Job` = `Completed`; pods `Running` (`RollingUpdate maxUnavailable: 0` → zero-downtime).

**Track C — Helm** — full prose: `DEPLOYMENT-PLAYBOOKS.md` Playbook B.4; `deploy/README.md`.

- ☐ `helm install np deploy/helm/neuropause-backend --namespace neuropause --create-namespace --set image.repository=<registry>/neuropause-backend --set image.tag=<tag> --set existingSecret=neuropause-backend-secrets --set autoscaling.enabled=true --set ingress.enabled=true`
  → **Expected:** release `np` deployed; `migrations.enabled=true` renders the one-off migrate Job (`templates/migrate-job.yaml`).
- ☐ `kubectl -n neuropause rollout status deploy/np-neuropause-backend`
  → **Expected:** `successfully rolled out`.

**Track D — Air-gapped** — full prose: `DEPLOYMENT-PLAYBOOKS.md` Playbook C; script `scripts/build-offline-bundle.sh`.

- ☐ On the CONNECTED build host: `scripts/build-offline-bundle.sh neuropause-backend:1.0.0`
  → **Expected:** `dist/offline-bundle/neuropause-offline-neuropause-backend__1.0.0.tar.gz` written (backend + `postgres:16-alpine` + `redis:7-alpine` `docker save`d, offline compose + loader packed).
- ☐ Transfer the single tarball on approved media; on the TARGET host: `tar -xzf neuropause-offline-*.tar.gz -C /opt/neuropause && cd /opt/neuropause && cp .env.example .env`
  → **Expected:** extracted; `.env` created (set `POSTGRES_PASSWORD` + ≥ 32-char `JWT_ACCESS_SECRET`).
- ☐ `./load-and-run.sh`
  → **Expected:** `docker load -i images.tar` then `docker compose -f docker-compose.offline.yml up -d`; backend on loopback `4000`.
  → **Honest status:** the script is shellcheck-CLEAN and the procedure documented, but the full `docker save`/`load` round-trip is **PARTIAL** — never executed in validation (`bench/results/reliability.json` scenario `offline-bundle`). This box is the pilot that completes that proof.

### 1.3 Post-deploy verification (all tracks)

For K8s/Helm first: `kubectl -n neuropause port-forward deploy/neuropause-backend 4000:4000 &` (Compose/air-gapped already bind loopback `4000`).

- ☐ **Liveness** — `curl -fsS http://127.0.0.1:4000/live`
  → **Expected:** `200 {"status":"alive","uptime":<n>}` (`apps/backend/src/app.ts`).
- ☐ **Readiness / dependencies UP** — `curl -fsS http://127.0.0.1:4000/health`
  → **Expected:** `200 {"status":"ok","components":{"database":"up","redis":"up"},"uptime":<n>}`. A `503`/`degraded` with any component `down` **blocks** the deploy — fix the datastore wiring before proceeding.
- ☐ **Metrics exposed** — `curl -fsS http://127.0.0.1:4000/metrics | grep neuropause_backend_up`
  → **Expected:** `neuropause_backend_up 1` (`apps/backend/src/observability/metrics.ts`; keep the endpoint network-restricted).
- ☐ **Catalog route serves** — `curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/store/apps`
  → **Expected:** `200`, well-formed JSON envelope (list is **empty** on a fresh prod deploy because `SEED_STORE_ON_BOOT=false` — that is correct, not a fault).

---

## 2. Migration checklist

Two real mechanisms only: the transactional, **forward-only** migrator
(`apps/backend/src/db/migrations/`, **12** files `0001_init`…`0012_embedding_state`)
and the **proven** `pg_dump`/restore drill. There is no `down` migration — recovery
is **data-side restore**. Full prose: `DEPLOYMENT-PLAYBOOKS.md` Playbook D.

### 2.1 Backup FIRST (never skip)

- ☐ **Take a verified, timestamped dump** — `scripts/backup-db.sh`
  → **Expected:** `Backup complete`; a new `backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz` (runs `pg_dump --clean --if-exists --no-owner --no-privileges | gzip` inside the `postgres` service; keeps the most recent 14).
- ☐ **Confirm the file is non-empty** — `ls -lh backups/neuropause-db-*.sql.gz | tail -1`
  → **Expected:** a > 0-byte file with the current timestamp. _A backup you have never restored is a hypothesis — §2.4 restores it._

### 2.2 Apply migrations

- ☐ **Run the forward-only migrator** — `npm run db:migrate`
  → **Expected:** log ends `Migrations complete`; migrations `0001`…`0012` applied on a fresh DB (`package.json:20` → `tsx src/db/migrate.ts`). On K8s/Helm this is the one-off migrate `Job`, which must reach `Completed` **before** pods serve — a failed migration fails the Job and blocks the rollout.

### 2.3 Verify 12 applied + idempotent re-run

- ☐ **Exactly 12 recorded** — `docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -tAc "select count(*) from schema_migrations;"'`
  → **Expected:** `12` (`0001_init` … `0012_embedding_state`).
- ☐ **Re-run applies nothing (idempotent)** — `npm run db:migrate`
  → **Expected:** `Migrations complete` with **zero** new "Applied migration" lines — re-run applies **0 new** (`RELIABILITY-RESULTS.md §1`, scenario `migration-idempotency` = **PASS**). This is why repeating a deploy is safe.

### 2.4 Restore drill — prove the backup (row-count match)

Prove restorability **before** you ever need it. The measured drill restored into a
scratch DB with **exact** row counts (`RELIABILITY-RESULTS.md §2`, scenario
`backup-restore` = **PASS**).

- ☐ **Record source row counts** —
  `docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -tAc "select (select count(*) from applications), (select count(*) from versions), (select count(*) from categories);"'`
  → **Expected:** a triple, e.g. reference drill `20 | 40 | 14` (applications | versions | categories). Record the **customer's** actual numbers.
- ☐ **Restore the dump into the running stack (DESTRUCTIVE — prompts `yes`)** — `scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz`
  → **Expected:** `Restore complete` (streams `gunzip -c FILE | psql -v ON_ERROR_STOP=1`; `ON_ERROR_STOP=1` aborts on the first SQL error — no partial restore). _For a non-destructive drill, restore into a scratch DB per `DEPLOYMENT-PLAYBOOKS.md` D.1._
- ☐ **Re-count and compare** — re-run the count query above.
  → **Expected:** counts **match the source triple exactly** (row-for-row identical). Any mismatch = restore FAIL → stop and investigate before relying on the backup.

---

## 3. Validation checklist

Reproduces the **real quality gates and deployment-asset checks** on the pilot's
checkout. These are the same gates `RELEASE-CHECKLIST.md §2–3` and CI
(`.github/workflows/deploy-validation.yml`, `backend-ci.yml`) enforce.

### 3.1 Deployment-asset validation

- ☐ **Kubernetes manifests — `kubernetes-validate` strict gate** (implemented by kubeconform):
  `kubeconform -strict -summary -kubernetes-version 1.29.0 deploy/kubernetes/backend.yaml deploy/kubernetes/optional.yaml deploy/kubernetes/secret.example.yaml`
  → **Expected:** `PASS` for all — no failures (recorded evidence: `bench/results/deployment.json` → `kubernetes_validate_strict` = PASS ×2).
- ☐ **Helm chart lints and renders** — `helm lint deploy/helm/neuropause-backend && helm template np deploy/helm/neuropause-backend --namespace neuropause > /tmp/chart-rendered.yaml`
  → **Expected:** `0 chart(s) failed`; rendered YAML written.
- ☐ **Rendered chart is schema-valid (strict)** — `kubeconform -strict -summary -kubernetes-version 1.29.0 /tmp/chart-rendered.yaml`
  → **Expected:** `PASS`, no failures.
- ☐ **Shell scripts are clean** — `shellcheck scripts/backup-db.sh scripts/restore-db.sh scripts/build-offline-bundle.sh`
  → **Expected:** no findings — **CLEAN** (`bench/results/deployment.json` → `shellcheck` = "CLEAN (all scripts incl. build-offline-bundle.sh)").
- ☐ **Raw manifests lint** — `yamllint -d "{extends: relaxed, rules: {line-length: disable, comments: disable, document-start: disable}}" deploy/kubernetes`
  → **Expected:** clean (the exact CI relaxed profile; cosmetic line-length disabled).

### 3.2 Quality gates (must be green — `RELEASE-CHECKLIST.md §2`)

- ☐ **Typecheck** — `npm run typecheck`
  → **Expected:** **0 errors** across every workspace.
- ☐ **Lint** — `npm run lint`
  → **Expected:** **0** warnings/errors (`eslint . --max-warnings 0`).
- ☐ **Tests** — `npm run test`
  → **Expected:** all suites pass — RC baseline **3,856 tests** (desktop 3,548 / backend 263 / sdk 15 / cli 30; `docs/validation/PERFORMANCE-BENCHMARKS.md`). Record the pilot's re-run count.
- ☐ **Build** — `npm run build`
  → **Expected:** backend then desktop build, **exit 0**.
- ☐ **Format** — `npm run format:check`
  → **Expected:** Prettier reports no drift.

### 3.3 Supply chain + observability

- ☐ **Production dependency audit** — `npm audit --omit=dev`
  → **Expected:** **0 production vulnerabilities** (RC baseline; any new advisory is triaged before proceeding — `RELEASE-CHECKLIST.md §3`).
- ☐ **Metrics substrate reachable for evidence collection** — `curl -fsS http://127.0.0.1:4000/metrics | grep -E 'neuropause_backend_up|neuropause_pg_pool_connections|neuropause_http_requests_total'`
  → **Expected:** all three metric families present — this is the substrate the customer scrapes for capacity/health evidence at pilot time.

---

## 4. Acceptance testing (signed acceptance script)

The gate that says **"the deployment is accepted."** It combines the real quality
gates (§3, must already be green) with a live smoke, the reproducible bench
harnesses, a reliability spot-check, and a security-posture confirmation. **No
result is pre-filled** — every value is captured live from the customer's instance
and the reference floor is labelled as ours.

### 4.1 Functional smoke

- ☐ **`/health` all components up** — `curl -fsS http://<host>/health`
  → **Expected:** `200 {"status":"ok","components":{"database":"up","redis":"up"},...}`.
- ☐ **`/live` alive** — `curl -fsS http://<host>/live`
  → **Expected:** `200 {"status":"alive",...}`.
- ☐ **`/store/apps` serves** — `curl -fsS -o /dev/null -w '%{http_code}\n' http://<host>/store/apps`
  → **Expected:** `200`, well-formed JSON (empty list acceptable on a fresh prod catalog).
- ☐ **End-to-end sign-in smoke** — one email/password sign-in against the deployed backend (`RELEASE-CHECKLIST.md §7`).
  → **Expected:** succeeds end to end; backend logs show no errors during first traffic.

### 4.2 Bench harness baseline run (customer's own numbers)

Run the **real** harnesses against the customer instance to establish **their**
baseline. Reference floor is the EVP 2-vCPU/8 GB result — **ours, not a customer
result** (`docs/validation/_grounding.md`); do not expect a match on different
hardware.

- ☐ **HTTP latency/throughput baseline** — `node bench/http-load.mjs --base http://<host>:4000 --json bench/results/pilot-http-load.json`
  → **Expected:** JSON with per-scenario p50/p90/p95/p99 + throughput, **0 errors**. Reference floor: `/store/apps` 610 rps p95 69 ms; point read 424 rps p95 104 ms. Record the pilot's numbers.
- ☐ **DB query latency baseline** — `DATABASE_URL=<url> node bench/db-latency.mjs --json bench/results/pilot-db-latency.json`
  → **Expected:** per-shape p50/p95/p99 written (read-only, safe to re-run). Reference floor: point read p50 ~0.23 ms.
- ☐ **Cold-start + idle metrics snapshot** — `bash bench/startup.sh`
  → **Expected:** `bench/results/startup.json` with spawn→first-`/health`-200 seconds + idle RSS/heap/pool. Reference floor: 0.66 s cold start, RSS ~117 MB idle, pool starts at 1.

### 4.3 Reliability spot-check (chaos, reversible)

Re-run the two most load-bearing resilience scenarios on the customer stack
(`RELIABILITY-RESULTS.md §3–4`). Both are reversible.

- ☐ **Redis-down fail-open** — `docker compose -f docker-compose.prod.yml stop redis` then `for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:4000/store/apps; done; curl -s http://127.0.0.1:4000/health`
  → **Expected:** five `200`s (served through the outage — rate limiter fails open) and `/health` = `{"status":"degraded","components":{...,"redis":"down"}}`; process stays up. Restore: `docker compose -f docker-compose.prod.yml start redis`. _(Known trade-off: rate limiting is not enforced while Redis is down — GA-tracked; pair with an alert on `redis:"down"`.)_
- ☐ **Restart recovery** — `docker compose -f docker-compose.prod.yml restart backend` then poll `curl -fsS http://127.0.0.1:4000/health`
  → **Expected:** returns to `200 {"status":"ok",...}`; reference restart-to-healthy **0.46 s** (`RELIABILITY-RESULTS.md §3`). Record the pilot's recovery time.

### 4.4 Security posture check

- ☐ **No production vulns** — `npm audit --omit=dev`
  → **Expected:** **0 production vulnerabilities** (RC baseline).
- ☐ **Audit trail present** — `docker compose -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -tAc "select to_regclass('"'"'public.audit_log'"'"');"'`
  → **Expected:** `audit_log` (the table exists — `apps/backend/src/db/migrations/0001_init.sql`).
- ☐ **Known pre-GA security items disclosed, not silently relied on** — review `RELEASE-CHECKLIST.md §3` against `ENTERPRISE-GA-REPORT.md`.
  → **Expected:** the two HIGH items are acknowledged in the pilot's risk register — Apple `id_token` **not yet JWKS-verified** (`apps/backend/src/auth/providers/apple.ts`); marketplace install accepts **unsigned packages when the trust store is empty**. Presence of these is honest disclosure, not a blocker to a scoped pilot; hiding them is the failure.

### 4.5 Acceptance sign-off

Sign only when **every box in §1–§4 is checked against real output**. Attach the
real gate output (§3), the pilot's bench JSONs (§4.2), and the honest
known-limitations list. Roles, not named individuals.

```
Deployment track (A/B/C/D): ____   Environment / build tag: ____________
Quality gates (§3.2) green:  ☐ typecheck 0  ☐ lint 0  ☐ tests ____  ☐ build 0
Migrations (§2): ☐ 12 applied  ☐ idempotent re-run  ☐ restore row-counts match
Reliability (§4.3): ☐ redis fail-open  ☐ restart recovery ____ s
Security (§4.4): ☐ 0 prod vulns  ☐ audit_log present  ☐ known items disclosed

Deployment Lead ______________________  Date __________
SRE / Operator  ______________________  Date __________
Customer Sponsor ______________________ Date __________
```

> **Acceptance is an instrument, not a testimonial.** A signed sheet records what
> was observed on the customer's instance at pilot time. Do not publish, quote, or
> aggregate any number here as a product claim until a real deployment has filled
> it — the reference floors above remain ours, and the customer's results remain
> the customer's.
