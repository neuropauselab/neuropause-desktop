# D-7 — SILENT WRITE PATHS

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `17d4798`
**Scope:** the six write paths D-7 named as remaining. No other gate touched; no main-process code
changed.

**The defect class, in one line:** *a click is refused and the screen says nothing.*

---

## STATUS

**D-7's six named paths are RESOLVED.** Four were genuine user-facing silent writes and are fixed;
**two were not what the register said they were**, and are re-classified with evidence rather than
patched to make a count come out right.

**The class is NOT eliminated.** A stronger census (AST, not text) found further sites the original
count of ten missed. Those are filed below as **D-7b, OPEN** — see "what this does not claim".

## WHAT THE REGISTER SAID, AND WHAT WAS ACTUALLY THERE

The population came from Round 17: *"a census of the renderer found 31 catch blocks whose entire body
is a log call. Ten sit on write paths."* Four closed in Round 17h (`9db121d`), six were listed as
remaining. Re-measured at HEAD — the citations date from `9db121d`, 460 commits and 89 changed
renderer files ago:

| Register slot | Re-measured | Disposition |
|---|---|---|
| `OperationsProvider:371` | line exact | **FIXED** — and it had **two** failure modes, not one |
| `SandboxProvider:271` | line exact | **FIXED** (`generateReport`) |
| `SandboxProvider:280` | line exact | **NOT A USER-FACING PATH** — `cancelExecution` has no caller |
| `SandboxProvider:289` | line exact | **FIXED** (`setSchedule`) |
| `WorkspaceContextProvider:90` | line exact | **RE-CLASSIFIED** — not user-initiated; the real defect was next door |
| `WelcomeView:75` | **drifted to :88** | **FIXED** (`restartTour`) + two unlisted siblings |

### The two that were not what they were filed as

**`SandboxProvider:280` — `cancelExecution` has no caller.** A census over 3,707 files
(`src/renderer`, `src/main`, `src/preload`, `packages`) found zero call sites. No click can reach it,
so it cannot be a *silent* write for a user. It was given the same shape as its siblings for
consistency, and that is **recorded, not counted** as a closed user-facing path.

**`WorkspaceContextProvider:90` — not user-initiated, and unfixable in place.** The site is
`flushSnapshot`, a 400ms-debounced layout save driven by a `useEffect` and a `beforeunload` listener.
No button means "save my layout". Its two click-adjacent callers (`switchWorkspace`, `createWorkspace`)
fail on the **outgoing** view's layout save while the action the user asked for succeeds anyway. By
the gate's own test it is not a silent write path.

It is also **structurally unfixable at that site**: `App.tsx:43/45` opens `WorkspaceContextProvider`
*outside* `ToastProvider`, so it cannot reach the toast layer, and it renders nothing but its
children. Adding error state there would have rendered nowhere — state nothing displays is a fake
fix, so it was not done.

**The real defect of that class, in the surface the user actually drives, is
`WorkspaceSwitcher`'s shared `run` helper — which had no `catch` at all.** Every consequential view
write (create / rename / delete / switch) funnels through it, so a rejection escaped as an unhandled
promise, `finally` un-greyed the popover, and the list simply did not change. **One catch on the
helper closes all four writes**, which is why the fix is a helper and not four call sites.

### Two sites the register never listed

Found by reading the files rather than trusting the list: `WelcomeView.complete()` (the checklist's
own "mark done" write) and the pilot toggle's outer catch — same shape, same screen. Both fixed,
since the surface was being added anyway.

## THE FIXES

The canonical Round-17h pattern was recovered from `9db121d` and followed rather than reinvented:
**(a)** one error channel per screen, named for the action; **(b)** cleared at the top of every write;
**(c)** set in the catch **beside** the existing log, never replacing it; **(d)** rendered as
`role="alert"`.

**`OperationsProvider.setFlags`** — reuses `appendLog`, the file's own failure surface (26 call sites,
rendered by `LogsPanel`), which six sibling catches already use; `setFlags` was the lone exception.
A second competing banner here would have been the defect the first-run screen already learned once.
**Both** failure modes are handled: the rejection, **and** the resolved-`null` refusal —
`registry:setFlags` answers `RegistryEntryDto | null`, so an unknown slug returns `null` without
throwing, the catch never runs, and the write silently did not happen. That second mode is invisible
to any test that only makes the channel throw. The write is permission-gated (`dashboard:read`),
`audit: true`, and durably persisted, so "it's only cosmetic" was not available as a defence.

**`SandboxProvider`** — the three catches now set the provider's existing `error`. `setSchedule`'s
message states that the switch is **unchanged**, which is true and load-bearing: `Toggle` is fully
controlled off `summary`, and `refreshLive()` sits after the throwing call, so the control really is
in its prior position. **`SandboxView`'s banner gained `role="alert"`** — it had no role at all, so
nothing announced it. A message on screen that assistive technology never announces is half a fix.

**`WelcomeView`** — a new `actionError` channel with a page-level slot. **Reusing `statusError` would
have been a fake fix**: it means "the checklist could not be LOADED" and renders inside the
`{status ? … : statusError !== null ? … }` ternary, i.e. only when there is no checklist. A failed
write happens while the checklist *is* showing, so that arm is never reached and the message would
have rendered nowhere.

**`WorkspaceSwitcher`** — one `catch` on the shared `run` helper plus a `viewError` slot under the
section where the action is taken. The boundary message is rendered **verbatim**, per the rule stated
in `AiRoutingPanel.tsx:55-60`: re-wording it would mean classifying a refusal by regex on English
prose, which is what D-6 exists to stop.

### A defect found in my own fix, by my own control

The first `setSchedule` fix put the message on a catch that also wrapped `refreshLive()`. A failed
*refresh* would then have claimed the *write* failed — and the message asserts "It is unchanged",
which would have been **a false statement to the user**. The success-path control caught it. The
claim is now scoped to the write itself. (`refreshLive` swallows its own errors and cannot throw
into the caller, so the exposure was latent rather than live — it is fixed regardless, because the
message must not be able to lie.)

## FILES CHANGED

```
MOD  src/renderer/src/operations/OperationsProvider.tsx    setFlags: reject AND resolved-null both reported
MOD  src/renderer/src/sandbox/SandboxProvider.tsx          3 catches speak; each write clears first
MOD  src/renderer/src/sandbox/SandboxView.tsx              error banner gains role="alert"
MOD  src/renderer/src/views/WelcomeView.tsx                actionError channel + page-level alert slot
MOD  src/renderer/src/shell/WorkspaceSwitcher.tsx          one catch on the shared run helper + viewError slot
NEW  ui-tests/silentWriteD7Welcome.test.tsx                3 pins
NEW  ui-tests/silentWriteD7WorkspaceSwitcher.test.tsx      4 pins
NEW  ui-tests/silentWriteD7Sandbox.test.tsx                4 pins
NEW  ui-tests/silentWriteD7Operations.test.tsx             3 pins
```

No main-process file was touched; `gate-detector.sh` returned **PROCEED** on every edited path.

## TESTS AND CHECKS

| Check | Result |
|---|---|
| New D-7 pins | **14/14** |
| Full UI suite | **373 passed** (from 359 — delta **exactly +14**, the new files) |
| Full main suite | **9579 passed / 7 skipped — identical to baseline** (no main-side change) |
| `tsc` node / web | **exit 0 / exit 0** |
| `eslint src ui-tests` | 1 error, **pre-existing**, frozen `cst/sendTransition.negative.test.ts:16` — untouched here |
| `electron-vite build` | **exit 0**, 2.85s |

**Negative controls — every fix proven load-bearing, all four restored byte-identically (sha256):**

| Control | Mutation | Result |
|---|---|---|
| NC-D7-A | `setActionError` removed from `restartTour` | **1 fail** |
| NC-D7-B | `setError` removed from `setSchedule` | **1 fail** |
| NC-D7-C | resolved-`null` refusal branch disabled | **1 fail** |
| NC-D7-D | `catch` removed from the `run` helper | **3 fail** |

NC-D7-C was run twice: the first attempt broke collection (`no tests`), which proves nothing about
an assertion, so it was redone as a syntactically valid one-token mutation.

**An instrument error caught by a control, worth recording.** The Sandbox suite first routed
`IpcChannel.SandboxSetSchedule` — **which does not exist**; the real channel is
`SandboxValidationScheduleSet`. The route bound to `undefined`, the real call went UNROUTED and threw,
and **the refusal test passed for the wrong reason**. Only the success-path control exposed it. A
green from a mis-specified instrument is a fake green nobody had to author.

## WHAT THIS DOES NOT CLAIM — D-7b, OPEN

**The original census of ten undercounted, and the search space is part of the claim.** A fresh AST
census over `apps/desktop/src/renderer` (522 files, 4.8 MB, parsed with the repo's own TypeScript
compiler API rather than by text matching) measured: **250 `CatchClause` nodes · 21 whose sole
statement is a `log.*()` call · 46 `.catch()` with a trivial body · 109 in the union of the swallow
classes.** Notably **zero truly-empty catches** — `eslint:recommended`'s `no-empty` already forbids
them, and all 42 statement-less catches carry an explanatory comment.

Among them, these **user-initiated silent writes are NOT closed by this work**:

| Site | Write |
|---|---|
| ~~`enterprise/modules/EnterpriseModuleScreen.tsx:599`~~ | **CLOSED 2026-08-31** — see the D-7b section below |
| ~~`state/ConnectionProvider.tsx:117 / :120 / :129`~~ | **CLOSED 2026-08-31** — D-7b Site 2, see the section below |
| `enterprise/EnterpriseView.tsx:135 / :142` | `personalization.favorite` / `saveView` |
| `business/BusinessFamilySection.tsx:162` | `personalization.favorite` |
| `views/WelcomeView.tsx` (nested) | the pilot step's inner `completeStep(...).catch(() => undefined)` — the primary write succeeds, so the checklist tick is a secondary effect; left deliberately |

**Enforceability was assessed and is not adopted here.** A `no-restricted-syntax` `CatchClause` rule
targeting the exact D-7 shape would flag ~21 sites today, and the broader swallow union ~109. Adopting
it now would force suppressions on many legitimately-silent catches (teardown, optional probes,
best-effort telemetry), and a rule that forces mass suppression is worse than no rule. It belongs
with D-7b, once the remaining true positives are closed.

**No claim is made** that the silent-write class is eliminated, that non-renderer swallows were
audited, or that any main-process behaviour changed.


---

# D-7b · SITE 1 — `EnterpriseModuleScreen` delete/archive/hold — **CLOSED**

**Date:** 2026-08-31 · **Base HEAD:** `43ba6c7` · Scope: this site only.

## ROOT CAUSE — three defects, and only the first was filed

The register named `EnterpriseModuleScreen:599`, the `.catch(() => undefined)` on
`ipc.holds.resolve`. Tracing the path found that catch was **not even the dominant failure**.

**1 · The hold outcome was discarded, and the likeliest failure never reached the catch.**
`hold:resolve` answers `HoldRecord | null` (`responses.ts:1540`) and returns **null** for an
unknown, already-resolved or out-of-scope hold — `holdStore.ts:67-70`, pinned as *intended*
behaviour by `decisionsIpc.test.ts:171-174` (*"an unknown id is null, not a throw"*). The call site
awaited it and discarded the value, so for the most likely case the `.catch` never ran and the
renderer could not tell "hold closed" from "hold still open". Worse, because the handler **resolves**,
`secureBridge` records the audit row as `ok: true` — *a refusal audited as a success.*

**2 · The archive result was discarded too — a false claim in governance evidence.**
`enterprise:module.setStatus` refuses by RESOLVING `{ok:false}` (`moduleRegistry.ts:603`,
reachable for a concurrently-deleted or out-of-scope record). The result was never read, so a
**refused** archive still closed the hold with the note *"Archived instead of deleting; every link
keeps resolving."* That is a false statement written into a durable governance record.

**3 · A refused delete was mistaken for a deletion.** `requestDelete` handled `!ok` **with** an
assessment, then fell through to `onChanged()` for every other case — so `{ok:false}` without an
assessment closed the modal as though the record had been deleted.

## THE EXACT WRITE PATH

```
row click -> setDetail(r)            EnterpriseModuleScreen.tsx:269
  -> <RecordDetail>                  :329   (mounted only while `detail !== null`)
    Delete            -> requestDelete(false) -> ipc.enterpriseModules.remove
                         -> IpcChannel.EnterpriseModuleDelete 'enterprise:module.delete'
                         -> moduleRegistry.ts:609  (requireAuth, audit, in-handler ctx.authorize -> THROWS)
    Archive instead   -> takeAlternative()      -> ipc.enterpriseModules.setStatus
                         -> IpcChannel.EnterpriseModuleSetStatus 'enterprise:module.setStatus'
                         -> moduleRegistry.ts:563  (refuses by RESOLVING {ok:false})
                       then                      -> ipc.holds.resolve
                         -> IpcChannel.HoldResolve 'hold:resolve'
                         -> decisions/index.ts:83 (static 'governance:manage'; REJECTS on denial,
                                                   RESOLVES null on unknown/already-resolved)
```

**Why a message alone would not have worked.** `onChanged` is
`() => { setDetail(null); void refresh(); }` (`:337-340`) and `RecordDetail` is mounted behind
`{detail && …}` (`:328`). Under React 18.3.1 automatic batching the unmount and the message land in
the **same render pass**, so the message renders **zero frames** — green at the state layer, invisible
to the user. The fix therefore does not call `onChanged()` on a failure, mirroring
`ModuleForm.submit` (`:377-393`), which already returns early and keeps its modal open. Where the
archive succeeded and only the hold failed, `onRefresh()` refreshes the list **without** unmounting.

**A role note, measured rather than assumed:** the seeded **Manager** role holds `crm:manage` but not
`governance:manage` (`enterprise/org/seed.ts:105-130`), so a Manager can archive and cannot resolve
the hold. The original comment's fallback — *"the Holds screen can still resolve it by hand"* — is
**false for exactly that user**, since `HoldsView` hits the same gate. The new message says closing
the hold needs governance permission rather than sending them on an errand that will also fail.

**What did NOT change:** a hold that cannot be closed still never fails the archive that already
happened. That half of the original reasoning was correct and is preserved.

## FILES CHANGED

```
MOD  src/renderer/src/enterprise/modules/EnterpriseModuleScreen.tsx
NEW  ui-tests/silentWriteD7bEnterpriseModule.test.tsx      8 pins
```

`describeMutationFailure` reads the boundary's own `errors` map (`_` is the documented record-level
key) — **no English prose is parsed**, so it cannot drift into the regex classification D-6 exists to
prevent. Rejections are rendered verbatim. A dedicated `actionError` state was added rather than
reusing `actionMsg`, which `runAction` clears on every custom action.

## TESTS AND CHECKS

| Check | Result |
|---|---|
| New D-7b pins | **8/8** (first run) |
| Full UI suite | **381 passed / 64 files** (from 373/63 — delta exactly the new file) |
| Full main suite | **9579 passed / 7 skipped — unchanged** |
| `tsc` node / web | **exit 0 / exit 0** |
| `eslint src ui-tests` | 1 error, **pre-existing**, frozen `cst/sendTransition.negative.test.ts:16` |
| `electron-vite build` | **exit 0**, 2.87s |

**Negative controls — all four fired; file restored byte-identically (sha256):**

| Control | Mutation | Result |
|---|---|---|
| NC-D7b-A | discard the hold outcome again | **3 fail** |
| NC-D7b-B | stop checking the archive result | **1 fail** |
| NC-D7b-C | let a refused delete fall through | **1 fail** |
| NC-D7b-D | call `onChanged()` on the hold-failure path | **3 fail** |

**NC-D7b-D is the one that matters most:** it reproduces the unmount empirically. With `onChanged()`
restored on that path the message is destroyed in the same render pass — so the claim that a
state-only fix would have been invisible is **measured, not argued**.

**Success controls** assert the hold and delete channels were actually reached (`resolveCalls === 1`,
`deleteCalls === 1`). The D-7 work was bitten by a route bound to a non-existent constant that made a
refusal test pass on an UNROUTED throw; here the friendly method is `remove` while the constant is
`EnterpriseModuleDelete`, so the same trap was live and the controls exclude it.

## REMAINING D-7b SITES — still OPEN

| Site | Write |
|---|---|
| ~~`state/ConnectionProvider.tsx:117 / :120 / :129`~~ | **CLOSED 2026-08-31** — see the D-7b Site 2 section below |
| `enterprise/EnterpriseView.tsx:135 / :142` | `personalization.favorite` / `saveView` |
| `business/BusinessFamilySection.tsx:162` | `personalization.favorite` |
| `views/WelcomeView.tsx` (nested) | the pilot step's inner `completeStep(...).catch(() => undefined)` |

**A finding recorded, not fixed** (outside this site's scope): because `hold:resolve` refuses by
resolving, `secureBridge` audits a refused hold-close as `ok: true`. The renderer now reports it, but
the **audit record still says success** — an evidence-layer defect needing its own gate.


---

# D-7b · SITE 2 — `ConnectionProvider` resume / pause / sync-now — **CLOSED**

**Date:** 2026-08-31 · **Base HEAD:** `a5e41c8` · Scope: this site only. Site 1 was not touched.

## ROOT CAUSE

`ConnectionProvider` exposes three user-initiated actions (`ConnectionIndicator.tsx:75/77/79`
drives them from the connection menu). All three called a cloud IPC write and swallowed **every**
failure with `.catch(() => undefined)`:

```
resumeSync  :117  ipc.cloud.liveSyncSetOnline(true).then(applySync).catch(() => undefined)
pauseSync   :120  ipc.cloud.liveSyncSetOnline(false).then(s => { applySync(s); info('Sync paused', …) }).catch(() => undefined)
syncNow     :129  ipc.cloud.liveSyncNow().then(applySync).catch(() => undefined)
```

**These channels REJECT on refusal.** `LiveSyncSetOnline` and `LiveSyncNow` are both `cloud:manage`
(`cloud/controlPlane/cloudAuthz.ts:77-78`), enforced at the secure-bridge boundary
(`secureBridge.ts:152-157`), which **throws** on denial → the `invoke` promise rejects
(`lib/ipc.ts:259-295`). A dead/timed-out channel rejects too. So a signed-in user without
`cloud:manage` — the menu items render regardless (`ConnectionIndicator.tsx:74-79`) — clicked
Resume / Pause / Sync-now and got **nothing**: no state change, no message.

**The filed defect (the misplaced pause toast) was real and is the sharpest case.** `pauseSync`'s
`info('Sync paused', …)` sat **inside `.then`**, so on rejection it never fired *and* the `.catch`
said nothing — a failed pause was completely silent, in both channels.

**A second, quieter false claim was found while tracing.** With no active org, `liveSyncSetOnline`
resolves `EMPTY_SYNC_STATUS` — which has **`online: true`** (`livesync/engine.ts:178-186`,
`liveSyncService.ts:182`). The old `.then` fired `info('Sync paused')` **unconditionally**, so a
no-op resolve announced a pause that never happened — the D-7b class (*stop claiming a success you
did not have*) one layer down from the reported bug.

## THE EXACT WRITE PATH

```
connection menu → Resume/Pause/Sync-now   ConnectionIndicator.tsx:75/77/79
  resumeSync/pauseSync → ipc.cloud.liveSyncSetOnline(bool)
     → IpcChannel.LiveSyncSetOnline 'livesync:setOnline'   (cloud:manage; secureBridge THROWS on denial)
     → liveSync.setOnline → scheduler.setOnline (returns SyncStatus; EMPTY_SYNC_STATUS.online===true when no org)
  syncNow    → ipc.cloud.liveSyncNow()
     → IpcChannel.LiveSyncNow 'livesync:now'               (cloud:manage; secureBridge THROWS on denial)
     → liveSync.syncNow → scheduler.syncNow (Promise<SyncStatus>; engine RESOLVES state:'error' on transport failure)
```

**Why the boundary message is rendered VERBATIM.** `invoke` has already decoded the D-6 denial code
and restored the clean, user-safe message before it reaches the renderer (`lib/ipc.ts:284-292`;
`secureBridge.ts:219` never emits internal detail), so re-wording it here would mean classifying a
refusal by regex on English prose — the defect D-6 exists to stop. There is no second redaction layer
in the renderer, and none is needed: these two channels emit only curated strings, and their engine
handlers never throw crafted messages.

## THE FIX

Each action now `await`s the write inside a `try` **scoped to the write alone**, so a success-path
side-effect (a `setState`, a toast) can never raise a false failure toast. On rejection it calls a
shared `reportSyncFailure(title, dedupeKey, err)` that raises an `error` toast — which the
ToastProvider renders `role="alert"` / `aria-live="assertive"` and persists (`ToastProvider.tsx:154-155`).
No Retry is offered (a denied toggle would only be denied again). Three deliberate choices:

- **Per-action dedupe keys** (`sync-pause` / `sync-resume` / `sync-now`), distinct from the existing
  `connection` key. `enqueueToast` replaces in place on a matching key
  (`packages/shared/.../uxInfra.ts:52-59`), so a single shared key would erase a pause failure the
  instant a resume failure landed. Distinct keys let both coexist and neither clobbers the offline
  banner.
- **The pause "success" toast is gated on `status.online === false`** — the no-active-org no-op no
  longer claims "Sync paused".
- **Bare-string rejection fallback** — a non-`Error` rejection yields "The request failed.", never an
  empty alert.

**Recorded, NOT fixed (out of this site's scope):** `syncNow`'s engine RESOLVES a transport failure
as `SyncStatus{state:'error'}` rather than rejecting (`livesync/engine.ts:279-302`), so a `.catch`
structurally cannot see it; that path is surfaced by the pre-existing degraded-connection warning
(`ConnectionProvider.tsx:110`, keyed `connection`), not by this catch. No claim is made that it is
covered here. `CloudProvider.tsx`'s separate `syncNow`/`setSyncOnline` (a different provider, reached
via `useCloud()`) lets rejections escape as unhandled promises via `void` — a **different site**, out
of scope.

## FILES CHANGED

```
MOD  src/renderer/src/state/ConnectionProvider.tsx        resume/pause/syncNow: scoped catch → announced error toast; pause toast gated on online===false; per-action dedupe keys
NEW  ui-tests/silentWriteD7bConnection.test.tsx           8 pins
```

No main-process file touched; renderer-only change.

## TESTS AND CHECKS

| Check | Result |
|---|---|
| New D-7b Site 2 pins | **8/8** |
| Full UI suite | **389 passed / 65 files** (from 381/64 — delta exactly the new file) |
| Full main suite | **9579 passed / 7 skipped — unchanged** (renderer-only change) |
| `tsc` node / web | **exit 0 / exit 0** |
| `eslint` on changed files | **clean** |
| `electron-vite build` | **exit 0** |

**Negative controls — all three fired; file restored byte-identically (sha256 `9c684cbb…`):**

| Control | Mutation | Result |
|---|---|---|
| NC-1 | `reportSyncFailure` neutered to swallow again | **5 fail** (all four failure-announce tests + the coexist test) |
| NC-2 | pause toast gate removed (`if (true)`) | **1 fail** (the no-active-org no-op test) |
| NC-3 | all three collapsed to one shared dedupe key | **1 fail** (the pause+resume coexist test) |

## USER-VISIBLE BEHAVIOUR (rendered, not state-level)

Verified through the REAL `ToastProvider` + REAL `ConnectionProvider` rendered in jsdom (the repo's
established rendered-UX harness; a real Electron run is not possible in the Linux CI sandbox):
a refused Resume / Pause / Sync-now now shows a persistent, screen-reader-announced error banner
(`role="alert"`, `aria-live="assertive"`) carrying the boundary's own message; a failed pause shows
that error and **no** "Sync paused"; a no-op pause (no active org) shows **neither**; a real pause
still shows "Sync paused" (`role="status"`, polite) exactly as before.

## REMAINING D-7b SITES — still OPEN

| Site | Write |
|---|---|
| ~~`enterprise/EnterpriseView.tsx:135 / :142`~~ | **CLOSED 2026-08-31** — D-7b Site 3, see the section below |
| `business/BusinessFamilySection.tsx:162` | `personalization.favorite` |
| `views/WelcomeView.tsx` (nested) | the pilot step's inner `completeStep(...).catch(() => undefined)` |
| `enterprise/PersonalizationPanel.tsx:58` | `personalization.favorite` (Remove) — newly found; fails silently via unhandled rejection in its `run` helper, a different mechanism |


---

# D-7b · SITE 3 — `EnterpriseView` favorite / save-view — **CLOSED**

**Date:** 2026-08-31 · **Base HEAD:** `a0e1fae` · Scope: `enterprise/EnterpriseView.tsx` only. Sites 1 and 2 untouched.

## ROOT CAUSE

The Enterprise header carries two user-initiated writes (`EnterpriseView.tsx`):

```
toggleFavoriteCurrent :134  ipc.enterprise.personalization.favorite({...}).then(setPersonalization).catch(() => undefined)   ← star button :193
saveCurrentView       :140  ipc.enterprise.personalization.saveView({...}).then(setPersonalization).catch(() => undefined)   ← pin button :202
```

Both channels are `dashboard:read` + `requireAuth` (`enterprise/authzGate.ts:453/456`, stamped requireAuth at `:524-526`), enforced at the secure-bridge boundary (`secureBridge.ts:144-168`), which **throws** on a not-signed-in / non-member / RBAC-denied / untrusted-sender request → the `invoke` promise rejects. The pure shared mutators never throw and never return a failure shape, so **every renderer-visible failure of these two writes is a rejection** — and `.catch(() => undefined)` swallowed all of them. A denied user clicked the star / pin and got no state change and no message: indistinguishable from a dead control.

## THE FIX

Each `.catch` now calls a shared `reportPersonalizationFailure(title, dedupeKey, err)` that raises an `error` toast — rendered `role="alert"` / `aria-live="assertive"` and persistent (`ToastProvider.tsx:154-155`) — carrying the boundary message **verbatim** (the D-6 `invoke` wrapper already restored the clean text; `EnterpriseUnavailable` in the same file renders `message` the same way). Per-action dedupe keys (`enterprise-favorite` / `enterprise-saveview`) so the two failures coexist rather than overwrite. The success arm `.then(setPersonalization)` — which fills the star (`isFavorite`) and refreshes saved views — is unchanged; the toast is purely additive on the failure arm, so it can never fire on a success and there is no optimistic state to roll back.

A toast was chosen over an inline banner because the writes fire from a compact icon-button header with no natural inline slot; the screen's only inline error channel (`EnterpriseUnavailable`) means "the surface failed to LOAD" and renders only in `error && !ready`, so reusing it for a write failure while the surface is loaded would render nowhere — the "fake fix" the D-7 Welcome case documents. This matches the D-7b Site 2 (`ConnectionProvider`) precedent for header/menu writes.

## RECORDED, NOT FIXED (out of this site's scope)

- **`recent` visit tracking** (`EnterpriseView.tsx:104/:123`) is a SECONDARY effect of a navigation that has already succeeded (`setTab`), so it stays deliberately silent — the same disposition the D-7 evidence gave the WelcomeView nested pilot write.
- **`personalization.get`** (`:86`) is a background READ on mount, not a user write.
- **Disk-persist failure is swallowed MAIN-side.** `personalizationStore.apply` returns the updated in-memory state and fires persistence fire-and-forget; `persist()` catches its own error with `log.error('Personalization persist failed')` (`personalizationStore.ts:108-109`) and never rejects. So a disk-write failure cannot reach the renderer — a main-side concern, out of scope for a renderer-only fix.
- **Newly-found sibling: `enterprise/PersonalizationPanel.tsx:58`** (the Remove-favorite button) also fails silently, but by a DIFFERENT mechanism — an unhandled rejection through its `run` helper, not `.catch(() => undefined)` — and in a different file. Recorded for its own site; not touched here.

## FILES CHANGED

```
MOD  src/renderer/src/enterprise/EnterpriseView.tsx        favorite/saveView: swallow → announced error toast (verbatim, per-action dedupe); success arm unchanged
NEW  ui-tests/silentWriteD7bEnterpriseView.test.tsx        5 pins
```

Renderer-only; no main-process file touched.

## TESTS AND CHECKS

| Check | Result |
|---|---|
| New D-7b Site 3 pins | **5/5** |
| Full UI suite | **394 passed / 66 files** (from 389/65 — delta exactly the new file) |
| Full main suite | **9579 passed / 7 skipped — unchanged** (renderer-only change) |
| `tsc` node / web | **exit 0 / exit 0** |
| `eslint` on changed files | **clean** |
| `electron-vite build` | **exit 0** |

**Negative controls — both fired; file restored byte-identically (sha256 `8107cb45…`):**

| Control | Mutation | Result |
|---|---|---|
| NC-1 | `reportPersonalizationFailure` neutered to swallow again | **4 fail** (both failure-announce tests + bare-string + coexist) |
| NC-2 | both actions collapsed to one shared dedupe key | **1 fail** (the favorite+saveView coexist test) |

## USER-VISIBLE BEHAVIOUR (rendered, not state-level)

Verified through the REAL `ToastProvider` + REAL `EnterpriseRoot` rendered in jsdom (providers mocked into an error state so the body is the light `EnterpriseUnavailable` while the header buttons render; the repo's established rendered-UX harness — a real Electron run is not possible in the Linux CI sandbox). A refused favorite or save-view now shows a persistent, screen-reader-announced error banner (`role="alert"`, `aria-live="assertive"`) carrying the boundary's own message; a successful favorite still fills the star (button relabels "Add to favorites" → "Remove from favorites") with no error.

## REMAINING D-7b SITES — still OPEN

| Site | Write |
|---|---|
| `business/BusinessFamilySection.tsx:162` | `personalization.favorite` |
| `views/WelcomeView.tsx` (nested) | the pilot step's inner `completeStep(...).catch(() => undefined)` |
| `enterprise/PersonalizationPanel.tsx:58` | `personalization.favorite` (Remove) — silent via unhandled rejection in its `run` helper |
