# Changelog

All notable changes to NeuroPause are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0-rc.1] — Enterprise Release Candidate

The first release candidate: a complete Enterprise AI platform across the desktop
(Electron + React) and backend (Node + Express + Postgres + Redis + Qdrant),
delivered incrementally and consolidated for production readiness. Anything modeled,
partial, or absent is labelled honestly — see
[`ENTERPRISE-GA-REPORT.md`](ENTERPRISE-GA-REPORT.md).

### Platform
- **Foundation & Experience** — secure Electron shell, backend-brokered OAuth (PKCE/RFC 8252), intent-native home.
- **Enterprise Business Platform, Modules & Certification** — family-grouped modules with a certification matrix.
- **Product Operations, Enterprise Administration, Enterprise Intelligence** — reuse-only control surfaces.
- **Knowledge, Automation, Collaboration, Federation, Commercial, Developer** platforms.
- **Enterprise AI Operating Platform** — the plan → reason → orchestrate → simulate → decide → govern → learn operating layer.
- **Enterprise Runtime, Cloud & Deployment** — backend Prometheus `/metrics`, real Kubernetes manifests + Helm chart, offline/air-gapped bundle, backend + deploy-validation CI.
- **Enterprise Platform Ecosystem (Extensibility)** — the platform-extensibility control plane.

### Enterprise GA hardening (this RC)
- **Security/authenticity:** gated the backend demo store seed behind `SEED_STORE_ON_BOOT` — production now starts with an empty catalog (no fabricated apps, ratings, or download counts).
- **Testing:** collected previously-orphaned renderer model tests into the standard test gate and fixed a stale assertion.
- **Documentation:** added the enterprise operator set — Administrator, Security, Operations, and Disaster Recovery guides, a release checklist, a documentation index, `LICENSE`, and a root `SECURITY.md` — and corrected a stale root `README` status.

### Known limitations (honest, pre-GA)
- Apple `id_token` signature is not yet verified against JWKS; marketplace-app install accepts unsigned packages when the trust store is empty.
- Update rollback is advisory (data-side recovery is the real path); federation disaster recovery is modeled.
- No alert routing, distributed tracing, or capacity forecasting; no macOS release automation; no coverage instrumentation; renderer component/E2E and accessibility tests are absent.

The full, evidence-based readiness classification (**Release Candidate**) is in
[`ENTERPRISE-GA-REPORT.md`](ENTERPRISE-GA-REPORT.md).

### Enterprise Validation Program (operational proof)
- Executed the RC evidence: stood up the real backend against real Postgres + Redis and **measured** it — HTTP load (24,000 requests, 0 errors), sub-ms database latency, intelligence-engine timings, Argon2id cost, and cold-start/restart — with reproducible harnesses in [`bench/`](bench/) and raw results in `bench/results/`.
- **Reliability/chaos** run against the live process: migration idempotency, exact backup/restore, restart recovery (0.46 s), Redis-down fail-open, and Postgres-down degrade-and-auto-reconnect — all passing.
- **Deployment validation** with real tools (`kubernetes-validate` strict PASS, `shellcheck` clean) and five reference **vertical validation** packs (Manufacturing, Healthcare, Agriculture, Financial, Government) — reference deployments + protocols with compliance **self-assessment mappings only** (no certifications, no named customers).
- Outcome: **Validated Release Candidate** (~76/100), documented in [`ENTERPRISE-VALIDATION-REPORT.md`](ENTERPRISE-VALIDATION-REPORT.md) with an evidence-tied path to GA. No features, no new platform.

[1.0.0-rc.1]: https://github.com/dishantdobariya91-debug/neuropause-desktop
