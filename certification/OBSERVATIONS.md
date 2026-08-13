# Program 13C — observations

Findings that are not gate verdicts. An observation is retired by a diagnosis,
never by a subsequent green run.

## O-1 · retentionScopeTenancy intermittent — DIAGNOSED, superseded by F-11b

Observed 2026-08-13 as `expected +0 to be 7` at retentionScopeTenancy.test.ts:374.
Reported here as "did not reproduce"; it reproduced on the very next full run
against BASELINE-28766c3e7bbe. Two green runs were treated as evidence of
absence. They were evidence of an idle machine.

CAUSE: TimelineService.flush() returned early whenever a write was in flight:

    if (this.writing || this.pending.length === 0) return;

So `await flush()` was not a barrier. export() awaits it and then reads the
file; dispose() awaits it and then clears the timer. Under load the read landed
before the write, and shutdown could drop the tail of the log.

It reproduced 0/20 times in isolation. The defect is real; the symptom needs
contention to appear.

FIXED in round22 (F-11b): writes serialized on a chain, flush() drains until
empty, regression test at apps/desktop/src/main/platform/timelineFlushBarrier.test.ts.

CONSEQUENCE FOR G11: the retention suite was green for the wrong reason on
every prior run — it passed when the append happened to land in time. G11 may
not be recorded against any run predating round22.

## O-2 · crashReporter.export() reads crashes.log without flushing — F-11c

Found by the census O-1 prompted. `crashReporter.export()` (services/crashReporter.ts:135)
calls fs.readFile on crashes.log directly. Writes go through createBoundedLog,
whose append() is documented fire-and-forget and which exposes flush() for
exactly this. export() never calls it, so a crash export can omit the crash it
was triggered by.

SAME CLASS AS F-11b, LOWER SEVERITY: crashes.log rotates install-wide and its
rows have no owner field, so this is support-bundle correctness, not tenancy.

NOT FIXED. One line — `await this.crashLog.flush();` — deliberately deferred to
round23 rather than added mid-freeze.

CENSUS RESULT, so the boundary is stated rather than assumed:
  TimelineService  — the only store with the `writing` boolean guard. Fixed.
  jobStore.flush() — `while (this.persisting) await this.lastPersist` — correct.
  boundedLog       — serialized chain, real flush() — correct, and the idiom
                     round22 gives the timeline.
  audit.log        — write-only in process; no read-back path exists.

## O-3 · system:backendReachability races IPC registration — intermittent

Cold start 13:09: renderer invoked 'system:backendReachability' at :17, main
registered secure IPC handlers at :20.216 — two unhandled "No handler
registered" errors. Startup was 11.8s that run.
Did NOT occur at 13:14 (startup 8.2s, probe fired after registration).
TIMING-DEPENDENT, NOT FIXED. Recorded as intermittent rather than resolved,
because "it did not happen the second time" was exactly the reasoning that
let O-1 survive for hours.

## O-4 · two banners state the same failure

The login screen renders the F-7 reachability notice AND the form's own
"Could not reach the NeuroPause backend. Is it running?" — the second asks the
user a question the first already answered. Cosmetic. Not fixed.

## O-5 · the recorder cannot accept a verdict once evidence is committed

record-gate.sh refusal 4 compares `git rev-parse HEAD` to the baseline's commit.
Committing certification/ moves HEAD without changing the source, so STORING
evidence and RECORDING evidence against the same baseline are mutually
exclusive. Found by hitting it, not by reading it.

Same class as the fixed-point problem SRC_DIRTY_SPEC already solved for the
dirty-tree check — fixed for one check, missed in the one beside it.

PROPOSED (round23): compare the SOURCE diff rather than the commit id —
  git diff --quiet "$BASE_COMMIT" HEAD -- . ':(exclude)certification'
— and move freeze-baseline.sh and record-gate.sh into certification/, so the
instrumentation sits inside the directory that is not the tree under test.

CONSEQUENCE: this baseline closes at 7/25. The next one RE-EARNS its verdicts
by re-running them, not by copying them across — roughly ten minutes of
scripted work plus one registration. That is the design working, not failing.

## O-6 · the default branch is 14 release candidates behind the certified tree

origin/main is at 1.0.0-rc.1, last moved 2026-08-05 by the repository's only
merged pull request. The certified tree — feat/understanding-holds-motion-system
at 1.0.0-rc.15 — is 225 commits ahead: 1177 files, 194,335 insertions.

`git diff HEAD...origin/main` is EMPTY. main contains nothing this branch lacks,
so merging forward is content-trivial.

WHY IT MATTERS: main is the DEFAULT branch. A fresh clone, a CI job, or a release
built without thinking gets rc.1 — containing none of F-6, F-7, F-8, F-9 or
F-11b. A build from the default branch today would ship the exact
backend-discovery defect this programme was started to fix.

CONSEQUENCE FOR GATES: G1 (artifact hashes) and G18 (release provenance) must not
be recorded until the default branch contains the certified tree. Provenance
against a branch the default branch does not contain is not provenance.

DECISION OWNER: Saurabh. Merge forward and make main the truth, or retire main
and name a release branch. Either is defensible. The present state is not.
