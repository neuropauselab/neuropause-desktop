# Worker Registry

> The store of every worker, with trust and health that evolve from outcomes.

## What it holds

The registry holds each `Worker` — identity, role, declared skills, permissions,
goals, memory scope, policy bindings, **trust score**, lifecycle, and **health**.
It is electron-free (the class takes a file path; the singleton lives in
`registryInstance.ts`) and persists with the standard serialized background
writer (atomic temp-file + rename).

## Registration is idempotent and upgrade-safe

```ts
registry.register(definition, now)
```

Registering a new id inserts it. Re-registering an existing id (e.g. a version
upgrade) refreshes identity, skills, and permissions but **preserves** the
worker's earned trust, health, and lifecycle, and keeps its original
`createdAt`. Built-in workers are re-registered on every startup, so this keeps
their accumulated standing across restarts.

## Trust evolves deterministically

Trust is a number in `0..1`, not an opaque score:

```
success → trust + 0.02      failure → trust − 0.05      (floored at 0.05, capped at 1)
```

A brand-new worker starts at `0.5`. This matters for governance: the default
write-trust policy only auto-allows memory/reminder writes at trust ≥ `0.6`, so a
new worker's write proposals require human approval until it has earned trust
through successful runs.

## Health reflects the recent success rate

After each outcome the registry recomputes health from the running counts:

```
jobsRun, jobsFailed, successRate
state = unhealthy   if jobsRun ≥ 3 and successRate < 0.5
      = degraded    if successRate < 0.8
      = healthy     otherwise
```

`recordOutcome(id, success, now)` is called by the runtime when a job reaches a
terminal state — exactly once per job — so trust and health always reflect real
work done.

## Surface

`get` / `has` / `list` (sorted by name) / `summaries` (compact `WorkerSummary`
for dashboards) / `setLifecycle` / `recordOutcome`. The registry emits `changed`
on every mutation, which the composition root turns into a renderer broadcast.
