# NeuroPause — Business Expansion Framework (GEAP)

> **What this is.** An **adoption-enablement** framework for packaging, positioning,
> and selling the **existing** NeuroPause commercial surface. It adds no billing
> engine, no runtime, and no new tier — it structures what is already in code:
> the subscription plans `free`/`starter`/`professional`/`enterprise`
> (`packages/shared/src/types/billing.ts`, `apps/backend/src/billing/*`,
> `RAZORPAY_PLAN_*`), the commercial view-model
> (`packages/shared/src/types/commercialPlatform.ts`), and the CRM customer domain
> (`packages/shared/src/types/customers.ts`).
>
> **Anti-fabrication guardrails (binding).** No customers, revenue, ARR, pipeline,
> win rates, market share, or TAM appear here — none exist to cite. Pricing is a
> **framework over the real tiers**: it proposes _structure_ (what each tier
> includes, the value metric) and attaches **no set dollar amounts**. Any number
> used to illustrate mechanics is explicitly labelled _"illustrative placeholder,
> not a set price."_ Every value proposition cites a **real, measured** capability.
> Maturity is stated honestly: **Validated Release Candidate** (`1.0.0-rc.1`,
> `ENTERPRISE-VALIDATION-REPORT.md`) — not GA.
>
> **Companion docs:** `docs/adoption/ADOPTION-MATRICES.md` (readiness backbone),
> `docs/adoption/PARTNER-ECOSYSTEM.md` (partner program — see §7).

---

## 1. Pricing strategy framework

### 1.1 The real tiers (source of truth)

Four subscription plans exist in `BILLING_PLANS` (`packages/shared/src/types/billing.ts`).
Each plan grants a coarse **feature-gating bucket** (`PlanTier`: `free`/`pro`/`enterprise`)
and carries **included seats** billed per-seat above the base. Enterprise is
**sales-assisted** (`selfServe: false`); the checkout route refuses it with
`not_self_serve` → "contact us" (`apps/backend/src/billing/router.ts`).

| Plan (real `BillingPlanId`)       | Gating tier  | Included seats | Trial   | Self-serve              | Motion                       |
| --------------------------------- | ------------ | -------------- | ------- | ----------------------- | ---------------------------- |
| **Free / Trial** (`trial`)        | `free`       | 5              | 14 days | Yes                     | Product-led evaluation       |
| **Starter** (`starter`)           | `pro`        | 3              | —       | Yes (Checkout)          | Self-serve, small team       |
| **Professional** (`professional`) | `pro`        | 10             | —       | Yes (Checkout)          | Self-serve, growing team     |
| **Enterprise** (`enterprise`)     | `enterprise` | 25             | —       | **No — sales-assisted** | Sales + solution engineering |

> Honest nuance: **Starter and Professional share the `pro` gating bucket** — they
> differ on **seats and capacity**, not on the feature set. The tier jump that
> unlocks _new capabilities_ is `pro → enterprise`. Design packaging around that
> reality, not around an implied Starter/Professional feature wall.

### 1.2 Packaging logic (value metric)

The **primary value metric is the active seat** (per-seat billing above the included
base — `billing.ts`). Two **secondary meters** already exist in the commercial
view-model to express expansion and overage without changing the seat model:

| Lever                | Real basis                                                                                                       | Packaging use                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Seats** (primary)  | `includedSeats` + per-seat overage (`billing.ts`)                                                                | Base value metric; grows with team adoption          |
| **Usage meters**     | `CommercialBilling.includedRequests`/`overageRequests`, `CommercialMetering.meters` (`requests30d`, `aiCostUsd`) | Capacity signal / optional overage, not a second SKU |
| **Capability gates** | Feature flags gated by `minPlan` (`apps/backend/src/featureFlags/`)                                              | Tier differentiation (§1.3)                          |
| **Deployment mode**  | `DeploymentModeId` (`commercialPlatform.ts`)                                                                     | Enterprise dimension (§2)                            |

### 1.3 Capability gating (real, tested)

Tier differentiation is enforced by the feature-flag catalog (`evaluateFlag`:
override → plan gate → default; tests in `featureFlags/flagCore.test.ts`,
`flagService.test.ts`). Verified gates:

| Flag                 | Min plan         |   Free   | Pro (Starter/Pro) | Enterprise |
| -------------------- | ---------------- | :------: | :---------------: | :--------: |
| `automation_builder` | free             |    ✅    |        ✅         |     ✅     |
| `cloud_sync`         | pro              |    —     |        ✅         |     ✅     |
| `advanced_analytics` | pro              |    —     |        ✅         |     ✅     |
| `multi_workspace`    | enterprise       |    —     |         —         |     ✅     |
| `ai_memory_search`   | (catalog member) | per gate |     per gate      |  per gate  |

This is the honest packaging spine: **what each tier includes is already codified**.
The framework's job is to _name_ and _position_ it, not to invent a price.

### 1.4 On price points

**No dollar figure in this document is a set or validated price.** The tiers'
monetary values are configured server-side (`RAZORPAY_PLAN_STARTER/PROFESSIONAL/ENTERPRISE`
in env — never hard-coded, so metadata can't drift from what the gateway charges).
A worked example — _"$X/seat/month with 10 included seats" is an **illustrative
placeholder, not a set price**_ — is only ever used to demonstrate the per-seat
mechanic. Separately, the **marketplace** `pricing_plans` table
(`0002_store.sql`: `price_cents`, `currency`, `interval`, `features`) prices
**third-party listings**, and is distinct from platform subscription pricing; do
not conflate the two.

---

## 2. Enterprise packaging

The Enterprise plan (`enterprise`, sales-assisted, `enterprise` gating tier,
25 included seats) bundles controls that already exist in code. Every row cites a
real asset; where a surface is present but **not yet wired to a live external
system**, it is labelled honestly.

| Bundle area        | Real capability                                                                                                                      | Evidence                                                                                 | Maturity                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **SSO / identity** | Backend-brokered OAuth **PKCE (RFC 8252)**, no client secrets; SSO/MFA/SCIM surface (`cloud/IdentityPanel`)                          | `apps/backend/src/auth/`, SPRINT-4 §5                                                    | Auth real; **live enterprise-IdP / SAML / PIV-CAC federation is MODELED** (GOVERNMENT.md §2.1) — scope as integration |
| **RBAC**           | Fail-closed IPC permission gate; least-privilege roles Owner/Admin/Manager/Member/Viewer/AI-Worker; startup classification invariant | `ipc/secureBridge.ts`, `ipc/runtimeAuthz.ts`, `enterprise/org/seed.ts` (FINANCIAL.md §1) | **Real + tested**                                                                                                     |
| **Audit**          | Append-only `audit_log` (INSERT-only writer, non-blocking); desktop IPC audit trail                                                  | `db/migrations/0001_init.sql`, `middleware/audit.ts`, `ipc/secureBridge.ts`              | Real; **backend coverage is auth-events-only today** — extend call sites before go-live (FINANCIAL.md §2.2)           |
| **Deployment**     | 5 modes (`cloud_saas`/`private_cloud`/`hybrid`/`on_premises`/`air_gapped`); Docker/Compose/K8s/Helm + offline bundle; hardened pods  | `commercialPlatform.ts`, `deploy/*`, DEPLOYMENT-VALIDATION.md                            | K8s **kubernetes-validate strict PASS**; offline bundle **PARTIAL** (needs Docker daemon)                             |
| **Support**        | Support-bundle generator, diagnostics, crash/telemetry (opt-in, local)                                                               | `main/support/supportBundle.ts`, SPRINT-4 §6                                             | Tooling real; **support-tier/SLA model is a framework** (ADOPTION-MATRICES §4, "Support = Gap")                       |
| **Licensing**      | Subscription **is** the license entitlement; `evaluateLicense` → valid/grace/invalid + entitled plan; 7-day grace                    | `main/license/`, SPRINT-4 §6                                                             | Real; enforcement wiring is an open item                                                                              |

**Segregation of duties is representable, not bolted on.** `workforce:operate`
(Member) is a distinct scope from `workforce:approve` (Manager); billing checkout
requires `org:manage` (Admin/Owner); the AI-Worker role holds only read scopes and
**cannot operate, approve, or spend** (FINANCIAL.md §1.3). This is the enterprise
governance story — sell it on the tested RBAC taxonomy, not on aspiration.

---

## 3. Customer segmentation

No named accounts — **personas and segments only** (grounding rule 1). Buying roles
map to the **real** RBAC roles, which is a genuine differentiator: the org chart is
enforceable in the product.

### 3.1 By size / motion

| Segment                   | Plan fit     | Seats | Motion                   | Primary persona                |
| ------------------------- | ------------ | ----- | ------------------------ | ------------------------------ |
| Solo evaluator / champion | Free/Trial   | ≤5    | Product-led              | Technical evaluator            |
| Small team                | Starter      | ~3    | Self-serve Checkout      | Team lead (Admin/Owner)        |
| Growing team / mid-market | Professional | ~10   | Self-serve + light-touch | Ops owner + security reviewer  |
| Large / regulated org     | Enterprise   | 25+   | Sales-assisted + SE      | Economic buyer + 2nd-line risk |

### 3.2 By buying persona (maps to real roles)

| Persona                        | Real role / scope                                        | What they need from us                                   |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| Economic buyer                 | **Owner** (`ALL_ENTERPRISE_PERMISSIONS`) — root of trust | Business case, TCO framing, expansion path               |
| Platform / structure admin     | **Admin** (`org:manage`, `governance:manage`)            | Deployment kits, SSO/RBAC config, tenancy                |
| Approver / control owner       | **Manager** (`*:approve`)                                | SoD story, audit evidence, maker-checker                 |
| End user                       | **Member** (`*:operate`) / **Viewer** (`*:read`)         | Workflow value, onboarding, time-to-first-brief          |
| Security / compliance reviewer | (evaluates, not a role)                                  | EVP evidence bundle, control mapping, open-items honesty |

### 3.3 By deployment posture

Cloud SaaS self-serve (Starter/Professional) vs **sovereign / regulated**
(Enterprise on-prem, private-cloud, or **air-gapped**). Posture — not size — is
often the true segment boundary: an air-gap requirement pulls even a small buyer
into Enterprise sales-assisted motion because the offline bundle and self-hosting
are the deliverable.

---

## 4. Industry positioning (the 5 EVP vertical packs)

Positioning is grounded strictly in `docs/validation/verticals/*`. Each pack names a
**real fit** and an **explicit boundary** — lead with the fit, disclose the boundary.

| Vertical          | Position on (real strength)                                                                                                | Do **not** claim (honest boundary)                                                                           | Pack                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Manufacturing** | Operator workflows, sandbox/validation, auditability, on-prem/**air-gapped shop-floor island**, enterprise intelligence    | Live OT — no PLC/SCADA/MES/historian drivers; digital-twin surfaces are **MODELED**                          | `verticals/MANUFACTURING.md` |
| **Healthcare**    | AI operating layer for **administrative & knowledge** work; append-only audit; RBAC; proven backup/restore for contingency | **Not** a medical device/EHR; **not** for clinical decisions; HIPAA/SOC 2 = **self-assessment mapping only** | `verticals/HEALTHCARE.md`    |
| **Agriculture**   | **Local-first / offline** (strongest fit); signed-retried-dead-lettered webhook automation                                 | Sensor/IoT (MQTT/OPC-UA/LoRaWAN) is **MODELED**, not wired                                                   | `verticals/AGRICULTURE.md`   |
| **Financial**     | Governance/RBAC, **segregation of duties**, append-only audit, business continuity                                         | **Not** a CDE; stores no PAN; SOC 2/PCI = **self-assessment mapping only**                                   | `verticals/FINANCIAL.md`     |
| **Government**    | Self-hosted/on-prem/**air-gapped**, hardened K8s, NIST SP 800-53 self-assessment mapping                                   | **No ATO / no FedRAMP**; SSO/PIV-CAC federation **MODELED**                                                  | `verticals/GOVERNMENT.md`    |

**Cross-vertical throughline for sales:** the common buyer value is _deploy inside
your boundary, govern it with enforced RBAC, prove it with an append-only audit
trail and reproducible EVP evidence._ The vertical packs are the reusable technical
proof — hand the relevant pack to the reviewer; do not re-derive claims.

---

## 5. Value propositions (each tied to measured evidence)

Every proposition below cites a **measured** result. Numbers come from the reference
2-vCPU box with a co-located load client — a **conservative floor**, not an SLA.
Do not alter figures when re-citing.

| #   | Proposition                                                       | Evidenced capability                                                                                                                                                                         | Citation                                                                        |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| V1  | **Survives infrastructure failure without operator intervention** | DB-down → process survives, clean 500s, **pool auto-reconnects with no restart**; Redis-down **fail-open**; restart→healthy **0.46 s**; backup/restore **exact row-count match**             | RELIABILITY-RESULTS.md; `bench/results/reliability.json`                        |
| V2  | **Fast and stable under sustained load**                          | **24,000 requests, 0 errors** (conc 32); DB **sub-ms** p50/p95; cold start→healthy **0.66 s**; pool auto-scaled 1→10                                                                         | PERFORMANCE-BENCHMARKS.md; `bench/results/http-load.json`                       |
| V3  | **Security controls are real and tested**                         | Argon2id (OWASP-aligned, ~20 ms), PKCE OAuth, refresh **rotation + reuse detection**, Ed25519 signing, SSRF guard, fail-closed RBAC, **0 production npm-audit vulns**                        | vertical security checklists (e.g. HEALTHCARE.md §4); `ENTERPRISE-GA-REPORT.md` |
| V4  | **Deploy in your own boundary — cloud, on-prem, or air-gapped**   | Docker/Compose/K8s/Helm; K8s **kubernetes-validate strict PASS**; hardened pods (non-root, RO-rootfs, drop ALL caps, seccomp); loopback-bound offline bundle                                 | DEPLOYMENT-VALIDATION.md; GOVERNMENT.md §1                                      |
| V5  | **Governance & auditability by construction**                     | Least-privilege RBAC + SoD taxonomy; **append-only** `audit_log`; startup classification invariant fails closed                                                                              | FINANCIAL.md §1–2                                                               |
| V6  | **Local-first compute that runs offline**                         | Deterministic intelligence engines over **5,000 entities** complete **far under the 2,000 ms budget** (graph.project ~93 ms; query paths single-digit ms) — no network, no model credentials | PERFORMANCE-BENCHMARKS.md §5; AGRICULTURE.md §3                                 |
| V7  | **Engineering quality signal**                                    | typecheck 0, lint 0, **3,856 tests pass**, build exit 0                                                                                                                                      | PERFORMANCE-BENCHMARKS.md §7                                                    |

> Every proposition ships with its evidence and its **caveat**. V3 carries two open
> HIGH items (§6); V4's offline bundle is **PARTIAL**; V5's backend audit coverage is
> **auth-only today**. Selling the caveat with the claim is the credibility strategy.

---

## 6. Sales enablement

### 6.1 Discovery questions (grounded in real decision points)

1. **Deployment posture?** Cloud SaaS, private cloud, on-prem, or **air-gapped**?
   (Determines plan/motion — air-gap ⇒ Enterprise. `commercialPlatform.ts` modes.)
2. **Identity source?** Which IdP, and is **SAML/OIDC/PIV-CAC federation** required?
   (Surface exists; **live federation is MODELED** — scope it, GOVERNMENT.md §2.1.)
3. **Seat count now / in 12 months?** (Primary value metric; sizes tier + expansion.)
4. **Regulatory regime?** HIPAA / SOC 2 / PCI / NIST 800-53? (We provide **control
   mappings**, not certifications — set expectation early.)
5. **Audit / SIEM requirements?** Which privileged events must be captured and
   forwarded? (Trail is append-only; **coverage extension may be pre-production work**.)
6. **Systems to connect?** (Connector framework is real; specific adapters may be
   build-and-validate work.)
7. **Availability expectations?** (Map to measured reliability floor — V1/V2 — and
   re-measure on their hardware.)

### 6.2 Evidence-based objection handling

| Objection                                | Evidence-based response                                                                                                          | Cite                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| "Is it production-ready?"                | Honest: **Validated RC (`1.0.0-rc.1`)**, not GA. Extensively validated with reproducible evidence; two HIGH items remain (§6.3). | `ENTERPRISE-VALIDATION-REPORT.md`    |
| "How does it perform?"                   | 24k requests / **0 errors**, sub-ms DB, 0.66 s cold start — on a conservative 2-vCPU floor; re-measure on your box.              | PERFORMANCE-BENCHMARKS.md            |
| "What happens when something breaks?"    | DB-down auto-recovers with no restart; Redis fail-open; 0.46 s restart; exact-fidelity restore.                                  | RELIABILITY-RESULTS.md               |
| "Is it secure?"                          | Tested control checklist + **0 prod vulns** — _and_ we disclose the open items (Apple JWKS, unsigned-install).                   | vertical §4; GA report               |
| "Can we run it air-gapped?"              | Yes — offline bundle, loopback-bound, fail-closed loader. Honest: full `docker save/load` is **PARTIAL** pending a daemon.       | AGRICULTURE.md §3; GOVERNMENT.md §1  |
| "Do you have SSO/SCIM?"                  | Surfaces exist; **live enterprise-IdP federation is an integration to scope**, not a shipped connector.                          | GOVERNMENT.md §2.1                   |
| "Are you HIPAA/SOC 2/FedRAMP certified?" | **No certification is held or claimed.** We provide self-assessment **control mappings** to feed your own audit/A&A.             | HEALTHCARE.md §7; GOVERNMENT.md §5.3 |
| "What's your audit coverage?"            | Append-only trail is real; **backend coverage is auth-events-only today** — extending call sites is a bounded, pre-go-live task. | FINANCIAL.md §2.2                    |

### 6.3 Honest maturity + open items (carry into every deal)

| Item                                                                  | Severity | Disposition                                                                                 | Source                    |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| Apple `id_token` not JWKS-verified                                    | **HIGH** | Disable Apple provider / federate to vetted IdP until fixed                                 | `auth/providers/apple.ts` |
| Marketplace **app** install accepts unsigned pkg on empty trust store | **HIGH** | Provision non-empty Ed25519 trust store; disable 3rd-party app install for regulated builds | `nps/packageService.ts`   |
| Rate limiter **fails open** on Redis outage                           | MED      | Deliberate availability choice; make it **alertable**; compensate at gateway/WAF            | `middleware/rateLimit.ts` |
| No per-PR desktop / macOS release CI                                  | MED      | Require signed reproducible desktop builds before fielding                                  | `.github/workflows/`      |
| No alerting / tracing / capacity forecasting                          | MED      | Day-2 monitoring is operator-wired; `/metrics` + logs exist to scrape                       | GA report TD-6            |
| SSO/federation, federation DR                                         | MODELED  | Scope as integration; do not represent as tested                                            | GA report §3              |
| Offline bundle                                                        | PARTIAL  | Script clean + documented; execute image round-trip on target                               | RELIABILITY-RESULTS.md §6 |

Maturity is a **trust asset**, not a liability — a validated RC with a published gap
catalog outsells an unqualified "GA" claim to a security reviewer.

---

## 7. Partner enablement

Partner motion is documented in **`docs/adoption/PARTNER-ECOSYSTEM.md`** (companion
GEAP artifact; ADOPTION-MATRICES §2 rates partner enablement **Partial**). Summary of
the real hooks it builds on — do not duplicate that doc here:

- **Marketplace publishers / trust:** Ed25519 signature + manifest verification,
  publisher trust store (`apps/desktop/src/main/nps/*`). _Open item:_ unsigned app
  install on empty trust store (§6.3).
- **Technology partners:** SDK (`packages/sdk`, 7 resources incl. `BillingResource`),
  CLI (`packages/cli`), connector SDK, signed webhooks (HMAC-SHA256, SSRF-guarded).
- **Implementation partners:** deployment kits, operational runbooks, and the 5
  vertical packs are the reusable delivery evidence.
- **Ecosystem directory:** partners surface exists; **production seed is empty** — no
  fabricated partner counts (grounding rule 3).

See `PARTNER-ECOSYSTEM.md` for tiers, obligations, lifecycle, and the certification
**roadmap** (mapping/prep only — no certification is held).

---

## 8. Expansion roadmap (land → expand framework)

A **motion framework**, not a forecast — no adoption, conversion, or revenue numbers
(none exist to cite). Every lever maps to a real product mechanic.

### 8.1 The motion

| Stage                   | Plan                          | Trigger to advance                                    | Real mechanic                                                            |
| ----------------------- | ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| **Land — evaluate**     | Free/Trial (14 days, 5 seats) | Team activated, first value realized                  | Trial subscription; product-led                                          |
| **Land — commit**       | Starter                       | Small team standardizes                               | Self-serve Checkout (`/billing/:orgId/checkout`)                         |
| **Expand — capacity**   | Professional                  | Seat pressure / usage growth                          | Per-seat + usage meters (§1.2); `pro` capabilities                       |
| **Expand — enterprise** | Enterprise                    | SSO/RBAC/audit/deployment/support or **air-gap** need | Sales-assisted; `enterprise` gates (`multi_workspace`), deployment modes |

### 8.2 Expansion levers (all real)

- **Seats** — primary metric; per-seat overage above the included base.
- **Usage** — request / AI-cost meters as optional overage, not a second SKU.
- **Capability unlock** — feature flags gated `pro`/`enterprise` (§1.3).
- **Deployment upgrade** — cloud → private-cloud → on-prem → air-gapped.
- **Vertical solution adoption** — lead a vertical pack in as a land-and-expand wedge.

### 8.3 Health & renewal signals (framework, no fabricated scores)

The commercial view-model already exposes the **shape** of expansion signals —
`CommercialCustomers.{healthOverall, adoptionScore, onboardingSteps, renewalRisk,
daysToRenewal}` and CRM health/tier logic (`customers.ts`:
`calculateCustomerHealth`, `calculateCustomerTier`, `recommendNextEngagement`). Use
these **fields** as the renewal/expansion dashboard schema; **populate them from real
tenant telemetry**, never with invented values. Licensing ties the loop:
`evaluateLicense` yields the **entitled plan** and a **7-day grace window**, so
renewal risk and downgrade behavior are already deterministic (SPRINT-4 §6).

---

## Bottom line

NeuroPause has a **real, code-grounded commercial surface** — four subscription
tiers, per-seat value metric, tested RBAC/audit/deployment controls, and reproducible
EVP evidence — ready to be **packaged and positioned** without inventing a single
customer, price, or metric. Sell the measured capability, disclose the open items,
and drive the land→expand motion on the mechanics that already exist. Maturity:
**Validated Release Candidate**, honestly stated.
