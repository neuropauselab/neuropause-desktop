# Phase I — Investigation: the universal consequential-action boundary

**Status: MODEL C ACCEPTED as design direction (frozen). INVESTIGATION / ANALYSIS
ONLY — no code, no kernel/executor change, no universal abstraction.** The next
implementation gate is a narrowly-scoped Phase I-A (`mail.send` worker-path closure),
authorized separately and gated on the context-availability prerequisite below.

Trigger: H-FINDING-3 (Phase H) — `mail.send` is governed at the `M365ActionExecute`
IPC ingress but reachable un-governed elsewhere. This asks the architectural question:
**where does a consequential action's governance boundary actually belong?**

---

## 1. Grounded inventory (what exists today)

Consequential capabilities, their effect boundary, and every ingress that can reach it
("governed" = routes through a `cst/*Transition` adapter → the frozen kernel).

| Capability | Effect boundary | Ingresses (governed?) |
|---|---|---|
| **Data import** | `applyImportPlan` (`dataPlane/index.ts:630`) | IPC `dp:import` → `governedImport` — **GOVERNED** (1/1) |
| **M365 mail.send** (email egress) | pure Graph send in `M365Executor.execute` (`m365/executor.ts:134`) | (a) IPC `M365ActionExecute`/`mail.send` → `governedSend` — **GOVERNED**; (b) IPC other actionId → `m365.execute` — un-governed; (c) `runBinding` `'m365'` (`runtimeCore.ts:2498`), reached by worker-approval + `ExecuteRun` — **un-governed (a worker-approved mail.send bypasses CST)** |
| **Infra mutation** (restart/terminate/scale/revoke live cloud) | `InfraActionExecutor.execute` (`infrastructure/executor.ts:104`) | (a) IPC `infra:action` (`infrastructure/index.ts:387`) — un-governed; (b) `runBinding` `'infra'` (`runtimeCore.ts:2488`) — un-governed |
| **Automation run** (external write self-neutered: connector-write is held-for-confirmation) | `AutomationRunner.runRule` (`automationRunner.ts:122`) | IPC `automations:run`; ExecuteEngine; `runBinding`; **scheduler timer**; **event-bus dispatch**; enterprise REST/SDK — **6 ingresses, 0 governed** |
| **Webhook outbound POST** (egress) | `WebhookDispatcher.attempt`→`post` (`webhookDispatcher.ts:146`) | 5s **timer**; bus-driven enqueue; IPC `WebhookReplay` — 3 ingresses, 0 governed |
| **Cloud live-sync / SCIM / webhook-provision** (egress) | `liveSync.syncNow`, cloud provisioning handlers (`cloud/index.ts:475,436,590`) | IPC + sync timer — 0 governed |
| **Connectors bridge write** (into internal modules) | `bridgeResource` (`connectors/bridge/index.ts:368`) | scheduled sync + connector events — 0 governed |
| **Internal mutating CRUD** (org/user/role, revoke, restart, backups, ecosystem keys) | store mutators | many dedicated IPC handlers, permission-gated only — 0 governed |

**Governed today: 2 of ~18 consequential ingresses.**

## 2. The three questions, answered from evidence

**(A) Is there a single chokepoint? NO.** The CST kernel governs only two transitions.
`runBinding` (`runtimeCore.ts:2482`) is a *partial* convergence — it funnels
infra+m365+automation, but only for the worker-approval / `ExecuteRun` ingress; it is
blind to the direct IPC handlers, webhooks, and cloud sync. The only place a given
capability's ingresses all meet is that **capability's own effect method** — and there
is **no point below the IPC layer where all capabilities meet** (egress via
webhooks/cloud shares no executor with the action executors).

**(B) Governance is ingress-local and sparse.** Every capability has 2–6 distinct
ingresses; only import (1/1) and mail.send-via-IPC (1/3) are governed. Notably the
capability Phase H governed is still bypassable: a **worker-approved `mail.send`
binding executes the raw executor** (`runtimeCore.ts:2498`), unseen by CST.

**(C) Broadest coverage, least intrusion = the per-capability effect boundary.**
For infra, m365, and automation, both the direct-IPC ingress and the
runBinding/worker-approval ingress **already converge at the executor's own `.execute`**
— so one interception per capability closes every ingress, including the worker-path
bypass. `runBinding` alone is the smallest edit but the weakest coverage (misses direct
IPC, webhooks, cloud). Egress (webhooks, cloud sync/SCIM) and internal CRUD have **no**
shared executor and need their own points regardless.

## 3. The models, evaluated against this architecture

**Model A — ingress governance (wrap each entry).** What Phase H did for one ingress.
- *Verdict: provably incomplete and non-scaling.* There are 18+ ingresses, several of
  which are **not IPC** (schedulers, the event bus, worker-approval, enterprise REST).
  Governing "each entry" means finding and wrapping all of them forever; a new caller
  silently reintroduces a bypass. H-FINDING-3 is the direct evidence.

**Model B — capability enforcement (govern at the effect).** Put the CST verdict where
every ingress for a capability converges: its effect method.
- *Verdict: correct boundary, but there is no single universal effect.* It is **one
  governed entry per capability**, not one global gate. It closes all ingresses for
  that capability (including worker-approval) in one place. Cost/hazard: the executors
  bundle auth+confirm+effect and **swallow the transport error class** (H-FINDING-1),
  so governance cannot live *inside* `execute()` without either modifying the frozen
  executor or wrapping it so the governed adapter becomes the **only** way in.

**Model C — both (IPC admission + capability enforcement).** IPC `requireAuth` and
per-channel permissions remain as an **admission pre-filter**; the **CST verdict lives
at the capability boundary** that all ingresses funnel through.
- *Verdict: this is what the evidence supports* — but it must be **derived
  incrementally, not built as a `UniversalTransition<T>` framework** (F8). The
  admission layer already exists; the missing half is a single governed door per
  capability with the other doors locked to it.

## 4. Recommendation (for decision — not yet authorized)

**Adopt a capability-boundary invariant, realized incrementally, one capability at a
time — not a universal framework.**

> **Invariant (proposed):** each consequential capability has exactly **one governed
> entry** — its effect wrapped by a per-capability CST adapter (the `governedImport` /
> `governedSend` shape) — and **every** ingress (IPC, `runBinding`, ExecuteEngine,
> scheduler, bus, worker-approval) reaches the effect **only** through that entry. The
> raw executor `.execute` is no longer a public consequential door.

Why this and not the alternatives:
- It fixes the class of defect H-FINDING-3 named (ingress-local leakage) at the point
  where ingresses actually converge, rather than chasing entries.
- It keeps the frozen kernel and executors unmodified: the adapter reuses the effect
  (Phase H's Option-1 pattern), and "locking the other doors" means routing
  `runBinding`/engine through the adapter, not editing the executor.
- It respects F8: no `UniversalTransition<T>`; each capability is proven independently
  (its own controls + evidence), and a shared abstraction is only extracted later, from
  ≥2 completed capabilities that demonstrably share structure.

**Immediate, concrete consequence to record:** `mail.send` governance is **incomplete**
— the worker-approval ingress (`runBinding` `'m365'`) bypasses `governedSend`. Phase H's
narrow claim stands, but "govern `mail.send`" is not finished until that ingress routes
through the adapter. This is the natural first target.

**Two capability classes need distinct treatment:**
1. *Executor-backed* (m365, infra, automation, import): the effect boundary is a clean
   convergence — one governed adapter per capability, all ingresses routed to it.
2. *Egress without a shared executor* (webhook POST, cloud sync/SCIM, bridge writes):
   no convergence below IPC; each needs its own governed boundary at its own effect
   (`webhookDispatcher.attempt`, `liveSync.syncNow`, `bridgeResource`). These are a
   **separate, later** investigation — they are timer/bus-driven, not intent-driven,
   which (per Phase G) is a different governance shape.

## 5. Explicit non-goals of this investigation
No code. No kernel/executor change. No `UniversalTransition` abstraction. No decision to
govern any specific new capability yet. No change to the frozen Data Import reference or
the Phase H commit. The internal-CRUD IPC surface (item 8) is out of scope — it is
permission-gated local mutation, not the external/irreversible class under study.

## 6. DECISION & FROZEN DIRECTION (accepted)

**Model C — ACCEPTED**, with this sharpened interpretation:

> **Two boundaries, not one.**
> - **Boundary A — admission governance** (rich semantic context: identity, purpose,
>   intent, relationship, risk, authority, approval, policy). Decides *should this
>   happen?* NeuroPause's constitutional model is strongest here.
> - **Boundary B — consequential-effect enforcement** (close to the effect). Enforces
>   the invariant *no required governance state ⇒ no consequent effect*, so the same
>   capability cannot be reached un-governed via a second ingress.
>
> Realized **incrementally, one capability at a time** — a per-capability governed
> door (`governedImport`/`governedSend` shape), all ingresses routed through it, the
> raw executor no longer a public consequential entry. **No `UniversalTransition<T>`
> until ≥ heterogeneous capabilities prove a stable shared contract (F8).**

**The key design principle (gates every capability boundary):**

> *Governance must not be moved to a boundary that lacks the minimum authoritative
> context required to make the governance decision.*

A capability boundary needs BOTH the enforcement point AND the required context
(identity, purpose, relationship, authority) available there. If the context is lost
before the boundary, the architecture has an **information-boundary problem** that must
be solved before — or instead of — moving governance down. This directly gates I-A:
the worker path must carry an **authoritative actor** (Phase H established
`workspaceId ≠ actor`; no fallback to `system`/`owner`/`unknown`).

### The permanent distinction this phase establishes
```
Control correctness  ≠  Path completeness
```
- **Control correctness** — when governance IS invoked, does it behave correctly?
  (Phase H: **yes**, within its declared path.)
- **Path completeness** — does *every* consequential path invoke the required
  governance? (H-FINDING-3: **not yet**.)

A capability must not receive a universal governance claim merely because control
correctness passes. Certification needs **two gates**: (A) control correctness, and
(B) **boundary completeness** = inventory + path discovery + bypass testing + explicit
scope declaration.

### Governance is a two-dimensional (capability × ingress) relationship
Coverage cannot be described by capability alone or ingress alone. Today the matrix is
sparse (2/18). Proposed measurement concepts, **not** to be published as percentages
until the denominator (the consequential-invocation inventory) is complete:
`Capability Governance Coverage = governed invocations of a capability / all its
invocations` (e.g. `CGC(mail.send) < 100%` even though its IPC ingress is governed);
`Boundary Completeness = ingress paths with enforced governance / known ingress paths`.

### A new negative-control class for capability closure: **Governance Bypass Reachability**
Beyond testing the adapter, prove per capability that *every* ingress crosses the same
governance invariant, and that the raw executor is not a public consequential door.
Additional cross-path controls: replay an authorization from one ingress against
another (expect REJECT unless the model binds across paths); use one idempotency key
through two ingresses (expect **one** logical consequence, not two external effects);
mutate actor/purpose/target/policy between authorization and execution (expect
revalidation/deny, not silent execution).

### Assurance is DECLARED, not universal
```
Path completeness × Governance correctness × Execution control × Verification × Evidence
   =  DECLARED assurance   (within declared control boundaries)
```
The strongest defensible statement remains: *NeuroPause identifies, governs,
authorizes, execution-controls, verifies and evidences consequential actions within
declared control boundaries, while explicitly distinguishing control correctness from
path completeness* — never "universally governs."

## 7. Roadmap (phased; only I-A is the next gate)

- **Phase I-A — `mail.send` boundary completion (NEXT).** Route the worker-approval
  ingress (`runBinding` `'m365'`) through `governedSend` so all identified `mail.send`
  paths cross the same governed door; re-run the send controls + the new bypass
  reachability controls; inventory any other alternate path. **Gated on** the
  worker-path context prerequisite (authoritative actor available — investigated
  before any code). No kernel/executor change; no universal abstraction.
- **Phase I-B — capability inventory.** Classify each capability (infra, m365,
  automation, import, webhook, cloud, bridge, scheduler) as consequential /
  non-consequential / ambiguous / out-of-scope, each with an ingress map.
- **Phase I-C — a genuinely different second capability** (recommend `infra.terminate`:
  resource destruction vs external communication) to test the capability-boundary
  principle against another consequence model.
- **Phase I-D — abstraction only if warranted.** Only after ≥3 heterogeneous
  capabilities demonstrate a stable shared contract may a shared abstraction be
  considered (preserves F8).
- **Egress class (webhooks / cloud sync / SCIM / bridge)** — deferred to a separate
  later investigation: timer/bus-driven, not intent-driven → a different governance
  shape (per Phase G).

## 8. Explicit non-goals (restated)
No code in this phase. No kernel/executor change. No `UniversalTransition`. No universal
governance claim. No governing of webhooks/cloud/internal-CRUD now. No Phase-I platform
refactor. Frozen Data Import reference and the Phase H commit untouched.
