# NeuroPause — AI Architecture (public launch)

## Components

| Component | Location | Credential custody |
| --- | --- | --- |
| AI Gateway | `apps/backend/src/ai/gateway.ts`, `router.ts` (mounted at `/ai`, `requireAuth` + per-IP + per-user rate limits) | provider keys ONLY in the backend environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); `AI_GATEWAY_PROVIDER=none` refuses with 503 |
| Gateway client | `apps/desktop/src/main/ai/gatewayClient.ts` | session bearer only; no provider key on the device for this lane |
| Governed agent loop | `apps/desktop/src/main/ai/gatewayAgentLoop.ts` | none — policy + execution on Computer-B |
| Engine budget | `apps/desktop/src/main/ai/aiEngine.ts` (`AiBudget`) | per-device runs/minute and output tokens/day; refusal is a deterministic fallback with the reason |
| Legacy device-direct lanes | `providerManager.ts`, `privateFirstClient.ts`, `ollamaClient.ts`, `claudeClient.ts`, `openaiClient.ts` | user-stored keys in the Electron safeStorage vault (`security/secureStore.ts`); never reach the renderer |

## Gateway contract (`np.ai.gateway/v1`)

Request: `{ messages: [{role, content, tool_call_id?, name?}], tools?: [{name, description, parameters}], maxOutputTokens? }`
Response: `{ id, provider, model, text, tool_proposals: [{proposal_id, tool, arguments}], finish_reason, usage, latency_ms, gateway: { version, policy: "AI_PROPOSES_ONLY", executes_tools: false, grants_authority: false } }`

Bounds (env-tunable): `AI_GATEWAY_MAX_MESSAGES` 64 · `AI_GATEWAY_MAX_INPUT_CHARS` 200000 · `AI_GATEWAY_MAX_OUTPUT_TOKENS` 2048 · `AI_GATEWAY_TIMEOUT_MS` 120000 · `AI_GATEWAY_USER_RPM` 30 · per-IP 120/min. The gateway performs no retries.

Invariant: a response carrying `authorized`/`approved`/`authorization`/`permission_granted`/`admissible` at the top level is rejected before it leaves the gateway (`assertNoAuthorityClaim`).

## Loop bounds (Computer-B)

`maxTurns` 6 · `maxToolCalls` 10 · `maxDurationMs` 180000 · cooperative `stopRequested()` checked before every model turn and every execution. Every run terminates in exactly one of COMPLETED · BLOCKED · STOPPED · FAILED · TIMEOUT · HUMAN_DECISION_REQUIRED and emits an evidence chain INTENT → MODEL_TURN → POLICY → ACTION → EXECUTION → RESULT → … → TERMINAL.

## Tool registry (launch set used in the live run)

| TOOL_ID | CAPABILITY | RISK | SIDE_EFFECT_CLASS | REQUIRED_AUTHORITY | CONFIRMATION | EVIDENCE | ROLLBACK |
| --- | --- | --- | --- | --- | --- | --- | --- |
| read_file | read one file inside a sandbox directory | LOW | READ_ONLY | NONE | no | ALWAYS | NOT_APPLICABLE |
| write_file | overwrite one sandbox file | MEDIUM | REVERSIBLE_WRITE | HUMAN_CONFIRMATION | yes | ALWAYS | REVERSIBLE |

Anything not in the registry is `DENIED_UNKNOWN_TOOL`. A `HUMAN_AUTHORITY` tool is not admitted by a `HUMAN_CONFIRMATION` decision.

## Prompt-injection posture

External content (documents, tool output, web text) enters the loop only as `role=tool` data. Adversarial tests: forged `SYSTEM:`/`ADMIN:`/`HUMAN AUTHORITY` lines and `AUTHORIZATION_GRANTED=true` in tool output (`gatewayAgentLoop.test.ts`), plus the live injected document run. Remaining ABSENT: renderer-side prompt-injection regression tests for the legacy assistant lanes (recorded in 08_AI_SECURITY_REGISTER).

## Model configuration recorded at launch

Live measurements used `AI_GATEWAY_PROVIDER=ollama`, `AI_GATEWAY_MODEL=qwen3-coder:30b` (tools-capable) on Computer-B. No cloud provider key is present in this environment; cloud lanes are `WAITING_FOR_OPERATOR_SECRET`. Model names are configuration, not code.
