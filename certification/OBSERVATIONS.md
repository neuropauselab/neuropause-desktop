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
