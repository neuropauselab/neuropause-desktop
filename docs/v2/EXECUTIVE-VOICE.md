# V2.6 — Executive Voice Assistant

A voice interface that lets an executive speak to NeuroPause and get evidence-
grounded answers. It is a **routing + response-composition layer** over existing
intelligence — it contains no AI model, no context builder, and no governance of
its own. Every question routes to a system that already exists; every state-
changing action is flagged for the existing approval/governance path.

## Scope of THIS increment (honest boundary)
A voice pipeline has three kinds of parts:
1. **The brain** — intent routing + response composition. **Pure, fully tested,
   shipped in this increment (17 tests).**
2. **Audio I/O** — wake word, STT, TTS. **Interfaces defined** (`WakeWordDetector`,
   `SpeechRecognizer`, `SpeechSynthesizer`); the local/native implementations and
   the floating mic UI are the next increment, verified on macOS with a real mic
   (a microphone cannot be exercised in CI — same constraint as the website/panel).
3. **The floating Voice UI** — states defined (`VoiceState`); the React component
   is the next increment.

This increment delivers the verifiable core: speech text in → correct routed,
evidence-grounded spoken response out, over IPC.

## STEP 1 recon — reused, never duplicated
- `composeExecutiveSnapshot` (V2.4) → the single richest evidence source (KPIs,
  org-health scores, critical alerts, founder recs) the composer speaks from.
- `buildFounderProactiveItems` (V2.2) + `buildOrgIntelligenceItems`/
  `collectOrgHealthInputs` (V2.3) → feed the snapshot.
- `classifyFounderIntent` (existing) → the free-form fallback for 'unknown'
  intents (we add no second NLU).
- Existing IPC/secureBridge + Zod contracts + logger → the handler + audit line.
- V2.4/V2.5 deep-link vocabulary → voice navigation reuses the same routes.

## Voice pipeline (STEP 2)
```
Wake Word ─▶ STT ─▶ [ classifyVoiceIntent ]  ← pure, tested
                          │ VoiceIntentResult
                          ▼
                  [ composeExecutiveSnapshot ]  ← existing V2.4 (real evidence)
                          │ snapshot
                          ▼
                  [ composeVoiceResponse ]      ← pure, tested
                          │ VoiceResponse { speech, deepLink?, actionId?, requiresApproval? }
                          ▼
        deepLink → navigate (V2.5)   actionId → governance/approval   speech → TTS
```
`voiceSubsystem.answer(transcript)` is the single entry the audio/renderer layer
calls; exposed over `IpcChannel.VoiceTurn`.

## Intent routing (STEP 5) — every intent maps to an existing system
greeting, org-health, engineering-health, critical-risks, mission-brief,
founder-recommendations, connector-status, license-status, summarize, open-module
(→ deep-link), action (→ governance), unknown (→ Founder AI free-form). Deterministic
keyword/pattern matching: fast, offline, no model. The wake phrase is stripped so
"Hello NeuroPause, how is engineering?" routes on the tail.

## Responses (STEP 6) — always real evidence
Answers read the live snapshot: e.g. "Engineering health is 94 out of 100 —
healthy.", "There are 2 critical risks. The most urgent is: License expires in 3
days.", greeting surfaces the critical count. An empty/absent snapshot yields
honest "nothing to report" / "I don't have live intelligence" phrasing — never a
fabricated number.

## Actions (STEP 7) — governance-gated
Action intents (create task, schedule meeting, notify team, generate report)
return `requiresApproval: true` + an `actionId`; execution goes through the
existing approval/governance path (this layer never self-executes state changes).

## Security (STEP 11)
The audit log records only the **recognized intent** and whether approval was
required — **no raw audio** is stored by this core. Microphone permission,
workspace isolation, and enterprise governance are handled by the existing
platform layers the audio implementation will attach to.

## Files changed
- `packages/shared/src/types/voice.ts` (new) — intents, VoiceResponse, VoiceState,
  and the audio-I/O interfaces.
- `packages/shared/src/index.ts` — export voice types.
- `packages/shared/src/ipc/channels.ts` — `VoiceTurn` channel.
- `apps/desktop/src/main/voice/voiceIntent.ts` (new) — pure classifier.
- `apps/desktop/src/main/voice/voiceComposer.ts` (new) — pure response composer.
- `apps/desktop/src/main/voice/voiceSubsystem.ts` (new) — wires snapshot + IPC.
- `apps/desktop/src/main/voice/voice.test.ts` (new) — 17 tests.
- `apps/desktop/src/main/runtimeCore.ts` — init + push handler (+import).

## Tests & verification
Desktop **584 passed** (17 new: classifier across all intents + wake-strip +
fallback; composer for each intent with real-evidence assertions, action-approval,
deep-link, and honest no-snapshot degradation). Backend 168. Typecheck + lint clean.

## Performance (STEP 10) — design targets
Classification is synchronous regex matching (sub-millisecond). The composer reads
an already-composed snapshot. The <300ms wake target and streaming TTS-while-
generating belong to the audio implementation; the brain adds negligible latency.

## Known limitations
- **Audio + UI are not in this increment** (interfaces only) and are unverifiable
  in CI; they're the next increment on macOS with a real microphone.
- Intent routing is deterministic keyword matching — robust for the listed
  executive intents, with Founder AI as the free-form fallback; it is not a
  general NLU (by design — explainable + offline).
- Conversation memory (STEP 8) reuses Executive Memory downstream; the multi-turn
  context wiring is a follow-up once the audio loop exists.
- No TTS voice selection / barge-in yet — audio-layer concerns.

## How the audio/renderer layer uses it
Wake word fires → STT streams text → call `IpcChannel.VoiceTurn` with the
transcript → receive `VoiceResponse` → speak `speech` via TTS, navigate `deepLink`
if present, and route `actionId` through approval if `requiresApproval`.
