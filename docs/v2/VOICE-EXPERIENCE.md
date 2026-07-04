# V2.7 — Voice Experience Layer

The conversational experience on top of the V2.6 voice brain: session lifecycle,
in-conversation commands, audio I/O, and a floating widget. This increment is
split deliberately by what can be **verified in CI** versus what needs **on-device
(macOS) verification** — and it is labeled honestly, per the rule against
presenting unverifiable code as tested.

## Two halves — read this first

### ✅ Verified core (pure, 16 new tests, 600 total green)
- **`packages/shared/src/voiceSession.ts`** — the session state machine as a pure
  reducer: idle → wake → listening → recognizing → thinking → speaking → waiting →
  (loop) → ended/timeout/cancelled, plus muted/offline/permission states. Placed in
  `shared` so BOTH main and renderer use one machine (correct Electron isolation —
  the renderer cannot import from main).
- **`packages/shared/src/voiceCommands.ts`** — the in-conversation command parser
  (stop/cancel/pause/continue/repeat/start-over/goodbye/thank-you) + helpers
  `interruptsSpeech` / `endsSession`. Pure, tested.
- **`packages/shared/src/types/voice.ts`** — extended `VoiceState`, added
  `VoiceCommand`, `VoiceSettings` (+ defaults).
- Tests run in the main-scoped vitest by importing from `@neuropause/shared`.

### ⚠️ On-device scaffold (NOT verifiable in CI — verify on macOS)
These use real audio + browser APIs (getUserMedia, webkitSpeechRecognition,
SpeechSynthesis) and animated UI. They CANNOT be exercised in the container (no
mic, no audio, no headless browser). They typecheck and follow existing renderer
conventions, and each file carries a ⚠️ header, but their **runtime behavior and
appearance must be verified by running the app on macOS**:
- **`apps/desktop/src/renderer/src/voice/voiceAudio.ts`** — `WebSpeechRecognizer`,
  `WebSpeechSynthesizer`, `LocalWakeWordDetector`, `requestMicPermission`,
  `listMicrophones`. All behind the shared interfaces (swap providers freely).
- **`apps/desktop/src/renderer/src/voice/VoiceWidget.tsx`** — the floating mic
  launcher + conversation panel; composes the tested session machine + command
  parser + audio services + the V2.6 `voiceTurn` IPC + V2.5 deep-link navigation.

## Architecture
```
[ VoiceWidget (renderer) ]
   mic → WebSpeechRecognizer ──partials/final──▶ voiceSessionReducer (shared, tested)
                                     │ final text
                                     ▼
                         parseVoiceCommand (shared, tested)
                         ├─ control command → interrupt/goodbye (local)
                         └─ none → ipc.intelligence.voiceTurn  → V2.6 brain (evidence)
                                     │ VoiceResponse
                                     ▼
                     deepLink → setSection (V2.5)   speech → WebSpeechSynthesizer
```

## STEP mapping
- **STEP 4/6 (audio providers)** — behind `SpeechRecognizer`/`SpeechSynthesizer`/
  `WakeWordDetector` interfaces; Web Speech impls provided, cloud impls slot in.
- **STEP 5 (session lifecycle)** — the tested reducer.
- **STEP 7 (interruptions/commands)** — the tested parser; stop/cancel/pause/
  start-over interrupt speech; goodbye ends the session.
- **STEP 8 (context)** — the machine keeps `lastFinal` for repeat/start-over;
  multi-turn memory reuses Executive Memory downstream (follow-up).
- **STEP 9 (widget)** — the scaffold component (verify on macOS).
- **STEP 10 (settings)** — `VoiceSettings` + defaults (wake toggle, device ids,
  rate, sensitivity, push-to-talk, DND, privacy mode, `storeAudioHistory:false`).
- **STEP 11 (privacy)** — defaults keep NO raw audio; privacy mode suppresses the
  on-screen transcript; the V2.6 audit logs intent only.

## Files changed
- `packages/shared/src/types/voice.ts` — extended states + settings/command types.
- `packages/shared/src/voiceSession.ts` (new) — session machine.
- `packages/shared/src/voiceCommands.ts` (new) — command parser.
- `packages/shared/src/index.ts` — export both.
- `apps/desktop/src/main/voice/voiceSession.test.ts` (new) — 16 tests (imports shared).
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `voiceTurn` binding.
- `apps/desktop/src/renderer/src/voice/voiceAudio.ts` (new, ⚠️) — audio services.
- `apps/desktop/src/renderer/src/voice/VoiceWidget.tsx` (new, ⚠️) — floating widget.

## Tests & verification
- **Desktop 600 passed** (16 new session + command tests). Shared + desktop +
  backend typecheck: **0 errors**. Lint: clean.
- The audio services and widget are **not** covered by automated tests (no audio in
  CI) — this is stated, not hidden.

## Known limitations — read honestly
- **Audio + widget are unverified in this environment.** Mount `<VoiceWidget/>` in
  the app shell and verify on macOS: mic permission prompt, wake/among-listening
  behavior, STT accuracy, TTS playback, interrupt on "stop", navigation on
  deep-linked answers. This is the required manual step.
- Wake word uses a local-recognizer phrase match (privacy-first, no cloud); a
  dedicated on-device wake model can replace it behind `WakeWordDetector`.
- The widget isn't yet mounted in `AppShell` — mounting it (one line) is part of
  the on-device wiring so it can be toggled by the `VoiceSettings.wakeWordEnabled`
  preference.
- Streaming TTS-while-generating and barge-in are audio-layer refinements.
- `VoiceSettings` type exists; the Settings UI to edit it is a follow-up increment.

## How to wire + verify on macOS
1. Mount `<VoiceWidget/>` in `AppShell` (gated on a settings flag).
2. Build + run the app on Apple Silicon.
3. Grant mic permission; click the mic (or say "Hello NeuroPause" once wake is on).
4. Ask "how is engineering?" → expect a spoken, evidence-grounded answer + optional
   navigation. Say "stop" mid-answer → speech halts. Say "goodbye" → session ends.
