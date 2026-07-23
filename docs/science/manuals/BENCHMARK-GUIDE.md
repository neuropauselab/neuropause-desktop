# NeuroPause — Benchmark Guide (how to run)

> A practical, step-by-step manual for running the NeuroPause performance
> harnesses and reporting the results **honestly**. It is the operational
> companion to `../BENCHMARK-FRAMEWORK.md` (methodology) and
> `../../validation/PERFORMANCE-BENCHMARKS.md` (the measured record). Terminology,
> harness names (H1–H4, P1–P2), and artifact paths match those documents exactly.
>
> **Cardinal rule — read before you run:** *a benchmark number without a
> committed artifact does not exist.* If you cannot point at a
> `bench/results/*.json` file for a figure, do not publish, quote, or paste it
> anywhere. Never hand-edit a number into a table — re-run the harness and commit
> the artifact it writes.

---

## 1. Prerequisites

You need a **migrated, seeded** Postgres and a reachable Redis — the same
services the backend itself uses. The harnesses measure whatever they connect
to; they do not stand up infrastructure for you.

| # | Requirement | How |
|---|---|---|
| 1 | Repo installed | `npm install` at the repo root (hoists `pg` used by H2) |
| 2 | Postgres + Redis up | `docker compose up -d` (brings up postgres:16-alpine, redis:7-alpine, qdrant) |
| 3 | `apps/backend/.env` set | `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` pointing at those services |
| 4 | Schema migrated | `npm run db:migrate` (applies the 12 forward-only migrations) |
| 5 | Catalog seeded | `cd apps/backend && npx tsx src/db/seed.ts` (20 apps / 40 versions / 14 categories) |
| 6 | Production build | `npm run build -w @neuropause/backend` (H3 boots `apps/backend/dist/index.js`) |

**Verify before benchmarking** (a green check here saves a wasted run):

```bash
# Postgres reachable and seeded (expect: 20)
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM applications"
# Backend healthy once started (expect: database up, redis up)
curl -s http://127.0.0.1:4000/health
```

> Port note: the reference environment used local Postgres/Redis on `:5433` /
> `:6380` (set in `.env`); the committed `docker compose` maps the defaults
> `:5432` / `:6379`. Either is fine — just make `DATABASE_URL` / `REDIS_URL`
> point at the instance that is actually running.

---

## 2. Running the harnesses

Run from the **repository root**. H3 first (it boots the backend and leaves it
running for H1/H2/P2); H4 is independent and needs no backend.

### H3 — cold start + idle metrics (`bench/startup.sh`)

```bash
bash bench/startup.sh
```

Kills anything on the port (so the spawn is a true cold start), times spawn →
first `/health` 200, snapshots idle `/metrics`, writes `bench/results/startup.json`,
and **leaves the backend running**. Expect one cold and one warm figure — both
real, neither derived from the other.

### H1 — HTTP API load (`bench/http-load.mjs`)

```bash
node bench/http-load.mjs --conc 32 --reqs 3000 --warmup 300 \
  --json bench/results/http-load.json
```

Drives the 8 real route scenarios at concurrency 32, 3,000 measured requests
each after a 300-request warmup (24,000 total). Prints a markdown table and
writes the artifact. If it prints `Backend not reachable … exit 2`, start the
backend (H3) first — it is refusing to invent numbers, which is correct.

### H2 — database latency (`bench/db-latency.mjs`)

```bash
DATABASE_URL="$DATABASE_URL" node bench/db-latency.mjs --iters 2000 \
  --json bench/results/db-latency.json
```

Times the 5 query shapes directly against Postgres (2,000 iters each after a
100-query warmup); read-only and safe to re-run. Exits `2` if `DATABASE_URL` is
unset. No HTTP client is involved, so these numbers have no co-location penalty.

### H4 — intelligence engines (`__bench__/performance.test.ts`)

```bash
cd apps/desktop && npx vitest run src/main/__bench__/performance.test.ts
```

Builds the deterministic 5,000-entity workspace and times 9 engine hot paths;
each asserts `< 2000 ms`. Runs headless (no Electron/macOS needed). Transcribe
the printed `ms` table into `bench/results/intelligence-engines.json`.

### P1 / P2 — Argon2 cost and under-load gauges

- **P1** is a direct 50-iteration call into the production hasher
  (`@node-rs/argon2`, params from `apps/backend/src/auth/passwords.ts`); record
  hash/verify percentiles to `bench/results/argon2.json`.
- **P2**: right after an H1 burst, scrape the live gauges and record them:

```bash
curl -s http://127.0.0.1:4000/metrics | \
  grep -E 'resident_memory_bytes|heap_used_bytes|pg_pool_connections|http_requests_total'
```

Write the values to `bench/results/metrics-under-load.json`. These gauges are
**point-in-time** — they reflect the specific burst you just ran, so capture
them per-run and never carry an old figure forward.

---

## 3. Interpreting results honestly

- **Lead with percentiles, not the mean.** The mean hides the tail; p95/p99 are
  the headline. Report the max too — it is the worst real request, not an outlier
  to hide.
- **Respect the co-located caveat.** On the 2-vCPU reference container the H1
  client shares cores with the backend, so HTTP latency/throughput are a
  **conservative lower bound**. Say so; do not present them as best-case. H2, H4,
  and P1 have no such contention and are representative.
- **Cold ≠ warm.** Report both start figures; never quote one as the other.
- **Sub-millisecond DB is expected.** If the app-layer HTTP latency dwarfs the DB
  latency (it does here), the floor is the app/serialization layer — say that
  rather than blaming Postgres.
- **The ~20 ms Argon2 cost is a feature.** It is the tunable work factor bounding
  ~50 verifies/s/core — a capacity input, not a regression to "fix".
- **Zero errors means zero errors.** Only write `0 errors` if the artifact's
  `errors` field is `0`. If a run has errors, report them.

---

## 4. Reporting: what "done" looks like

A benchmark result is reportable only when **all** of these hold:

1. The harness ran against real, migrated, seeded infrastructure.
2. Its `bench/results/*.json` artifact is **written and committed**.
3. Any published table cites that artifact and names the command to reproduce it.
4. The figure is transcribed **unaltered** — same rounding, same values.
5. It is labelled by evidence level: **L3 (Measured)** for a committed artifact;
   **L0 (Proposed)** for a spec not yet run (desktop/macOS, AI-model, connector —
   see `BENCHMARK-FRAMEWORK.md` §9). Never present an L0 spec as a measurement.

If a number fails any of these, it is not a result yet. Re-run, commit, then
report.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Backend not reachable … (exit 2)` | H1 could not `GET /health` | start the backend via H3, or point `--base` at the right URL |
| `DATABASE_URL required` (exit 2) | H2 has no DB URL | export `DATABASE_URL` (redacted automatically in the artifact) |
| `backend did not become healthy` | DB/Redis down or `.env` wrong | check `docker compose ps`, fix `.env`, re-run H3 |
| `pg module not found` | deps not installed | `npm install` at the repo root |
| Catalog count ≠ 20 | not seeded / partially seeded | re-run `npx tsx src/db/seed.ts` (clean `reset` re-seed) |
| Wildly different numbers | different hardware / warm cache / co-location | record the environment (`environment.json`) and compare like-for-like |

---

## 6. The rule, restated

Everything above serves one discipline: **measure the real system, commit the
artifact, cite it, and label its evidence level.** A benchmark number without a
committed artifact does not exist — and a proposed spec (L0) is never reported as
a measured result (L3). When in doubt, re-run and let the artifact speak.
