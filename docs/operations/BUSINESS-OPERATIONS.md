# NeuroPause EOSP — Business Operations Operating Manual

> **What this is.** The **business-operations execution** manual for the Enterprise Operations & Scale
> Program (EOSP): the internal **cadence and workflows** that run NeuroPause as a software business —
> sales operations, the customer lifecycle, the renewal workflow, success-metric definitions, and the
> internal reporting rhythm. It adds **no runtime and no platform** — roles, stages, checklists, and
> decision rules over the **real** commercial surface (`subscriptions`/`billing` model, CRM customer
> domain, commercial view-model). It is **operations, not strategy**: it _builds on_ the GEAP docs
> `docs/adoption/BUSINESS-EXPANSION.md` (pricing/positioning) and `docs/adoption/CUSTOMER-SUCCESS.md`
> (adoption lifecycle) and never restates them.
>
> **Honesty banner (non-negotiable).** No customers, revenue, ARR, pipeline, win rates, churn, or seat
> counts appear here — **none exist to cite**. Every business KPI is a **definition + how-measured**,
> never a value; every target is a **proposed objective**, never an achievement. Pricing references the
> **real plans** `trial/starter/professional/enterprise` (`BILLING_PLANS`; tiers `free/pro/enterprise`) with **no set prices** — monetary values live
> server-side (`RAZORPAY_PLAN_*` env). Renewal/lifecycle tie to the **real** `subscriptions`/`billing`
> model. Health is a **method over real telemetry**, never a fabricated score. **Roles, not people** —
> no individuals named, no staffed team claimed. Maturity anchor: **Validated Release Candidate**
> (`1.0.0-rc.1`, `ENTERPRISE-VALIDATION-REPORT.md`).

## 1. Scope, boundary, and operating roles

The boundary is strict: GEAP decides _what we sell and how we frame it_; this manual decides _how the business runs the motion week to week_.

| GEAP strategy asset (do not restate)                                    | This manual extends it into…                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `BUSINESS-EXPANSION.md` §1 pricing framework (real tiers, value metric) | the **deal-desk** rules that apply the tiers to a specific opportunity (§2.4) |
| `BUSINESS-EXPANSION.md` §6 sales enablement (discovery, objections)     | the **pipeline workflow** those questions gate (§2.1–§2.3)                    |
| `BUSINESS-EXPANSION.md` §8 land→expand motion                           | the **lifecycle + expansion** operating stages (§3)                           |
| `CUSTOMER-SUCCESS.md` §5 maturity model, §6 health method, §7 renewal   | the **renewal workflow**, triggers, and save paths (§4)                       |
| `CUSTOMER-SUCCESS.md` §3 persona playbooks                              | the **success-owner cadence** and reporting inputs (§3, §6)                   |

**Operating roles (roles, not people).** Each role is staffable by any qualified operator; headcount is an org decision, the _structure_ is the contract. Buyer-side roles map to the **real** RBAC roles the product enforces.

| Role                        | Owns                                                              | Real anchor                                                        |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Sales / RevOps operator** | Pipeline hygiene, stage gates, forecast inputs (definitions only) | CRM customer domain (`packages/shared/src/types/customers.ts`)     |
| **Solutions engineer (SE)** | POV execution, evidence bundle, honest-gap disclosure             | EVP + vertical evaluation protocol (`docs/validation/verticals/*`) |
| **Deal desk**               | Tier/seat/motion fit, approvals, non-standard terms               | `BILLING_PLANS`, `selfServe` gate (`billing/router.ts`)            |
| **Success owner (CSM)**     | Onboard→adopt→expand cadence, health review, next-best-action     | `recommendNextEngagement` (`customers.ts`), `CommercialCustomers`  |
| **Renewal owner**           | Renewal timeline, risk triage, save/escalation                    | `subscriptions` model (`apps/backend/src/subscriptions/*`)         |
| **Billing approver**        | Checkout/cancel authority (mutations)                             | **Owner/Admin only** (`requireManager`, `billing/router.ts`)       |

---

## 2. Sales operations — lead → qualify → POV → close

A four-stage workflow. Each stage has an **entry gate**, an **owner**, **activities grounded in a real asset**,
and an **exit gate** to pass before advancing. No pipeline value, deal count, conversion, or win rate is asserted — those are **definitions** in §5, from real CRM data.

### 2.1 The pipeline as a workflow

| Stage                    | Entry gate                  | Owner                        | Activities (real asset)                                                            | Exit gate (advance when…)                                      |
| ------------------------ | --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Lead / inbound**       | Contact captured            | Sales operator               | Log account + persona in CRM; map buying role to a real RBAC role (`customers.ts`) | Persona identified; deployment posture hypothesized            |
| **Qualify**              | Lead accepted               | Sales operator + SE          | Run the discovery questions (`BUSINESS-EXPANSION.md` §6.1); score fit (§2.2)       | Fit dimensions answered; plan + motion provisionally set       |
| **Proof-of-Value (POV)** | Qualified + fit ≥ threshold | SE                           | Run the vertical **evaluation protocol** on EVP evidence (§2.3)                    | Protocol executed; **§9 limitations accepted in writing**      |
| **Deal desk & close**    | POV exit met                | Deal desk + billing approver | Tier/seat/motion sizing; contract or self-serve checkout (§2.4)                    | Subscription created (checkout) or MSA signed (sales-assisted) |

Stage transitions are recorded on the CRM record (`CrmCustomer.status` moves
`onboarding → active`; `updatedAt` timestamps each move) — the **source** for the
cycle-time and conversion **definitions** in §5.

### 2.2 Qualification — fit over real decision points

Qualification is a **fit assessment against real product decision points**, not a generic scorecard. The discovery questions live in `BUSINESS-EXPANSION.md` §6.1; this manual defines how their answers **route** the opportunity.

| Fit dimension (from discovery)                        | Answer routes to…                                 | Real basis                                                     |
| ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| **Deployment posture** (cloud / on-prem / air-gapped) | Air-gap ⇒ **Enterprise, sales-assisted**          | `DeploymentModeId` (`commercialPlatform.ts`)                   |
| **Identity / federation** need                        | SAML/PIV-CAC ⇒ scope as integration (**MODELED**) | `GOVERNMENT.md` §2.1 (disclose, don't oversell)                |
| **Seat footprint** (now / +12 mo)                     | Sizes tier + expansion path                       | `includedSeats` per plan (`billing.ts`)                        |
| **Regulatory regime**                                 | HIPAA/PCI/NIST ⇒ vertical pack + self-mapping     | `docs/validation/verticals/*` (mapping, **not** certification) |
| **Audit / SIEM** scope                                | Coverage-extension may be pre-go-live work        | `audit_log`; auth-events-only today (disclose)                 |

**Rule:** posture and regime, not headcount, set the motion — an air-gap or a regulated regime pulls even a small buyer into Enterprise sales-assisted (`selfServe: false`).

### 2.3 Proof-of-Value (POV) — grounded in EVP evidence + the evaluation guide

The POV is the credibility engine — **not** a bespoke demo build, but the **reproducible evaluation protocol the platform already ships**, run on the customer's fit case and handed over with its evidence and its caveats.

- **Evidence bundle (EVP):** `ENTERPRISE-VALIDATION-REPORT.md` §2 validation matrix
  (Validated 16 · Partial 2 · Harness-ready 1 · Modeled 3 · Absent 1), §8 readiness
  score, value propositions V1–V7 (`BUSINESS-EXPANSION.md` §5). Cite the report and raw
  `bench/results/*.json`; do **not** re-derive figures.
- **Evaluation guide (how evidence is levelled):** the Evidence Guide
  (`docs/science/manuals/EVIDENCE-GUIDE.md`) ladder — **L4 Validated / L3 Measured / L2
  Implemented / L1 Modeled / L0 Proposed**. Tag every POV claim with its level; show
  only L2+ and label anything MODELED honestly.
- **Runnable protocol:** the matching vertical pack (`docs/validation/verticals/*`) —
  the executable evaluation protocol `CUSTOMER-SUCCESS.md` §2 uses as the Evaluate gate.

**POV operating checklist (SE-owned).**

- [ ] Select the matching vertical pack as the evaluation protocol; agree the exit gate.
- [ ] Assemble the EVP evidence bundle; tag each claim L0–L4 (Evidence Guide).
- [ ] Reproduce the relevant proof on the customer's box where possible (e.g. re-run `bench/http-load.mjs`) — measured floors are a **conservative lower bound**, not an SLA.
- [ ] Walk the **open items** register (`BUSINESS-EXPANSION.md` §6.3) — Apple JWKS, unsigned-install, rate-limiter fail-open — _with_ the customer. Disclosure is the strategy.
- [ ] Obtain **written acceptance of §9 limitations + validated-RC status** — the exit gate.

### 2.4 Deal desk — self-serve vs sales-assisted

Deal desk applies the **real** tiers and gates. Two motions exist in code and must not be blurred:

| Motion             | Plans                                                  | Mechanism (real)                                                         | Approver                       |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------ |
| **Self-serve**     | `trial`, `starter`, `professional` (`selfServe: true`) | `POST /:orgId/checkout` → gateway subscription (`billing/router.ts`)     | Owner/Admin (`requireManager`) |
| **Sales-assisted** | `enterprise` (`selfServe: false`)                      | Checkout **refuses** with `not_self_serve` → "contact us"; contract path | Deal desk + billing approver   |

**Honest guardrails deal desk must carry:** billing stays **disabled** until `RAZORPAY_KEY_ID` +
`RAZORPAY_KEY_SECRET` are set (`billingConfigured()`); **seats are displayed, not enforced** — no seat-cap
gate (`ADMINISTRATOR-GUIDE.md` §9), so seat counts are **advisory**; plan prices are server-side env.

### 2.5 Sample deal-desk checklist

> Reusable gate before any subscription is created or MSA is signed. All fields are
> **placeholders** — no example values.

```
DEAL-DESK REVIEW — <account / opportunity id>
By <sales operator role> · Reviewed <deal desk role> · Date <YYYY-MM-DD>

1. FIT     Persona→RBAC role <Owner|Admin|Manager|Member|Viewer>
           Posture <cloud|private|hybrid|on-prem|air-gapped> · Regime <none|HIPAA|PCI|NIST>
2. TIER    Plan <trial|starter|professional|enterprise> · Gating tier <free|pro|enterprise>
           Motion <self-serve checkout | sales-assisted> · Seats <n> (advisory, not enforced)
3. POV     Vertical protocol <pack> · exit gate <met|not met>
           §9 limitations accepted in writing <yes|no·ref> · Open items disclosed <which>
4. TERMS   Deployment mode <mode> · Support tier <community|standard|enterprise> (CS §9)
           Non-standard terms → approval <n/a | approver role>
5. HANDOFF Success owner <role> · Renewal owner <role> · renewal window seeded (§4)
```

---

## 3. Customer lifecycle — onboard → adopt → expand → renew

The post-sale operating stages — each tied to a **real tier** and the **health method**
(§3.2), building on `CUSTOMER-SUCCESS.md` rather than restating it.

### 3.1 Operating stages

| Stage       | Tier focus (real)           | Owner                     | Entry gate                                         | Exit gate                                           | Built on                              |
| ----------- | --------------------------- | ------------------------- | -------------------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| **Onboard** | `trial`/`starter`           | Success owner             | Subscription created (`status: active`/`trialing`) | First-value milestone reached                       | `CUSTOMER-SUCCESS.md` §1              |
| **Adopt**   | `starter`/`professional`    | Success owner             | First value confirmed                              | Multiple personas active; health method live (§3.2) | `CUSTOMER-SUCCESS.md` §5 (Crawl→Walk) |
| **Expand**  | `professional`→`enterprise` | Success owner + deal desk | Seat/usage pressure or capability need             | Tier step or seat growth executed                   | `BUSINESS-EXPANSION.md` §8            |
| **Renew**   | any paid tier               | Renewal owner             | Renewal window opens (§4)                          | Subscription renewed or offboarded                  | `CUSTOMER-SUCCESS.md` §7              |

Onboarding sub-steps are **already schema'd** (`CommercialCustomers.onboardingSteps[]`,
`onboardingProgressPct`, `onboardingNextStep`, `onboardingCompleted`) — use these
**fields** as the tracker, **populated from real telemetry**, never invented progress.

### 3.2 Account health method (no fabricated scores)

Health is a **method over real signals**, publishing **no example score** — every value is the customer's own. It composes two real, deterministic conventions already in code:

1. **CRM relationship health** — `calculateCustomerHealth(customer, now)` returns a band
   `low | medium | high` (risk) from account status + `calculatePaymentRisk`;
   `customerHealthScore` maps those bands to **90 / 60 / 25** for averaging; the
   Executive Center banding is **healthy ≥ 75 / watch ≥ 50 / at-risk** below
   (`customers.ts`). `recommendNextEngagement` yields the deterministic **next-best
   action** the success motion executes.
2. **Telemetry health index** — the GEAP method in `CUSTOMER-SUCCESS.md` §6: band each
   real signal (`/health`, `/metrics`, `audit_log`, NeuroCore snapshot) to
   {100/60/0}, weight, composite to a 0–100 index **per customer, per period**.

The commercial view-model records the result —
`CommercialCustomers.{healthOverall, healthBand, dimensions[], adoptionScore,
renewalRisk}` (`CommercialBand: healthy|watch|at-risk|critical`). Publish the **method
and weights**, **never a score as a benchmark**; band-based roster segmentation is an
**operational trigger**, not a number to advertise.

### 3.3 Expansion operating levers

All levers are real product mechanics (`BUSINESS-EXPANSION.md` §8.2); the operating job is to _recognize the trigger and act_, not to invent an uptake number.

| Lever                  | Trigger the success owner watches                       | Real mechanic                                                          |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Seats**              | Seat pressure (advisory — not enforced)                 | `subscriptions.seats` (`subscriptions/types.ts`)                       |
| **Usage**              | Meter utilization trending to limit                     | `CommercialMetering.meters[]`, `requests30d` (`commercialPlatform.ts`) |
| **Capability unlock**  | Need for `pro`/`enterprise` gated flag                  | feature-flag `minPlan` gates (`BUSINESS-EXPANSION.md` §1.3)            |
| **Deployment upgrade** | Posture change (cloud → private → on-prem → air-gapped) | `DeploymentModeId`                                                     |
| **Vertical adoption**  | Vertical protocol → executed pilot                      | `docs/validation/verticals/*`                                          |

---

## 4. Renewal workflow

Renewal is a **motion**, not a metric — no renewal rate or revenue is asserted. Triggers come from the **real** `subscriptions` model and its billing projection.

### 4.1 Renewal triggers from the real `subscriptions` model

The org's subscription row (`subscriptions/types.ts`) carries the authoritative state;
the Razorpay webhook maps gateway events onto it via `mapRazorpayStatus`
(`billing/service.ts`). These mappings are **deterministic and real** — the renewal
motion keys off them directly.

| Real signal          | Field / mapping (real)                                                                                           | Renewal motion                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Trial ending**     | `status: 'trialing'` (Razorpay `created`); `trialEndsAt` = `startAt ?? chargeAt`                                 | Convert on first-value milestone before `trialEndsAt` (§3.1)             |
| **Cycle closing**    | `status: 'active'`; `currentPeriodEnd` (from Razorpay `currentEnd`) approaching                                  | Open renewal timeline (§4.2); run success review                         |
| **Payment stalling** | `status: 'past_due'` (Razorpay `pending`/`halted`)                                                               | **Save path** — dunning + billing-approver outreach (§4.3)               |
| **Terminated**       | `status: 'canceled'` (Razorpay `cancelled`/`completed`/`expired`) → auto-drops to `plan: null, planTier: 'free'` | **Win-back path** (§4.3)                                                 |
| **Config error**     | `BillingError('unknown_plan')` on an unmapped Razorpay plan id                                                   | **Ops fix** — reconcile `RAZORPAY_PLAN_*` before the customer sees drift |

Seats renew at `Math.max(1, quantity)` (`service.ts`); the default subscription is
`free / active / 1 seat` (`ensureSubscription`). Mutations (checkout/cancel) are
**Owner/Admin only** — route the renewal ask to the billing approver.

### 4.2 Renewal timeline

> Anchored on `currentPeriodEnd` (paid) or `trialEndsAt` (trial). Days are a **proposed
> default cadence** to ratify per segment, not a commitment. All owners are roles.

```
RENEWAL TIMELINE — anchored on subscriptions.currentPeriodEnd (T-0)

 T-90  Renewal owner opens the record; run §3.2 health review; confirm status == active
       and a chargeAt is scheduled (Razorpay projection).            [Renewal owner]
 T-60  Map expansion to a tier step (starter→professional→enterprise) vs §3.1 stage;
       flag renewalRisk band (healthy|watch|at-risk|critical).       [Success owner]
 T-30  If band watch/at-risk → trigger save play (§4.3); confirm billing approver
       (Owner/Admin) engaged for any plan/seat change.               [Renewal owner]
 T-14  Verify checkout/renewal path; for enterprise (sales-assisted) confirm contract
       track, NOT self-serve checkout (not_self_serve).              [Deal desk]
 T-0   currentPeriodEnd: subscription should remain status == active post-charge.
       trialEndsAt path: trialing → active before this date.         [Billing approver]
 T+0..T+grace  Licensing grace window applies (evaluateLicense → valid|grace|invalid,
       7-day grace, SPRINT-4 §6); status past_due → escalate save (§4.3).  [Renewal owner]
```

### 4.3 Save & escalation paths

| Situation (real trigger)                 | Path               | Actions                                                                          | Escalation                                              |
| ---------------------------------------- | ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `status: 'past_due'` (pending/halted)    | **Dunning / save** | Billing-approver outreach; confirm gateway retry (`chargeAt`); resolve payment   | Unresolved past grace → renewal-owner escalation review |
| `renewalRisk` = at-risk/critical at T-30 | **Retention save** | §3.2 health review; `recommendNextEngagement` action; scope contraction vs churn | Loop in deal desk for term/tier adjustment              |
| `status: 'canceled'` → dropped to `free` | **Win-back**       | Preserve data (forward-only, no downgrade path); re-engage on first-value        | Time-boxed; then offboard cleanly                       |
| `unknown_plan` BillingError              | **Ops fix**        | Reconcile `RAZORPAY_PLAN_*` env mapping (`plans.ts`)                             | Block renewal comms until state is correct              |

Operational incidents surfacing during renewal (e.g. `/health` degraded) follow the
support escalation in `CUSTOMER-SUCCESS.md` §8 — this manual routes the _commercial_
motion, not the incident runbook.

---

## 5. Success metrics — definitions only (no achieved values)

> **Definitions + how-measured only.** Every row states _what the metric means_ and _its
> real source_; every target is a **proposed objective**, to be baselined from real data.
> **No achieved value, rate, or amount is asserted anywhere in this table** — none exists.

| Metric                    | Definition (how-measured)                                                                      | Source (real)                                                                    | Target (proposed)                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Qualification rate        | Share of leads passing the §2.2 fit gate in a period                                           | CRM stage transitions (`CrmCustomer.status`, `updatedAt`)                        | Baseline in first period                   |
| POV completion rate       | Share of started POVs reaching the §2.3 exit gate (§9 accepted in writing)                     | POV tracker + vertical-protocol sign-off                                         | Baseline, then ratchet                     |
| Stage conversion          | Share advancing stage N → N+1 (lead/qualify/POV/close)                                         | CRM pipeline stage transitions                                                   | Baseline per stage                         |
| Sales cycle time          | Elapsed lead-entry → subscription-created / MSA-signed                                         | CRM `createdAt`→`updatedAt` timestamps                                           | Ratify per segment                         |
| Activation rate           | Share of new subscriptions reaching first-value milestone                                      | `onboardingCompleted`, `onboardingSteps[]`; `audit_log` first workforce approval | Set at baseline                            |
| Time-to-first-value       | Elapsed onboarding start → first-value milestone                                               | `onboardingSteps[]` timestamps; `audit_log`                                      | Ratify per segment                         |
| Adoption-stage attainment | Distribution of accounts across Crawl/Walk/Run                                                 | `adoptionScore` + §5 stage gates (`CUSTOMER-SUCCESS.md`)                         | Shift distribution upward                  |
| Account health index      | Banded 0–100 composite per §3.2 method                                                         | `/health`, `/metrics`, `audit_log`, `calculateCustomerHealth`                    | Weights + thresholds proposed              |
| Net seat change           | Change in `subscriptions.seats` over a period (advisory — not enforced)                        | `subscriptions` model                                                            | Baseline (directional)                     |
| Trial conversion          | Share of `status: 'trialing'` subs reaching `active` before `trialEndsAt`                      | `subscriptions.status`, `trialEndsAt`                                            | Set at baseline                            |
| Gross renewal rate        | Share of paid subs `active` at the renewal window that renew vs lapse to `past_due`/`canceled` | `subscriptions.status` transitions at `currentPeriodEnd`                         | Proposed objective                         |
| Net revenue retention     | **Definition only:** cohort expansion − contraction/churn; _no revenue value stated_           | Real billing ledger once live (prices are server-side env)                       | Definition published; value never asserted |
| Renewal-on-time rate      | Share of renewals completed by `currentPeriodEnd` without lapsing to `past_due`                | `subscriptions.status`, `currentPeriodEnd`                                       | Proposed objective                         |

> The only **published, real commitment** is the security-disclosure acknowledgment in root `SECURITY.md`; every row above is a **definition to instrument**, never a reported number.

---

## 6. Internal reporting — weekly / monthly business review

A reporting **cadence** whose templates are **placeholder skeletons** — each `<…>` is filled from real CRM / subscription / telemetry sources at review time, never fabricated.

### 6.1 Cadence

| Cadence                           | Audience (roles)                             | Inputs (real source)                                                 | Owner                   |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| **Weekly business review (WBR)**  | Sales operator, SE, success + renewal owners | Pipeline stage board; health bands; renewal timeline (T-90…T-0)      | Sales / RevOps operator |
| **Monthly business review (MBR)** | Above + deal desk + billing approver         | WBR roll-up; adoption-stage distribution; renewal + expansion motion | Success owner           |
| **Quarterly (QBR-internal)**      | All operating roles                          | MBR roll-up; metric-definition ratification; open-items register     | RevOps operator         |

### 6.2 Weekly Business Review — template (placeholders)

```
WBR — week of <YYYY-MM-DD> · prepared by <role>   (all values are placeholders)

1. PIPELINE  Lead <n> · Qualify <n> · POV <n> · Deal desk <n>   [CRM stage board]
             Stage changes <account→stage> · Stalled>threshold <list+owner>
2. POV       In-flight <account→pack→exit-gate> · §9 acceptance outstanding <list>
3. LIFECYCLE Onboarding <n> · first-value <n> · Health bands <band→count> (§3.2, no scores)
             Next-best-action queue <recommendNextEngagement outputs>
4. RENEWALS  Window open T-90..T-0 <account→currentPeriodEnd→status>
             past_due save-path <account→action→owner> · trialing→convert-by trialEndsAt
5. BLOCKERS / ESCALATIONS <item→owner→due>
```

### 6.3 Monthly Business Review — template (placeholders)

```
MBR — month of <YYYY-MM> · prepared by <role>   (definitions §5; values are placeholders)

A. FUNNEL     Qualification / POV-completion / stage-conversion / cycle-time <TBD: CRM>
B. LIFECYCLE  Activation / time-to-first-value <TBD> · Adoption stage dist. <stage→count>
C. RENEWAL    Renewal-on-time / gross-renewal / trial-conversion <TBD: subscriptions>
              Expansion levers actioned <list> · Net revenue retention <definition only>
D. HEALTH     Roster by health band <band→count> · At-risk/critical + save plans <list>
E. OPEN ITEMS Apple JWKS · unsigned-install · fail-open <status> [BUSINESS-EXPANSION §6.3]
F. DECISIONS & ACTIONS <decision→owner→due>
```

---

## Provenance & scope

- **Real (code-grounded):** plan catalog `trial/starter/professional/enterprise` (`billing.ts`,
  `BILLING_PLANS`, `selfServe`; tiers `free/pro/enterprise`, `free` also the fallback for cancelled
  subs); subscription model + status `active/trialing/past_due/canceled`
  (`subscriptions/types.ts`); Razorpay projection + status mapping (`billing/{types,service,webhook,router,plans}.ts`);
  CRM health method (`customers.ts`); commercial view-model (`commercialPlatform.ts`).
- **Built on (not restated):** GEAP `BUSINESS-EXPANSION.md` and `CUSTOMER-SUCCESS.md` (health method §6,
  renewal §7, escalation §8, support §9); EVP `ENTERPRISE-VALIDATION-REPORT.md` + `bench/results/*`;
  Evidence Guide (`EVIDENCE-GUIDE.md`, L0–L4); vertical protocols (`docs/validation/verticals/*`); sibling `SRE.md`.
- **Proposed (to be ratified):** every success-metric **target**, cadence interval, and renewal-timeline
  offset — all objectives, never measurements.
- **Not present (honest):** no customers, revenue, ARR, pipeline, win rates, churn, or seat counts; no
  fabricated health scores; no set prices. Every business KPI here is a **definition + how-measured**.
  Maturity: **Validated Release Candidate** — this manual runs the business _as it truly is_.
