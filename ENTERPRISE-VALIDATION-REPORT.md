# NeuroPause — Enterprise Validation Program (EVP)

> **Historical snapshot — superseded facts.** This report was written in the
> `1.0.0-rc.1` era (bulk pass of 2026-07-24) and is retained as program history.
> Authoritative current facts: **104 certified modules across 13 families**
> (locked by `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts`),
> version lineage `1.0.0-rc.14`. See `PHASE7-COMPLETION-REPORT.md` and the
> Phase 8 reports for current state. Banner added by Phase 8 (8.11).

**Version:** `1.0.0-rc.1` · **Program run:** 2026-07-18 · **Reference env:** 2-vCPU
Xeon @2.10 GHz, 8 GB, Node 22.22.2, Postgres 16.13, Redis 7.0.15

**Classification:** **Validated Release Candidate** — the Release Candidate is now
backed by *executed* operational evidence (performance measured, reliability
proven, deployment validated), materially closer to GA but short of "Enterprise
Proven" until the target-hardware, security, and release-engineering items in §9
are closed.

> This program added **no features, no new platform, and no architectural layer.**
> It stood up the real system, measured it, broke it, restored it, and wrote down
> exactly what happened. Every measured value is recorded as an artifact in
> `bench/results/` or is regenerable by a named harness/procedure (run-to-run
> variance — e.g. cold vs warm boot — is expected and disclosed). Anything not
> executed is labelled, not faked.

---

## 1. What was actually done

Standing up the **real backend** (production build) against **real Postgres and
Redis**, applying the **real migrations**, seeding the app's **own catalog**, then:

- Load-testing the real HTTP API (24,000 requests, 0 errors) — `bench/http-load.mjs`.
- Timing the real database (10,000 queries, 0 errors) — `bench/db-latency.mjs`.
- Running the real intelligence-engine benchmark over 5,000 entities — `__bench__/performance.test.ts`.
- Measuring the real Argon2id auth cost with production parameters.
- Executing six reliability/chaos scenarios against the live process.
- Validating the real deployment assets with `kubernetes-validate`, `shellcheck`, `yamllint`.
- Producing five **reference deployment + validation-protocol** packs (Manufacturing, Healthcare, Agriculture, Financial, Government) and an evidence pack (reference architectures, playbooks, runbooks), each grounded in the real controls/telemetry and honestly labelling what is modeled.

Full evidence: `docs/validation/` and `bench/results/`.

---

## 2. Enterprise Validation Matrix

Legend: **Validated** = executed against the real system with recorded evidence ·
**Partial** = mechanism real + statically validated, full execution pending a
capability this env lacks · **Modeled** = schema/surfaces exist and are tested, not
wired to a live external system · **Harness-ready** = instrumentation/harness
exists, execution pending target hardware.

| # | Capability | State | Evidence |
|---|---|---|---|
| 1 | Backend build integrity | **Validated** | typecheck 0, lint 0, 3,856 tests, build exit 0 |
| 2 | Backend cold start | **Validated** | 0.66 s → healthy (DB+Redis up) |
| 3 | HTTP API under load | **Validated** | 24,000 req, 0 errors, p50/p95/p99 recorded |
| 4 | Database performance | **Validated** | 10,000 queries, sub-ms p50/p95 |
| 5 | Intelligence engines | **Validated** | 9 hot paths ≤93 ms over 5,000 entities |
| 6 | Auth cost (Argon2id) | **Validated** | hash/verify ~20 ms at production params |
| 7 | Observability (`/metrics`,`/health`) | **Validated** | live series scraped idle + under load |
| 8 | Migration idempotency | **Validated** | 12 applied; re-run applies 0 |
| 9 | Backup / restore | **Validated** | pg_dump→restore, exact row match |
| 10 | Restart recovery | **Validated** | 0.46 s to healthy after SIGTERM |
| 11 | Redis-down fail-open | **Validated** | serves 200s; `/health` degraded; no crash |
| 12 | Postgres-down resilience | **Validated** | survives; degrades honestly; auto-reconnects |
| 13 | Kubernetes manifests | **Validated** | `kubernetes-validate` strict PASS ×2 |
| 14 | Shell / offline bundler | **Validated (static)** | `shellcheck` CLEAN |
| 15 | Dependency security | **Validated** | 0 production vulns (`npm audit --omit=dev`) |
| 16 | Production data authenticity | **Validated** | `SEED_STORE_ON_BOOT=false` in prod; empty-catalog tests |
| 17 | Offline / air-gapped install | **Partial** | script + procedure real; `docker save/load` needs a daemon |
| 18 | Helm release | **Partial** | chart complete; local render N/A; rendered in CI |
| 19 | Desktop startup / render / IPC | **Harness-ready** | macOS-only; perf instrumentation exists; not run headless |
| 20 | Real AI model execution | **Modeled** | needs live model credentials |
| 21 | Connector execution / cross-device sync | **Modeled** | needs live services + multiple devices |
| 22 | Vertical device integrations (PLC, EHR, IoT) | **Modeled** | schema/surfaces exist; not wired to live equipment |
| 23 | Alerting / tracing / capacity | **Absent** | not implemented (tracked) |

**Tally:** Validated 16 · Partial 2 · Harness-ready 1 · Modeled 3 · Absent 1.

---

## 3. Operational Evidence Matrix

Each row ties a KPI to a **real telemetry source** and the **measured** value on
the reference environment.

| KPI | Source (real) | Measured / observed |
|---|---|---|
| Cold-start time | boot → `/health` 200 | **0.66 s** |
| Restart recovery | SIGTERM → `/health` 200 | **0.46 s** |
| Liveness throughput | `neuropause_http_requests_total` | `/live` 2,103 rps, `/health` 1,221 rps |
| Store read latency | `bench/http-load.mjs` | list p50 52 ms; point read p50 72 ms, p99 118 ms |
| DB query latency | `bench/db-latency.mjs` | point read p50 0.23 ms, p95 0.46 ms |
| Memory under load | `neuropause_backend_resident_memory_bytes` | 117 MB → 213 MB (24k req) |
| Connection pooling | `neuropause_pg_pool_connections` | auto-scale 1 → 10, drains to idle |
| Health honesty | `/health.components` | reports `degraded` on Redis/DB loss |
| Auth work factor | Argon2id (prod params) | ~20 ms/verify (deliberate) |
| Request accounting | `neuropause_http_requests_total` | 16,510 counted; probes excluded correctly |
| Audit trail | `audit_log` table | append-only; populated on privileged actions |
| Error rate under load | harness | **0 / 24,000** |

---

## 4. Deployment Validation Matrix

| Artifact | Tool | Result |
|---|---|---|
| `deploy/kubernetes/backend.yaml` | `kubernetes-validate` (strict) | **PASS** |
| `deploy/kubernetes/optional.yaml` | `kubernetes-validate` (strict) | **PASS** |
| `scripts/*.sh` (incl. offline bundler) | `shellcheck` | **CLEAN** |
| `deploy/**/*.yaml` | `yamllint` | clean (cosmetic line-length only) |
| Helm chart (8 templates) | `helm` | render in CI (`deploy-validation.yml`); local CLI N/A |
| Backend container | `apps/backend/Dockerfile` | present; image build needs a Docker daemon |
| CI: backend, deploy-validation, windows-release | GitHub Actions | present |
| CI: per-PR desktop tests, macOS release | — | **absent** (tracked) |

Detail: `docs/validation/DEPLOYMENT-VALIDATION.md`.

---

## 5. Performance benchmarks (summary)

Measured, 0 errors throughout. Full tables + reproduction: `docs/validation/PERFORMANCE-BENCHMARKS.md`.

- **Cold start** 0.66 s · **restart** 0.46 s.
- **HTTP** (conc 32, 24k req): `/health` 1,221 rps p50 22 ms; `/store/apps` 610 rps p50 52 ms p99 80 ms; point read 424 rps p50 72 ms p99 118 ms.
- **DB** (10k queries): sub-ms p50/p95 across point/list/aggregate/join. *The DB is not the HTTP bottleneck; app layer + 2-vCPU contention is.*
- **Engines** (5,000 entities): graph.project 92.8 ms, timeline.query 76.8 ms, search.query 6.1 ms — all far under the 2,000 ms guard.
- **Argon2id**: hash 19.7 ms / verify 19.6 ms p50.

---

## 6. Reliability results (summary)

Five of six PASS; one PARTIAL (honest). Detail: `docs/validation/RELIABILITY-RESULTS.md`.

| Scenario | Result |
|---|---|
| Migration idempotency | PASS |
| Backup / restore (exact) | PASS |
| Restart recovery (0.46 s) | PASS |
| Redis-down fail-open | PASS |
| Postgres-down degrade + auto-recover | PASS |
| Offline/air-gapped bundle | PARTIAL (needs Docker daemon) |

---

## 7. Reference architectures, playbooks, runbooks, vertical packs

| Document | Purpose |
|---|---|
| `docs/validation/REFERENCE-ARCHITECTURES.md` | single-node, Kubernetes, air-gapped topologies (real assets) |
| `docs/validation/DEPLOYMENT-PLAYBOOKS.md` | reproducible install / upgrade / rollback playbooks |
| `docs/validation/OPERATIONAL-RUNBOOKS.md` | incident runbooks tied to real `/health` + `/metrics` signals |
| `docs/validation/verticals/MANUFACTURING.md` | reference deployment + KPIs + validation protocol |
| `docs/validation/verticals/HEALTHCARE.md` | clinical-adjacent mapping + HIPAA/SOC 2 self-assessment mapping |
| `docs/validation/verticals/AGRICULTURE.md` | offline-first + automation validation; sensor model |
| `docs/validation/verticals/FINANCIAL.md` | governance/audit + SOC 2 / PCI self-assessment mapping |
| `docs/validation/verticals/GOVERNMENT.md` | air-gapped + NIST 800-53 self-assessment mapping (no ATO) |

Every vertical pack is a **reference deployment and validation protocol**, not a
record of a real customer install. Compliance material is a **control self-mapping
to guide the customer's own audit — never a certification.**

---

## 8. Enterprise Readiness Score

Evidence-tied, per dimension. Each score reflects how much of the dimension is
backed by *executed* evidence versus harness-ready/modeled/absent. Method is
transparent: scores are assigned from the evidence tier, and the composite is a
simple mean (no hidden weighting).

| Dimension | Score /100 | Basis |
|---|---:|---|
| Build & test integrity | 100 | all gates green, 3,856 tests, 0 prod vulns |
| Backend performance | 90 | measured under load, 0 errors; desktop perf pending |
| Reliability & resilience | 85 | 5/6 chaos PASS, backup/restore proven; long-run chaos + offline exec pending |
| Deployment | 80 | k8s strict PASS, shellcheck clean; no macOS/desktop CI, helm render in CI only |
| Security | ~~70~~ → **90** | strong controls, 0 prod vulns; **both former HIGH items now CLOSED** (Apple `id_token` JWKS-verified; marketplace install fail-closed) with regression tests — see GA report |
| Observability | 65 | real `/metrics`+`/health`+`audit_log`; no alerting/tracing/capacity |
| Desktop/client validation | 40 | engines measured; UI/IPC/render pending macOS target hardware |
| Vertical/domain validation | 55 | reference packs + protocols + mappings; integrations modeled, no executed pilots |
| Documentation & evidence | 95 | comprehensive, reproducible, honestly labelled |

**Indicative composite (as of 2026-07-18): ~76 / 100 → "Validated Release Candidate."**

> **Update (2026-07-24, GA Execution Program):** the "two known security finishes"
> cited below as a drag on the score have since been **closed with regression tests**
> (Security 70 → 90), and per-PR desktop CI + macOS release automation have landed
> (raising Deployment). The current, authoritative readiness decision — recomputed on
> this evidence — is in [`GENERAL-AVAILABILITY-REPORT.md`](GENERAL-AVAILABILITY-REPORT.md).
> The remaining drags below (client-tier desktop benchmarks on Apple-Silicon hardware,
> and vertical readiness being *protocol-and-mapping* rather than *executed pilots*)
> still stand.

The score is deliberately not rounded up. The backend is genuinely
production-validated (the 90/85/100 dimensions); the drag is the client-tier
benchmarks, two known security finishes (**now closed — see update above**), and the
fact that vertical readiness is *protocol-and-mapping*, not *executed pilots*.

---

## 9. Known limitations & remaining risks

**Security (both GA blockers now CLOSED — GA Execution Program, 2026-07-24):**
1. ~~Apple `id_token` not JWKS-verified.~~ **CLOSED** — now signature-verified vs Apple JWKS with issuer/audience/expiry + RS256 pin (`apps/backend/src/auth/providers/apple.ts`; `apple.test.ts`, 8 tests).
2. ~~Marketplace **app** install accepts unsigned packages when the trust store is empty.~~ **CLOSED** — install is now fail-closed for unsigned/untrusted/tampered artifacts in packaged builds (`signature.ts`/`packageService.ts`; `signature.test.ts`, 5 tests).
3. Rate limiter fails open on Redis outage — proven, deliberate; pair with an alert on `redis:"down"`. *(Still open — MEDIUM, deliberate availability trade-off.)*

**Validation gaps (execute to move Validated-RC → Proven):**
4. Desktop startup/render/IPC/renderer-memory benchmarks — run the existing harness on macOS Apple-Silicon.
5. Real AI-model and connector execution + cross-device sync — needs live credentials/services.
6. Full offline bundle build/transfer — run `scripts/build-offline-bundle.sh` on a host with Docker.
7. Long-run chaos / network-partition failure injection — needs a multi-node target.
8. Vertical **pilots** — the packs are protocols; a real pilot per vertical would convert "reference" to "proven."

**Release engineering / operations:**
9. Per-PR desktop CI and macOS release automation are absent.
10. Update rollback is advisory (data-side restore is the real path); federation DR is modeled.
11. Alerting, distributed tracing, capacity forecasting are absent.

---

## 10. Recommendation

Ship as a **Validated Release Candidate**. The Enterprise Validation Program itself
is **complete and evidence-backed**: the platform's core is measured, its failure
modes are proven, its deployment assets are validated, and every artifact is
reproducible from `bench/` and `docs/validation/`.

Do **not** market the platform as "Enterprise Proven," FedRAMP/HIPAA/SOC 2
certified, or as running in named production customers — none of that is true, and
the evidence base does not support it. The honest, defensible claim is: *"NeuroPause
has a reproducible Enterprise Validation Program; its backend is production-validated
under load and fault injection on a reference environment, with a documented,
prioritized path (§9) to full Enterprise GA."*

Close §9 items 1–2 (security) and 4 (desktop benchmarks) first — they are the
highest-leverage steps from **Validated RC** toward **Enterprise GA**.

---

*Reproducibility: harnesses in `bench/` (`http-load.mjs`, `db-latency.mjs`,
`startup.sh`, and the `__bench__` engine test), raw results in
`bench/results/*.json`, narrative evidence in `docs/validation/`. Re-running the
harnesses against a live backend regenerates these measurements within normal
run-to-run variance — the recorded artifacts are the point-in-time record.*
