# NeuroPause — Round 24 status: done, and remaining

**Date:** 13 August 2026, end of session
**Baseline:** `BASELINE-ee7e55790755` at commit `1d208cf`, branch `fix/round23-flush-barrier-recorder`
**Certification:** Program 13C — **7 of 25 gates PASS. NOT CERTIFIED.**
**Prepared for:** Saurabh Patel, Dr Kinjal Mali, Dishant Dobariya

---

## The uncomfortable summary first

There is still no installable, certified build. Two real defects were found and
fixed tonight, the test suite is green on a baseline whose toolchain finally
matches its pin, and seven gates hold evidence. Eighteen do not.

Two things changed the shape of the problem rather than the count:

1. **A Windows installer has existed since 13:34 UTC today.** `windows-release`
   for tag `v1.0.0-rc.16` completed successfully. It was reported as absent in
   the previous handoff because a diagnostic command was written so that
   "nothing failed" and "nothing ran" printed identically. That was an error in
   the reporting, not in the pipeline.

2. **The macOS 401 is not a certificate problem.** Signing works. The failure is
   the notarisation credential, now narrowed to the app-specific password.

---

## Completed this session

### 1. O-8 — a restart re-fired automation rules *(found, fixed, controlled)*

The automation scheduler's once-per-occurrence guard lived in a plain `Map`
inside the subsystem closure, so it died with the process. An `interval`
schedule reports `due: true` on **every** tick by construction, which made that
map the only thing standing between a relaunch and a second execution of an
occurrence that had already fired.

Relaunch inside the bucket and every interval rule fired again, immediately,
once per restart — and a crash loop is a restart loop. The actions those rules
execute are webhooks, notifications and connector writes.

**Fix:** the occurrence claim is persisted on the rule itself
(`lastScheduledOccurrence`), written **before** the fire, so at-most-once means
the same thing on both sides of a restart.

Deliberately *not* stored on `lastRun.at`, which also records manual runs —
reading that as the suppression source would let a 09:05 manual run silently
cancel the 09:00 daily schedule for the rest of the day.

Shipped as `round24b.patch`, commit `aa46897`.

### 2. O-9 — the call site Round 10 missed *(found, fixed, controlled)*

`enterprise/index.ts` debounced the parked-reference retry behind **one shared
timer**, cleared and re-armed on every save on the install, calling
`engine.retryPending(null)` with no principal. Two failures in one block:

- **Whose queue runs was decided 400 ms later**, from whoever was signed in at
  fire time, not from the tenant whose save scheduled it.
- **One tenant's save cancelled another's pending pass.** Under a bulk import
  the window never elapses and the parking queue is not drained by this path
  at all.

This is the exact shape fixed in `graph/index.ts`, `memory/index.ts` and
`taskScheduler.ts` under Round 10 (NEW-M10). This fourth site was never re-read
against that fix. Nothing crosses tenants — the store is owner-scoped both ways
— so it is the quiet failure: work that silently does not happen.

Shipped as `round24c.patch`, commit `1d208cf`.

### 3. O-10 — eight verdicts were recorded under the wrong identity

`.git/config` in this repository named Saurabh, so all three of tonight's
commits carry him as author and the first recording of eight gates carried him
as `recorded_by` — including a G13 row whose own `owner` field says Dishant.

This is O-7 in a worse form: not "cannot attribute a change to a person" but
"attributes it confidently to the wrong one, in a signed artifact."

Identity corrected at repository scope; the eight verdicts re-recorded so
`recorded_by` is true. `head_author` deliberately left as Saurabh — the commits
are immutable and rewriting them would invalidate the baseline. The divergence
between the two fields is now the visible record.

### 4. Verification — numbers, not adjectives

| Check | Result |
|---|---|
| Full suite, parallel | **8,088 passed** (776 files), 17.13 s |
| Full suite, file parallelism disabled | **8,088 passed**, 129.26 s |
| UI suite (`vitest.ui.config.ts`) | **138 passed**, 3.59 s |
| `npm run typecheck` | exit 0, 0 errors |
| `npx eslint .` | exit 0, 0 errors |
| O-8 negative control | **2 of 9 fail** |
| O-9 negative control | **6 of 6 fail** |

Both controls are the **prior committed files restored from git**, not
paraphrases of them. That distinction matters: the first attempt at this
technique earlier in the programme used a reconstruction that still passed,
which is how a broken write barrier survived a control.

### 5. Baseline and gates

`BASELINE-ee7e55790755` records `node_running 20.20.2` against `node_pinned 20`
— **the first baseline in Program 13C where the runtime matches the pin.** Every
suite recorded against the previous baseline carried a toolchain warning saying
it was not really a run against that tree.

| Gate | Verdict | What it proves |
|---|---|---|
| G0 | PASS | Baseline frozen, clean tree, ancestry and source verified |
| G0b | PASS | Node 20.20.2 matches the pin |
| G0c | PASS | Typecheck, 0 errors |
| G0d | PASS | Lint, 0 errors |
| G0e | PASS | Deliberate regressions make their tests fail |
| G0f | PASS | Suite deterministic in both concurrency modes |
| G12 | PASS | Background-job ownership survives a restart |
| G13 | BLOCKED | O-9 fixed but only WIRED, not EXECUTED |

**G13 is deliberately not a PASS.** `initEnterprise` reaches `app.getPath`, so
its test reads the source and asserts the shape rather than running the retry
pass. That proves the defect cannot silently return through an edit; it does not
prove the pass executes under the right tenant at runtime. Recording PASS on a
source-shape assertion is DECLARED = PROVEN, which is the failure this programme
exists to prevent.

### 6. Installers

- **Windows:** built successfully from tag `v1.0.0-rc.16`, run `31705572329`.
  The pipeline works end to end.
  **Caveat:** that artifact predates round23 and all of round24, so its hash
  cannot close G1 or G18 for the current baseline. A new tag will be needed.
- **macOS:** signing succeeds (`Developer ID Application: Dishant Dobariya`).
  Notarisation returns 401. Diagnosed to the app-specific password — the Apple
  ID resolves, the password is rejected.

---

## Remaining — 18 gates

### Dishant, and needing nothing from anyone else

| Gate | What it needs |
|---|---|
| **G11** | Retention: eviction scoped per tenant, **surviving restart**. Same technique as G12 applied to `pruneOwn` across a new store instance. **Cheapest remaining gate.** |
| **G10** | Runtime ownership: executor never receives the prohibited operation |
| **G13** | Extract the reference-retry debounce into an Electron-free module, then drive it behaviourally alongside the existing NEW-M10 cases |
| **G2** | Wiring census: zero unexplained production orphans |
| **G14** | Recovery drill: kill it, watch it report UNAVAILABLE honestly, restart |
| **G19** | Open-defect report empty |

### Blocked on the macOS credential

| Gate | What it needs |
|---|---|
| **G1** | Installer hashes produced from the frozen baseline — needs a new tag built from `1d208cf` |
| **G16** | Cross-platform: real binaries on **both** platforms |
| **G18** | Release provenance: installer hash referenced by the certification artifact |
| **G4** | Real UI on physical Windows and macOS, screen captured *(Windows half is reachable today)* |

### Blocked on infrastructure that does not exist

| Gate | What it needs |
|---|---|
| **G3** | DNS → TCP → TLS → HTTP → `/health/ready`, from two networks, against a host that stays up |
| **G5** | Authentication against production, not a laptop |
| **G15** | Restore drill: real data → isolated restore → count the rows |
| **G17** | Production smoke: live end to end through the real API |

### Saurabh's, and no amount of engineering closes them

| Gate | What it needs |
|---|---|
| **G6** | Governance verdicts declared **before** execution, then matched |
| **G7** | Paired allow/refuse cases; verdict **and** reason class |
| **G8** | The deterministic adversarial matrix |
| **G9** | Same case ×3 identical; change policy version → verdict changes |

G9 has a structural problem recorded in the baseline itself: **no policy version
exists in this product.** It is recorded as absent rather than filled with a
plausible value, and G9 cannot pass until one exists.

---

## Open findings

| # | Finding | Status |
|---|---|---|
| O-1 | Retention test intermittent | Diagnosed → F-11b, fixed |
| O-2 | `crashReporter.export()` reads without flushing | Fixed (round23) |
| O-3 | Reachability check races IPC registration | Fixed (round23) |
| O-4 | Two banners state the same failure | Fixed (round23) |
| O-5 | Recorder could not accept a verdict once evidence was committed | Fixed (round23) |
| O-6 | Default branch 14 RCs behind | Resolved — merged |
| O-7 | Repository cannot attribute a change to a person | **Open** |
| O-8 | Restart re-fires an automation occurrence | Fixed (round24b) |
| O-9 | Parked-reference retry ran as the wrong tenant | Fixed (round24c), **evidence WIRED only** |
| O-10 | Eight verdicts recorded under the wrong identity | **Open** — identity fixed, cause not |

---

## Immediate actions, in order

**Dishant — tonight or first thing:**

1. Commit `certification/` and **push the branch**. Three commits and the entire
   certification record currently exist only in one laptop's working tree.
   Committing `certification/` is safe: `verify-freeze` excludes it, which was
   the point of the O-5 fix.
2. Generate a **fresh app-specific password** at appleid.apple.com for the Apple
   ID that appears as Account Holder at developer.apple.com → Membership.
   Re-run `xcrun notarytool store-credentials np-notary`, then correct the
   `APPLE_APP_SPECIFIC_PASSWORD` secret with `gh secret set` (no echo).
3. Once notarisation validates locally, tag from `1d208cf` and let both release
   workflows run. That single tag makes G1, G16 and G18 reachable from one
   baseline instead of two.
4. G11 — the cheapest remaining gate, needs no Apple, no server, nobody else.

**Saurabh — this week:**

1. Write the expected governance verdicts for G6–G9 **before** anything is
   executed against them. Written afterwards they prove nothing.
2. Decide whether a policy version exists. Without one, G9 cannot pass at all.
3. Move the repository to a GitHub organisation with all three of you as owners.
4. A real host for `api.neuropause033.com`. Four gates sit behind it.

**Verification still outstanding:** whether the default branch carries round23
and round24. It was asserted earlier tonight without being checked, and an
unverified claim in a certification report is exactly what this programme is
about. Confirm before any release is cut from `main`.

---

## The honest close

Two genuine defects found and fixed with negative controls taken from git rather
than reconstructed. A test suite green in both concurrency modes on the first
baseline whose runtime matches its pin. A Windows installer that turned out to
exist. A macOS blocker narrowed from "notarisation is broken" to one credential.

Also true: eighteen gates unmeasured, one gate honestly BLOCKED rather than
dressed up, no server, no backup, no alerting, a repository that had to have its
own certification record corrected because it was configured to commit as
someone else — and, at the time of writing, none of tonight's work pushed
anywhere.

Both halves are the report.
