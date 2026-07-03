# Orchestrator

> Running a workflow — a DAG of steps — over the Worker Runtime.

## Workflows

A `WorkflowSpec` is a named DAG of `WorkflowStep`s. Each step is either a
`worker` step (run a skill) or an `approval` step (an explicit human checkpoint),
and declares `dependsOn` (step ids that must succeed first), with optional
`retry`, `timeoutMs`, and `approvalPrompt`.

```ts
orchestrator.start(spec, now): WorkflowRun
orchestrator.resume(run, spec, now): WorkflowRun
orchestrator.approveCheckpoint(run, spec, stepId, approved, now): WorkflowRun
```

## How a run advances

Worker steps execute synchronously through the runtime, so a run advances as far
as it can in one pass, then reports its status:

- **sequential & parallel** — a step runs as soon as its dependencies have
  succeeded, so independent branches advance together in the same pass;
- **retry** — a failing worker step is retried up to `retry + 1` attempts;
- **timeout** — a step whose measured run exceeds `timeoutMs` is failed;
- **dependency management** — when a step fails (or a checkpoint is rejected),
  its still-pending dependents are marked `skipped` and the run is `failed`;
- **approval checkpoints** — an `approval` step pauses the run
  (`awaiting_approval`); `approveCheckpoint` resolves it and continues.

## Two kinds of pause, reconciled

A run can pause for two reasons, and the orchestrator handles both:

1. an explicit `approval` **step** — resolved with `approveCheckpoint`;
2. a `worker` step whose **job** parked proposals for approval — resolved at the
   job level via the runtime (`approveProposal`), after which `resume` reconciles
   the step against its now-completed job and the run continues.

## Status

`recomputeStatus` makes the run status a pure function of its step states: any
`failed` → `failed` (pending dependents `skipped`); any `awaiting_approval` →
`awaiting_approval`; all `succeeded`/`skipped` → `succeeded`.

## This stage

Workflow run objects are kept **in memory** (the durable record is the Job
Store). The model doesn't change when persistence is added in a later stage.
