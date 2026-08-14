# NeuroPause — full session report

**Session:** 13–14 August 2026, overnight
**Branch:** `fix/round23-flush-barrier-recorder`
**Head at end of session:** `5f0f242`
**Certification:** Program 13C — **7 of 25 gates PASS at `BASELINE-ee7e55790755`. NOT CERTIFIED.**
**Prepared for:** Saurabh Patel, Dr Kinjal Mali, Dishant Dobariya

---

## The honest headline

**The Windows runtime bug is still not diagnosed.** Eight hours in, the root
cause — runtime-core failure, startup race, or workspace-less tenant — remains
one of three candidates. Every screenshot and error string produced so far came
from a binary built *before* any of tonight's fixes, so it describes code that
no longer exists.

What did happen: five real defects found and fixed with negative controls, a
Windows installer that turned out to have existed all along, a release pipeline
that turned out to be broken by my own earlier edit, and an application that
will now say what is wrong with it instead of making someone read files off a
laptop to find out.

Three of the defects fixed tonight were **caused by my own previous repairs.**
That is stated up front because it is the most useful pattern in this report.

---

## 1. Commits made

| Commit | Round | What |
|---|---|---|
| `c9c5d2e` | 24a | Notarization failure no longer destroys a signed macOS artifact |
| `aa46897` | 24b | **O-8** — a restart no longer re-fires an automation occurrence (G12) |
| `1d208cf` | 24c | **O-9** — the parked-reference retry carries its own principal |
| `cdad47a` | — | Certification evidence: baseline, gates, O-10 |
| `91ee4a8` | 25 | **W-1** refusal recording; **W-2** Windows window chrome |
| `d1c602c` | 25b | **W-3** release workflows were unparseable |
| `fccd38a` | 25c | **W-4** CI now validates every workflow |
| `5f0f242` | 26 | **W-5** tenant refusals reach the caller with their own reason |

All pushed. Working tree clean at each step.

---

## 2. Defects found and fixed

### O-8 — a restart re-fired automation rules

The scheduler's once-per-occurrence guard was a plain `Map` in a closure, so it
died with the process. An `interval` schedule reports `due: true` on **every**
tick by construction — suppression was the only thing between a relaunch and a
second execution of an occurrence that had already fired. Relaunch inside the
bucket and every interval rule fired again, once per restart. A crash loop is a
restart loop, and the actions those rules execute are webhooks, notifications
and connector writes.

**Fix:** the claim is persisted on the rule (`lastScheduledOccurrence`), written
*before* the fire, so at-most-once means the same thing on both sides of a
restart. Deliberately not stored on `lastRun.at`, which also records manual runs
— reading that would let a 09:05 manual run silently cancel the 09:00 schedule
for the rest of the day.

**Negative control:** 2 of 9 tests fail against the prior code.

### O-9 — the call site Round 10 missed

`enterprise/index.ts` debounced the parked-reference retry behind **one shared
timer**, cleared and re-armed on every save on the install, calling
`retryPending(null)` with no principal. Two failures in one block: whose queue
runs was decided 400 ms later by whoever was signed in, and one tenant's save
cancelled another's pending pass — so under a bulk import the window never
elapsed at all. Same shape fixed in `graph/`, `memory/` and `taskScheduler` in
Round 10; this fourth site was never re-read against that fix.

Nothing crosses tenants — the store is owner-scoped both ways — so this is the
quiet failure: work that silently does not happen.

**Negative control:** 6 of 6 tests fail against the prior file, restored from
git rather than reconstructed.

### O-10 — eight gate verdicts recorded under the wrong identity

`.git/config` named Saurabh, so all three round24 commits carry him as author
and the first recording of eight gates carried him as `recorded_by` — including
a G13 row whose own `owner` field says Dishant. O-7 said the repository cannot
attribute a change to a person; this said it attributes them confidently to the
wrong one, in a signed artifact.

Identity corrected at repository scope, verdicts re-recorded, and the divergence
between `head_author` and `recorded_by` deliberately left visible as the record
of what happened.

### W-1 — an audit side effect vetoed an authorization outcome

`createAuthorize` called `onPermissionRefused(...)` *before* throwing, at three
sites. That callback writes a durable hold; a hold needs an owner; with no
tenant scope the write throws — and the recorder's exception escaped **in place
of** the authorization error.

The user was told *"Cannot record a hold: no organization and workspace are
active"* when the fact they needed was *"No organization member is bound to this
account."* Both true. Only the second names the condition. **This is why the
Windows investigation spent days in the data layer.**

**Negative control:** the test fails with exactly the reported Windows string.

### W-2 — Windows got a frameless window

`titleBarStyle: 'hiddenInset'` was set unconditionally under a comment reading
"Ignored on other platforms." Three of the four options in that block are
macOS-only no-ops. `titleBarStyle` is not — Windows degrades it to `hidden`,
producing a window with no close, minimise or maximise controls. The comment
asserted a cross-platform property the API does not have, which is why nobody
re-examined it.

### W-3 — both release workflows were unparseable *(self-inflicted)*

Round 23 correctly found that a step's `if:` cannot see that step's own `env:`,
and then "fixed" it by referencing `secrets.` in the `if:` — which is not an
available context there at all. GitHub rejected the whole file. **From that
commit onward neither `windows-release` nor `macos-release` could be dispatched**,
and it surfaced only as an HTTP 422 the day someone tried. Some of what was read
as macOS notarisation failure may have been this.

**Fix:** the flag is computed at job level, where `secrets` *is* available, and
holds only a boolean — the key itself stays in the step that needs it, so the
secret's exposure is not widened.

### W-4 — nothing had ever parsed a workflow file

`scripts/check-workflows.sh` now parses every workflow and rejects unavailable
contexts in `if:`, wired as the first step of `certification-freeze.yml` —
first because a broken workflow cannot check itself.

It caught a break in its own step name during authoring: `- name: Workflows
parse, and no if: uses an unavailable context` put an unquoted `if:` inside a
YAML scalar. Quoted, re-run, clean.

### W-5 — eight reasons, one sentence

`resolveFull()` distinguishes eight reasons a tenant cannot resolve, each with
plain-words text already written. `createAuthorize` discarded all eight and
threw one. An install that never signed in, one with no workspace, and one whose
workspace points at a deleted organization are three different faults with three
different remedies — and from outside the process they were indistinguishable.

**Fix:** `TenantContextError` carries the existing `TenantRefusalReason` as a
stable code and the existing message text. No new error framework; inventing a
second vocabulary would give one condition two names.

**Negative control:** 9 of 13 tests fail without it.

---

## 3. Certification state

`BASELINE-ee7e55790755` at commit `1d208cf` — **the first baseline in Program
13C where the runtime matches the pin** (`node_running 20.20.2` against
`node_pinned 20`; the previous baseline ran 22.22.2, so every suite recorded
against it carried a toolchain warning).

| Gate | Verdict |
|---|---|
| G0, G0b, G0c, G0d, G0e, G0f, G12 | **PASS** |
| G13 | **BLOCKED** — O-9 is fixed but WIRED, not EXECUTED |
| 17 others | NOT RUN |

**G13 is deliberately not a PASS.** `initEnterprise` reaches `app.getPath`, so
its test reads the source and asserts the shape. That proves the defect cannot
silently return through an edit; it does not prove the pass executes under the
right tenant at runtime. Recording PASS on a source-shape assertion is
DECLARED = PROVEN, which this programme exists to prevent.

**The freeze is now stale.** HEAD is `5f0f242`; the baseline points at
`1d208cf`. `verify-freeze.sh` will correctly report FREEZE BROKEN and
`record-gate.sh` will refuse until a re-freeze. The seven PASS records remain
accurate about `1d208cf`.

---

## 4. Test evidence

| Point in session | Files | Tests |
|---|---|---|
| Session start | 773 | 8,066 |
| After round24 | 776 | 8,088 |
| After round25 | 778 | 8,099 |
| After round26 | 779 | 8,112 |

All passing, in **both concurrency modes** (parallel 17.13 s, file-parallelism
disabled 129.26 s), plus UI 138. `npm run typecheck` exit 0 and `npx eslint .`
exit 0 at every step.

**Corroborated on Windows:** CI run `31736409853` ran Typecheck, Lint and Test
green on `windows-latest`. That retires a class of hypothesis — nothing
platform-specific breaks at unit level. It says nothing about bootstrap.

**Negative controls, every fix:**

| Fix | Control result |
|---|---|
| O-8 | 2 of 9 fail |
| O-9 | 6 of 6 fail (whole file restored from git) |
| W-1 / W-2 | 5 of 11 fail |
| W-4 | both controls exit 1 |
| W-5 | 9 of 13 fail |

Controls were taken from **git**, not reconstructed. That distinction matters:
earlier in this programme a paraphrased control passed against broken code and
let a defective write barrier through.

---

## 5. Windows release

**Discovered:** `windows-release` for `v1.0.0-rc.16` had **succeeded at 13:34 UTC
on 13 August** — run `31705572329`. It was reported as absent in an earlier
handoff because a diagnostic command was written so that "nothing failed" and
"nothing ran" printed identically. That was a reporting error, not a pipeline
failure.

**Built:** run `31736409853` from `d1c602c` — green.

- `NeuroPause-Setup.exe` — 111,834,131 bytes
- SHA-256 `55a49980b26302c31f3f4b5ce1128af8c300bc42b564caadc815c6891a95ecab`
- Published as pre-release `win-round25-test` (tag deliberately not `v*`, so it
  does not trigger the release workflows)

**Dispatched:** run `31762377196` from `5f0f242` — status unknown at time of
writing.

**Version collision, unresolved:** both installers are named `1.0.0-rc.16`.
`package.json` needs a bump before any real release — G18 provenance is
unresolvable when one version maps to two hashes. This is very likely why the
error string reported after installing was the pre-W-1 message.

---

## 6. macOS

`notarytool` returns 401. Diagnosed in two steps: the first attempt used the
**Team ID in the Apple ID field**, producing "The account does not exist"; with
the correct email it became "Username or password is incorrect", which resolves
the account and rejects the credential. Remaining candidates: the value is not
an app-specific password, it was revoked by an Apple ID password change, or
`neuropause033@gmail.com` is not the Apple ID enrolled in team `J3G89MY3QG`.

Also relevant: W-3 meant the macOS release workflow could not load at all during
part of this period, so some failures attributed to notarisation were parse
failures.

---

## 7. What is still not done

- **The Windows runtime root cause.** Still one of three candidates.
- **No UI/UX parity work.** Windows and macOS run the same React bundle from the
  same build — there is no platform-specific renderer. The reported "weaker UI"
  is what every screen renders when the tenant scope is null. Rebuilding those
  screens would be the most expensive available way to not fix the cause.
- **No installed-app verification**, no DPI matrix, no visual regression.
- **No GitHub Release** in the `v*` sense.
- **macOS notarisation** — blocked on an Apple credential.
- **18 of 25 gates** not PASS.
- **Re-freeze** required before any further gate recording.

---

## 8. Three defects came from my own repairs

Worth naming as a pattern rather than as three incidents:

1. **round23's workflow "fix"** made both release pipelines unloadable. The
   diagnosis was right; the correction was not verified in the environment that
   would execute it.
2. **`--log-failed`** printed nothing both when a run succeeded and when the run
   id was empty — so I reported "no installer exists" while one had existed for
   nine hours.
3. **A silenced `git apply`** (earlier in the programme) hid a rejected patch for
   forty minutes.

All three share a shape: a change made to fix a real problem, not verified where
it would run. W-4 exists because of it — CI now parses what I edit.

---

## 9. Security and ownership items raised

- **The repository was made public** mid-session to solve a download problem.
  That exposed the production droplet IP `64.227.128.218` and `root@` SSH usage
  in both release workflows, the deploy paths, and the certification record
  documenting the product's own weaknesses. GitHub Secrets themselves are not
  exposed by going public; the target is. Recommended: private again, rotate
  `DEPLOY_SSH_KEY`, move to a non-root deploy user.
- **Single-owner concentration.** The DigitalOcean account, the GitHub personal
  account, the Apple ID, the production API, the certified tree and — until last
  night — the repository's commit identity all resolve to one person. Four
  separate findings, one cause. That belongs in a founder conversation about
  moving the repository to an organisation, not in a patch.

---

## 10. The one thing that ends the guessing

Install the build from `5f0f242`, confirm it with

```
Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter build-info.json -Recurse |
  ForEach-Object { Get-Content $_.FullName }
```

(`commit` must start with `5f0f242`), then open **Data**. It will print one of
eight sentences. Each one names a different fix:

| Sentence | Means | Fix lives in |
|---|---|---|
| "No workspace is active." | provisioning deadlock | workspace bootstrap |
| not-signed-in text | backend unreachable | auth, not tenancy |
| workspace orphaned | dangling org reference | repair, not provisioning |
| tenant not operable | suspended/archived org | organization status |

That sentence is the entire remaining input. Not the log, not the JSON — the
sentence.
