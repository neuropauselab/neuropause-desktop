# AI Workforce — Architecture

> Phase 6 (Stages 1–2). Governed, evidence-grounded AI workers over the intelligence layer — propose, gate, approve — with a full operator cockpit.

## What it is

The AI Workforce is the layer that turns NeuroPause from a system that *answers*
into a system that can *act* — safely. It is real production infrastructure:

- a **Worker SDK** for defining workers and their skills;
- a **Worker Registry** that holds every worker with evolving trust and health;
- a **Worker Runtime** that runs a skill into a governed `Job` and schedules
  background execution;
- a **Governance Runtime** that gates every proposed action;
- an **Orchestrator** that runs multi-step workflows (DAGs);
- nine **built-in workers**, one per role.

## The contract: workers propose, governance gates, humans approve

This is the single most important property of the workforce, and it holds for
every worker without exception:

```
skill runs (read-only) → proposes actions → governance verdict → human approves side effects
```

1. A **skill** reads a permission-scoped view of the intelligence layer and
   returns a read-only **summary + evidence** plus zero or more **proposed
   actions**. A skill never performs a side effect itself.
2. Each proposal is stamped into an `ActionRequest` and passed to the
   **Governance Runtime**, which returns `allow` / `deny` / `require_approval`
   (the most restrictive outcome across four checks — see `governance.md`).
3. Side-effecting proposals park the job as `awaiting_approval` until a human
   approves or rejects them. Nothing leaves the machine on a worker's say-so.

Every governance decision is written to an append-only audit log.

## Honest boundaries (what this is and isn't)

We are precise about what Stage 1 does, so nothing here is overstated:

- **No language model is in the loop by default.** Skills are deterministic and
  evidence-grounded — they read connected data and cite it. This is a deliberate
  design choice (the same one Founder AI makes): a worker cannot fabricate a
  task, a deadline, or a customer. The SDK has a clean, documented seam where a
  model-backed reasoning step can be added later — but it is a *seam*, not a
  stub pretending to be intelligence.
- **"Background execution" is a cooperative in-process scheduler**, not a pool of
  OS processes or threads. `enqueue` returns immediately and the job runs on the
  next tick. This is honest about the mechanism while still being genuinely
  non-blocking.
- **Side effects are proposed, not performed.** A worker that "drafts a reply" or
  "sets a reminder" produces a governed *proposal* carrying the payload; actually
  delivering that side effect is gated behind human approval and (for outbound
  actions) is wired in deliberately, not faked.
- **Workflow runs are in-memory this stage.** The durable record is the **Job
  Store** (every run, its proposals, and its verdicts persist). Workflow run
  objects live in memory and are rebuilt per session; persistence can be added
  without changing the model.
- **Trust and health are computed deterministically** from job outcomes — they
  are not opaque scores. Success nudges trust up, failure down (floored); health
  reflects the recent success rate.

## Where it sits

The workforce reads only **derived state** — the Unified Data Model, Enterprise
Timeline, AI Memory, and knowledge graph — never a connector directly. Each job
runs against a fresh, permission-scoped snapshot of that intelligence layer.

```
connectors → UDM / graph / timeline / memory → [scoped snapshot] → worker skill → governed job
```

## Documents

- `sdk.md` — defining workers and skills, the permission model, least privilege.
- `registry.md` — the worker store, trust, and health.
- `runtime.md` — executing a skill into a job; the scheduler; the approval loop.
- `governance.md` — the four checks, the default policies, the audit log.
- `orchestrator.md` — workflows, dependencies, retry, timeout, checkpoints.
- `built-in-workers.md` — the nine workers and their skills.


## Further reading

- `runtime.md`, `registry.md`, `sdk.md`, `governance.md`, `orchestrator.md`,
  `built-in-workers.md` — the Stage 1 engine.
- `experience.md` — the Stage 2 operator cockpit (Mission Control, the worker
  dashboard, the approval center, the automation studio, analytics, and the
  executive chat).
