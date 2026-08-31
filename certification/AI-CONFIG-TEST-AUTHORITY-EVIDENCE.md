# AI CONFIG TEST — AUTHORITY BOUNDARY

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `75a8b3c`
**Scope:** the authority classification of `aiConfig:test` only. No tenancy, consent, vault,
fail-closed or provider-security behaviour is weakened, and the other issues recorded in the AI gate
are deliberately untouched.

---

## THE DEFECT

`IpcChannel.AiConfigTest` was classified `'PUBLIC'` in `ai/aiAuthzGate.ts` and listed in
`PUBLIC_CHANNELS` in `ipc/runtimeAuthz.ts`, so `withAiAuthz` stamped its handler with **neither
`requireAuth` nor `permission`**. The handler falls back to the stored vault credential:

```ts
// aiConfigIpc.ts:394-410
const key = req.secret || (await credentialStore.getSecret(OPENAI_CREDENTIAL_ID))
          || process.env.OPENAI_API_KEY || '';
return validateOpenAiKey(key);
```

and then makes a **real request to `api.openai.com` / `api.anthropic.com`**. A caller with no session
could send `{provider:'openai'}` with no secret and learn whether the install's stored key is valid —
without ever possessing it — and bill the owner for every attempt.

**Two harms:** a key-validity **ORACLE** and unmetered **SPEND**.

**Bounded honestly:** the response is `{ok, detail, latencyMs}`, so the key itself could never be
read back. This closes the oracle and the spend. **It was not a key-exfiltration hole and is not
described as one.**

### Reproduced BEFORE any code was changed

The test file was written first and run against the unmodified tree. Four failures, verbatim:

```
→ aiConfig:test must declare a permission: expected undefined not to be undefined
→ promise resolved "{ ok: true, …(2) }" instead of rejecting
→ promise resolved "{ ok: true, …(2) }" instead of rejecting
→ expected [ …(2) ] to deeply equal []
```

The material two are the third and fourth: an **unauthenticated** caller received `ok: true` from the
oracle, and **2 outbound requests left the machine** on calls that should have been refused. A
counting `fetch` stub makes spend measurable rather than argued.

## THE FIX — `org:manage`, and the first attempt was wrong

**Two sites, because they must agree.** `runtimeAuthz` refuses a channel that is *both* gated and on
the allowlist (`ipc/runtimeAuthz.ts:1308-1310` — *"A channel is open or it is guarded; a stale
allowlist row is a false ..."*), so a one-sided edit would either leave the hole open or fail the
startup classification check at `runtimeCore.ts:4095-4106`.

| Site | Before | After |
|---|---|---|
| `ai/aiAuthzGate.ts` | `'PUBLIC'` | `'org:manage'` |
| `ipc/runtimeAuthz.ts` `RUNTIME_CHANNEL_PERMISSIONS` | absent | `'org:manage'` |
| `ipc/runtimeAuthz.ts` `PUBLIC_CHANNELS` | listed | **removed** |
| `ai/aiConfigIpc.ts` def | no `audit` | `audit: true` |

### The first attempt chose `cloud:operate` and that was a regression

The obvious choice was the lock the credential-**writing** siblings carry — `AiConfigSetProvider`,
`AiConfigSetCredential`, `AiConfigResetToEnv`, `AiConfigMigrate` are all `cloud:operate`. It reads as
the conservative option. **It was wrong, and an independent review caught it.**

`testConnection` short-circuits before any credential is touched:

```ts
// aiConfigIpc.ts:395
if (req.provider === 'ollama') return validateOllama(ollamaBaseUrl());
```

That branch is a bare `GET http://localhost:11434/api/tags` — **no vault read, no cloud host, no
spend, no oracle**. And `cloud:operate` is in `PLATFORM_ONLY_PERMISSIONS`
(`packages/shared/src/types/enterprise.ts:370`), which **no organization role can hold**: the only
satisfier is `PlatformOperatorRegistry.isOperator`, seeded solely from
`NEUROPAUSE_PLATFORM_OPERATORS` or `<userData>/platform-operators.json`, and **nothing in the product
seeds either**.

So the first fix put a **localhost probe behind platform-operator authority**. On a default install
`detectOllama` (PUBLIC) and `pullModel` (`org:manage`) would keep working while **Test Connection
alone failed, on the same screen, for the same local server** — including for every S17 local-first
user, whose device-local principal passes `requireAuth` and is then refused at the permission check.

**This is a trap the file itself already documented, twelve lines above the row I edited**
(`aiAuthzGate.ts:101-108`), where `AiConfigPullModel` was given `org:manage` and not `cloud:operate`
for precisely this reason: *"the LOCAL-AI setup path first-run needs, so it takes the same authority
as the tenant preference write rather than `cloud:operate` (which no organization role can hold —
the D-5 trap)."* The corrected fix takes the same authority for the same path and the same reason.

### What `org:manage` buys, and what it does not

- **It closes the reported defect.** The caller must be a real principal holding org-management
  authority, so an untrusted or unauthenticated renderer can no longer drive the oracle or the spend.
- **It does not reach `cloud:operate` parity on the cloud branch** — an org manager can still
  validity-probe a stored key. **Recorded, not hidden.** It is also consistent with how this product
  already gates credential-spending AI paths: `m365Draft` runs a *full completion* against the same
  vault key under `connectors:read` (`connectors/index.ts:736-742`, `m365/aiDrafts.ts:38`).

### The vault fallback is deliberately KEPT

Settings sends `keyInput.trim() || undefined` (`AiSettingsPanel.tsx:125`), so testing an
**already-saved** key legitimately depends on it. Deleting it would close the oracle by breaking the
feature. Gating the channel closes it while the real workflow keeps working.

### Two stale statements corrected in the same change

1. **`aiAuthzGate.ts`'s own justification** read *"`aiConfig:test` validates a candidate credential
   and PERSISTS NOTHING"*. It was **wrong about the code** — the handler tests a candidate only when
   one is supplied, otherwise the **vault's**. *Non-persisting* was also the wrong axis: reading a
   secret and spending against it needs no write to be consequential.
2. **`tenancy/channelAuthorityTenancy.test.ts`** listed the channel in `STILL_PUBLIC`, asserting
   `PUBLIC_CHANNELS.has(channel) === true` — the test **encoded the earlier decision as a
   requirement**, so the finding could only surface by changing the test. The file already documents
   that mechanism for `EngineeringAnalyze` at ROUND 13 M-14, and the row is removed **with its
   reason**, following that precedent.

## FILES CHANGED

```
NEW  src/main/ai/aiConfigTestAuthority.test.ts        10 pins — reproduction, regression, boundary
MOD  src/main/ai/aiAuthzGate.ts                       PUBLIC → org:manage; stale justification corrected
MOD  src/main/ipc/runtimeAuthz.ts                     gated map += channel; PUBLIC_CHANNELS -= channel
MOD  src/main/ai/aiConfigIpc.ts                       audit: true on the def
MOD  src/main/tenancy/channelAuthorityTenancy.test.ts STILL_PUBLIC row removed, with reason
```

`testConnection`, the validator, the vault and the provider clients are otherwise **byte-untouched**.

## TESTS AND CHECKS

| Check | Result |
|---|---|
| `aiConfigTestAuthority.test.ts` | **10/10** (4 failing before the fix) |
| Whole `src/main/ai/` suite | **26 files / 258 passed / 3 skipped** |
| Classification suites (`channelAuthorityTenancy`, `runtimeAuthz`, `round10PrincipalsChannels`, `dataPlane/wiring`) | **117 passed** |
| `ai/` + `ipc/` + `tenancy/` | **1619 passed / 3 skipped** |
| Full main suite | **917 files / 9579 passed / 7 skipped** (from 916/9569/7 — delta **+1 file / +10 tests**, exactly the new file) |
| `tsc` node / web | **exit 0 / exit 0** |
| `eslint src` | 1 error, **pre-existing**, in frozen `cst/sendTransition.negative.test.ts:16` — untouched here (`git diff` on that path is empty) |
| `electron-vite build` | **exit 0**, 2.89s |
| `gate-detector.sh` | **PROCEED** on all five edited paths |

**Negative control 1 — the lock closes the hole.** The gate alone reverted to `'PUBLIC'` *while
leaving the `PUBLIC_CHANNELS` removal in place* ⇒ **4 of 8 pins fail** ⇒ restored ⇒ green. The
isolation shows the **lock** does the work and the allowlist edit alone would not have.

**Negative control 2 — the regression pin is load-bearing.** The authority reverted to the
platform-only `cloud:operate` ⇒ **10 of 10 pins fail** ⇒ restored ⇒ **10/10**.

Both controls restored **byte-identical by sha256**.

**Every authority assertion drives the real `createAuthorize`.** An earlier draft used
`authorize: () => undefined` — a stub that grants unconditionally — which made "the workflow still
works" unfalsifiable and hid the localhost regression completely. That is CLAUDE.md §2 #27: the
expectation must come from the consumer, never from a permitter the test invented. The review found
it, and it is now fixed rather than noted.

**The build wrote to a temporary `--outDir`, since removed;** `out/` was not modified by it
(`out/main/index.js` mtime `14:31:26` predates the build).

## FINDINGS RECORDED, DELIBERATELY NOT FIXED

Surfaced by the independent review. **In scope to record, out of scope to fix** — each needs its own
gate, and one is larger than the defect this document closes.

1. **`assistant:ask` is `PUBLIC` and reaches the same vault key.** `runtimeAuthz.ts:1167`; the
   handler def at `assistant/index.ts:544-561` carries no `permission` and no `requireAuth`;
   `assistant/index.ts:334` is `runAi: (req) => aiEngine.run(req)`, which resolves to the same
   `credentialStore` secrets via `providerManager.ts:31-36` and reaches
   `api.anthropic.com/v1/messages` / `api.openai.com/v1/chat/completions`. **This fix closed a
   `/v1/models` probe while an unauthenticated *completion* against the same key remains open** —
   strictly more billable, and it also carries context outward. Honest bound: unlike `testConnection`
   this path is **conditional** (`providerManager.ts:138` external-consent gating, route planning,
   and deterministic short-circuits in `assistantService`), and it was **not executed**. *Confirmed:
   no authority check stands between the channel and `aiEngine.run`. Not established: whether a given
   unauthenticated ask reaches the model on a specific install.*
2. **`m365Draft` spends the same key under `connectors:read`** (`connectors/index.ts:736-742` →
   `m365/aiDrafts.ts:38`) — a Member-level read scope drives a full completion.
3. **Two unauthenticated key-*existence* oracles remain** (neither validity nor spend):
   `aiConfig:get` returns `storedKeys` (`aiConfigIpc.ts:101-115`), and `aiConfig:migrationStatus`
   returns `envHasKey` (`migrationManager.ts:36`).
4. **The five non-IPC dispatchers produce no `audit.log` line.** Audit and denial stamping live
   inside the `ipcMain.handle` closure (`secureBridge.ts:188`, `:194`, `:218-220`), while the
   companion gateway, REST gateway and sandbox wirings call `runSecureHandler` directly. The
   permission gate itself is enforced identically on all of them (same def object, same deps).
5. **`ipc/router.ts:140-157` is a parallel ungated dispatch table** outside the
   `runtimeCore.ts:4095` classification invariant. It holds **no** AI or Assistant channel, so it
   does not affect this fix.
6. **A refusal now files a governance HOLD.** `createAuthorize` calls `recordRefusal` before throwing
   on the platform-only branch (`authzGate.ts:288`); under `org:manage` this applies to refused
   callers generally, deduped by subject.

Also still open from the prior AI gate, unchanged: `resetToEnvironment` deletes only the Anthropic
credential, so a stored OpenAI key survives a "reset"; a `safeStorage`-unavailable save fails
silently.

## WHAT THIS DOES NOT CLAIM

- It closes an **oracle and spend**, not key disclosure — there was no key-disclosure path here, and
  the review confirmed the response and error paths carry no key material (`connectionValidator.ts`
  returns fixed literals or `HTTP ${status}`; `timeBoxed`'s catch substitutes a fixed string).
- It does **not** claim parity with `cloud:operate`; see "what `org:manage` buys, and what it does
  not".
- **No live provider call was made in verification.** Every test counts outbound requests against a
  stubbed `fetch`; no real key was used and nothing was spent.
- No gate row is marked PASS by this document.
