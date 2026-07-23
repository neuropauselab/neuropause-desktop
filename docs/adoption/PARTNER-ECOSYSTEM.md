# NeuroPause Partner Ecosystem Framework

> A GEAP **adoption-enablement** artifact. It defines the partner _program_
> structure, enablement paths, lifecycle, governance, and metric definitions that
> let partners deploy, integrate, operate, and advise on the **existing** platform.
> It adds no runtime and no architecture — only program design mapped onto assets that already exist in the repo.

## 0. How to read this (grounding + honesty)

- **Adoption, not architecture.** Every path routes to a real guide, SDK, CLI, or code surface. Nothing here ships new code.
- **Maturity is honest.** NeuroPause is a **Validated Release Candidate** (`ENTERPRISE-VALIDATION-REPORT.md`), not GA. Partner claims inherit that status — no "enterprise-proven at scale."
- **License is Proprietary — All Rights Reserved** (`LICENSE`). Partner rights flow only from a signed agreement, never from repo access; any open-contribution motion is a **proposed** future path, not a current right.
- **No named partners, no counts.** The partner directory is real code (`partnersStore.ts`) but its **production seed is empty** — the hard-coded sample list is a demo-only fixture gated behind `demoSeedsEnabled()` / `NP_DEMO_SEEDS` and asserted empty by `ecosystemProdSeed.test.ts`. This framework **names no partner and asserts no count.**
- **Certification is a roadmap only.** §6 is an exam **blueprint + control mapping**. **NeuroPause holds no certification and this is not a certification.**
- **Metrics are definitions only.** §9 defines _how_ to measure — **no numbers, targets, or achieved results.**

---

## 1. Partner program

### 1.1 Program tracks (aligned to the real partner-type model)

The `PartnerType` enum in `packages/shared/src/types/ecosystem-exchange.ts`
defines four real partner types. Each becomes a program track with a primary
motion and a real enablement anchor.

| Track                  | Real `PartnerType`  | Primary motion                         | Enablement anchor (real asset)                                    |
| ---------------------- | ------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Implementation         | `system_integrator` | Deploy + operate for customers         | §2 · `docs/validation/DEPLOYMENT-PLAYBOOKS.md`, `docs/guides/*`   |
| Managed service        | `msp`               | Run the platform as a service          | §2 · `docs/guides/OPERATIONS-GUIDE.md`, `OPERATIONAL-RUNBOOKS.md` |
| Technology             | `technology`        | Build connectors/integrations/listings | §3 · `docs/connectors/connector-sdk.md`, `packages/sdk`           |
| Consulting             | `consulting`        | Advise, design, govern                 | §4 · vertical packs, `docs/enterprise/*`                          |
| Training (designation) | — (cross-cutting)   | Deliver enablement + courseware        | §5 · companion `TRAINING-EDUCATION.md`                            |

> **Honesty note.** "Training partner" is **not** a distinct type in code; it is a
> designation on a `consulting`/`system_integrator` partner. Its curriculum is an
> open Gap (Partner Readiness Matrix §2) that `TRAINING-EDUCATION.md` fills.

### 1.2 Program tiers (real tier vocabulary)

Tiers use the real `PartnerTier` values — **`registered` · `select` ·
`premier`** — and their real sort order (`premier` highest) from
`partnersStore.ts`. Tiers are earned, reviewed, and reversible (§8).

| Tier       | `PartnerTier` | Entry bar (checklist-gated, §7)                                                      | Representative benefits                                             | Representative obligations                                           |
| ---------- | ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Registered | `registered`  | Signed agreement; onboarding complete                                                | Directory listing; docs/SDK/CLI access; self-serve enablement       | Accept license terms; keep profile current                           |
| Select     | `select`      | ≥1 competency evidenced (§6 mapping); ≥1 successful implementation persona-validated | Co-marketing eligibility; deal registration; roadmap previews (NDA) | Maintain ≥1 skilled individual per claimed competency; annual review |
| Premier    | `premier`     | Multi-competency; multi-region or vertical depth; publisher trust ≥ `verified` (§3)  | Co-sell motion; early-access channels; named alliance contact       | Business plan; quarterly review; trust-tier maintenance              |

Partner **economics** (any fee, margin, or plan) are governed by the real customer tiers `free/starter/professional/enterprise` and belong to the companion `BUSINESS-EXPANSION.md` artifact — **no revenue or margin figures are asserted here.**

### 1.3 Benefits/obligations — quick checklist

- [ ] Benefit gated to a tier the partner has actually earned (no retroactive perks)
- [ ] Every benefit maps to a real asset or a defined program service
- [ ] Every obligation is verifiable at review time (§8)
- [ ] License compliance obligation present in every tier

---

## 2. Implementation partners

**Goal:** a partner can independently deploy, validate, and operate a customer
install. Enablement reuses the existing deployment and validation corpus — it
duplicates none of it.

### 2.1 Enablement path (real assets)

| Capability                    | Real asset to master                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Reference topologies          | `docs/validation/REFERENCE-ARCHITECTURES.md`                                                        |
| Install (Docker / K8s / Helm) | `docs/DEPLOYMENT.md`, `deploy/README.md`, `deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*` |
| Air-gapped / offline delivery | `scripts/build-offline-bundle.sh`                                                                   |
| Step-by-step deploy           | `docs/validation/DEPLOYMENT-PLAYBOOKS.md`                                                           |
| First-run + auth              | `docs/guides/INSTALLATION.md`, `docs/guides/QUICK-START.md`, `docs/AUTHENTICATION.md`               |
| Operate day-2                 | `docs/guides/{ADMINISTRATOR,OPERATIONS,SECURITY}-GUIDE.md`                                          |
| Incident response             | `docs/validation/OPERATIONAL-RUNBOOKS.md`, `docs/guides/DISASTER-RECOVERY-GUIDE.md`                 |
| Go-live gate                  | `docs/guides/RELEASE-CHECKLIST.md`, `docs/validation/DEPLOYMENT-VALIDATION.md`                      |

### 2.2 Vertical specialization (the 5 real packs)

A partner may declare a vertical specialization (`Partner.specializations`) only
against a pack that exists:

| Vertical      | Pack                                         |
| ------------- | -------------------------------------------- |
| Agriculture   | `docs/validation/verticals/AGRICULTURE.md`   |
| Financial     | `docs/validation/verticals/FINANCIAL.md`     |
| Government    | `docs/validation/verticals/GOVERNMENT.md`    |
| Healthcare    | `docs/validation/verticals/HEALTHCARE.md`    |
| Manufacturing | `docs/validation/verticals/MANUFACTURING.md` |

### 2.3 Implementation-partner readiness checklist

- [ ] Reproduced a `DEPLOYMENT-PLAYBOOKS.md` deploy end-to-end in a lab
- [ ] Validated it against `DEPLOYMENT-VALIDATION.md` expected results
- [ ] Rehearsed one `OPERATIONAL-RUNBOOKS.md` incident + one DR restore
- [ ] Walked the `RELEASE-CHECKLIST.md` go-live gate
- [ ] Read the declared vertical pack(s); no undeclared vertical claims
- [ ] Communicates **Validated RC** status to customers (no over-claiming)

---

## 3. Technology partners

**Goal:** a partner integrates with, extends, or publishes onto the platform via
the **real** developer surfaces — connector SDK, SDK, webhooks — and climbs the
real publisher trust ladder.

### 3.1 Integration surfaces (real assets)

| Surface           | Real asset                                                      | What the partner builds                                                                                 |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Connectors        | `docs/connectors/connector-sdk.md`, `connector-lifecycle.md`    | A `ConnectorManifest` (data, not code); read-only least-privilege OAuth/API-key auth                    |
| Programmatic API  | `packages/sdk/src/resources.ts`                                 | Uses `ConnectorsResource`, `MarketplaceResource`, `WorkersResource`, `BillingResource`, `UsageResource` |
| Machine auth      | `OAuthResource` (`/oauth/token`, client-credentials, OAuth 2.1) | Service-account access with scoped tokens                                                               |
| Event integration | `packages/sdk/src/webhooks.ts`                                  | HMAC-SHA256 receiver (`verifyWebhook`; `t=<ms>,v1=<hex>`, replay tolerance)                             |
| Plugins           | `docs/runtime/PLUGIN-SDK.md`                                    | Packaged extensions                                                                                     |
| CLI automation    | `packages/cli` (`connectors`, `automation`, `api-key`, auth)    | Scripted onboarding + ops                                                                               |

### 3.2 Publisher trust ladder → program mapping

Marketplace publishing is governed by the real `PublisherTier`
(`packages/shared/src/types/marketplace.ts`): **`unverified → verified → trusted
→ official`**, backed by Ed25519 signing (`apps/desktop/src/main/nps/signature.ts`).
Trust tier is a **gate for program tier**, not a substitute for it.

| `PublisherTier` | Real meaning                         | Maps to program expectation              |
| --------------- | ------------------------------------ | ---------------------------------------- |
| `unverified`    | No verified signing identity         | Pre-listing / sandbox only               |
| `verified`      | Verified publisher, signed artifacts | Minimum for `select` technology partners |
| `trusted`       | Sustained clean trust history        | Expected for `premier`                   |
| `official`      | First-party / alliance-grade         | Reserved; governance-approved only       |

Publish lifecycle (real, `MarketplaceResource`): **draft → `publishVersion` →
`submit` (scan → sign → review) → `review` → `publish`**, with `rollback`
available. Governed install returns **deny / require_approval / allow**
(`marketplaceService.ts`).

> **Carry the known open item honestly:** unsigned-app install is currently
> permitted when the trust store is empty (`signature.ts` trust-store seam).
> Technology partners MUST sign; enterprises SHOULD set `requireSignature`
> (§8). Do not present signing as fully enforced today.

### 3.3 Technology-partner checklist

- [ ] Integration uses only documented SDK/CLI/connector surfaces
- [ ] Connector declares **read-only, least-privilege** scopes (per SDK doc)
- [ ] Webhook receiver verifies HMAC signature + rejects stale timestamps
- [ ] Artifacts Ed25519-signed; publisher identity verified (≥ `verified`)
- [ ] Passed the `submit → review → publish` pipeline; rollback tested

---

## 4. Consulting partners

**Goal:** advisory partners design, govern, and de-risk adoption without
necessarily running the deployment.

- **Enablement anchors (real):** vertical packs (`docs/validation/verticals/*`), enterprise/governance corpus (`docs/enterprise/*`), security posture (`docs/guides/SECURITY-GUIDE.md`), buyer evidence (`docs/validation/{PERFORMANCE-BENCHMARKS,RELIABILITY-RESULTS}.md`, `bench/results/*`).
- **Motion:** evaluation facilitation, governance/policy design (maps to real `OrgMarketplacePolicy` knobs, §8), change management, value framing — **evidence-based, no fabricated ROI.**
- **Specialization:** declared against real vertical packs only.

Checklist:

- [ ] Uses only EVP evidence; presents **Validated RC** status accurately
- [ ] Governance recommendations map to real policy controls (§8)
- [ ] Value/ROI framed as method + persona, never invented customer numbers
- [ ] Hand-off to an implementation partner for delivery is defined

---

## 5. Training partners

**Goal:** deliver skills enablement and courseware. Training partner is a
**designation** (see §1.1), and its curriculum is an acknowledged Gap.

- **Companion artifact:** curriculum, courseware, and delivery standards live in `TRAINING-EDUCATION.md` (GEAP) — referenced, not forked.
- **Skill spine:** the three real skills of §6 — **deploy, operate, develop** — are the course domains, each tied to real assets.
- **Standard:** content cites the same real assets, inherits the same honest status; no claims of accredited certification (§6).

Checklist:

- [ ] Course domains map 1:1 to deploy / operate / develop skills
- [ ] Every module cites a real asset from §2 or §3
- [ ] Materials state "not a certification" wherever §6 content appears
- [ ] Assessment reuses the §6 blueprint (mapping), not an invented credential

---

## 6. Certification roadmap (mapping only)

> ## NOT A CERTIFICATION
>
> **NeuroPause holds no certification and confers none.** This section is a
> **proposed exam blueprint + control mapping** — a preparation and
> skills-evidence framework only. No accreditation body, proctoring, or credential
> exists. Nothing here may be marketed as "certified."

### 6.1 Skill tracks (tied to real skills)

| Track   | Real skill                                    | Evidence corpus                                                                                         |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Deploy  | Stand up + validate an install                | §2 deployment + validation assets                                                                       |
| Operate | Run day-2, respond to incidents, recover      | `docs/guides/{ADMINISTRATOR,OPERATIONS,SECURITY,DISASTER-RECOVERY}-GUIDE.md`, `OPERATIONAL-RUNBOOKS.md` |
| Develop | Build connectors/integrations, publish safely | §3 SDK / connector SDK / webhooks / publishing                                                          |

### 6.2 Exam blueprint (proposed weightings are design parameters, not scores)

| Track   | Domain                     | Weight¹ | Sample objective                                                  |
| ------- | -------------------------- | ------- | ----------------------------------------------------------------- |
| Deploy  | Reference topologies       | 20%     | Select a topology from `REFERENCE-ARCHITECTURES.md` for a persona |
| Deploy  | Install & offline delivery | 40%     | Execute Helm/K8s + offline bundle deploy                          |
| Deploy  | Validation & go-live       | 40%     | Pass `DEPLOYMENT-VALIDATION.md` + `RELEASE-CHECKLIST.md`          |
| Operate | Administration & security  | 35%     | Configure admin/security per guides                               |
| Operate | Incident response          | 35%     | Resolve an `OPERATIONAL-RUNBOOKS.md` scenario                     |
| Operate | DR & continuity            | 30%     | Perform a backup/restore per DR guide                             |
| Develop | Connector authoring        | 35%     | Add a least-privilege `ConnectorManifest`                         |
| Develop | SDK/CLI integration        | 35%     | Client-credentials auth + resource calls                          |
| Develop | Publishing & trust         | 30%     | Sign, `submit → review → publish`, verify webhook                 |

¹ Weightings are **blueprint design parameters** for a proposed instrument, not
measured results.

### 6.3 Control mapping (objective → real asset = evidence of skill)

| Objective            | Control / real asset                                            |
| -------------------- | --------------------------------------------------------------- |
| Deploy on K8s/Helm   | `deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`       |
| Offline/air-gapped   | `scripts/build-offline-bundle.sh`                               |
| Validate deploy      | `docs/validation/DEPLOYMENT-VALIDATION.md`                      |
| Incident runbook     | `docs/validation/OPERATIONAL-RUNBOOKS.md`                       |
| DR restore           | `docs/guides/DISASTER-RECOVERY-GUIDE.md`                        |
| Connector authoring  | `docs/connectors/connector-sdk.md`                              |
| SDK auth + resources | `packages/sdk/src/resources.ts`                                 |
| Signed publishing    | `apps/desktop/src/main/nps/signature.ts`, `MarketplaceResource` |
| Webhook verification | `packages/sdk/src/webhooks.ts`                                  |

### 6.4 Roadmap stages (proposed)

1. **Blueprint ratified** (this mapping) → 2. **Prep materials** (via `TRAINING-EDUCATION.md`) → 3. **Practice assessment** (self-scored, no credential) → 4. **Proctoring/accreditation** — _out of scope; requires an external body and is not claimed._

---

## 7. Partner lifecycle

Five stages: **recruit → onboard → enable → co-sell → renew**. Each has an entry
gate, activities, and an exit criterion that also drives tiering (§8).

| Stage   | Entry                    | Key activities                                    | Exit criterion                                                   |
| ------- | ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| Recruit | Fit against a §1.1 track | Qualify motion, region, vertical                  | Signed agreement (license accepted)                              |
| Onboard | Agreement signed         | Directory profile created; access to docs/SDK/CLI | Profile complete → **`registered`**                              |
| Enable  | `registered`             | Work §2/§3 checklists; §6 skill evidence          | ≥1 competency evidenced → **`select`**                           |
| Co-sell | `select`                 | Deal registration; co-marketing; joint delivery   | Sustained delivery + trust ≥ `verified` → **`premier`** eligible |
| Renew   | Any tier                 | Periodic review (§8); refresh competencies        | Renewed at, promoted, or demoted from tier                       |

Per-stage checklists:

- **Recruit** — [ ] track fit documented · [ ] license terms shared up front
- **Onboard** — [ ] directory profile complete · [ ] SDK/CLI access confirmed · [ ] onboarding call done
- **Enable** — [ ] track checklist passed · [ ] §6 skill evidence captured
- **Co-sell** — [ ] deal-registration understood · [ ] reference impl. persona-validated · [ ] trust tier ≥ `verified` (if publishing)
- **Renew** — [ ] review completed on cadence · [ ] competencies still staffed · [ ] compliance re-attested

---

## 8. Partner governance

### 8.1 Tiering rules (promotion / maintenance / demotion)

| Rule        | Basis                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Promotion   | Meets the higher tier's §1.2 bar **and** evidences the §6 skills      |
| Maintenance | Retains staffed competencies + (if publishing) trust tier             |
| Demotion    | Failed review, lapsed competency, or trust regression → drop one tier |
| Suspension  | License breach or trust revocation → directory removal pending cure   |

Tier and `certified` flag (`Partner.certified`) are **governance-set**, never
self-declared.

### 8.2 Review cadence

| Tier         | Cadence     | Reviews                                   |
| ------------ | ----------- | ----------------------------------------- |
| `registered` | Annual      | Profile currency, license attestation     |
| `select`     | Semi-annual | Competency staffing, delivery quality     |
| `premier`    | Quarterly   | Business plan, trust tier, co-sell health |

### 8.3 Trust & compliance mapping (real controls)

Partner governance maps onto the real `OrgMarketplacePolicy` controls that
enterprises already enforce (`packages/shared/src/types/marketplace.ts`,
`marketplaceService.ts`):

| Program control                  | Real enforcement knob                               |
| -------------------------------- | --------------------------------------------------- |
| Require signed partner artifacts | `requireSignature`                                  |
| Minimum publisher trust to list  | `minPublisherTier`                                  |
| Gate installs behind approval    | `requireApproval` (`require_approval` decision)     |
| Remove/deny a partner            | `blockedPublishers`, `blockedTypes` (deny decision) |

### 8.4 License compliance (Proprietary — All Rights Reserved)

- [ ] Partner rights derive **only** from a signed agreement, not repo access
- [ ] No redistribution/sublicensing of code beyond agreement terms (`LICENSE`)
- [ ] Any "open contribution" is treated as **proposed**, not permitted today
- [ ] Security disclosures follow root `SECURITY.md`
- [ ] Enterprises advised to set `requireSignature` (open item, §3.2)

---

## 9. Partner success metrics

> **Definitions and method only.** This section states **how** to measure. It
> contains **no numbers, no targets, and no achieved results.** Any number is set
> per engagement, never asserted here.

### 9.1 Metric framework

| Metric                  | Definition                                     | Data source (real)                                                                 | Method                              | Cadence     |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------- | ----------- |
| Enablement completion   | Share of track checklist (§2/§3) evidenced     | Program records                                                                    | Ratio of items complete             | Per review  |
| Skill-evidence coverage | §6 objectives evidenced per claimed competency | §6 mapping                                                                         | Objective coverage                  | Per review  |
| Deployment health       | Health of partner-run installs                 | `/health`, `/metrics`, `audit_log`                                                 | Aggregate health signal             | Continuous  |
| Integration adoption    | Use of partner connectors/listings             | `MarketplaceResource.stats` (`/marketplace/stats`), install state                  | Adoption trend (no counts asserted) | Periodic    |
| Publish quality         | Review pass vs. rollback of partner listings   | `submit/review/publish` + `rollback` (rollback-rate metric, `marketplaceModel.ts`) | Rate over submissions               | Per release |
| Trust standing          | Publisher trust tier + score                   | `PublisherProfile.tier` / `trustScore`                                             | Tier + 0..1 score                   | Continuous  |
| Usage-driven value      | Consumption on partner-influenced accounts     | `UsageResource.summary` (`/usage/analytics`)                                       | Trend vs. baseline                  | Periodic    |
| Governance compliance   | Adherence to §8 controls                       | `OrgMarketplacePolicy` state, review outcomes                                      | Pass/fail per control               | Per review  |

### 9.2 Method rules

- [ ] Report deltas/trends against a stated baseline — **never a fabricated figure**
- [ ] Every metric traces to a real telemetry primitive above
- [ ] Segment by persona/track/tier; **never name a customer** (personas only)
- [ ] Exclude demo-seed data (`demoSeedsEnabled()`); production directory is empty
- [ ] Re-state **Validated RC** status alongside any maturity claim

---

## Appendix · Cited real assets

- **Partner model:** `packages/shared/src/types/ecosystem-exchange.ts` (`Partner`, `PartnerType`, `PartnerTier`); `apps/desktop/src/main/ecosystem/exchange/{partnersStore,partnersInstance,ecosystemProdSeed.test}.ts` (empty prod seed)
- **Trust/publishing:** `packages/shared/src/types/marketplace.ts` (`PublisherTier`, `PublisherProfile`, `TrustReport`, `OrgMarketplacePolicy`); `apps/desktop/src/main/nps/signature.ts` (Ed25519); `.../marketplace/marketplaceService.ts`
- **Developer surfaces:** `packages/sdk/src/{resources,webhooks}.ts`; `packages/cli`; `docs/connectors/{connector-sdk,connector-lifecycle}.md`; `docs/runtime/PLUGIN-SDK.md`
- **Deploy/operate:** `docs/DEPLOYMENT.md`; `deploy/{README.md,kubernetes/*,helm/neuropause-backend/*}`; `scripts/build-offline-bundle.sh`; `docs/guides/{INSTALLATION,QUICK-START,TROUBLESHOOTING,ADMINISTRATOR-GUIDE,SECURITY-GUIDE,OPERATIONS-GUIDE,DISASTER-RECOVERY-GUIDE,RELEASE-CHECKLIST}.md`
- **Validation/EVP:** `docs/validation/{REFERENCE-ARCHITECTURES,DEPLOYMENT-PLAYBOOKS,OPERATIONAL-RUNBOOKS,DEPLOYMENT-VALIDATION,PERFORMANCE-BENCHMARKS,RELIABILITY-RESULTS}.md`; `docs/validation/verticals/{AGRICULTURE,FINANCIAL,GOVERNMENT,HEALTHCARE,MANUFACTURING}.md`; `bench/results/*`
- **Status/license:** `ENTERPRISE-VALIDATION-REPORT.md` (Validated RC); `ENTERPRISE-GA-REPORT.md`; `LICENSE` (Proprietary); root `SECURITY.md`
- **Companion GEAP artifacts:** `TRAINING-EDUCATION.md`, `MARKETPLACE-GROWTH.md`, `DEVELOPER-ECOSYSTEM.md`, `BUSINESS-EXPANSION.md`, `CUSTOMER-SUCCESS.md`
