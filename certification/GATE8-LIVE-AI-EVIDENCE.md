# GATE 8 — LIVE AI PROVIDER VERIFICATION

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `b356682` (Gate 12)
**Scope:** Gate 8 only — re-verify the live-provider production path; run the existing verification suites;
find/fix any genuine defect; characterize precisely what is verified vs. what is operator-gated. No production
code was changed (no defect was found).

---

## THE PRODUCTION PATH — INDEPENDENTLY RE-VERIFIED (no defect found)

`ai-config → Secure Vault → consent → tenant clamp → planRoute → PrivateFirstClient → provider client → HTTP →
provenance`. An independent read of every file in the chain confirmed all seven safety properties, each with an
enforcing site and each proven at a real socket by the always-on wire test:

| # | Property | Verdict | Enforcing site |
|---|---|---|---|
| 1 | **Tenant clamp** `min(platform, tenant)` at ROUTE time (not just display); `local_only` forces local even with a cloud config + both keys present | PASS | `providerManager.ts:132-133` (`resolveEffectiveAiMode` on the resolved pref) → `planRoute`; `aiRouting.ts:105-127, 273-280`. Single assembly site shared with Settings display. |
| 2 | **Consent** — private_first falls back local→cloud ONLY with consent; refuses external without it, fail-closed (no request, honest provenance) | PASS | `providerManager.ts:138`; refusal → empty routes → `PrivateFirstClient.isConfigured()` false → deterministic fallback, no network (`privateFirstClient.ts:70-77`, `aiEngine.ts:94-105`). |
| 3 | **Provenance** stamped by EXECUTION, never config; "external" label ⇔ cloud URL, "local" ⇔ loopback, cannot diverge | PASS | `privateFirstClient.ts:93-105`; Claude client posts only to hardcoded `https://api.anthropic.com` (`claudeClient.ts:10,55`); refused/failed → `location:'none'` (`aiEngine.ts:203`). |
| 4 | **Fail-closed boot** — boot router unconfigured even with env keys; boot-window request → deterministic fallback, provenance `none`; failed reconfigure parks fail-closed (not fail-open external) | PASS | `provider.ts:59-72`, `engineInstance.ts:16`, `engineManager.ts:73-80`, `runtimeCore.ts:798`. |
| 5 | **Secret handling** — key read from vault, passed only into the client as a header; never returned to renderer, never in provenance/response, never logged; 401 surfaces its reason without the key | PASS | `providerManager.ts:31-36,226-229`; `getConfig` exposes only `hasStoredKey` booleans (`aiConfigIpc.ts:101-115`); `assertHeaderSafeApiKey` + `redactProviderError` (`apiKeyGuard.ts:44-94`); `logger.ts` redaction. |
| 6 | **Vault** — safeStorage-encrypted at rest, mode 0600, atomic write, corrupt-quarantine; NO plaintext fallback; not committed | PASS | `secureStore.ts:39-59,83-91,128-153`; `vault.bin` in Electron userData; `.env*` gitignored. |
| 7 | **Single production entry** — `buildModelRouter` is the sole site that reads config+vault and builds provider clients; no second ungated cloud-client path | PASS | `providerManager.ts:214-246` called only by `engineManager.reconfigure`; the bare builders have no production caller (tests/smoke only). |

**Verdict:** production path correct and safe. **No genuine code defect found → no production code changed.**
One mitigated boot-window race (tenant unresolved → platform mode for a sub-second window before the UI is
interactive; boot router fail-closed throughout; reconfigure fires on tenant-recovery, workspace-switch, and
preference-set — `engineManager.ts:41-57`) is recorded as OPTIONAL defense-in-depth, not a defect. It is a
reasoned single-tenant-correct tradeoff; changing it risks breaking single-tenant installs, so per "do not
redesign working code" it is left as-is and documented.

## TESTS RUN (this environment — offline / no keys)

| Suite | Result |
|---|---|
| `providerWireIntegration.test.ts` (always-on cloud WIRE proof — real localhost sockets speaking the Anthropic/OpenAI/Ollama protocols through the full chain) | **7/7** |
| `liveProviderVerification.test.ts` (env-gated live) | **1 passed / 3 skipped** — the 3 live cases skip HONESTLY (no keys / no Ollama), never faked, exactly as designed |
| `privateFirstRouting.test.ts` | **19/19** |
| `bootWindowRouter.test.ts` | **4/4** |
| All `src/main/ai/` | **26 files / 258 passed / 3 skipped** |
| `src/main/tenancy/` + `src/main/ipc/` | **98 files / 1363 passed** |
| `tsc` node | **exit 0** |
| ESLint `src/main/ai` | **clean** |
| `electron-vite build` | **exit 0** |

The always-on wire proof (`providerWireIntegration.test.ts`) is the strongest offline evidence: at a REAL socket
it proves `local_only` with both cloud keys in the vault produces ZERO cloud requests, the tenant clamp holds at
the wire, private_first falls back local→cloud only WITH consent (and names the failed local attempt), refuses
without consent, and a 401 surfaces its reason with the key absent from the response.

## WHAT IS VERIFIED vs. WHAT IS OPERATOR-GATED

- **Ollama / local inference — GREEN (LIVE).** A real local inference through the full production chain
  (ai-config → Vault → tenant clamp `local_only` → planRoute → PrivateFirstClient → running Ollama `llama3.1`)
  completed with execution-stamped provenance `{location:'local', provider:'ollama', mode:'local_only'}` and real
  token counts — `liveProviderVerification.test.ts`, `NP_LIVE_AI=1`, 2026-08-14. (Not re-runnable in this Linux
  sandbox: no Ollama daemon here — `127.0.0.1:11434` ECONNREFUSED.)
- **Cloud path (Anthropic + OpenAI) — code + wire GREEN.** The full chain is re-verified in code (table above)
  and proven at a real socket against the exact vendor protocols (wire test 7/7).
- **Cloud LIVE completion (real Anthropic + OpenAI) — OPERATOR-GATED, ABSENT here.** A real completion requires
  real vendor API keys. Per the app's design (and the safety rules), keys are supplied by the operator through
  the Secure Vault / provider Settings — or, for the gated test, via env vars in the operator's own shell. **This
  environment has no keys and must not handle them, so the live-cloud cases skip (recorded as ABSENT evidence,
  never a pass).** Provider **egress is confirmed available** here (`api.anthropic.com:443` and
  `api.openai.com:443` both reachable), so the ONLY missing input for cloud-live is the operator's keys.

## OPERATOR RUNBOOK — cloud-live completion (flips the last item to LIVE)

On a machine with real keys and egress (keys never committed; the command reads them from the operator's env and
the test writes them into the encrypted Vault via `credentialStore.setSecret`, the real production path):

```bash
cd apps/desktop
NP_LIVE_AI=1 ANTHROPIC_API_KEY=<real> OPENAI_API_KEY=<real> \
  npx vitest run src/main/ai/liveProviderVerification.test.ts
```

Expected: the Anthropic and OpenAI cases each complete with non-empty text and
`routing: { location:'external', provider:'anthropic'|'openai' }` (execution-stamped provenance). Capture the run
output as the cloud-live evidence and update this row to GREEN.

## GATE 8 RESULT

**YELLOW (unchanged) — code path fully re-verified, local-live GREEN, cloud wire GREEN; cloud-live remains
operator-gated (real keys).** No defect was found and nothing was weakened. The residual is genuinely
external — it needs the operator's paid API keys entered through the Secure Vault, which cannot be performed (or
faked) in this sandbox. This is the same external-blocked shape as the S15 real-send ceremony and the Windows
gates: the engineering is done and verified; the final live proof is one operator command away.
