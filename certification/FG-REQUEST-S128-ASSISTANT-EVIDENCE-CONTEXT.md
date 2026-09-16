# FG REQUEST — S128 · wire the governed evidence-grounding source into the live assistant Context Builder

**Status:** REQUESTED — awaiting operator token. **The non-frozen substrate (S128) is already landed and
green;** this FG covers ONLY the last hop: making the live Brain consume it.

## Why an FG is required
The S128 governed AI grounding read (`QueryEvidenceContext` → `projectEvidenceForAI → AiContextItem[]`)
is fully non-frozen and live. Connecting it as a live **assistant Context Builder source** requires the
assistant to reach a tenant-scoped evidence reader. The assistant is constructed by
`initAssistant({...})` at **`apps/desktop/src/main/runtimeCore.ts:2731`** — and `runtimeCore.ts` is a
**FROZEN surface**. Passing the evidence reader into that call is a one-line additive frozen change, so
it needs an authorized FG token. `AiContextItem` / `AiContextSource` (also frozen) are **reused, not
modified** — no change there.

## Exact change requested (additive, one file, one line)
- **File (frozen):** `apps/desktop/src/main/runtimeCore.ts`
- **Change:** at the existing `const assistant = initAssistant({ … })` call (~line 2731), pass ONE
  additional dependency — a read-only, tenant-scoped evidence-context provider bound to the same
  `DurableCommandJournal` + `platformBusRef` + `DeliveredEventLog` already constructed there:
  ```
  evidenceContext: (opts) => buildEvidenceContext(journal, platformBusRef.current ?? undefined,
                                                  deliveredLog, resolveActiveTenantId(), opts).data.context
  ```
  (exact expression finalized against the real locals at apply time; it reuses S128's `buildEvidenceContext`
  and the tenant already resolved for the assistant.)
- **Accompanying NON-frozen change:** `apps/desktop/src/main/assistant/index.ts buildContext(...)` appends
  the evidence grounding items to the returned `AiContextItem[]` (exactly as `projectCapabilitiesForAI`
  is appended today), gated to the assistant's already-resolved tenant.

## Purpose
Let the live Brain ground its answers on **what actually happened operationally** (governed command
history + connector lineage + correlation trace + delivery posture) — read-only, with explicit per-item
provenance — completing "AI grounded on canonical evidence."

## Compatibility
- Additive only: one new optional dep on `AssistantSubsystemDeps`; absent ⇒ behavior identical to today
  (no evidence grounding). No existing field changes; no `AiContextItem`/`AiContextSource` change.
- Read-only: no store access beyond the existing governed reads; no command execution; no approval/
  connector/autonomous action; tenant server-resolved; credential-free; bounded — all already proven by
  the S128 governed-read tests.

## Tests required before/after applying the token (change-control choreography)
- INTACT baseline #1 (freeze re-record), apply the one additive line, full main + UI suites green, the
  S128 grounding suites green, a new assistant-path test proving: (a) evidence items appear in
  `buildContext` output for the active tenant, (b) tenant isolation (no cross-tenant grounding),
  (c) absent-dep ⇒ unchanged output, (d) no AI execution triggered by grounding; isolated frozen-only
  commit; INTACT #2; evidence doc.

## STOP
No token is guessed or manufactured. The live-assistant-wiring sub-branch is **STOPPED here** until the
operator provides: `AUTHORIZED: FG-S128-ASSISTANT-EVIDENCE-CONTEXT — runtimeCore initAssistant additive
evidenceContext dep, per gate doc` (exact wording is the operator's to set).
