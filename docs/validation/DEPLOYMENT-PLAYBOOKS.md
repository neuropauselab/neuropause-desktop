# NeuroPause — Deployment Playbooks

Step-by-step, **reproducible** deployment playbooks. Every command below exists in the repo
(README, `package.json` scripts, `deploy/`, or `scripts/`) — nothing is illustrative. Expected
results reference the measured numbers in `docs/validation/_grounding.md`, unaltered.

These playbooks are the *how-to-run* companion to the topology in
`docs/validation/REFERENCE-ARCHITECTURES.md` and the incident procedures in
`docs/validation/OPERATIONAL-RUNBOOKS.md`. Deployment mechanics that already live in
`deploy/README.md` are referenced, not rewritten.

**Conventions.** `$` = run from the repository root. Replace `<registry>` / `<tag>` with real
values. The prod image tag used throughout the manifests is `neuropause-backend:1.0.0`.

---

## Playbook A — Fresh install (single host / developer)

Mirrors the README "Getting started" sequence exactly (`README.md:77-98`). Prerequisites:
Node ≥ 20.11 (`.nvmrc` pins `20.11.0`), Docker, `npm@10`.

```bash
# 1. Install all workspace dependencies
$ npm install

# 2. Start infrastructure (Postgres + Redis) in the background
$ npm run infra:up            # → docker compose up -d   (package.json:21)

# 3. Configure the backend
$ cp .env.example apps/backend/.env
#    set at minimum in apps/backend/.env:
#      JWT_ACCESS_SECRET   (generate: openssl rand -base64 48)
#      DATABASE_URL, REDIS_URL  (defaults already match docker-compose.yml)

# 4. Run database migrations (forward-only; applies 0001..0012)
$ npm run db:migrate          # → db:migrate -w @neuropause/backend  (package.json:20)

# 5a. Dev: run backend + desktop together (hot-reload)
$ npm run dev                 # backend on http://127.0.0.1:4000 + Electron (macOS)
# 5b. Or backend only:
$ npm run dev:backend
```

**Production single-host variant (Compose).** Build and run the real image with its Postgres
and Redis, per `deploy/README.md:27-32`:

```bash
$ cp .env.example .env        # set POSTGRES_PASSWORD, JWT_ACCESS_SECRET (>=32 chars)
$ docker compose -f docker-compose.prod.yml up -d --build
```

**Verify.**

```bash
$ curl -fsS http://127.0.0.1:4000/live      # {"status":"alive","uptime":...}
$ curl -fsS http://127.0.0.1:4000/health    # {"status":"ok","components":{"database":"up","redis":"up"},...}
$ curl -fsS http://127.0.0.1:4000/metrics | head   # neuropause_backend_up 1 ...
```

**Expected characteristics (reference env, `_grounding.md`).** Cold start → healthy in
**0.66 s**; idle RSS ≈ **117 MB**; the `pg` pool auto-scales **1 → 10** under load. A clean
build passes the gates: **typecheck 0, lint 0, 3,856 tests, build exit 0, 0 production
npm-audit vulns** — reproduce with:

```bash
$ npm run typecheck && npm run lint && npm run test && npm run build
$ npm audit --omit=dev        # RC baseline: 0 production vulnerabilities
```

---

## Playbook B — Kubernetes deploy (raw manifests + Helm)

The cluster runs the stateless backend against **managed** Postgres/Redis
(`REFERENCE-ARCHITECTURES.md` Arch 2). Prerequisites the cluster must already provide: an
ingress controller (nginx) and cert-manager if you enable Ingress; metrics-server if you
enable the HPA.

### B.0 — Validate before you apply (the real strict PASS)

The manifests and chart are schema-validated in CI (`.github/workflows/deploy-validation.yml`).
Reproduce the exact **kubeconform strict** checks locally — the recorded result is **PASS** for
both raw manifests (`bench/results/deployment.json`):

```bash
$ helm lint deploy/helm/neuropause-backend
$ helm template np deploy/helm/neuropause-backend --namespace neuropause > /tmp/chart-rendered.yaml

$ kubeconform -strict -summary -kubernetes-version 1.29.0 \
    deploy/kubernetes/backend.yaml \
    deploy/kubernetes/optional.yaml \
    deploy/kubernetes/secret.example.yaml
# → PASS  (deploy/kubernetes/backend.yaml, optional.yaml)

$ kubeconform -strict -summary -kubernetes-version 1.29.0 /tmp/chart-rendered.yaml
```

### B.1 — Build and push the image

```bash
$ docker build -f apps/backend/Dockerfile -t <registry>/neuropause-backend:<tag> .
$ docker push <registry>/neuropause-backend:<tag>
```

### B.2 — Create the Secret out-of-band (recommended)

Point `DATABASE_URL`/`REDIS_URL` at the **managed** datastores (`deploy/README.md:59-66`):

```bash
$ kubectl -n neuropause create secret generic neuropause-backend-secrets \
    --from-literal=DATABASE_URL='postgresql://user:pass@managed-pg:5432/neuropause' \
    --from-literal=REDIS_URL='redis://managed-redis:6379' \
    --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
```

### B.3 — Apply raw manifests

```bash
$ kubectl apply -f deploy/kubernetes/backend.yaml    # ns, ConfigMap, migrate Job, Deployment, Service
$ kubectl apply -f deploy/kubernetes/optional.yaml   # HPA (needs metrics-server) + Ingress (needs a controller)
$ kubectl -n neuropause rollout status deploy/neuropause-backend
```

The `neuropause-backend-migrate` Job runs `node dist/db/migrate.js` once
(`backend.yaml:44-93`, `backoffLimit: 3`) **before** the Deployment serves. `ConfigMap` sets
`RUN_MIGRATIONS_ON_BOOT: "false"` and `SEED_STORE_ON_BOOT: "false"` (`backend.yaml:39-41`).

### B.4 — Helm alternative

```bash
$ helm install np deploy/helm/neuropause-backend \
    --namespace neuropause --create-namespace \
    --set image.repository=<registry>/neuropause-backend --set image.tag=<tag> \
    --set existingSecret=neuropause-backend-secrets \
    --set autoscaling.enabled=true --set ingress.enabled=true
$ kubectl -n neuropause rollout status deploy/np-neuropause-backend
```

`migrations.enabled=true` (default) renders the same one-off migrate Job
(`templates/migrate-job.yaml`). With `existingSecret` set, no in-chart Secret is rendered
(`templates/secret.yaml`, `_helpers.tpl` `secretName`).

**Verify.**

```bash
$ kubectl -n neuropause get pods         # 2 backend pods Running; migrate Job Completed
$ kubectl -n neuropause port-forward deploy/neuropause-backend 4000:4000 &
$ curl -fsS http://127.0.0.1:4000/health # 200 {"status":"ok",...}
```

Prometheus discovers each pod via the scrape annotations `prometheus.io/scrape|path|port`
(`backend.yaml:122-124`). Rollouts are zero-downtime: `RollingUpdate maxUnavailable: 0` +
the `/health` readiness probe (`backend.yaml:107-162`).

---

## Playbook C — Air-gapped install

Build a self-contained bundle on a connected host, transfer it, load and run on the isolated
host (`deploy/README.md:68-74`; script `scripts/build-offline-bundle.sh`).

### C.1 — On the CONNECTED build host (needs Docker + internet)

```bash
$ scripts/build-offline-bundle.sh neuropause-backend:1.0.0
# builds the backend image, pulls postgres:16-alpine + redis:7-alpine,
# docker save's all three into images.tar, writes docker-compose.offline.yml
# and load-and-run.sh, then tars everything to:
#   dist/offline-bundle/neuropause-offline-neuropause-backend__1.0.0.tar.gz
```

### C.2 — Transfer

Move the single `dist/offline-bundle/neuropause-offline-*.tar.gz` to the air-gapped host on
approved media.

### C.3 — On the AIR-GAPPED target host (needs Docker; no internet)

```bash
$ tar -xzf neuropause-offline-*.tar.gz -C /opt/neuropause && cd /opt/neuropause
$ cp .env.example .env
#   set POSTGRES_PASSWORD and a >=32-char JWT_ACCESS_SECRET (the loader refuses to start without .env)
$ ./load-and-run.sh
#   → docker load -i images.tar
#   → docker compose -f docker-compose.offline.yml up -d
#   backend starts on loopback port 4000
```

**Verify.**

```bash
$ curl -fsS http://127.0.0.1:4000/live
$ curl -fsS http://127.0.0.1:4000/health
```

**Honest status.** `build-offline-bundle.sh` is **shellcheck-CLEAN** and the procedure is
documented, but a full `docker save`/`load` round-trip needs a Docker daemon and was **not
executed** in validation → **PARTIAL** (`bench/results/reliability.json`,
`bench/results/deployment.json`). Run C.1–C.3 end-to-end on real hosts to complete the proof.

---

## Playbook D — Upgrade & rollback

Grounded in two real mechanisms: the **transactional, forward-only** backend migrator
(`apps/backend/src/db/migrations/`, 12 files) and the **proven** `pg_dump`/restore drill.
Read the crucial honest caveat first.

> **Rollback is DATA-SIDE, not binary-side.** App-binary downgrade is **advisory only** —
> `autoUpdater.allowDowngrade = false`; the updater computes a revert *target* with no side
> effect and installs nothing (`DISASTER-RECOVERY-GUIDE.md §5.1`). Migrations are
> **forward-only**; there is no `down` migration. The real recovery lever is **restore a
> pre-upgrade backup**, then re-point at the prior image tag manually.

### D.1 — Pre-upgrade: take a verified backup (do NOT skip)

The **proven procedure** (`_grounding.md`; `bench/results/reliability.json` scenario
`backup-restore`, status **PASS**): `pg_dump -Fc` (136 KB in the drill) → fresh DB →
`pg_restore` → **row counts match exactly** (applications 20, versions 40, categories 14).

The shipped operator scripts implement the same `pg_dump`/restore family for the Compose stack:

```bash
$ scripts/backup-db.sh
# → docker compose exec -T postgres pg_dump --clean --if-exists --no-owner --no-privileges
#   | gzip  →  backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz   (keeps the most recent 14)
```

For the custom-format drill variant (what was measured), dump and prove restorability into a
scratch database before touching production:

```bash
$ pg_dump -Fc "$DATABASE_URL" -f /tmp/pre-upgrade.dump
$ createdb neuropause_verify && pg_restore -d neuropause_verify /tmp/pre-upgrade.dump
$ psql neuropause_verify -c "select count(*) from applications;"   # confirm expected row counts
```

> A backup you have never restored is a hypothesis, not a backup
> (`DISASTER-RECOVERY-GUIDE.md §8.5`).

### D.2 — Apply the upgrade (migrations as a gated step)

**Kubernetes / Helm (recommended):** with `RUN_MIGRATIONS_ON_BOOT=false`, the migrate Job runs
the new migrations before pods serve — a failed migration **fails the Job and blocks the
rollout** instead of serving a bad schema (`DISASTER-RECOVERY-GUIDE.md §4.2`).

```bash
$ helm upgrade np deploy/helm/neuropause-backend \
    --namespace neuropause --reuse-values \
    --set image.tag=<new-tag>
$ kubectl -n neuropause get job    # ...-migrate must reach Completed
$ kubectl -n neuropause rollout status deploy/np-neuropause-backend
```

**Compose single-host:**

```bash
$ docker compose -f docker-compose.prod.yml pull   # or rebuild: up -d --build
$ docker compose -f docker-compose.prod.yml up -d
# the Dockerfile CMD applies pending migrations (node dist/db/migrate.js) then serves
```

Re-running the migrator is **idempotent**: proven — 12 migrations, re-run applied **0 new**
(`_grounding.md`; reliability scenario `migration-idempotency`, PASS).

### D.3 — Verify the upgrade

```bash
$ curl -fsS http://<host>/health     # 200 {"status":"ok","components":{"database":"up","redis":"up"}}
$ curl -fsS http://<host>/metrics | grep neuropause_backend_up   # neuropause_backend_up 1
```

Also run the post-release checks in `docs/guides/RELEASE-CHECKLIST.md §7`: a smoke sign-in
end-to-end, and a scan of backend logs for errors during first traffic.

### D.4 — Rollback (data-side)

If the upgrade is bad:

```bash
# 1. Restore the pre-upgrade dump (DESTRUCTIVE; prompts for 'yes')
$ scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz
#   → gunzip -c FILE | docker compose exec -T postgres psql -v ON_ERROR_STOP=1
#     ON_ERROR_STOP=1 aborts on the first SQL error (no partial restore)

# 2. Re-point at the prior image tag (manual, deployment-level)
$ helm upgrade np deploy/helm/neuropause-backend --namespace neuropause \
    --reuse-values --set image.tag=<previous-tag>
#   (Compose: set the previous tag / rebuild and `up -d`)

# 3. Restart the backend so pooled connections re-establish, then verify /health
```

**Limits, stated plainly.** Whole-dump restore only — **no PITR/WAL** in-repo, so you recover
to the state of a specific dump, never to an arbitrary moment between dumps
(`DISASTER-RECOVERY-GUIDE.md §3.2`). Because migrations are forward-only, a restore that
predates a migration returns the schema *and* data to the pre-migration state together — which
is exactly why D.1 is mandatory. Close the PITR gap with managed Postgres
(`DISASTER-RECOVERY-GUIDE.md §8.1`).
