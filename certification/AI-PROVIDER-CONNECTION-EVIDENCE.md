# AI PROVIDER CONNECTION — OpenAI · Anthropic · Ollama

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `545eb1a`
**Scope:** the AI provider connection surface only. No other gate touched.

---

## NAMING, STATED HONESTLY FIRST

The task named this **"D-5"**. In the certification record, `D-5` is **"AI policy
intersection"** and is **PASS** (`PROGRAM-13C-GATE-MATRIX.md:22`, 9/9 exhaustive
intersection + 7 composition tests + the `NC-D5-ELEVATE` negative control). The
scope actually described — OpenAI / Anthropic / Ollama connectivity — is the AI
provider surface, which belongs to **Gate 8 (AI/Assistant, YELLOW)**.

The work below is against the described surface. The `D-5` row is **not**
modified, because nothing here bears on the policy-intersection law it records.

## ROOT CAUSE — one credential-disclosure defect, two robustness defects

### 1 · A provider API key could be rendered on screen and written to disk in cleartext

**Reproduced first-hand on this repo's node v20.20.2:**

```
new Request(url, { headers: { 'x-api-key': 'sk-ant-SEC\nRET123456789' } })
→ TypeError: Headers.append: "sk-ant-SEC\nRET123456789" is an invalid header value.
```

The key is **verbatim** in that message. Both cloud clients called `fetch`
inside a `try/finally` with **no `catch`**, so it escaped intact and was copied
unchanged, hop after hop:

```
claudeClient / openaiClient  (throws, uncaught)
  → privateFirstClient       attempted[].reason = err.message   (verbatim)
  → aiEngine                 reason → noModelRouting(...)
  → assistantService         envelope.processing  → crosses IPC
  → aiRouting                case 'none': return meta.reason    (verbatim)
  → ProcessingBadge          {model.why}                        ← RENDERED
  → conversationStore        JSON.stringify(envelope)           ← PERSISTED
```

A live credential outside the encrypted vault, in `assistant-conversations.json`,
which no redaction pass touches.

**It is reachable, not theoretical.** The Settings field only `.trim()`s — which
strips surrounding whitespace, never an *embedded* newline — and the IPC contract
is `z.string().min(1)`. A key pasted from a wrapped terminal or a PDF is stored
exactly as typed.

**Redaction alone could not have fixed it**, and this is why the fix refuses
instead of scrubbing: `logger.redactCredentialText`'s `sk-` rule requires 8+
characters after the prefix, and a newline-broken key presents only `sk-ant-SEC`
— seven. *A defence that depends on the secret's own shape is not a control.*
Pinned as its own test.

### 2 · Ollama version misparsed in the installed-but-not-running state

`aiConfigIpc.ts` stripped a leading `"ollama version"` prefix, assuming one line.
**Reproduced on this machine** (binary installed at `/opt/homebrew/bin/ollama`,
service down), the real output is two warning lines:

```
Warning: could not connect to a running Ollama instance
Warning: client version is 0.30.7
```

The anchored replace matched nothing, so the whole warning became the "version"
and Settings would render `Installed but not running (vWarning: could not
connect to a running Ollama instance\nWarning: client version is 0.30.7)` —
worst precisely where the user most needs a clear next step.

### 3 · Two smaller robustness gaps

- `ollamaClient` and `claudeClient` parsed the response body with an unguarded
  `res.json()` where `openaiClient` guards it. A proxy error page or a truncated
  body surfaced a raw V8 `SyntaxError` on the same verbatim path to the UI.
  *(Correcting the review that reported this: only **one** sibling had the
  guard, not two — `claudeClient` lacked it as well.)*
- The connection validator mapped 429 for OpenAI but **not** for Anthropic, so a
  rate-limited Anthropic user — whose key is fine — was told
  `Anthropic API returned HTTP 429.` and invited to re-check a working key.

## FIX

`src/main/ai/apiKeyGuard.ts` (new, pure) — one rule shared by both cloud clients
and the validator:

- **`assertHeaderSafeApiKey`** refuses a key carrying any C0/C1 control
  character **before the request is built**, so the SDK never sees a value that
  would make it echo the secret. The message is actionable and contains no key
  material: *"The saved API key contains an invalid character — usually a line
  break from a wrapped copy-paste. Re-enter the key on one line."*
- **`redactProviderError`** is the second layer, reusing the existing
  `redactCredentialText` rather than inventing a redactor: anything a provider
  throws next leaves these clients scrubbed.
- The predicate is a **code-point scan, not a regex** — a control-character
  class is exactly what `no-control-regex` exists to flag, and suppressing the
  rule would be louder than not needing it.

Also: `parseOllamaVersion` now scans every line for a version and **requires the
capture to start with a digit** (the first draft parsed `"ollama version is
0.30.7"` as the version `"is"`); the `res.json()` guard is applied to
`ollamaClient` and `claudeClient`; Anthropic gains its 429 branch.

## FILES CHANGED

```
NEW  src/main/ai/apiKeyGuard.ts                 refuse-then-redact, shared rule
NEW  src/main/ai/apiKeyLeakGuard.test.ts        9 pins
NEW  src/main/ai/connectionValidatorWire.test.ts 11 pins, real sockets
NEW  src/main/ai/ollamaVersionParse.test.ts      7 pins
MOD  src/main/ai/claudeClient.ts                guard + redact + json guard
MOD  src/main/ai/openaiClient.ts                guard + redact
MOD  src/main/ai/ollamaClient.ts                json guard
MOD  src/main/ai/connectionValidator.ts         invalid-key detail + Anthropic 429
MOD  src/main/ai/aiConfigIpc.ts                 parseOllamaVersion (exported, pinned)
```

## TESTS AND CHECKS

| Check | Result |
|---|---|
| `apiKeyLeakGuard.test.ts` | **9/9** |
| `connectionValidatorWire.test.ts` | **11/11** (real `127.0.0.1` servers) |
| `ollamaVersionParse.test.ts` | **7/7** |
| Whole `src/main/ai/` suite | **24 files / 239 passed / 3 skipped** |
| Full main suite | **916 files / 9569 passed / 7 skipped** (from 913/9542 — delta +3 files / +27 tests) |
| Full UI suite | **59 / 359** (unchanged — no renderer change) |
| `tsc` node / web | clean / clean |
| `eslint src` | clean but for the pre-existing frozen `cst/` unused-import in the defect log |
| `electron-vite build` | **exit 0**, 2.78s |

**Negative controls, both restored byte-identically (sha256 equal):** the
Anthropic 429 branch removed ⇒ 1 wire pin fails; the key guard and redaction
removed from `claudeClient` ⇒ 2 leak pins fail ⇒ restored ⇒ 9/9.

**Connection testing is now proven at a real socket.** `connectionValidator`
previously had six tests against a mocked `fetch`, which prove branching and
nothing about the wire. Each provider builds a *different* auth header
(`x-api-key` + `anthropic-version` vs `Bearer`), so a header-shape mistake
passes every mocked test and fails against the real API. The new pins assert
what a real server actually received — method, path, headers — plus a leak guard
across 200/401/429/500, and that an empty key never reaches the network at all.

## REQUIREMENTS, ANSWERED

| Requirement | Status |
|---|---|
| OpenAI via the secure configuration flow | **Yes** — key → `aiConfig:setCredential` → `safeStorage` vault; never in `ai-config.json`, never returned to the renderer (DTO carries booleans), never in `audit.log` |
| Anthropic via the same flow | **Yes** — identical path |
| Ollama as local provider | **Code-sound; NOT live-verified here** — see below |
| Install only when appropriate, never silently overwrite | **Already correct, unchanged.** There is no installer. The "get Ollama" affordance is `shell.openExternal` to ollama.com/download — a *guide*. Model pull is an explicit user action against the user's own local service, tag passed as a JSON field, never through a shell |
| Selection / validation / testing / errors / loading / fallback | Validator hardened + socket-proven; the `local_only` clamp is pinned at a real socket by the pre-existing `providerWireIntegration.test.ts` and is untouched |
| Never hardcode keys | **Verified.** Repo-wide scan for `sk-`/`sk-ant-` literals across `apps/desktop/src`: one hit, `supportBundle.test.ts:39`, a fixture literally named `fixture` asserting that `redactText` redacts it |

## REMAINING — stated, not worked around

1. **Ollama is installed on this machine but the service is NOT running**
   (`/opt/homebrew/bin/ollama`, client 0.30.7; `curl 127.0.0.1:11434/api/tags`
   returns nothing). So the local provider is **code-verified, not
   live-verified** in this session. Earlier rounds recorded a live llama3.1
   answer; that cannot be re-confirmed now.
2. **Cloud-live completions remain unverified** — they need real Anthropic and
   OpenAI keys, which are an external dependency. The gated tests exist and
   **skip rather than fake**: 3 skipped in `liveProviderVerification.test.ts`.
3. **Recorded, not fixed** (found during review, outside this fix's scope):
   ~~`aiConfig:test` is a PUBLIC unauthenticated channel that falls back to the
   stored vault key and makes a live provider call — a key-validity oracle and
   unmetered spend, though it cannot exfiltrate the key;~~ **CLOSED
   2026-08-31** — the channel is now gated at `org:manage` and removed from
   `PUBLIC_CHANNELS`. (`cloud:operate`, its credential-writing siblings' lock,
   was tried first and reverted: it is platform-only, so it would have put the
   channel's bare localhost Ollama probe behind platform-operator authority —
   the same D-5 trap `AiConfigPullModel` already avoided.) Reproduced first,
   then pinned by
   `ai/aiConfigTestAuthority.test.ts`. The vault fallback is deliberately kept,
   because Settings legitimately tests an already-saved key. See
   `AI-CONFIG-TEST-AUTHORITY-EVIDENCE.md`. The superseded statement is kept
   visible rather than deleted (§2 #21).
   **Still open:** `resetToEnvironment` deletes only the Anthropic credential,
   so a stored OpenAI key survives a "reset"; a `safeStorage`-unavailable save
   fails silently with the typed key discarded and no error shown.

**No gate row is marked PASS by this document.** The credential-leak defect is
fixed and pinned; local and cloud live verification remain outstanding.
