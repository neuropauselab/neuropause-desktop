# SEAM-B.11 / GATE-R.5 — PRODUCTION ACCEPTANCE + CONTROLLED RELEASE BOUNDARY

## 1. Scope
Determine whether the B.10-verified governed journal-post runtime path can be accepted at the
PRODUCTION boundary — i.e., whether the ACTUAL production artifact and deployment path execute the same
governed composition — without bypass, stale artifact, unsafe external effect, uncontrolled state, or
evidence loss. RUNTIME_VERIFIED ≠ PRODUCTION_ACCEPTED throughout. **This was a MEASUREMENT-ONLY gate:
zero source changes, zero builds, zero launches, zero packaging, zero external effects.**

## 2. Custody
HEAD_AT_START `6515f3e` (= the B.10 commit; expected inheritance) · branch
`cert/data-import-cst-integration` · 1 worktree · staged 0 · no submodules · tree carries only the
custody-protected pre-existing ` M certification/baseline.json` (byte-untouched, uncommitted, not
repaired, not re-frozen) · kernel tarball sha `293d056…` intact · FILES_CHANGED/COMMITS/PUSHES/FETCHES/
EXTERNAL_EFFECT at start = 0. `verify-freeze.sh`: ANCESTRY OK · SOURCE FAIL — the standing classified
baseline-lag class (accepted non-frozen deliverables), not FROZEN MODIFIED.

## 3. B.10 Baseline
Both B.10 artifacts present at HEAD (`e2e/journalRuntime.e2e.cjs`,
`src/main/reconciliation/journalRuntimeReadBack.test.ts`). §79 opening hash check: **all 7 B.8/B.9
governed files byte-identical to the B.10 manifest** (`shasum -c`: 7× OK). Behavioral re-measurement at
HEAD: the six governed-path suites (B.8 pins 18 · composition pins 9 · generalLedger 12 · readBack 14 ·
readBackReconciler 20 · actionRecord 13) = **86/86 green**. The B.10 claims-to-preserve set (§5) and
honest NOT_EXECUTED set (§6) are carried forward unweakened.

## 4. Build System
`npm run package[:mac|:win|:mac:universal]` = `generate-notices.cjs` → `generate-build-info.cjs` →
`electron-vite build` → `electron-builder <platform> --publish never` → `verify:release`
(`verify-release-artifacts.cjs`: installer + update payload + feed present, feed sha512/size verified
against disk bytes, exit 1 on any FAIL). `electron-builder.yml`: `files: [out/**/*, package.json]`,
asar, `directories.output: dist`, updater `publish: generic https://neuropause033.com/updates channel:
beta`. **Every sanctioned packaging chain REBUILDS `out/` unconditionally in the same `&&` chain** — no
packaged-from-alternate-dir path exists without config edits (search space: all package.json scripts +
both release workflows). CI: `macos-release.yml` / `windows-release.yml` (tag `v*` or dispatch; publish
to site gated OFF by repo var; artifacts-first discipline).

## 5. Production Artifact
**Identified: the electron-builder `dist/` set** — mac `NeuroPause-arm64.dmg` + `-mac.zip` + `beta-mac.yml`
+ blockmaps; win NSIS `NeuroPause-Setup.exe` + zip + portable + `beta.yml`. **Newest packaged artifact:
`1.0.0-rc.20`, built 2026-08-15T06:28:50Z from commit `efe8196` (build-info.json verbatim: dirty:
false)** — nine days and the entire SEAM/GATE-BUILD arc older than HEAD. **No packaged artifact contains
the B.8/B.9/B.10 governed journal path.** A founder-test Windows set also exists under repo-root
`release/windows/` (13 Aug). The armed `out/` (20 Aug, ceremony build at `472092c`) remains the newest
electron-vite output and provably lacks the governed path (B.9/B.10 measurements; untouched this gate).

## 6. Build Parity
**PRODUCTION BUILD PARITY: NOT ESTABLISHED at HEAD.** The B.10 alternate build (fingerprint recorded in
the B.10 evidence; artifact deleted after capture per its §43) proved the CURRENT source builds and runs
governed — but it was electron-vite output only, never packaged. The packaged rc.20 predates the
governed path entirely. §12 determination: **STATE B — stale but regenerable under an explicit
envelope** (not STATE A: nothing packaged at HEAD; not STATE C: the mechanism is proven in this tree —
rc.1→rc.20 artifact sets, feeds, blockmaps, builder-effective-config, notarization-status all exist from
real runs, and verify-release is the wired final step). C-flavored caveat recorded: the mechanism was
last exercised at `efe8196`, and `package.json` still reads `1.0.0-rc.20` — a HEAD build needs a version
decision or it re-uses a spent version string over different bits.

## 7. Composition Parity
Re-measured at HEAD, UNCHANGED from B.9/B.10 and single-sited: `enterprise/index.ts:132/:1264` registers
the object-identical governed singleton (`journalEntryModuleInstance.ts:24-33` verbatim — durable
idempotency over `journal-post-transitions.json` + `onOutcome: recordJournalPostEvidence`);
`documentSpecs.ts` still deliberately excludes the journal; exactly one `initEnterpriseModules` call and
one `new EnterpriseModuleRegistry` in non-test code. Decisive: the git diff-stat over
`949f127..6515f3e` shows the only landed changes since the B.9 census are B.9's transitionId fix and
B.10's harness/test — **no writer, door, composition, or importer file changed.**

## 8. Door Census
Identical to B.9: five production doors (renderer IPC `moduleRegistry.ts:607-624` · companion
`companion/index.ts:205` · REST `api/routeRegistry.ts:153` (scope `records:write`) · sandbox
`realPlatform.ts:97` · GL cascade `glPosting.ts:177`) all resolving the same handler/registry. Writer
sweep re-run (spaces stated): **exactly one site produces `postedAt` on a journal row —
`journalEntryModule.ts:398-400`, inside the kernel-wrapped, CAS-guarded effect.** Sibling-store
`posted` stamps (payroll run, stock movement, stock adjustment, SAP sync view) classified non-journal.
`postJournal`/`postEntry` funnel to the GL cascade. **No ungoverned production journal-post write door.**

## 9. Governance Path
Unchanged and re-pinned behaviorally (86/86). The §87 invariant holds for this path: no execution
without governance (the write lives inside the kernel effect); no success without verified effect
(VERIFIED_SUCCESS requires the authoritative re-read); no verification from a success string (D-16
classifier only); no authority from identity alone (grant + approval both required).

## 10. Authority
No actor → **DENY `AUTHORIZATION_FAILURE`** (policy stage — the B.9-measured classification, preserved;
kernel.ts:156-160 + the adapter's empty-grant projection). Unauthorized/inactive at the door →
`createAuthorize` throws before `runAction` (no dev/env relaxation — measured, 0 flag conditionals).
Authorized + grant → kernel evaluation → ALLOW. No founder bypass exists or was added.

## 11. Policy
Behavioral: policy-allow → post proceeds (Tests A); policy-refuse → DENY with zero writes (JOURNAL-B8-02
/ B9-02, re-run green). Limitation recorded honestly: at the PRODUCTION door a policy-refusal case is
not manufacturable without injection (the door always presents a granted session actor) — the refusal
path is module/composition-proven, plus B.10's structural finding that the door cannot produce an empty
actor. `policyVersion` remains a label, never authority (kernel single read site, evidence-string only).

## 12. Request
The governed request is minted per attempt (per-attempt `transitionId` `journal-post:<entry>:<rev>:<ms>-<seq>`
— the B.9 fix re-verified present at HEAD; idem key `sha256(tenant|entry|rev)` unchanged), with declared
`expectedPostState` before execution.

## 13. Decision
ALLOW/HOLD/DENY distinct, each with the kernel ReasonCode interpolated into the user-facing refusal
message (`(${sem}: ${reason})`) and the evidence row's verdict/outcome fields — no ERROR collapse
(§54 map, full table in the fleet record; highlights: DENY `AUTHORIZATION_FAILURE` · HOLD
`APPROVAL_REQUIRED`/`APPROVAL_EXPIRED`/`RECONCILIATION_REQUIRED`/`OUTCOME_UNKNOWN` · STALE_RESOURCE ·
door-level 'already posted').

## 14. Execution
One physical write per logical post, CAS-guarded, rev+1 exactly — re-pinned (module, composition) and
runtime-proven in B.10. Executor-throw → kernel HOLD `OUTCOME_UNKNOWN` with the idempotency record left
IN_FLIGHT (next attempt HOLDs `RECONCILIATION_REQUIRED`) — fail-closed, never a duplicate effect.

## 15. Evidence
One durable row per kernel attempt; settled terminals only for VERIFIED_SUCCESS/FAILURE; refusals carry
NO terminal (pinned); `effectTime` = the row's own `postedAt` verbatim. §34 sufficiency per the B.9 §25
ledger, re-verified at HEAD: actor/action/decision/execution/verification PERSISTED; purpose/
policyVersion/approval-object/raw-params/observed-state NOT_PERSISTED (stated, never invented).

## 16. Read-back
Authoritative from persisted bytes (fresh reader, separate process — B.10 Test G; suites re-run green).
A success-looking string cannot establish verification (`finalStatusOf` consults the verification object
through the D-16 classifier first). Vocabulary bounds re-recorded: journal HOLD rows read `UNKNOWN`,
STALE_RESOURCE rows read at the generic `EXECUTED` rung (the distinct string survives in the row's
`outcome` field, not FINAL_STATUS) — send-shaped surface, honest, unchanged.

## 17. Concurrency
**CONCURRENCY_SCOPE = SINGLE_PROCESS_EVENT_LOOP + SINGLE-INSTANCE LOCK — PROVEN, with stated trust
bounds.** `requestSingleInstanceLock` is unconditional (`index.ts:225-236`); companion gateway and the
REST surface run IN the main process (the only socket listeners in src/main are the companion gateway
and the OAuth loopback — measured); sandbox relaunches are profile-isolated by argument construction
(`--user-data-dir=<userData>/sandbox/...`); no utilityProcess/worker_threads in non-test code. Stated
§2 #31-class bounds (not mitigations): a forked plugin child and an operator-configured processAdapter
command are plain OS processes outside the store's import graph — no shipped entrypoint touches the
journal store, but no OS sandbox prevents arbitrary child code from writing files. Stale-lock-after-crash
semantics are DOCS-grade (Chromium liveness-checked lock; the B.10 incident measured the live-holder and
post-kill cases). NOT claimed: multi-process atomicity, distributed concurrency.

## 18. Idempotency
Durable ledger re-verified: corrupt file → `DurableStoreError` at construction (never silently reset);
acquire-persist failure → rollback + rethrow (no admission); release only for IN_FLIGHT; atomic
temp+rename (no fsync — no power-loss claim). **NEW FINDING (recorded, deliberately not fixed — §65):**
the ledger is constructed at MODULE SCOPE in `journalEntryModuleInstance.ts`, on the static import chain
of the main bundle — **a corrupt `journal-post-transitions.json` at boot is APP-FATAL** (uncaught
module-load exception; the app does not start). Fail-closed in the strongest sense — no duplicate effect
is possible, and nothing else runs either — but the blast radius is the whole app and the failure is not
surfaced as an UNAVAILABLE state. The same shape pre-exists for the M365 ledger
(`connectors/index.ts:420`, frozen). A boot-resilience seam for a future gate; not a governance defect.
**Second precision finding (comment drift, §2 #20 class, recorded not edited):** the module's
VERIFIED_SUCCESS branch comment claims it covers the duplicate-suppressed kernel replay, but every
duplicate-suppressed outcome carries `executed:false` and classifies UNKNOWN — the branch is unreachable
for replays (and the door's 'already posted' fires first anyway). Behavior is conservative (UNKNOWN,
never false success); the COMMENT is inaccurate at HEAD.

## 19. Restart
B.10 Tests H/I stand (posted state + `postedAt` byte-identical across restart; replay refused; DONE
intents durable). Not re-executed this gate (no launches); the artifacts and evidence are 90 minutes
old at the same HEAD.

## 20. Packaging
Mechanism proven at `efe8196` (rc.20, mac + win, with feed/sha512 verification wired); **unexercised at
HEAD** (STATE B). Producing the artifact at HEAD requires the envelope in §29's Next Action: it would
overwrite the armed ceremony `out/` (or the operator rules it expendable / schedules the re-arm), stamp
`-dirty` unless the tree is cleaned or ruled, and needs a version/CHANGELOG decision (rc.20 is spent).
Signing posture: the rc.20 mac artifact is UNSIGNED/UN-NOTARIZED (`notarization-status.json` verbatim:
skipped, credentials absent); signing is CI-secret-injected, no identity in the repo. Nothing was
packaged, published, uploaded, or distributed this gate.

## 21. Installation
NOT PROVEN — no install test was authorized or run (§42 conditional not triggered). Old installers exist
for `efe8196`-era code only.

## 22. Runtime
The production-equivalent runtime remains proven exactly as B.10 scoped it: alternate build, isolated
profile, real composition/door/kernel/evidence/read-back. The PACKAGED-artifact runtime (asar,
installed layout, updater active) has never executed the governed path.

## 23. External Effect
**EXTERNAL_EFFECT = 0** this gate (read-only). §28 firewall re-measured: the full dependency closure of
the four journal files (one transitive level + the CST dist, 8 files) contains **zero** network
primitives and zero imports of connectors/m365, delivery, webhooks, or notification paths — journal.post
cannot reach an external effect except through an explicitly governed path (none exists on this path).

## 24. Public Claims
All quarantined PUBLIC CLAIM, NOT IMPLEMENTATION PROOF (fleet record): the "AI Action Firewall"
allow/review/block + human-approval story is established at **The Hitavada** (22 Mar 2026, Patel named
"Founder and CEO of NeuroPause Lab Limited"; "applied for a global patent … currently in the process");
**no Economic Times article was found** (the directive's ET attribution is NOT_ESTABLISHED on the web;
the claims themselves are established via Hitavada; absence is an index-negative). "NeuroShell"/
"Execution Intelligence System" positioning: **no public source found** (all NeuroShell hits are
unrelated third parties); `neuropause033.com` DNS-unreachable from this environment. Legal name:
public sources CONFLICT ("Limited" — Hitavada/LinkedIn slug; "Pvt Ltd" — Devdiscourse; plus an ANI
advertorial naming a third entity and using "patented") — preserved, not normalized; the custodied
certificate reads NEUROPAUSE LAB PRIVATE LIMITED. **PATENT_STATUS =
PUBLICLY_REPORTED_APPLICATION_IN_PROCESS** (no office record found; advertorial "patented" does not
raise the ceiling).

## 25. Maturity
| COMPONENT | MODULE | COMPOSITION | RUNTIME | PRODUCTION |
|---|---|---|---|---|
| authority | E4 | E3 | E3 | E0 |
| policy | E4 | E3 | E3 | E0 |
| governed-request | E4 | E3 | E3 | E0 |
| CST kernel (consumed) | E4 | E3 | E3 | E0 |
| journalPostTransition | E4 | E3 | E3 | E0 |
| journalEntryModule | E4 | E3 | E3 | E0 |
| idempotency (durable) | E4 | E3 | E3 | E0 |
| evidence (ActionRecord) | E4 | E3 | E3 | E0 |
| read-back | E4 | E3 | E3 | E0 |
| reconciler invisibility | E4 | E3 | E3 | E0 |
| renderer door | — | E3 | E3 | E0 |
| production artifact | — | — | — | **E1** (identified/specified at HEAD; mechanism exercised at `efe8196` only) |
| production installation | — | — | — | E0 |
| finance.journal.post | E4 | E3 | E3 | **E0** |

## 26. First-Broken-Edge
**FIRST_BROKEN_EDGE = BUILD / PRODUCTION ARTIFACT** (§74, "production artifact is stale"). Everything
upstream (identity → authority → policy → request → decision → transport → execution → read-back →
verification) is proven at module/composition/alternate-runtime level; everything downstream
(packaged-artifact runtime, installation, acceptance) is unreachable until the artifact exists at HEAD.

## 27. Known Limits
Event-loop CAS scope (unchanged) · the honest NOT_EXECUTED set carried (§6) · plugin/processAdapter
trust bounds stated (§17 above) · app-fatal corrupt-ledger boot finding (§18 above) · comment-drift
finding (§18 above) · importer posted-row CONTENT mutation re-measured and re-classified: (a) outside
the post transition (structurally cannot produce postedAt/status), (b) a production consequential write
on posted-row content bypassing the module validate hook, (c) a separate governance seam
(reviewer-approved, provenance-stamped), (d) **not a blocker for POST-transition acceptance** — the
operator should weigh it in the acceptance decision as a posted-row immutability erosion, but the POST
invariant is unaffected · lint state carried by hash-proof (zero source drift since B.10's clean run;
the pre-existing frozen-path lint exception stands untouched).

## 28. Verdict

## Decision Matrix (§72)
SOURCE CURRENT? **YES** · BUILD CURRENT? **NO** (armed out/ = ceremony build at `472092c`) · PRODUCTION
ARTIFACT IDENTIFIED? **YES** (dist/ electron-builder set; newest = rc.20 @ `efe8196`) · BUILD PARITY?
**NO at HEAD** · COMPOSITION PARITY? **YES** (source-level; executed in B.10's alternate runtime) · DOOR
CENSUS CLOSED? **YES** · GOVERNANCE PATH CLOSED? **YES** · EVIDENCE CLOSED? **YES** · READ-BACK CLOSED?
**YES** · MULTI-PROCESS SAFETY? **SCOPED** (single-process event loop + lock, proven; nothing wider
claimed) · EXTERNAL EFFECT? **NO** · PACKAGING PROVEN? **at `efe8196` yes; at HEAD NO** · INSTALLATION
PROVEN? **NO** · PRODUCTION RUNTIME PROVEN? **NO** · PRODUCTION ACCEPTANCE? **NO**.

**FINAL VERDICT: `PRODUCTION_BUILD_ENVELOPE_REQUIRED` (§84-G).** A production build must be created but
is not authorized: the sanctioned packaging chain unconditionally rebuilds `out/` — destroying the armed
NP-008 ceremony build — and carries version/CHANGELOG/clean-tree/signing decisions that are the
operator's. Per §83: *runtime governance was verified in an isolated Electron build/profile; production
acceptance remains unproven.* No production claim is made from test evidence; no deployment, publish, or
distribution occurred.

## 29. Next Single Action
**The operator's PRODUCTION-BUILD ENVELOPE**, which must rule on exactly five things (measured list):
1. Overwriting the armed ceremony `out/` — accept the loss, schedule the re-arm (`NP_E2E_BUILD=1`
   rebuild as the LAST build afterwards), or rule the 20-Aug ceremony build expendable.
2. The command + order: `npm run package:mac` in `apps/desktop` (notices → build-info → electron-vite
   build → electron-builder `--publish never` → verify:release). `--publish never` is already wired —
   no upload occurs.
3. The side-writes: `THIRD-PARTY-NOTICES.md` (root + resources) and `resources/build-info.json`
   (currently holding the 15-Aug rc.20 record) get overwritten.
4. Tree/version provenance: the tree is dirty (protected `baseline.json`) ⇒ build-info stamps
   `-dirty` unless ruled or resolved; `1.0.0-rc.20` is spent ⇒ version bump + CHANGELOG section, or an
   explicit ruling.
5. Signing posture: locally unsigned/un-notarized (credentials absent) — acceptable for an acceptance
   test artifact, or not.
After that envelope executes, the next gate is the §42-§52 production-artifact acceptance matrix
(install to a fresh isolated profile, re-run the B.10 scenario through the PACKAGED binary).

## Final Operator Question (§90)
*"Is finance.journal.post now proven through the actual production artifact and production-equivalent
deployment path, or is the first broken edge still between runtime verification and production
acceptance?"*

**NO — the first broken edge sits at BUILD / PRODUCTION ARTIFACT, one step before production
acceptance:** no packaged artifact at or after the governed path exists (newest = rc.20 from `efe8196`,
15 Aug, pre-B.8), and producing one requires the five-point production-build envelope above — an
operator-controlled event this gate correctly did not perform.
