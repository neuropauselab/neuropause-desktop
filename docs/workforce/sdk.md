# Worker SDK

> How a worker is defined, validated, and given a least-privilege view of the data.

## A worker is a record plus skill implementations

A **worker** is a `Worker` value (identity, role, declared skills, permission
scopes, goals, memory scope, trust, health) defined in shared types. The SDK
pairs that record with a set of **skill implementations** and validates the two
against each other at construction:

```ts
defineWorker(worker, skills): WorkerDefinition   // throws if invalid
```

`validateWorker` rejects, fast and loudly:

- a malformed id (`worker:slug`) or version (`x.y.z`) or unknown role;
- a worker that declares no skills;
- a declared skill with no implementation (or vice-versa);
- a skill that **requires a permission scope the worker is not granted**
  (over-privilege).

## Skills: read, then propose

A skill implementation is `{ id, run(ctx, input) }`. `run` is synchronous and
returns a `SkillResult`:

```ts
interface SkillResult {
  summary: string;            // the read-only result, always delivered
  evidence: ActionEvidence[]; // { kind, id } back-pointers into the data
  grounded: boolean;          // false when there was no connected data to act on
  proposals: ProposedAction[];// side-effecting actions to be governed
}
```

A `ProposedAction` carries its `permissions`, `risk`, `evidence`, and a `payload`
— but **no mechanism to execute itself**. The runtime turns it into an
`ActionRequest` and the Governance Runtime decides its fate.

## The permission model

Permission scopes are split into low-risk **reads** (`read:entities`,
`read:graph`, `read:timeline`, `read:memory`, `read:health`, `read:connectors`)
and side-effecting **writes/proposals** (`write:memory`, `write:reminder`,
`propose:draft`, `propose:message`). A skill declares the scopes it exercises;
the worker grants a set; validation ensures the former is a subset of the latter.

## Least privilege at runtime

Before a skill runs, `scopeData` projects the full intelligence-layer snapshot
down to only what the worker is granted:

```ts
scopeData(fullData, worker) // strips entities/timeline/memory/graph the worker can't read
```

A worker without `read:timeline` simply receives an empty `events` array; without
`read:graph`, its `neighbors()` lookup returns nothing. Skills cannot reach
around this — they only ever see the scoped `ctx.data`.

## The reasoning seam (no LLM by default)

`run` is a plain function today, computing its result deterministically from
`ctx.data`. This is where a model-backed reasoning step would attach in a later
stage: a skill could call out to a model to *interpret* the scoped data and
*draft* a proposal — but the proposal would still flow through governance and
human approval unchanged. The seam is the `run` boundary; nothing downstream of
it needs to change to add intelligence, and nothing today pretends the seam is
already filled.
