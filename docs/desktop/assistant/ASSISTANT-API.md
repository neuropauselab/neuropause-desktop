# NEMS Workspace Assistant — API Reference (Phase 6 Stage 4)

The Workspace Assistant is a **composition over existing engines**: the AI Engine reasons, the Context Builder retrieves, the ExecuteEngine executes (behind approvals), conversation-memory governance screens and remembers. It adds one main-process module (`apps/desktop/src/main/assistant/`) and the documented `assistant:*` IPC cluster — **the D-1 exception**: reasoning, retrieval, and conversation persistence are main-side, and no pre-existing channel accepts assembled context or persists conversations. No new AI engine, retrieval pipeline, connector path, or agent framework exists anywhere in this layer.

## The turn pipeline (`assistantService.ts`)

```
Conversation → Context → Retrieval → Reasoning → Planning → Approval → Execution → Verification → Response
```

- **Governance first:** every user message passes `screenMemory` before anything runs — credentials/PHI are refused, redacted in storage, and never processed.
- **Deterministic intent** (`assistantModel.ts`): weighted-rule classification into the eleven request classes (`question · search · analysis · planning · automation · execution · decision-support · content-creation · navigation · connector-action · workflow`); below the 0.34 confidence floor the assistant asks for clarification — no retrieval, no model call, nothing invented.
- **Context** — every collector (workspaces, connectors, executions, workforce approvals, automations, timeline, memory) settles independently; a failing or unwired subsystem becomes an explicit `unavailable {system, reason}` — never a silent zero (the Stage 2 contract).
- **Retrieval** — the EXISTING `ContextBuilder` with the additive `assistant` worker profile, plus audited executive-memory recall. The model never answers without this package.
- **Reasoning** — `aiEngine.run` with the versioned `assistant.workspace` prompt (v1): the model narrates strictly over deterministic findings + retrieved context, must echo evidence ids, and is instructed it **cannot act**. Offline ⇒ `grounded:false`, findings still answer, `aiOffline:true`.
- **Planning** — deterministic per-intent templates (`buildPlan`); targets are located by conservative name-matching over live records (`automationStore.all()`, `workerRegistry.summaries()`); every step declares `purpose / reason / expectedOutput` (spec 4.5) and side-effecting steps are **structurally `needsApproval`**.
- **Approval → Execution** — `assistant:plan.decide` (RBAC `workforce:operate`, audited) is the only dispatch trigger; approved steps run **exclusively through `executeEngine.execute`** (kinds `automation`/`worker`), so every existing gate (automation runner, workforce governance, confirmation-gated connector executors) applies unchanged. Plan mode records approvals but never dispatches.
- **Verification** — read from the real `ExecutionSession` (`state`, `durationMs`, `resultSummary`) onto the step; never assumed.
- **Response** — the mandatory `AssistantEnvelope` (below).

## Correlation ID (end-to-end traceability)

One `asst_<uuid>` per turn, threaded into: the retrieval tool-call record → `AiEngineRequest.correlationId` → the **AI audit record** (`AiAuditRecord.correlationId`, additive field) → executive-memory audit events (`MemoryAuditEvent.correlationId`, additive) → the approval events → `ExecutionRequest.correlationId` → the ExecuteEngine's `execution.*` timeline events → every `assistant.*` platform event → the envelope + Session Inspector. Join keys surfaced at administrator level: `trace.audit.{aiResponseId, executionIds, timelineEventTypes, permissionClass}`.

## Modes — one pipeline, five configurations (`MODE_CONFIG`)

| Mode | Retrieval | Reasoning | Side-effect steps | Dispatch on approval | Notes |
|---|---|---|---|---|---|
| Ask | 8 items / 4k chars | ✓ | never offered | — | fast grounded answers |
| Analyze | 16 / 9k, deep tier | ✓ | never offered | — | deep dives |
| Plan | 10 / 5k | ✓ | offered, gated | **never** | inspectable dry-run |
| Execute | 10 / 5k | ✓ | offered, gated | ✓ (after approval) | the acting mode |
| Monitor | none | **no model call** | never | — | deterministic operational snapshot |

## The envelope (`AssistantEnvelope` — explainability is structural)

Every response carries: `correlationId`, `mode`, `intent{id,confidence,matched}`, `clarification?`, `text?`, `findings[]` (evidence-carrying, deterministic), `recommendations[]`, `draft?` (review-only; the assistant never sends), `navigation?`, `plan?`, `sources[]`, `toolCalls[]` (purpose/reason/expectedOutput/outcome/duration), `confidence`, `grounded`, `aiOffline`, `unavailable[]`, `assumptions[]`, `reasoningSummary`, `trace` (the Session Inspector payload), `memoryCapture?`.

## Session Inspector (`AssistantTrace` + `ASSISTANT_TRACE_LEVEL_DETAIL`)

One trace, three deterministic detail levels (the shared map is the single source of truth): **User** (context, sources, tool calls, honest unavailability), **Developer** (+ retrieved items, prompt id/version, model, latency, tokens/cost, phase timings), **Administrator** (+ permission class, AI-audit join, execution-session ids, timeline event types). Rendered by `inspectorSections()` in the renderer view-model; nothing outside the level map is revealed or hidden ad hoc.

## IPC surface (all zod-validated, sender-trusted, classified)

| Channel | Purpose | Authorization |
|---|---|---|
| `assistant:ask` | Run one turn (90 s bound) | PUBLIC (sender-trust, like `founder:ask-v2`) |
| `assistant:conversations` / `assistant:conversation` | List / load | PUBLIC |
| `assistant:conversation.save` | Rename / pin | PUBLIC + **bridge-audited** |
| `assistant:conversation.delete` | Delete | PUBLIC + **bridge-audited** |
| `assistant:conversation.branch` | Fork at a message | PUBLIC |
| `assistant:plan.decide` | Approve/reject a plan step | **`workforce:operate` + requireAuth + audited** (same scope as `execute:run`) |
| `assistant:cancel` | Interrupt the in-flight turn | PUBLIC |
| `assistant:event` (broadcast) | Phase/step/turn progress | subscribe allowlist |

Startup fail-closed invariant: every channel is either RBAC-stamped via `RUNTIME_CHANNEL_PERMISSIONS` or deliberately listed in `PUBLIC_CHANNELS` — an unclassified channel refuses to boot.

## Conversation store (`conversationStore.ts`)

Durable JSON (`userData/assistant-conversations.json`), ExecutionStore write pattern (serialized atomic tmp+rename, mode 0600). Caps: 100 conversations (pinned survive first), 200 messages each. Branches carry `parent {conversationId, messageId}`. User text is stored **post-screen** (redacted on refusal).

## Renderer

`assistant/AssistantHost.tsx` (IPC binding, live `assistant:event` subscription, hand-offs) + `AssistantView.tsx` (conversation panel, mode chips, plan viewer, approval cards showing what/why/impact/**honest rollback**, drafts, explainability strip, Session Inspector) + `assistantViewModel.ts` (pure, node-tested) + `assistantHandoff.ts` (one-shot mailbox used by ⌘K and Mission Control — the Stage 3 pattern).

## Security notes

The renderer can never self-confirm execution (`ExecutionRequest.confirmed/params` remain in-process-only; the assistant service is a trusted dispatcher that only acts on an audited, RBAC-gated approval). Worker steps re-enter workforce governance — a worker's own side-effecting proposals still park in the Approval Center. Drafts are never sent. Secrets never reach retrieval, the model, or disk.
