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

### Scientific & Standards Program (formalization)

- Formalized the implemented platform into an internal **engineering-science reference** ([`docs/science/`](docs/science/README.md), 23 documents) — a documentation-only layer that adds no runtime and duplicates no system.
- Introduced an **evidence ladder** (L0 Proposed · L1 Modeled · L2 Implemented · L3 Measured · L4 Validated) applied to every concept, plus five scientific matrices (Capability, Evidence, Measurement, Validation, Standards).
- Eight framework sciences (Ontology, Observation, Measurement, Validation, Assurance, Prediction, Replication, Standards), a 65-row **reference-implementation matrix** (51 Implemented / 3 Partial / 2 Modeled / 8 Future / 1 not-claimed), a benchmark framework, and ten manuals.
- Honesty-preserving throughout: **no fabricated proofs, benchmarks, peer review, or certifications**; prediction is honestly held mostly **L0** (no statistical forecasting engine); standards are adopted-external/internal-convention with **no certification claimed**. Full report: [`SCIENTIFIC-STANDARDS-REPORT.md`](SCIENTIFIC-STANDARDS-REPORT.md).

### Global Ecosystem & Adoption Program (enablement)

- Built the **adoption surface** over the unchanged platform ([`docs/adoption/`](docs/adoption/README.md), 23 new artifacts) — eleven frameworks (Customer Success, Partner Ecosystem, Developer Ecosystem, Marketplace Growth, Research & Academic, Open-Source Strategy, Training & Education, Deployment Program, Documentation Architecture, Community Governance, Business Expansion) plus five adoption-readiness matrices.
- Added real, actionable contributor artifacts: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SUPPORT.md`, `CODEOWNERS`, and `.github/` issue + pull-request templates — grounded in the real quality gates and Conventional Commits.
- Honesty-preserving and independently reviewed: **no invented customers, certifications, market share, revenue, community metrics, or published papers**; open source is an explicitly **proposed** path (the license is proprietary); pricing is a framework over the real `trial/starter/professional/enterprise` plans with no set prices; maturity stated as Validated RC. No platform code changed. Full report: [`GLOBAL-ADOPTION-REPORT.md`](GLOBAL-ADOPTION-REPORT.md).

### Enterprise Operations & Scale Program (operations)

- Wrote the **internal operating manual** for running NeuroPause at scale ([`docs/operations/`](docs/operations/README.md), 11 frameworks) — enterprise operations, customer support, SRE, security operations, release operations, business operations, developer operations, executive operations, global scaling, compliance operations, and continuous improvement.
- Quantitative spine is **measured**: capacity math derives from the EVP benchmarks (one 2-vCPU replica ≈ 400–600 rps DB reads at 0 errors, ~230 MB RSS, ≤10 DB connections, Argon2 ~50 verifies/s/core, 0.46 s restart); fleet numbers are labelled projections; SLIs come from the real `/metrics`+`/health`+`audit_log` substrate.
- Honesty-preserving and independently reviewed: **there is no production fleet**, so SLOs are proposed targets and no achieved uptime/MTTR/availability exists; **no fabricated customers, revenue, KPIs, or operational metrics**; SOC 2 / ISO 27001 content is **readiness-mapping only** (not certified, no audit occurred); operational maturity is honestly early (Initial→Defined). No platform code changed. Full report: [`ENTERPRISE-OPERATIONS-REPORT.md`](ENTERPRISE-OPERATIONS-REPORT.md).

[1.0.0-rc.1]: https://github.com/dishantdobariya91-debug/neuropause-desktop
