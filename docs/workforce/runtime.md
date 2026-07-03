# Worker Runtime

> Running one skill into a governed job, scheduling background work, and the human approval loop.

## A job is one skill run

`runtime.runJob(spec)` runs one worker skill end to end and returns a `Job`:

1. resolve the worker (registry) and its skill (skill lookup); an unknown worker
   or skill yields a clean `failed` job, not a crash;
2. snapshot the intelligence layer via the injected `dataProvider`, then
   `scopeData` it to the worker's permissions;
3. execute the skill (see below);
4. persist the job to the **Job Store** and, if terminal, feed the outcome back
   to the registry (`recordOutcome`).

The runtime is electron-free: registry, governance, job store, the data
provider, and the skill lookup are all injected. The composition root wires the
real singletons; tests inject synthetic ones.

## The executor (pure core)

`executeJob` is pure and synchronous. It runs the skill in a `SkillContext`,
records the read-only summary + evidence, and turns each proposed action into a
governed `JobProposal`:

```
for each proposal: build ActionRequest → governance.evaluate → JobProposal { verdict, approval: null }
```

The job's terminal status follows from the verdicts:

- any proposal `require_approval` (still undecided) → `awaiting_approval`;
- otherwise → `succeeded`;
- the skill threw → `failed` (the read result is simply absent).

A **denied** proposal does not fail the job — the read result is still valid; the
denied action just won't proceed. Real wall-clock `durationMs` is measured even
though logical timestamps are injected for determinism.

## Background execution (cooperative scheduler)

The `Scheduler` provides non-blocking execution:

```ts
const jobId = scheduler.enqueue(spec); // returns immediately; job is 'queued'
// ...on the next tick (or scheduler.drain()):
//   the job runs queued → running → terminal
```

This is an honest cooperative in-process scheduler — it drains its queue on a
timer (`drain()` runs it synchronously for deterministic tests), not a pool of OS
processes. The interactive IPC path uses synchronous `runJob` so the caller gets
the completed (or parked) job immediately; the scheduler is there for fire-and-
forget background runs.

## The approval loop

A job parked as `awaiting_approval` is resolved by a human:

```ts
runtime.approveProposal(jobId, proposalId, by, note, now)
runtime.rejectProposal(jobId, proposalId, by, note, now)
```

When the last pending proposal is decided, the job transitions to `succeeded`
and the outcome is recorded **once**. Rejecting a proposal still completes the
job — the worker did its job correctly; the human simply declined the action. A
proposal that wasn't `require_approval` has nothing to decide, and a
re-decision is idempotent.
