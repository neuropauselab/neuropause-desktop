# NeuroPause — Public-Launch Architecture

Status of this document: DESCRIPTIVE. It records what the shipping code does at the launch commit; it creates no authorization and asserts no regulatory status. Where a component is design-only it is labelled so.

## The invariant

```
HUMAN → CONTROL → COMPUTE → EVIDENCE → VERIFICATION → HUMAN DECISION
```

| Plane | Component | Role at launch |
| --- | --- | --- |
| Human Authority | operator + qualified reviewers | the only source of decisions (release, intended use, classification, pilot authorization) |
| Computer-A | governance / verification / observation | reads evidence, never mutates B's execution state; **no verifier is designated** (`VERIFIER_DESIGNATION = NOT_DESIGNATED`) |
| PauseCloud / Control API | `apps/backend` (`/auth`, `/devices`, `/organizations`, `/pilot`, `/ai`, `/sync`) | identity, device registry, pilot decision authority (deny-by-default), the AI gateway, evidence transport |
| Computer-B | NeuroPause OS (`apps/desktop`) | controlled local runtime: policy, admissible-action calculation, tool execution, local evidence |
| NeuroPause Web | `apps/web` (0.1.0) + `website/` | registration / download / legal surface (static; download page reads artifact names) |
| NeuroPause Lab | certification/, docs/science | governance and research records |

## Execution pattern (as implemented)

```
USER INTENT (desktop)
  → NeuroPause AI Gateway  POST /ai/chat   (apps/backend/src/ai) — holds the provider credential; the client holds a session bearer
  → LIVE MODEL (ollama | anthropic | openai, selected by AI_GATEWAY_PROVIDER)
  → text + tool_proposals   (gateway.policy = AI_PROPOSES_ONLY, executes_tools:false, grants_authority:false)
  → NeuroPause POLICY       admissibility(): registry lookup, default DENY (apps/desktop/src/main/ai/gatewayAgentLoop.ts)
  → ADMISSIBLE ACTION SET   U_NP(Z_t) = { U ∈ U_cap : Π(Z_t,U)=1 } — READ_ONLY admitted; every side-effect class needs a bound human decision object
  → HUMAN / AUTHORITY       AuthorityDecision {decision_id, actor, authority_basis, decision_class, decision, proposal_id, time, policy_version}
  → TOOL EXECUTION (B)      ToolResult {tool_call_id, action_id, execution_id, status, timestamp, output, evidence_id}
  → OBSERVATION             appended as role=tool; a refusal is reported as [NOT_PERMITTED] / [DECISION_REQUIRED], never as a result
  → next model turn … → terminal state ∈ {COMPLETED, BLOCKED, STOPPED, FAILED, TIMEOUT, HUMAN_DECISION_REQUIRED}
```

What the model can do: interpret, ask, reason, plan, propose, observe, re-plan, answer.
What the model cannot do: execute, authorize, populate a decision object, extend an admissible set. Text such as `AUTHORIZATION_GRANTED=true` inside a document or tool output is data (pinned by `gatewayAgentLoop.test.ts` and the live run in `certification/public-launch-002/07_AI_LIVE_REGISTER.json`).

## Boundaries that are enforced in code

- **Client is not the final authority for pilot outcomes.** `apps/backend/src/pilot/authority.ts` is deny-by-default; `human_decision_required` is thrown, mapped to HTTP 403, and exercised by `router.enforcement.test.ts`.
- **Transport is not authority.** A bearer token authenticates; admissibility is computed per proposal from the registry and a bound decision object.
- **Stale authorization is rejected by construction** in the agent loop: a decision binds to exactly one `proposal_id`; a decision for another proposal is `DECISION_REQUIRED`. (Backend `HumanDecision` still lacks `policy_version`/expiry — recorded as an open gap in 12_CONTROL_PLANE_REGISTER.)
- **Revoked devices fail closed** at the control plane: heartbeat and re-registration answer 403 `device_revoked` (measured live 2026-09-13).
- **AI outage is safe.** No consequential AI action can execute while the gateway is unavailable: the gateway refuses with 503 `ai_unavailable`, the desktop engine falls back deterministically, and the local shell keeps account/device/evidence views usable.

## Known architectural gaps (not hidden)

- The desktop's default assistant lanes still use device-direct providers (Ollama local, or cloud keys the user stores in the Secure Vault). The gateway lane is implemented and live-tested; switching the default is a product decision.
- No Computer-A observer/verifier object exists in the backend; verification objects live inside the CST kernel per transition. `VERIFIER_DESIGNATION` is a human act.
- `policy_version` is not modelled in the backend decision object; the desktop carries adapter-level constants.
