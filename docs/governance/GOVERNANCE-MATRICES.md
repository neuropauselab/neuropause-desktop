# NeuroPause — Product Governance Matrices

The PERG reconnaissance deliverable. Four matrices governing NeuroPause's evolution
after GA, built from the **real** backlog, debt, and risk registers. Every item
carries one evidence label: **Implemented** (runs today) · **Validated** (verified
by gates/tests/benchmarks) · **Proposed** (committed, near-term, backlog-grounded)
· **Future Vision** (aspirational, uncommitted).

Anchors: platform is a **Validated Release Candidate** (`1.0.0-rc.1`); **no GA, no
post-GA release, no customer, no production fleet exists.** Registers are the real
GA matrices (`ENTERPRISE-GA-REPORT.md`).

---

## 1. Product Evolution Matrix

Where each capability stands and how it evolves. (Capabilities, not fabricated
progress.)

| Capability area                      | State                      | Evidence                                                           | Next governed step   |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------ | -------------------- |
| Core platform (desktop + backend)    | **Validated**              | 3,856 tests, build 0, EVP measured                                 | maintain; RC→GA gate |
| Authentication (OAuth/PKCE)          | **Validated / Proposed**   | PKCE validated; Apple JWKS Proposed (TD-1)                         | close TD-1 (High)    |
| Marketplace / packages               | **Implemented / Proposed** | pipeline implemented; signed-install Proposed (TD-2)               | close TD-2 (High)    |
| Deployment (Docker/K8s/Helm/offline) | **Validated**              | kubeconform strict, shellcheck, EVP                                | maintain             |
| Reliability / DR                     | **Validated / Proposed**   | backup/restore proven; automated rollback Proposed (TD-5)          | promote rollback     |
| Observability                        | **Implemented / Proposed** | `/metrics`+`/health`+`audit_log`; alerting/tracing Proposed (TD-6) | wire alerting        |
| Release engineering (CI)             | **Implemented / Proposed** | 3 workflows; desktop/macOS CI Proposed (TD-4)                      | add desktop+mac CI   |
| Client-tier performance              | **Proposed**               | harness exists; target-hw run Proposed                             | run on macOS         |
| Federation                           | **Future Vision**          | modeled only                                                       | design when demanded |
| Multi-region / i18n                  | **Future Vision**          | proposed in EOSP; not built                                        | 2.x                  |
| Statistical prediction/forecasting   | **Future Vision**          | no engine (NSSP L0)                                                | 2.x research         |

---

## 2. Release Readiness Matrix

The governed gate from **Validated RC → GA**, then per-release readiness. (No
release beyond `1.0.0-rc.1` exists.)

| Gate                          | Requirement                               | State         | Blocking?             |
| ----------------------------- | ----------------------------------------- | ------------- | --------------------- |
| Quality gates                 | typecheck/lint/test 3,856/build all green | **Validated** | —                     |
| Production vulns              | `npm audit --omit=dev` = 0                | **Validated** | —                     |
| Deployment validation         | kubeconform strict + shellcheck           | **Validated** | —                     |
| HIGH security items closed    | TD-1 Apple JWKS, TD-2 signed install      | **Proposed**  | **Yes — GA blocker**  |
| Desktop CI per PR             | TD-4a                                     | **Proposed**  | Yes (release-quality) |
| macOS release automation      | TD-4b                                     | **Proposed**  | Yes (signed GA build) |
| Automated rollback            | TD-5                                      | **Proposed**  | Recommended pre-GA    |
| Alerting/observability        | TD-6                                      | **Proposed**  | Recommended pre-GA    |
| Target-hardware benchmarks    | client SLIs measured                      | **Proposed**  | Recommended           |
| First customer pilot evidence | CDEP loop executed                        | **Proposed**  | Recommended pre-GA    |

**Readiness verdict:** the release _process_ is validated; **GA is gated on closing
TD-1 and TD-2 (both High) plus release-engineering TD-4** — governed here, not yet done.

---

## 3. Technical Debt Matrix (governed register)

The real GA debt register (TD-1…TD-10), with governance fields. Severities verbatim.

| ID    | Debt                                               | Severity | Owning role | Remediation                                 | Retirement criterion            |
| ----- | -------------------------------------------------- | -------- | ----------- | ------------------------------------------- | ------------------------------- |
| TD-1  | Apple `id_token` not JWKS-verified                 | **High** | Security    | verify vs Apple JWKS (add `jose`)           | signature verified + test       |
| TD-2  | Marketplace unsigned-install bypass                | **High** | Security    | require signature / non-empty trust store   | unsigned install refused + test |
| TD-3  | Rate-limit fail-open on Redis loss                 | Medium   | SRE         | alert on fail-open (deliberate design)      | alert wired; documented         |
| TD-4  | No per-PR desktop CI / no macOS release automation | Medium   | DevEx       | add desktop CI + mac release workflow       | both in CI, green               |
| TD-5  | Advisory rollback; federation DR modeled           | Medium   | SRE         | automate rollback; DR when federation ships | automated rollback tested       |
| TD-6  | No alerting / tracing / capacity forecasting       | Medium   | SRE         | wire alert routing + tracing                | alerts fire on burn-rate        |
| TD-7  | No renderer E2E/a11y; no coverage instrument       | Medium   | QA          | add E2E/a11y + coverage                     | suites present + gated          |
| TD-8  | 930 KB renderer chunk                              | Low–Med  | Frontend    | route-split / trim                          | chunk under budget              |
| TD-9  | Partial admin-scope UI                             | Low      | Product     | surface remaining scopes                    | full scope coverage             |
| TD-10 | FNV-1a in one non-security path                    | Low      | Security    | review; swap if security-relevant           | reviewed / documented           |

---

## 4. Roadmap Dependency Matrix

The 7 governed open items, sequenced by dependency (the near-term Proposed roadmap).
No dates — dependency waves only.

| Wave   | Item (Proposed)                    | Depends on               | Unblocks                        | Evidence when done    |
| ------ | ---------------------------------- | ------------------------ | ------------------------------- | --------------------- |
| **W1** | TD-1 Apple JWKS verification       | —                        | GA security gate                | signature-verify test |
| **W1** | TD-2 signed-install enforcement    | —                        | GA security gate                | unsigned-refused test |
| **W1** | TD-4a per-PR desktop CI            | —                        | release quality; safe iteration | desktop suite gated   |
| **W2** | TD-4b macOS release automation     | W1 CI                    | signed GA build                 | mac artifact in CI    |
| **W2** | TD-6 alerting/tracing              | — (uses real `/metrics`) | measurable SLOs; TD-3 alert     | burn-rate alert fires |
| **W2** | TD-5 automated rollback            | W1 CI                    | safe GA operations              | rollback drill passes |
| **W3** | target-hardware desktop benchmarks | macOS build (W2)         | client-tier SLIs measured       | field bench artifact  |
| **W3** | first customer pilot (CDEP)        | GA-candidate build       | real operational evidence       | filled CDEP templates |

**Critical path to GA:** W1 (TD-1, TD-2, TD-4a) → W2 (mac automation, alerting,
rollback) → GA candidate → W3 (benchmarks + first pilot). Every item is Proposed and
backlog-grounded; none is claimed done.

---

## Reading note

These matrices are the governed backbone of the PERG frameworks and the final
`PRODUCT-GOVERNANCE-REPORT.md`. Nothing here marks a roadmap item delivered that is
not truly Implemented, invents a metric or customer, or commits a Future-Vision
item. The registers are the real GA matrices — PERG governs their retirement.
