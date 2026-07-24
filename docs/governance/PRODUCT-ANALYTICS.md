# NeuroPause PERG — Product Analytics & KPI Governance

> **What this is.** The **governance catalog** of product KPIs by which NeuroPause's
> evolution is measured and decided after GA: each KPI as a **definition + telemetry
> source + measurement method**, with **no current value**. It is the product-analytics
> **layer of PERG** — it decides _what evidence governs a product decision, where each
> number will come from, and what cannot yet be measured_. It adds **no runtime and no
> platform**; it wires over the **real** observability substrate only. It **elevates,
> does not restate**, EOSP `docs/operations/EXECUTIVE-OPERATIONS.md` (the exec KPI/SLI
> specs) and CDEP `docs/pilots/CUSTOMER-FEEDBACK.md §5` (the adoption measurement plan) —
> those own their math and instruments; here they become the **standing product-KPI
> framework** that gates roadmap, release, and deprecation decisions.
>
> **No-fabrication banner (non-negotiable, `_grounding.md` rules 2 & 5).** Every KPI in
> this file is a **definition and a method, never a value**. **No engagement, adoption,
> usage, reliability, or quality number is asserted** — there is **no GA, no production
> fleet, and no product-analytics pipeline**. All value columns ship **blank (`—`)**.
> Targets are **proposed objectives**, ratified only against real data. The platform is a
> **Validated Release Candidate** (`1.0.0-rc.1`); **adoption has no data pre-pilot**.
> **Roles, never people.**

**Legend.** Value `—` = deliberately blank (no production measurement stream exists).
Evidence labels (`_grounding.md`): **Implemented** substrate (series emitted today) ·
**Proposed** (requires instrumentation named in the debt register) · **Future Vision**
(uncommitted). "Requires instrumentation — Proposed" marks a KPI the current substrate
**cannot** emit.

---

## 1. Product KPIs (the governed catalog)

Four families govern product evolution: **Engagement**, **Reliability-experienced**,
**Adoption**, **Quality**. Each KPI carries an **ID · definition · why it matters (the
decision it governs) · telemetry source · value (blank) · proposed target**. The **value
column is blank for every row** — it is a contract for a number computed from a real
source once wiring and a pilot exist, not a figure asserted here. Where a real **RC
baseline** exists (a Validated CI fact), it appears in the _target_ column as a labelled
fact, never in the live-value column.

### 1.1 Engagement KPIs — how actively the product is used

Elevated from the CDEP §5.1 adoption signals into standing product-governance KPIs.
Backend attribution comes **solely** from `audit_log`; there is **no client analytics**.

| ID        | KPI                     | Definition                                                      | Why it matters (governs)                                                        | Telemetry source                                                    | Value | Proposed target                                   |
| --------- | ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| **ENG-1** | Active participants     | Distinct `user_id` with ≥1 audited entry in a window            | Reach input to the `P=(E×I×R)÷Effort` prioritization rubric (PRODUCT-EVOLUTION) | `audit_log.user_id` (distinct)                                      | —     | _Proposed:_ window-over-window active-user growth |
| **ENG-2** | Authentication activity | Count of auth events (login/register/logout) in a window        | Baseline "is anyone using it" signal that gates roadmap attention               | `audit_log.action` (5 auth actions)                                 | —     | _Proposed:_ non-zero, trend-stable                |
| **ENG-3** | Time-to-first-value     | Interval from onboarding start to a user's first audited action | Governs onboarding/UX roadmap items; friction evidence                          | `MIN(audit_log.created_at)` per `user_id`                           | —     | _Proposed:_ downward trend                        |
| **ENG-4** | Activity trend          | Audited entries per day/week bucket over a window               | Governs capacity roadmap and deprecation timing                                 | `audit_log.created_at`                                              | —     | _Proposed:_ stable/positive                       |
| **ENG-5** | Feature-action coverage | Breakdown of which **feature** actions fire (beyond auth)       | Governs feature invest/retire decisions                                         | `audit_log.action` — **auth-only today** → requires instrumentation | —     | _Proposed:_ instrument feature call-sites         |
| **ENG-6** | Desktop engagement      | Client-side feature usage per session                           | Governs desktop roadmap prioritization                                          | **no client analytics ships** → requires instrumentation            | —     | _Proposed:_ opt-in client telemetry               |

### 1.2 Reliability-experienced KPIs — reliability as the user feels it

The SLI/SLO definitions, error-budget arithmetic, and burn-rate policy are **owned by
EOSP §3 and `SRE.md §2–4` and are not restated**. Here they are governed as
**product-experienced** signals that gate the RC→GA and per-release decisions.

| ID        | KPI                           | Definition                                             | Why it matters (governs)                                              | Telemetry source                                                                | Value | Proposed target                                       |
| --------- | ----------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| **REL-1** | Request success rate          | Non-5xx share of served requests over a window         | Primary experienced-reliability gate for release ship/no-ship         | `neuropause_http_requests_total{status}` (**real scrape**)                      | —     | _Proposed:_ ≥ 99.9% (EOSP §3 / `SRE.md`)              |
| **REL-2** | Client-visible error rate     | Combined 4xx+5xx share (client + server faults)        | Separates client-integration friction from platform faults for triage | `neuropause_http_requests_total{status}` (**real scrape**)                      | —     | _Proposed:_ 5xx floor per `SRE.md`; 4xx watched       |
| **REL-3** | Experienced availability      | Good-probe fraction (`/health`=200) over a window      | Governs GA readiness and SLO reaffirmation                            | `GET /health status` — **needs external probe** → requires instrumentation      | —     | _Proposed:_ 99.9% (EOSP §3)                           |
| **REL-4** | Degraded-dependency exposure  | Fraction/time with `components.database\|redis:"down"` | Governs DR/rollback and alerting roadmap (TD-5/TD-6)                  | `GET /health components.*` — **needs probe history** → requires instrumentation | —     | _Proposed:_ ≥ 99.9% deps up                           |
| **REL-5** | Serving continuity & recovery | Process-serving continuity and restart-to-ready time   | Governs rollout-safety and release-engineering decisions              | `neuropause_backend_uptime_seconds` (**real scrape**) drop                      | —     | _Proposed:_ recovery ≤ 5 s (EOSP §3, measured 0.46 s) |

### 1.3 Adoption KPIs — breadth and depth of uptake

Elevated from CDEP §5.1. **No adoption data exists pre-pilot** (§4); every value is the
customer's own number, produced at pilot time.

| ID        | KPI                           | Definition                                        | Why it matters (governs)                         | Telemetry source                                                    | Value | Proposed target                           |
| --------- | ----------------------------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ----- | ----------------------------------------- |
| **ADO-1** | Adoption breadth              | Active participants relative to provisioned seats | Governs expansion motion and reach scoring       | `audit_log.user_id` distinct (denominator **not emitted**)          | —     | _Proposed:_ breadth objective (per pilot) |
| **ADO-2** | Maturity-stage attainment     | Accounts at Crawl / Walk / Run (GEAP §5)          | Governs enablement roadmap and success playbooks | Milestone-**observed**, not telemetry → requires instrumentation    | —     | _Proposed:_ stage-advance objective       |
| **ADO-3** | Feature-adoption coverage     | Which capabilities are actually exercised         | Governs invest/retire and deprecation candidates | `audit_log.action` — **auth-only today** → requires instrumentation | —     | _Proposed:_ instrument feature actions    |
| **ADO-4** | Request-volume adoption proxy | Aggregate request growth over the window          | Coarse uptake proxy when audit coverage is thin  | `neuropause_http_requests_total` (aggregate, **real scrape**)       | —     | _Proposed:_ positive trend (proxy only)   |
| **ADO-5** | Persona activation            | Which GEAP §3.1 personas are active               | Governs persona-targeted roadmap bets            | Observation checkbox, not telemetry → requires instrumentation      | —     | _Proposed:_ persona-coverage objective    |

### 1.4 Quality KPIs — build integrity and product quality experienced

Release-gate facts reuse EOSP §3 / `ENTERPRISE-GA-REPORT.md §2.1`; product-experienced
quality (client crash/error) is **additive and not yet instrumentable**.

| ID        | KPI                            | Definition                                                          | Why it matters (governs)                                     | Telemetry source                                                         | Value | Proposed target                                     |
| --------- | ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ | ----- | --------------------------------------------------- |
| **QUA-1** | Release quality-gate pass rate | Pass/fail of typecheck / lint / test / build on the assessed commit | Hard release gate (no ship on red)                           | CI gates (`backend-ci.yml`; GA report §2.1)                              | —     | _Proposed:_ 100% green; RC baseline: all green      |
| **QUA-2** | Test-suite integrity           | Green test count vs the RC baseline; any regression                 | Governs release confidence and TD-7 test-debt burn-down      | CI test job                                                              | —     | _Proposed:_ ≥ baseline; RC baseline **3,856 tests** |
| **QUA-3** | Production dependency vulns    | Count from `npm audit --omit=dev`                                   | Security release gate                                        | `npm audit --omit=dev` in CI                                             | —     | _Proposed:_ 0; RC baseline **0 prod vulns**         |
| **QUA-4** | Audit-log completeness         | Presence of expected append-only entries for privileged actions     | Governs governance-evidence trust and audit-coverage backlog | `audit_log` (**auth-only today**) → partial; requires instrumentation    | —     | _Proposed:_ extend call-site coverage               |
| **QUA-5** | Client-experienced quality     | Renderer crash / error rate per session                             | Governs desktop quality roadmap (TD-7)                       | **no client analytics; no renderer coverage** → requires instrumentation | —     | _Proposed:_ renderer telemetry + E2E/a11y           |
| **QUA-6** | Escaped-defect signal          | Pilot/issue-intake defects not caught by gates                      | Governs test-strategy and quality investment                 | CDEP §2 issue log + `.github/ISSUE_TEMPLATE/*` (process)                 | —     | _Proposed:_ downward escaped-defect trend           |

---

## 2. Measurement methods

**How each KPI is computed from the real substrate, at what cadence, and the honest
limits.** Methods are **read-only** — governance never adds a runtime. Three mechanisms
cover the catalog; a fourth (client analytics) does **not exist** and is called out.

### 2.1 Mechanism A — `audit_log` queries (Engagement, Adoption, Quality-completeness)

Read-only SQL against the customer's own append-only `audit_log`. Canonical shapes
(governance-ratified from CDEP §5.2 — computed at pilot time, **never seeded**):

```
ENG-1 Active participants:  COUNT(DISTINCT user_id) FROM audit_log WHERE created_at BETWEEN <s> AND <e>;
ENG-2/ADO-3 Action usage:   SELECT action, COUNT(*) FROM audit_log WHERE created_at BETWEEN <s> AND <e> GROUP BY action;
ENG-3 Time-to-first-value:  MIN(created_at) per user_id  vs  onboarding start;
ENG-4 Activity trend:       COUNT(*) by day/week bucket over the window.
```

- **Sampling.** Bounded by an explicit `[start,end]` window; bucketed by day/week for
  trend. No streaming — a periodic read at the review cadence (EOSP §5).
- **Honest limits.** `audit_log` is **append-only actions**, and the backend writes
  **only five auth actions today** (`auth.oauth.register|login`, `auth.email.register|
login`, `auth.logout`; `auth/router.ts`). So ENG-1..4 measure **authenticated
  presence**, not feature depth; **ENG-5, ADO-3, QUA-4 cannot be measured** until
  feature call-sites are instrumented. `user_id` is nullable (`ON DELETE SET NULL`), so
  distinct-user counts exclude deleted accounts.

### 2.2 Mechanism B — `/metrics` scrape (Reliability-experienced, Adoption proxy)

Aggregate Prometheus text exposition, non-sensitive. Request KPIs are computed by
**differencing the counter across two scrapes** (CDEP §5.2 shape):

```
REL-1/REL-2/ADO-4:  diff neuropause_http_requests_total{status=~"2.."} vs {~"[45].."} across two scrapes.
REL-5:              detect neuropause_backend_uptime_seconds reset (drop) → restart; time to next /health 200.
```

- **Sampling.** Two-scrape delta works **manually today**; continuous windowed SLO
  tracking requires the **proposed** scrape-retention + Alertmanager wiring (absent —
  TD-6). Point-in-time gauges (memory, pool) are read per scrape.
- **Honest limits.** The counter is **aggregate by `method`+`status` only** — **no
  per-user, no per-route, no per-feature, and no latency histogram** (the app ships
  counts only). `neuropause_backend_up` is **hard-coded to `1` and only emitted while the
  process can serve the scrape** — a down backend yields **no sample at all**, so
  **availability/uptime cannot be derived from this series**. That is why REL-3/REL-4 need
  an external probe (below).

### 2.3 Mechanism C — `/health` probe (Experienced availability, dependency exposure)

`GET /health` returns `status: ok|degraded` (200/503) and `components.database|redis:
up|down`. Availability KPIs are the good-probe fraction over time.

- **Sampling.** Requires a **periodic external blackbox probe** storing pass/fail —
  **the platform does not ship one** (EOSP §1 "wiring status"; `SRE.md §4`).
- **Honest limits.** REL-3/REL-4 are **requires-instrumentation — Proposed**: without
  probe history there is no availability series. A single live `/health` read gives a
  point state only, not a window.

### 2.4 Mechanism D — client/product analytics (does not exist)

**Deliberately absent (do not fabricate):** **no product-analytics / event-tracking
pipeline** and **no per-feature client telemetry**. Desktop signals are
**milestone-observed** (`neurocore:systemHealth`, `diagnostics:get` report **health, not
usage**). ENG-6, QUA-5, ADO-2, ADO-5 therefore have **no substrate today** and are
**Proposed instrumentation**. Do **not** synthesize a funnel the platform cannot emit.

---

## 3. Telemetry mapping

Each KPI mapped to the **exact real series / field / column**, with a measurability
verdict. KPIs the current substrate **cannot** emit are marked **"requires
instrumentation — Proposed"** and tied to a real debt item.

| KPI                                 | Exact real telemetry anchor                                              | Measurable today?                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| ENG-1 Active participants           | `audit_log.user_id` (distinct) + `.created_at` window                    | **Yes** — Implemented substrate (auth presence)                    |
| ENG-2 Auth activity                 | `audit_log.action` ∈ {auth.oauth/email.register/login, auth.logout}      | **Yes** — Implemented substrate                                    |
| ENG-3 Time-to-first-value           | `MIN(audit_log.created_at)` per `user_id`                                | **Yes** — Implemented substrate                                    |
| ENG-4 Activity trend                | `audit_log.created_at` (bucketed)                                        | **Yes** — Implemented substrate                                    |
| ENG-5 Feature-action coverage       | `audit_log.action` for **non-auth** actions                              | **No** — requires audit call-site coverage (Proposed, TD-adjacent) |
| ENG-6 Desktop engagement            | _(none — no client analytics)_                                           | **No** — requires client analytics pipeline (Proposed)             |
| REL-1 Request success rate          | `neuropause_http_requests_total{status}` (5xx vs all)                    | **Yes** — real scrape; continuous needs wiring (Proposed, TD-6)    |
| REL-2 Client-visible error rate     | `neuropause_http_requests_total{status}` (4xx+5xx)                       | **Yes** — real scrape; continuous needs wiring                     |
| REL-3 Experienced availability      | `GET /health` `status`==ok fraction                                      | **No** — requires external blackbox probe (Proposed, TD-6)         |
| REL-4 Degraded-dependency exposure  | `GET /health` `components.database\|redis`                               | **No** — requires probe history (Proposed, TD-6)                   |
| REL-5 Serving continuity & recovery | `neuropause_backend_uptime_seconds` drop + `/health` 200                 | **Partial** — restart detectable on scrape; SLO needs wiring       |
| ADO-1 Adoption breadth              | `audit_log.user_id` distinct ÷ provisioned seats                         | **Partial** — numerator real; denominator **not emitted**          |
| ADO-2 Maturity-stage attainment     | GEAP §5 stage (observed)                                                 | **No** — observation, not telemetry (Proposed)                     |
| ADO-3 Feature-adoption coverage     | `audit_log.action` (feature actions)                                     | **No** — auth-only today (Proposed)                                |
| ADO-4 Request-volume proxy          | `neuropause_http_requests_total` (aggregate)                             | **Yes** — real scrape (proxy only, no attribution)                 |
| ADO-5 Persona activation            | GEAP §3.1 persona (observed)                                             | **No** — observation, not telemetry (Proposed)                     |
| REL/aux Capacity context            | `neuropause_backend_resident_memory_bytes`, `pg_pool_connections{state}` | **Yes** — real scrape (context for REL/ADO)                        |
| QUA-1 Gate pass rate                | CI `typecheck/lint/test/build`                                           | **Yes** — CI fact (per commit)                                     |
| QUA-2 Test-suite integrity          | CI test count vs 3,856 baseline                                          | **Yes** — CI fact                                                  |
| QUA-3 Production vulns              | `npm audit --omit=dev`                                                   | **Yes** — CI fact                                                  |
| QUA-4 Audit-log completeness        | `audit_log` privileged-action presence                                   | **Partial** — auth-only today; broader = Proposed                  |
| QUA-5 Client-experienced quality    | _(none — no renderer telemetry/coverage)_                                | **No** — requires client analytics + coverage (Proposed, TD-7)     |
| QUA-6 Escaped-defect signal         | CDEP §2 issue log + `.github` intake                                     | **Process** — no automated telemetry (Proposed at scale)           |

> **Mapping honesty.** Only the **real-scrape** (REL-1/2, ADO-4, capacity) and
> **`audit_log`** (ENG-1..4) KPIs, plus CI facts (QUA-1..3), are measurable on today's
> substrate. Everything marked **No/Partial** needs instrumentation the platform does not
> ship: an **external `/health` probe** (REL-3/4), **feature-level audit call-sites**
> (ENG-5, ADO-3, QUA-4), a **client/product-analytics pipeline** (ENG-6, ADO-2/5, QUA-5),
> and **scrape-retention/alerting** for continuous windows (TD-6). None is claimed built.

---

## 4. Adoption measurements

**Adoption is measured from the real substrate the customer's own instance emits — never
a fabricated count.** This section defines the adoption **signals** and their real
sources, states plainly that **no adoption data exists pre-pilot**, and ships a **blank
capture**. It elevates CDEP §5 into the standing adoption-governance definition; it seeds
**no number**.

### 4.1 Adoption signals (real sources only)

| Signal                      | Real source                                     | What it yields                                  | Honest limit                                          |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Active participants         | `audit_log.user_id` distinct                    | Distinct authenticated users active in a period | Append-only; **auth-events only**                     |
| Feature/action usage        | `audit_log.action`                              | Which audited actions fired                     | **Auth actions only today** — no feature depth        |
| Time-to-first-value         | `audit_log.created_at`                          | First-action timestamp per user                 | Per user, from their first entry                      |
| Activity trend              | `audit_log.created_at`                          | Entries over the window (day/week)              | Volume, not intent                                    |
| Request volume & status mix | `neuropause_http_requests_total{method,status}` | Aggregate count; 2xx vs 4xx/5xx share           | **Aggregate only** — not per-user/feature, no latency |
| Availability context        | `/health`, `/metrics` gauges                    | Uptime/pool context for the window              | Explains low usage vs downtime                        |
| Milestone / stage           | GEAP §5 stage · §3.1 personas                   | Crawl/Walk/Run; personas active                 | **Observed checkbox, not telemetry**                  |

### 4.2 Blank adoption capture (ships empty — no value seeded)

```
ADOPTION CAPTURE — blank instrument (fill at pilot time only)
| Period | Active user_ids | Top actions (audit_log) | Req total (2xx/4xx/5xx) | Stage (GEAP §5) | Personas active |
| <week> | —               | —                       | — / — / —               | <Crawl/Walk/Run>| —               |
```

### 4.3 Pre-pilot reality (honest)

- **No adoption data exists.** No pilot has run; there is **no GA and no production
  fleet**. This document asserts **no active-user count, no usage rate, no request total,
  and no stage attainment** — every cell above is blank by rule.
- **What can be measured on day one of a pilot:** ENG-1..4 and ADO-4 (auth presence +
  aggregate request volume) — the **customer's own** numbers, computed read-only against
  **their** `audit_log` / `/metrics`.
- **What cannot, until instrumented:** feature-level adoption (ADO-3 / ENG-5),
  maturity/persona attainment as telemetry (ADO-2/5), and any per-feature funnel — these
  are **Proposed instrumentation**, not measurable today, and must never be presented as
  measured (`_grounding.md` rules 2 & 5).

---

## Provenance & scope

- **Definitions, not values.** §1–§4 are **KPI definitions + real sources + methods +
  proposed targets**. **No value column is populated**; there is no production fleet and
  no product-analytics pipeline. RC baselines cited in targets (3,856 tests, 0 prod
  vulns, all gates green) are **real Validated CI facts** (`_grounding.md`), not live KPI
  values.
- **KPI governance ownership (roles, not people).** Engagement/Adoption → **Product
  owner**; Reliability-experienced → **SRE**; Quality → **QA**; audit-completeness &
  security-relevant KPIs → **Security**. Reviewed on the EOSP §5 cadence; re-checked at
  every release gate.
- **Real substrate of record.** `/metrics`
  (`neuropause_backend_up|_uptime_seconds|_resident_memory_bytes|_heap_used_bytes`,
  `neuropause_pg_pool_connections{state}`, `neuropause_http_requests_total{method,status}`
  — `observability/metrics.ts`), `/health` (`status`, `components.database|redis` —
  `app.ts`), `audit_log` (`user_id, action, detail, ip, created_at` — `0001_init.sql`;
  five auth actions written — `auth/router.ts`), CI quality gates.
- **Honest gaps (named, not hidden).** No product-analytics/event-tracking pipeline; no
  per-feature client telemetry; `audit_log` is auth-events-only; `neuropause_backend_up`
  is static (`1` when scrapable, no sample when down); no latency histogram; availability
  needs an external probe the platform does not ship; alerting/tracing absent (TD-6).
- **Elevates, does not duplicate.** SLI/SLO/error-budget math is owned by EOSP §3 /
  `SRE.md`; the adoption instruments and pilot forms by CDEP §5; the prioritization rubric
  by PRODUCT-EVOLUTION — all **referenced, not restated**. PERG adds the governance layer:
  the KPI catalog, the measurability verdicts, and the instrumentation backlog that gates
  product decisions from **Validated RC → GA**.
