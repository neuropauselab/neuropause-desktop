# PROGRAM 13C — ROUND 17
## RUNTIME CERTIFICATION EVIDENCE RECORD

**Date:** 12 August 2026 · **Branch:** `feat/understanding-holds-motion-system`
**Environment:** macOS 25.5.0 arm64, `saurabhs-MacBook-Pro`, Node v20.20.2, npm 10.8.2
**Verification split:** static in a Linux container, every runtime gate on the Mac.

---

## VERDICT

# NOT CERTIFIED

One open HIGH and five untested gates. Under the program's own rule — any gate
NOT TESTED / UNKNOWN / PARTIAL / BLOCKED ⇒ NOT CERTIFIED — the verdict does not
turn on judgement.

**But the verdict means something different than it did this morning.** Rounds 3
through 16 recorded PASS against an application that could not finish starting.
Today it starts, and three gates are earned rather than assumed.

---

## A. THE FINDING THAT INVALIDATES ROUNDS 3–16

`apps/desktop/src/main/runtimeCore.ts:1023` held `assertAllTenantStoresBound()`.
Forty-three `init*()` calls run *below* that line, and thirteen tenant-scoped
stores construct — and therefore **register** — at import time while calling
`bindScope()` inside those inits.

So from Round 3 (`943dad8`, 11 Aug) the gate threw on a transient state, naming
thirteen stores that were about to be bound correctly. The throw landed in the
`try/catch` around `initRuntimeCore` at `index.ts:139`, composition died at line
1023, and **`registerSecureHandlers` at line 3903 never ran**. The application
painted a full UI and answered `No handler registered` for essentially every
channel.

The diagnostic was destroyed on the way out: `logger.ts` did
`JSON.stringify(meta)`, and an `Error`'s `name`/`message`/`stack` are
non-enumerable, so the fatal was recorded as:

```
ERROR (main) Runtime core failed to initialize {}
```

The file sink is, by that file's own header, the only surviving diagnostic in a
packaged app.

**Fourteen rounds of security certification were conducted against a dead
runtime.** Every static finding and fix from those rounds remains correct; every
statement about runtime behaviour was unfounded.

### Dating it

| Commit | Round | Role |
|---|---|---|
| `8e9bb90` | 2 | added the gate at its (wrong) position |
| `943dad8` | **3** | first late-binding store registered — **the break** |
| `21f64cb` | 9 | another one |

`v1.0.0-rc.15` was tagged `8522dca`, 7 August. **All eight release tags predate
the break** — nothing shipped is affected.

---

## B. FIXES SHIPPED TODAY

| Patch | Change | Negative control |
|---|---|---|
| **round17** | both startup gates moved to immediately before `registerSecureHandlers`, beside `assertAllChannelsClassified` | **NC-R17-ORDER** — reverting fails 2 of 7: *"gates run BEFORE 43 init\*() call(s)"* |
| **round17** | `logger.ts` normalizes `Error` (recursively, incl. `cause`) before `JSON.stringify` | **NC-R17-LOG** — reverting loses the store name from the sink |
| **round17b** | `ResourceStore.bindScope` binds its private `TenantMemo` as well as its row boundary | **NC-R17-MEMO** — reverting makes the cache inert |
| **round17c** | onboarding step ids derive from one const tuple; `z.enum(ONBOARDING_STEP_IDS)` | **NC-R17-STEPS** — reverting fails 2: `expected [ 'legal' ] to deeply equal []` |

Committed as `b47412e`, pushed. round17c applied, not yet committed.

**Program total: 25 discriminating negative controls.**

### What the repositioned gate found on its first honest run

Thirteen names became one:

```
Tenant-scoped stores have no tenant boundary: infrastructure-resource-graph
```

`ResourceStore` holds **two** registered boundaries — `tenancy` on the rows and a
private `TenantMemo` on the composed graph — and `bindScope()` forwarded to only
the first. It was the only unbound memo of 27. It fails **closed** (an unbound
memo composes fresh and caches nothing, and the row filter beneath it was bound
throughout), so it was never a disclosure: it was a projection that silently
never cached. Found because the gate was finally allowed to ask the question.

---

## C. THE FIRST-RUN PATH HAD NEVER BEEN EXECUTED

Three independent blockers, all inside the first two screens, none visible to
7,021 passing tests.

**1 · `ai:config.setMode` requires `cloud:operate` — OPEN.**
`platformOperatorRegistry.ts` deliberately refuses to bootstrap an operator:
*"EMPTY MEANS NOBODY … there is deliberately NO channel, no settings screen and
no bootstrap-if-empty path."* A fresh install therefore has zero platform
operators, and *"Where should your AI work?"* refuses both buttons.

Two independently correct decisions composing into a product that cannot be set
up. Round 7/8 moved the AI-config mutations; the registry has always refused to
self-seed. Neither is wrong on its own.

**Requires a product decision** (§G).

**2 · `onboarding:completeStep` rejected `'legal'` — FIXED (round17c).**
`ONBOARDING_STEPS` lists six steps with `'legal'` — the EULA and privacy
acknowledgement — **second**. `OnboardingCompleteStepRequest` hand-listed five.
`completeStep(step: OnboardingStepId)` typechecks against the six-value union;
the Zod enum is a separate declaration nothing compares it to.

The correct pattern already existed two lines above in the same file's imports:
`HELP_DOC_IDS` is a const tuple consumed by `z.enum()`. Onboarding hand-wrote
both lists. Compliance note: that step's own comment says completing it *"records
that the documents were shown and acknowledged"* — the acknowledgement has never
been recordable.

**3 · The renderer retries authorization failures** — 22 times in 10 seconds.
An authorization refusal is not retryable. OPEN, minor.

---

## D. RUNTIME GATES

| # | Gate | Verdict | Evidence |
|---|---|---|---|
| 1 | Native Mac launch | **PARTIAL** | dev build reaches `Startup complete`, 718 handlers; packaged `.app` not rebuilt since the fixes |
| 2 | Real A/B/C organizations | **PASS** | three `org_<uuid>` orgs created over IPC, canary user + unit seeded in each |
| 3 | Cross-tenant attack matrix | **PARTIAL** | 13 read channels × 3–4 tenants, positive **and** negative controls; reads only |
| 4 | Runtime ownership | NOT TESTED | |
| 5 | Retention under load | NOT TESTED | |
| 6 | Background principal | NOT TESTED | |
| 7 | Queue identity | NOT TESTED | |
| 8 | Restart #1 (graceful) | **PASS** | all seven conditions, §E |
| 9 | Restart #2 (SIGKILL) | **PASS** | no drift, §F |
| 10 | Real backup/restore | NOT TESTED | |
| + | Fresh running-app red team | NOT TESTED | substrate now exists |

**Three earned, two partial, five untested.** This morning: zero.

---

## E. GATE 8 — RESTART #1 · PASS

| Phase-4 condition | Evidence |
|---|---|
| 1 · A/B/C survive restart | orgs 1→4, units 13→16, users 28→34, governance 3/6/0→12/24/26, workspaces 1→4 |
| 2 · Raw stores intact | store loggers unchanged: fed orgs 1, fed policies 4, cloud tenants 1 |
| 3 · Seeded org retains its state | `NeuroPause`: fedOrgs 1, fedPolicies 4, cloudTenants 1 |
| 4 · A/B/C scoped views correct | A, B, C: **0 / 0 / 0** across all three |
| 5 · Resolver rehydrates | four distinct answers, same channels, same session, keyed on active org |
| 6 · No cross-tenant disclosure | 13 channels, own-canary present + foreign-canary absent |
| 7 · Disk persistence | `enterprise-org.json` and `enterprise-governance.json` each contain A, B **and** C canaries after restart |

### The raw-vs-scoped question, resolved

The 1→0 readings were never data loss. Different loggers report different
layers:

| Value | Store logger | Scoped logger |
|---|---|---|
| federation orgs | `federation-runtime` = 1 | `federation` = 0 |
| federation policies | `federation-governance` = 4 | `federation services` = 0 |
| cloud tenants | `cloud-tenancy` = 1 | `cloud` = 0 |

`globalGovStore.ts:386` — `listPolicies()` returns `this.fed.onlyMine(...)`. The
projection is tenant-filtered and organization C owns none of it.

**Inverted, the point is plain:** had C — twenty minutes old, nothing federated —
reported the seeded organization's 1 tenant and 4 policies, *that* would have
been the disclosure. Zero is the boundary working.

Corroborated on disk without being asked: `federation-governance.json` and
`federation-runtime.json` were **last written at 17:33**, before A/B/C existed.
Creating three organizations touched the org directory and governance and left
federation alone.

### The authority boundary — both directions

| Channel (`cloud:operate`) | `operators: 1` | `operators: 0` |
|---|---|---|
| `update:setChannel` | RESOLVED | **refused — Not authorized** |
| `update:download` | RESOLVED | **refused** |
| `update:installOnQuit` | RESOLVED | **refused** |
| `update:checkNow` | RESOLVED | **refused** |
| `registry:export` | RESOLVED | **refused** |
| CONTROL `catalog:featured` | resolved | resolved |

Same build, same payloads, one variable: the operator file. Refusals carry
`Not authorized`, not a Zod message, so it is the authority check firing rather
than payload validation. The strongest single result of the day.

---

## F. GATE 9 — RESTART #2 (SIGKILL) · PASS

`pkill -9`, no quit hooks, then relaunch with **no user action at all**:

| | boot 13:56 | boot 13:59 |
|---|---|---|
| orgs / units / roles / users | 4 / 16 / 24 / **115** | 4 / 16 / 24 / **115** |
| graph nodes on disk | **44** | **44** |
| billing subscriptions | **2** | **2** |
| governance chains / rules / audit | 12 / 24 / 30 | 12 / 24 / 30 |
| workspaces | 4 | 4 |

**No drift.** A store that persists only in an app-quit hook fails here, and none
did.

The earlier growth (users 34→115, graph 22→44) was **activity-driven and
one-time**, not load-time re-seeding — this run is what proves it. The user
arithmetic is exact: 81 = 27 × 3, the 27 built-in workers provisioned into each
of A, B and C on first switch. Bounded, per-organization, and stable.

---

## G. OPEN — DECISION REQUIRED

**D-5 · Does `ai:config.setMode` stay platform-only?**

- **A.** Keep it `cloud:operate`; rewrite onboarding to set a per-tenant AI
  preference. Correct on the authority axis. Real work.
- **B.** Accept one-organization-per-machine; let the org Owner hold it.
  Pragmatic for the product's current shape, weakens the install/tenant split.

This is a product-shape question, not a security one, and Round 17 cannot close
without it.

---

## H. OTHER OPEN FINDINGS

| Finding | Severity |
|---|---|
| Fresh install cannot complete onboarding (D-5) | **HIGH** |
| `index.ts:139` still swallows a fatal from `initRuntimeCore` | MEDIUM — deferred deliberately |
| Release provenance: build-info bakes `rev-parse HEAD` with no dirty check; three artifacts claim `1.0.0-rc.15`; `verify:release` cannot detect a working-tree build | MEDIUM |
| Second launch raises `uncaughtException: Object has been destroyed` instead of exiting cleanly | LOW |
| Renderer retries authorization failures ~22× | LOW |
| `identity.json` first-run logged at ERROR | LOW, log hygiene |
| Windows signing: `signtool.exe` ran five times with no certificate in `electron-builder.yml` — source unidentified | **unresolved question** |
| F22 5/18 adapters; channel→store coverage partial | unchanged since Round 16 |

---

## I. AUTOMATED VERIFICATION

| Gate | Container | macOS |
|---|---|---|
| Desktop main suite | **675 files / 7021 tests, 0 fail** | **identical** |
| Typecheck node / web | 0 / 0 | 0 / 0 |
| `packages/shared` typecheck | clean | — |
| Lint (changed files) | clean | — |
| Negative controls | **25** | — |
| 46 workspaces, backend build | not re-run | **not re-run** |

Container and Mac have matched exactly on every comparison in this program.

---

## J. F22 — MEASURED AGAINST REAL DATA

The disk canary scan gives the denominator empirically for the first time:

| File | A | B | C | Verdict |
|---|---|---|---|---|
| `enterprise-org.json` | 1 | 1 | 1 | **multi-tenant on disk** |
| `enterprise-governance.json` | 1 | 1 | 1 | **multi-tenant on disk** |

Both are among the thirteen unimplemented F22 domains; `enterprise-org` is
decision record D-3. `timeline.jsonl` contained **no** canary strings despite
growing 190KB→196KB, so timeline partitioning remains untested rather than clean.

The only archive on disk is `backups/2026-08-12T12-03-37-041Z-pre-migration` —
the release-ops pre-migration snapshot, whole-install, 8 files, not
tenant-partitioned. F22's problem statement in physical form.

---

## K. WHAT AN AFTERNOON ON THE MAC ACTUALLY BOUGHT

I told you for five rounds that it would retire ten gates. It retired three and
partially retired two.

What it actually did was **invalidate six of my own reports** and surface four
defects — a fourteen-round outage, an unbound tenant memo, a contract drift that
blocked every install, and an authority composition that makes first-run
impossible — none of which 7,021 passing tests could see, and every one of which
appeared within ninety minutes of the application being launched.

The remaining five gates need per-subsystem setup: runtimes, scheduled tasks,
queues, archives. They are a second sitting, not a second round.

**Do not write another static round.**
