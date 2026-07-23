# GEAP Grounding — REAL ASSETS + ANTI-FABRICATION RULES (authoring anchor)

> Shared source of truth for every Global Ecosystem & Adoption Program (GEAP)
> document. GEAP is an **adoption-enablement** program: it produces the guides,
> playbooks, frameworks, and actionable artifacts that let customers, partners,
> developers, researchers, and enterprises adopt the **existing** platform. It
> **adds no runtime, no architecture, and no platform.** Every artifact must be
> **actionable** (a checklist, template, command, workflow, or step-by-step) and
> **grounded** in a real asset below or in the prior program reports.

## Hard anti-fabrication rules (non-negotiable)

1. **No invented customers.** Never name or imply a real customer, logo, deployment, or case study. Use **personas and segments** ("a mid-market manufacturer would…").
2. **No certifications held.** NeuroPause holds **no** certification. All certification content is a **roadmap / control-mapping / exam-preparation** framing — explicitly "not a certification."
3. **No market adoption, market share, community metrics, revenue, or user counts.** Provide **frameworks and models**, never numbers presented as achieved. No "X downloads", "Y partners", "$Z revenue".
4. **Open source is PROPOSED, not current.** The repository license is **Proprietary — All Rights Reserved** (`LICENSE`). Never say NeuroPause "is open source" or "has a community of contributors." OSS content is an explicitly **proposed future path** and internal/partner contribution process.
5. **No published papers / peer review / research collaborations.** Research content is **enablement** (how one _could_ reproduce, cite, or collaborate). Reproducible datasets that genuinely exist (the bench fixtures) may be cited.
6. **Pricing is a framework**, grounded in the real tiers that exist in code (`free`/`starter`/`professional`/`enterprise`); never claim market-validated prices or revenue.
7. **Status is honest:** the platform is a **Validated Release Candidate** (`ENTERPRISE-VALIDATION-REPORT.md`) — not GA, not "proven in production at scale." Adoption artifacts must not overstate maturity.
8. **Build on, don't duplicate.** Cite and extend the existing docs; never restate or fork a system.

## Real adoption assets (cite these)

### Existing documentation (build on these)

- **Getting started:** `docs/guides/INSTALLATION.md`, `QUICK-START.md`, `TROUBLESHOOTING.md`; root `README.md`; `docs/AUTHENTICATION.md`.
- **Operators:** `docs/guides/{ADMINISTRATOR,SECURITY,OPERATIONS,DISASTER-RECOVERY,RELEASE-CHECKLIST}-GUIDE.md`.
- **Deployment:** `docs/DEPLOYMENT.md`, `deploy/README.md`, `deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`, `scripts/build-offline-bundle.sh`.
- **Validation evidence (EVP):** `docs/validation/` (PERFORMANCE-BENCHMARKS, RELIABILITY-RESULTS, DEPLOYMENT-VALIDATION, REFERENCE-ARCHITECTURES, DEPLOYMENT-PLAYBOOKS, OPERATIONAL-RUNBOOKS, 5 vertical packs) + `bench/results/*.json`.
- **Science (NSSP):** `docs/science/` (23 docs; evidence ladder L0–L4).
- **Enterprise / ecosystem / federation:** `docs/enterprise/` (13), `docs/ecosystem/` (12), `docs/federation/` (8).
- **Reports:** `ENTERPRISE-GA-REPORT.md` (Release Candidate), `ENTERPRISE-VALIDATION-REPORT.md` (Validated RC), `SCIENTIFIC-STANDARDS-REPORT.md`, `PHASE-2..5-REPORT.md`, `CHANGELOG.md`.

### SDK (developer enablement) — `packages/sdk`

- `NeuroPauseClient` + resources: `OAuthResource`, `ConnectorsResource`, `MarketplaceResource`, `EnterpriseResource`, `WorkersResource`, `BillingResource`, `UsageResource`, plus `WebhookEvent`, `HttpTransport`, `WorkerSpec`, `PackageDefinition`. 15 tests.

### CLI (operator/developer enablement) — `packages/cli`

- Real command surface (`commands.ts`, `cli.ts`, `args.ts`): resources incl. `connectors`, `billing`, `crm`/`crm-contacts`, `automation`, `context`, `api-key`, auth (`client-id`/`client-secret`/`base-url`). 30 tests.

### Marketplace / store (marketplace-growth) — real

- Backend store (`apps/backend/src/store/*`): `apps`, `categories`, `featured`, `collections`, `reviews`, `trending`, `developers` (publishers), `versions`, install/download/uninstall. Query requires `status='published'`.
- Desktop marketplace + package service (`apps/desktop/src/main/{marketplace,nps}/*`): signature verification (`verifySignature`/`verifyManifest`, Ed25519), publisher trust, worker install fail-closed. **Open item:** unsigned app install allowed when trust store empty.
- Ecosystem exchange (`apps/desktop/src/main/ecosystem/exchange/*`): packs + partners directory — **production seed empty** (no fabricated install counts; tested).

### Commercial / pricing (business-expansion) — real

- Tiers in code: **`free` · `starter` · `professional` · `enterprise`** (`RAZORPAY_PLAN_*`, `pricing_plans` table). Types: `billing.ts`, `commercialPlatform.ts`, `customers.ts`, `subscriptions`. Billing router/service/webhook (Razorpay). Frame pricing as a **framework over these real tiers** — no revenue claims.

### Developer / partner platform — real

- `developerPlatform.ts`, developer portal, plugin SDK (`docs/runtime/PLUGIN-SDK.md`), connector SDK (`docs/connectors/*`). Partner surfaces: ecosystem partners directory, marketplace publishers/verification.

### License & community (honest gaps)

- `LICENSE` = **Proprietary, All Rights Reserved**. Root `SECURITY.md` exists.
- **Absent (real gaps GEAP fills honestly):** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `SUPPORT.md`. These may be authored as real, actionable artifacts — framed for internal/partner contributors and an explicitly proposed public path (given the proprietary license).

## Authoring rules

1. Every artifact is actionable and cites a real asset or a prior report.
2. Personas/segments, never named customers. Frameworks/models, never fabricated metrics.
3. Certification = mapping/prep only. OSS = proposed (proprietary license). Research = enablement, no papers.
4. Honest maturity: Validated RC, not GA. Carry known open items (Apple JWKS, unsigned install, no macOS CI) where relevant.
5. Adoption, not architecture — no new runtime/platform/system.
