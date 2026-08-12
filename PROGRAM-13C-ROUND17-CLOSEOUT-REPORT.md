# PROGRAM 13C — ROUND 17 CLOSEOUT
## THE ROUND THAT AUDITED ITS OWN INSTRUMENTS

**12 August 2026** · branch `feat/understanding-holds-motion-system` · `9b32132 … 967f1e2`
macOS arm64, Node v20.20.2 · static work in a Linux container, **every result below produced on the Mac or in GitHub Actions**

---

## 0 · WHAT THIS ROUND IS

Rounds 3–16 certified an application that could not complete `initRuntimeCore`.
Round 17 fixed that. This closeout covers what happened **after** the application
started booting, and it is not more security work: it is the discovery that
several of the instruments this programme has been reading were wrong.

Nine defects. **Four of them are mine, three are in this programme's own
remediation, and one is a fourteen-day-old commit nobody re-read.** Every one was
found by executing something rather than reasoning about it.

| Commit | |
|---|---|
| `9b32132` | timing budgets measured where the number means something; builds admit a dirty tree |
| `e2d36fc` | the bench test's name and its budget agree again; suite count was a subset |
| `5c9f80d` | the restriction notice is readable; the composition is testable; the UI suite is a gate |
| `9db121d` | four of ten silent write failures now speak; the pattern is named |
| `7137416` | the desktop test script runs the whole desktop suite |
| `967f1e2` | the backend integration suite has a gate |

---

## 1 · THE SUITE COUNT WAS A SUBSET

Every round of this programme reported **677 files / 7048 tests**. That is
`src/main` alone. `vitest.config.ts` also collects **87 renderer view-model
files**. The true figure was **764 / 8011**.

```
find src/main     -name '*.test.ts'  →  677
find src/renderer -name '*.test.ts'  →   87
                                        ───
                                        764   ← what `npm test` actually runs
```

A subset published as a total, in the certification record, by me, across six
reports and one source comment. Corrected in `e2d36fc` with the miscount stated
rather than quietly overwritten.

## 2 · A TEST THAT ADVERTISED ONE BUDGET AND ENFORCED ANOTHER

`knowledgeBench.test.ts` is named `compose ≤100ms · matrix ≤100ms · lineage
≤100ms · dashboard ≤500ms`. It asserted **120**.

`f48059b1` — *"test(ci): relax Stage 7 benchmark threshold"*, 5 August — moved the
assertion `100 → 120` and left the title untouched. For a week the file said one
thing and enforced another.

The intermittent failure was **contention, not code**: 764 files across parallel
workers, `compose` measured **117.1ms** in the shared run and **17.8ms** alone.
Six-and-a-half times, not "nearly double" — a number I also got wrong.

Resolved by **isolation, not inflation**. Correctness (`assets > 1000`,
`relations > 500`, `lineage.found`, 8 domains) asserted on every run; the four
budgets asserted only under `npm run bench`, which runs the file alone. A run
without them says so out loud. **Compose restored to 100**, where the name always
claimed it was: 18.6ms observed leaves 5.6× headroom, and the reason for the
relaxation — shared workers — is the thing the isolation removed.

## 3 · RELEASE PROVENANCE

`build-info.json` baked `rev-parse HEAD` with no working-tree check. On 12 August
three different things carried `1.0.0-rc.15`: the tag (`8522dca`), a build
claiming `8c570cd`, and the bits inside it, which were `8c570cd` plus two
unapplied patches. `verify-release-artifacts` could not tell them apart — it
checks the feed hash against the binary, which says nothing about provenance.

Now records `branch` and `dirty`, appends `-dirty` to `commit`, warns on stderr.
A repo git cannot answer for reports `dirty: null`, not a comforting `false`.

---

## 4 · THE SUITE NOTHING RAN

`apps/desktop/ui-tests/` — ten files that mount real React components in jsdom and
drive them with real clicks. **`npm test` could not see it**: every `include` glob
in `vitest.config.ts` starts `src/**`, and `ui-tests/` is outside `src/`.

It was **red since 11 August — Program 13C Round 2** (`8e9bb90`), which gave
`RelationshipStore` a `TenantOwnership`. Fifteen rounds of certification ran on
top of a red suite. Nobody noticed because nothing ran it: not `desktop-ci.yml`,
not `test:release`, not the root `npm test`. **Eight release tags shipped without
a single mounted component being rendered.**

| First run | 3 files failed · **10 tests failed** · 101 passed |
|---|---|
| Cause A (7) | `relatedRecords.ui.test.tsx` built a `RelationshipStore` with no `.bindScope` — its sibling stores had one on the line above. Round 2. |
| Cause B (3) | `firstRun.ui.test.tsx` ×2 and `reducedMotion.test.tsx` ×1 still routed `ai:config.setMode`. D-5 moved first run to `ai:preference.set`. Round 17d, the same day. |
| After | **11 files · 116 tests · 0 failures** |

Cause A was fixed by binding a **real tenant**, not by adding an ambient fallback
to `vitest.setup.ts`. That file installs fallback scopes for nine subsystems and
deliberately does not cover `TenantOwnership`; adding one would scope every
tenant-owned store in every test by default and quietly weaken the isolation
proofs this programme rests on. The narrow fix is the honest one.

Cause B was fixed by routing `ai:preference.*` through the **real store and the
real rule**. A hand-written `{ effectiveMode: … }` stub would have been quicker
and would have put a second copy of the intersection law in the tree — the one
thing `tenantAiPreferenceCompose.ts` says must never exist.

## 5 · THE NOTICE THAT RENDERED FOR FOUR MILLISECONDS

The D-5 report listed *"confirm the amber notice renders (one look)"* as work
remaining for a human. **That look would have found nothing.**

```ts
setRestrictedByPlatform(view.restrictedByPlatform);
await ipc.firstRun.set({ aiModeChosen: true });   // ← React flushes here
setStep('workspace');                             // ← the notice's step unmounts
```

The notice lives inside the processing step. It painted for the length of one IPC
round trip and vanished. A saved preference the platform cannot honour, and a
screen that moves on without saying so, **is the silent no-op D-5 was written to
prevent** — reproduced inside the code that prevents it, and shipped in `d1a0e9c`.

Fixed: when the platform cannot honour the choice the step **holds**, the notice
renders with `role="status"` (not `alert` — nothing failed), and one deliberate
click advances. Not a dead end; the button works. An acknowledgement.

**Gate closed by assertion, not by eye.** `firstRun.ui.test.tsx` now clicks
"Allow approved cloud AI", asserts the preference reached the real tenant-bound
store, asserts the notice text is on screen, asserts no `alert` is present, and
asserts the wizard did not advance.

## 6 · THE ONE FUNCTION NOTHING COULD TEST

`aiPreferenceView()` imported the module-level store, which imports `electron` for
`app.getPath('userData')`. Nothing outside an Electron runtime could reach it.
`round17TenantAiPreference.test.ts` covers the **store** and the shared
**resolver** — 23 assertions — and nothing about the composition.

**The single defect this programme shipped lived in exactly that function**:
`restrictedByPlatform` compared modes and ignored `externalConsent`, so a default
install told an organization its cloud choice was in force while external routing
was impossible. It was found by a human running a fresh install. No test could
have found it.

Split into a pure `tenantAiPreferenceCompose.ts` plus a four-line wiring wrapper.
**7 tests**, the first of which pins that exact defect. One expression remains
outside the tested function — `resolveAiMode(cfg, cfg.provider ?? 'ollama')`,
because `resolveAiMode` lives in an Electron-importing module. Stated, not glossed.

---

## 7 · THE RETRY STORM DID NOT EXIST

Five reports referred to a *"renderer authorization retry storm (~22 retries)"*.
There is no retry code in the renderer IPC path: the preload is a bare
pass-through, `lib/ipc.ts:192` invokes once and rethrows, and its `loggedFailures`
set dedupes to one warning per channel per session. **I read 22 log lines and
named a mechanism without checking whether one existed.**

What produced them: `AiRoutingPanel` caught the `cloud:operate` refusal into
`log.warn` and rendered nothing, and the radios are *controlled* by `routing.mode`
— which `refresh()` never updates after a failure — so React put the selection
straight back. The control un-clicked itself in silence. Twenty-two clicks by a
person, which is the rational response.

## 8 · THE PATTERN BEHIND THE HIGH

The first-run HIGH was never a bug. A census of the renderer found **31 catch
blocks whose entire body is a log call. Ten sit on write paths** — a user clicks,
the call is refused, the screen says nothing.

| Closed in `9db121d` | |
|---|---|
| `AiRoutingPanel.setMode` | refused → radio snaps back, silence |
| `AiRoutingPanel.setConsent` | same |
| `AiRoutingPanel.refresh` | panel renders empty, no reason given |
| `FirstRunExperience.chooseWorkspace` | `setStep('discovery')` inside the `try` — "Explore Business" went inert. **The HIGH's exact shape, two steps later in the same wizard.** |

The first-run screen now has **one** error channel, not one per step. The AI panel
renders the boundary's message verbatim rather than rewriting it — inventing a
friendlier sentence means classifying by regex on English prose, which is what
**D-6** exists to stop.

## 9 · GATES THAT NOTHING INVOKED

Adding a `test:ui` step to `desktop-ci.yml` was **half a fix**. The release
workflows do not run that file; they run `test:release`, which runs each
workspace's own `test` script. A signed artifact could still ship with the UI
suite unrun.

`@neuropause/desktop`'s `test` now runs **both configs**, so every caller gets the
whole suite without knowing it exists — this workflow, `test:release`, a developer
typing `npm test`, and whatever workflow someone adds next. *A gate each caller
must remember to invoke is the same defect as no gate, one indirection later.*

An audit of all **54 vitest configs** and every workspace `test*` script against
every workflow then found a second orphan: **`apps/backend`'s `test:integration`**,
invoked by nothing. Its two files are `auth.test.ts` and `organizations.test.ts` —
the identity and tenant boundary the desktop app trusts.

**Unlike the UI suite, it is green.** Verified against a real Postgres 16 + Redis 7
with the database dropped so `waitForDb` had to create it: 12 migrations applied,
**2 files / 17 tests**. Ungated and passing is still ungated — nothing would have
said so on the day it stopped. Now a `backend-ci` job with service containers.

Three clean negatives from the same audit: `packages/shared` and
`shared-cloud` have no `test` script because they have **zero test files**
(their code is exercised from desktop tests); the `vitest.config.ts.timestamp-*`
files are already gitignored and untracked; **no third orphan exists.**

---

## 10 · NEGATIVE CONTROLS

| Control | Result |
|---|---|
| **NC-17h-A** — remove `setError` from `AiRoutingPanel.setMode` | **3/3 FAIL** — *"Unable to find role=alert"*; restored → 3/3 pass |
| **NC-17h-B** — remove `setActionError` from `chooseWorkspace` | **1 FAIL / 7 pass**; restored → 8/8 pass |
| **NC-D5-ELEVATE** (carried) — resolver returns the tenant value | **3 fail**, incl. *"a tenant preference widened platform policy"* |

## 11 · VERIFICATION

| Gate | Result | Where |
|---|---|---|
| Desktop node suite | **765 files / 8018 tests, 0 failures** | Mac + GitHub Actions |
| Desktop UI suite | **11 files / 116 tests, 0 failures** (was 3 files / 10 tests failing) | Mac + GitHub Actions |
| Backend unit | **37 / 418** | GitHub Actions |
| Backend integration | **2 / 17** — real Postgres 16 + Redis 7 | container + GitHub Actions |
| `npm run bench` | compose **18.6ms** / budget 100 | Mac |
| Typecheck node / web | clean | Mac |
| Lint `--max-warnings 0` | clean | Mac |
| `desktop-ci` `7137416` | **success** — one step, both summaries | GitHub Actions |
| `backend-ci` `967f1e2` | **success** — all three jobs incl. new `integration` | GitHub Actions |
| Working-copy integrity | 2413 files, digest `000291b3…0b3721` identical to the committed tree | container ↔ Mac |
| 46 workspaces, backend build on the Mac | **NOT RUN** | — |

---

## 12 · GATE STATUS

| Gate | Verdict |
|---|---|
| D-5 intersection law | **PASS** — 9/9 exhaustive + 7 composition tests + NC-D5-ELEVATE |
| HIGH — fresh install cannot complete onboarding | **CLOSED** — both paths, and the restriction notice now asserted on screen |
| Amber restriction notice | **PASS** — mounted-component assertion, not an eye |
| Tenant RBAC / cross-tenant | **PASS** (unit); runtime cross-tenant reads only |
| F22 19-domain honesty | **PASS** |
| Channel→store | 2 declared; coverage **PARTIAL** |
| 1 Native Mac launch | **PARTIAL** — dev build; packaged `.app` not rebuilt since the fixes |
| 2 Real A/B/C | **PASS** |
| 3 Cross-tenant matrix | **PARTIAL** — reads only, mutations incomplete |
| 4 Runtime ownership | **NOT TESTED** |
| 5 Retention | **NOT TESTED** |
| 6 Background principal | **NOT TESTED** |
| 7 Queue identity | **NOT TESTED** |
| 8 Restart #1 | **PASS** |
| 9 Restart #2 (SIGKILL) | **PASS** |
| 10 Real backup/restore | **NOT TESTED** |
| Fresh running-app red team | **NOT TESTED** |

# PROGRAM 13C — NOT CERTIFIED

Five gates untested, one partial, one reads-only. The verdict does not turn on
judgement, and nothing in this round moves it. What this round changed is that
the certification's own instruments are less wrong than they were this morning:
one suite that ran nowhere is a gate, one that was red for fifteen rounds is
green, one law that had no test has seven, one budget that lied about itself
tells the truth, and one notice that promised honesty for four milliseconds now
waits for a click.

---

## 13 · SCOPE — READ THIS BEFORE QUOTING ANY VERDICT

Since 10 August, across seventeen rounds:

```
716  apps/desktop
 34  packages/shared
  3  .github/workflows
  0  apps/backend        ← zero
```

**Program 13C is a multi-tenant isolation certification that has examined the
desktop application and nothing else.** The backend carries its own tenant
boundary — `0003_organizations.sql`, `0004_auth_hardening.sql`, its own RBAC, its
own API surface, its own database. The two integration tests gated in `967f1e2`
are named `auth` and `organizations`. That is not a coincidence; it is the
boundary sitting immediately next to the one this programme has spent seventeen
rounds on, and it has never been looked at.

This is not a defect. It is a scope boundary that has been treated as certified by
association. Whatever "PROGRAM 13C = CERTIFIED" is eventually meant to assert to a
customer, it will not cover the backend unless that is decided deliberately.

## 14 · OPEN DECISIONS

| | |
|---|---|
| **D-6** | Authorization outcomes cross the IPC boundary as English prose. `AuthorizationError` carries a structured `permission` field and `name`; `secureBridge.ts:195` rebuilds it as `IpcError(message)` and Electron serializes only `message`. Three renderer sites classify denials by copy-pasted regex; `retrievalStatus.ts:160` concedes it cannot distinguish and defaults `retryable: true`. **Reword the message and every one of them silently fails open.** Recommendation: a closed machine-readable code in the envelope — never the stack — plus one `isAuthzDenial` in `lib/ipcError.ts`. |
| **D-7** | The six remaining silent write paths (`OperationsProvider:371`, `SandboxProvider:271/280/289`, `WorkspaceContextProvider:90`, `WelcomeView:75`), and whether the census becomes enforceable: `no-restricted-syntax` with `CatchClause > BlockStatement[body.length=1] > ExpressionStatement > CallExpression[callee.object.name='log']`. It also flags the 21 read/refresh sites, so landing it means deciding what those owe the user. |
| **tsconfig** | `ui-tests/` is in neither `tsconfig.node.json` (`src/main`, `src/preload`) nor `tsconfig.web.json` (`src/renderer/src`). **Those files have never been typechecked** — including everything written today. |
| **Node 20 actions** | `actions/checkout@v4` / `actions/setup-node@v4` are being forced onto Node 24 across all five workflows, two of which are the release pipelines. A warning today. |

## 15 · REMAINING

1. Gates 4, 5, 6, 7, 10 — per-subsystem setup, a second sitting at the machine
2. Rebuild the packaged `.app` → converts gate 1 to PASS
3. Gate 3 — the mutation half of the cross-tenant matrix against a running app
4. 46 workspaces + backend build on the Mac
5. Channel→store coverage beyond the first two
6. F22 5/19 → the thirteen remaining, four still needing decisions D-1…D-4
7. Fresh running-app red team

## 16 · ERRORS I MADE TODAY, FOR THE RECORD

1. Published `src/main`'s test count as the suite total, in six reports.
2. Called a "retry storm" a mechanism that does not exist, in five reports.
3. Quoted 59.4ms as the isolated bench figure; it is 17.8ms.
4. Shipped `restrictedByPlatform` comparing modes while ignoring `externalConsent`.
5. Shipped a restriction notice that could not be read.
6. Wrote a patch that silently rewrote an unrelated line in `package.json`.
7. Fixed the CI gate on the PR path and called it closed while releases still skipped it.
8. Predicted two UI failures when there were ten.
9. Handed over three commands that did not run as written (`<>` placeholders, two bad ANSI filters).

Six of these were caught by running something. Three were caught by you.

**Do not write another static round.**
