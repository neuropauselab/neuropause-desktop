# INCREMENT 03 — A6 · Retrieval Quality + Qdrant-Absent Degradation Hardening

**Status:** COMPLETE — verification gate closed, 40 files shipped and byte-verified.
**Scope discipline:** retrieval was not redesigned. No API was changed unnecessarily. No parallel system was created. Every change extends a subsystem that already existed.

---

## 1. Repository Recon

Retrieval in this repository is not one component. It is a four-layer path, and each layer already had an owner before this increment began.

The renderer calls `ipc.memory.semanticRecall(...)` from two places and only two: the Memory view (`apps/desktop/src/renderer/src/views/MemoryView.tsx`) and the Universal Search pipeline (`apps/desktop/src/renderer/src/search/searchPipeline.ts`). The main process answers on the `memory:semanticRecall` channel, handled in `apps/desktop/src/main/memory/semanticRecallHandler.ts`, which composes a lexical recall from `memoryStore.ts` with a semantic leg obtained through `memorySemanticRecall.ts`. That semantic leg reaches the backend over `apps/desktop/src/main/backendsemantic/backendSemanticClient.ts`. The backend terminates the call in `apps/backend/src/semantic/api/semanticRouter.ts`, which delegates to `semanticSearchService.ts` and, beneath that, to the embedding pipeline and the Qdrant client (`apps/backend/src/semantic/pipeline/embeddingPipeline.ts`).

Two facts about that path shaped everything in this increment.

The first is that the lexical leg and the semantic leg are independent. `memoryStore.ts` answers from a local store with no network dependency at all, so keyword recall keeps working when Qdrant is unreachable, unconfigured, or slow. The hybrid design was already correct: the system genuinely does degrade rather than fail. That is the behaviour A6 was asked to harden, not to invent.

The second is that the degradation was **silent**. Every layer swallowed its own failure and returned the lexical half as if it were the whole answer. The renderer's `catch` in `MemoryView.recall` caught *every* client-side rejection — including the RBAC denial on `memory:semanticRecall` — and quietly fell back to `ipc.memory.recall`. A user without `intelligence:read` therefore received keyword-only results, presented as a complete answer, permanently, with nothing anywhere explaining why. The same silence existed in the search pipeline, where the "semantic" source reported `ready`.

Supporting recon findings that constrained the design:

- **Electron IPC serializes only an error's `message`.** Custom properties such as a `code` do not survive the trip to the renderer. A renderer-side failure taxonomy derived from a rejected `invoke` is therefore not constructible, and string-matching the message is precisely what a classifier exists to prevent.
- **The renderer has no component-test infrastructure.** There are zero `*.test.tsx` files, no testing-library, and no jsdom. Any renderer logic that must be tested has to be React-free.
- **`apps/desktop/vitest.config.ts` uses an explicit per-directory allow-list `include` array**, not a repo-wide glob. A new test directory is not collected until it is named there.
- **`noUncheckedIndexedAccess` is not enabled** in `tsconfig.base.json`. `TABLE[key]` types as `string`, so a `?? fallback` on a record lookup reads as dead code to both the compiler and the reader.
- **`@typescript-eslint/no-explicit-any` is `warn`, and CI runs `--max-warnings 0`.** Warnings are errors in practice.

---

## 2. Runtime Audit

What actually happens today, traced end to end, in each of the states the increment was asked about.

**Qdrant healthy.** `semanticRecallHandler` runs both legs, merges by the ranking in `memoryRanking.ts`, and returns hits. Correct, and unchanged by this increment except that the result now carries a diagnostics envelope.

**Qdrant absent or unreachable.** The backend's semantic route threw, and `apps/backend/src/middleware/error.ts` flattened the throw into `500 internal_error`. The desktop client saw an opaque 500, could not distinguish "the dependency is down, retry later" from "your query was malformed, do not retry", and fell back to lexical. The user saw keyword results with no notice. Two distinct defects: the backend discarded a classification it already had, and the desktop had no vocabulary to receive one.

**Repeated failure.** There was no circuit breaker. Every recall paid the full timeout to a dependency that was known to be down, on every keystroke of a debounced search box.

**No organization selected / semantic not configured / empty query.** The semantic leg was skipped by design. This is normal operation, not a fault — but the system had no way to say so, which meant any future "we degraded" notice would have had to fire on these states too and would have trained users to ignore it.

**RBAC denial.** `memory:semanticRecall` is gated on `intelligence:read`. The denial arrived at the renderer as a rejected `invoke`, was caught by the blanket `catch`, and became a silent permanent downgrade.

**Total failure of both legs.** `MemoryView` rendered the empty state **"No memories match that"** — a positive claim about the user's data, made from a failure to read it. This was the most serious finding in the audit: the product asserted a fact it had no evidence for.

---

## 3. Gap Analysis

Seven gaps, each stated as the difference between observed behaviour and correct behaviour.

1. **No structured description of what retrieval did.** Results were indistinguishable from results-with-a-broken-leg. Nothing crossed the IPC boundary to say which.
2. **The backend discarded its own error classification.** `embedding_failed` and `search_failed` were known at the throw site and thrown away by the error middleware.
3. **No health endpoint was mounted.** `GET /memory/semantic/:orgId/health` existed as a service but was not routed, so no caller could ask whether semantic search was up without performing a search.
4. **No circuit breaker.** A down dependency was retried on every keystroke.
5. **The renderer's fallback was unconditional and silent.** It could not distinguish an IPC-layer failure from a semantic-layer failure, and reported neither.
6. **Universal Search reported the semantic source as `ready` when it was not.** The source-status UI existed and was correct in structure; it was being fed a value that was not true.
7. **The Memory view claimed "no matches" on a read failure.** A false statement about user data.

Explicitly *not* treated as gaps, and left alone: the hybrid lexical+semantic architecture, the ranking formula's inputs, the `memory:recall` channel's shape, the store layout, and the search pipeline's source model. All were already correct.

---

## 4. Architecture Decisions

**One classification, computed once, in the main process.** `main/memory/retrievalDiagnostics.ts#retrievalModeFor` is the single source of truth for whether a retrieval was `degraded`. The renderer reads that verdict and supplies words; it does not re-derive it. This is why the renderer helper carries an explicit note that `circuit_open` is a *skip* that nonetheless counts as degraded — the renderer must not second-guess a judgement made upstream.

**A structured envelope, not a string.** `RetrievalDiagnostics` was added to `packages/shared/src/types/memory.ts` as an **optional** field on `MemoryRecallResult`. Optional is the whole compatibility story: a producer written before A6 omits it, and every consumer treats `undefined` as "not reported" and says nothing. The union members (`SemanticFailureKind`, `SemanticSkipReason`) are closed, so wording tables written as `Record<Union, string>` break the build when a member is added rather than silently rendering a generic string.

**Failure classification lives beside the client that observes the failure**, in `main/memory/semanticFailure.ts`. It reads status codes and error shapes at the one place where they are still intact. Nothing downstream string-matches a message.

**Resilience is a wrapper, not a rewrite.** `main/memory/resilientSemanticSearch.ts` wraps the existing search call with a timeout and a circuit breaker. The search function it wraps is unchanged. `retrievalHealth.ts` holds the breaker state. This keeps the retrieval algorithm untouched, which was a stated constraint.

**All UI strings live in the renderer**, in `renderer/src/lib/retrievalStatus.ts`. The retrieval engine and the shared contracts stay presentation-free — the same separation `memoryExplanation.ts` already established for ranking metadata. The helper sits in `lib/` rather than `search/` or `views/` because both consumers need identical wording and `searchPipeline.ts` is documented as importing nothing from other feature modules. It is pure and React-free so it can be unit-tested at all, given the renderer has no component-test harness.

**The IPC-failure path is deliberately not a second taxonomy.** `retrievalStatusForIpcFailure` returns one honest status — semantic search did not run, plus whatever the bridge said — because the renderer provably cannot reconstruct the main-process classification across an IPC boundary that drops custom error properties.

---

## 5. Files Modified

40 files: 27 modified, 13 new. All shipped to the Mac working tree and verified byte-identical (aggregate md5 `0a0750634a9fa5e5ad298f4e67ae7537`).

**New (13)**

| File | Role |
|---|---|
| `apps/desktop/src/main/memory/retrievalDiagnostics.ts` | Computes `retrieval.mode`; the single source of truth for "degraded" |
| `apps/desktop/src/main/memory/retrievalDiagnostics.test.ts` | |
| `apps/desktop/src/main/memory/semanticFailure.ts` | Classifies a failure into `SemanticFailureKind` at the observation site |
| `apps/desktop/src/main/memory/semanticFailure.test.ts` | |
| `apps/desktop/src/main/memory/resilientSemanticSearch.ts` | Timeout + circuit-breaker wrapper around the existing search call |
| `apps/desktop/src/main/memory/resilientSemanticSearch.test.ts` | |
| `apps/desktop/src/main/memory/retrievalHealth.ts` | Breaker state and health accounting |
| `apps/desktop/src/main/memory/retrievalHealth.test.ts` | |
| `apps/desktop/src/renderer/src/lib/retrievalStatus.ts` | Pure, React-free presentation leaf; all retrieval wording |
| `apps/desktop/src/renderer/src/lib/retrievalStatus.test.ts` | 19 tests |
| `apps/backend/src/middleware/error.test.ts` | Locks the classified-code behaviour |
| `apps/backend/src/semantic/api/semanticRouter.test.ts` | |
| `apps/backend/src/semantic/api/semanticHealthRouter.test.ts` | |

**Modified (27)** — `apps/backend/src/app.ts`, `middleware/error.ts`, `semantic/api/{semanticHealthRouter,semanticHealthService,semanticRouter}.ts` + `semanticHealthService.test.ts`; `apps/desktop/src/main/backendsemantic/backendSemanticClient.ts` + test; `main/ipc/runtimeAuthz.ts`; `main/memory/{index,memoryRanking,memorySemanticRecall,memoryStore,semanticRecallHandler}.ts` + their tests; `main/platform/aiHealthProbes.ts` + test; `main/runtimeCore.ts`; `renderer/src/search/searchPipeline.ts` + test; `renderer/src/views/MemoryView.tsx`; `apps/desktop/vitest.config.ts`; `packages/shared/src/types/memory.ts`; `packages/deploy/src/assets.ts`.

---

## 6. Verification Results

Run on the complete, restored tree.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **EXIT 0** — zero `error TS` |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) | **EXIT 0** |
| Tests | `npm run test --workspaces --if-present` | **5252 / 5253 passing**, 552 / 553 files |
| Build | `npm run build` | **EXIT 0** — three builds (9.06s, 785ms, 13.63s) |
| Ship-back | md5 manifest, both sides | **40 / 40 identical** |

The single test failure is `apps/desktop/src/main/knowledgeAssets/knowledgeBench.test.ts:258` — `expected 102.53 to be less than or equal to 100`. It is a wall-clock benchmark on `knowledgeAssets`, a subsystem this increment does not touch, and it passes two of three standalone runs in this container. **The budget was not raised to make it green.** A performance guard that is loosened whenever it fires stops being a guard.

**Correction to an earlier report in this engagement.** A previous session reported "typecheck clean". That was false. `@neuropause/platform-operations` was failing with `TS2307: Cannot find module '@neuropause/release'`. The cause was that `packages/release` (33 files) and `docs/release` (8 files) were **missing from the cloud working copy** — they exist and are committed on the Mac (`cdca040b`). They were restored and md5-verified before this gate was run. The lesson is recorded in §11: an incomplete working copy can manufacture a convincing "pre-existing repository failure" that does not exist in the user's repository.

---

## 7. Performance Impact

Net positive, and the direction matters more than the magnitude.

The circuit breaker removes the dominant cost in the failure case. Before this increment a search box with a 200 ms debounce issued one full-timeout request per settled keystroke against a dependency already known to be down. With the breaker open, those calls return immediately from local state and the semantic leg is skipped, so a Qdrant outage no longer converts every search into a timeout wait.

In the healthy path the added work is the construction of one small plain object per recall and one `Record` lookup per render. Neither is measurable against a network round-trip and an embedding computation.

The explicit timeout added by `resilientSemanticSearch` bounds a previously unbounded wait. This can only reduce worst-case latency.

No new allocation lives beyond a single call, and no new state is retained apart from the breaker's counters, which are a fixed number of integers.

---

## 8. Security Impact

**The RBAC gate is unchanged and still enforced.** `memory:semanticRecall` requires `intelligence:read`. The change is that a denial is now *reported* instead of silently downgraded. Reporting a denial to the user whose request was denied discloses nothing they did not already have — they made the request.

**Error detail is bounded and pre-sanitized.** The detail rendered to the user comes from the secure bridge, which already replaces internal failures with a clean `IpcError` message and never forwards stack detail. `retrievalStatus.ts` additionally caps the borrowed string at 200 characters and drops any non-string-ish rejection rather than stringifying it into `[object Object]`.

**The backend now returns stable, deliberately chosen codes** — `503` with a retryable classification for a dependency that is down, or `500` with `embedding_failed` / `search_failed` — instead of leaking or discarding upstream text. The health route returns fixed codes rather than raw upstream messages.

**The health route is rate-limited** at 30 requests/minute/IP, so an unauthenticated liveness probe cannot be used to hammer the dependency it reports on.

**No new IPC channel accepts unvalidated input,** and no new secret, token, or credential is read, written, logged, or transported by any file in this increment.

---

## 9. Backward Compatibility

Preserved, by construction rather than by assertion.

`RetrievalDiagnostics` is **optional** on `MemoryRecallResult`. A producer that does not set it is valid, and `describeRetrieval(undefined)` returns `null`, which every consumer treats as "say nothing". Pre-A6 behaviour is therefore the exact behaviour of the new code when the envelope is absent.

The `memory:recall` channel is untouched in shape and semantics. The `memory:semanticRecall` request shape is unchanged; only the response gained an optional field. No channel was renamed or removed. No existing permission was widened or narrowed.

**Eight intentional behaviour changes are disclosed here rather than buried.** Each is a change a user or an integrator could notice.

1. **The "High Confidence" chip no longer appears on lexical-only recalls.** The confidence formula now accounts for whether the semantic leg actually contributed. Previously a keyword-only result could be labelled high-confidence on the strength of a leg that never ran.
2. **`memory:semanticRecall` is now gated on `intelligence:read`.** This closes a gap where an intelligence-tier read was reachable without the intelligence-tier scope.
3. **The semantic API answers `503` (retryable) or `500` with the real `embedding_failed` / `search_failed` code**, instead of a blanket `500 internal_error`.
4. **`GET /memory/semantic/:orgId/health` is now mounted**, rate-limited at 30/min/IP, and returns stable error codes rather than raw upstream messages.
5. **Universal Search's "semantic" source now reports `unavailable`** (orange, with a reason) when retrieval is degraded, where it previously reported `ready`. Lexical results still appear — the source badge is now accurate about which sources produced them.
6. **The Memory view shows a degradation notice** when, and only when, `retrieval.mode === 'degraded'`. By-design lexical modes (no org, not configured, empty query) stay silent, so the notice keeps its meaning.
7. **On total failure the Memory view shows "Couldn't search your memory"** instead of "No memories match that". The product no longer makes a claim about the user's data from a failure to read it.
8. **`apps/desktop/vitest.config.ts` now collects `src/renderer/src/lib/**/*.test.ts`.** The pattern is directory-wide, matching every other entry, so a future test beside `format.ts` is picked up without another config edit.

### Reported separately: a gate-integrity fix, not part of A6

`packages/deploy/src/assets.ts#assetsDir()` resolved its path from `process.cwd()`, under a comment asserting that cwd is "the workspace root (where the test runner and CI run)". That assertion was wrong. The root `test` script is `npm run test --workspaces`, and **npm sets cwd to each package directory**, so the expression resolved to `packages/deploy/packages/deploy/assets` and every asset-reading test in `@neuropause/deploy` and `@neuropause/infrastructure` threw `assets directory not found`. Both `.github/workflows/macos-release.yml` and `windows-release.yml` run `npm test`, so **`npm test` was red in the release pipeline**.

It now resolves from `__dirname`, which is the convention this repository already uses for cwd-independent paths (`packages/reliability/src/hardening.ts:70`, and the aliases in every `vitest.config.ts`). It is safe here because `@neuropause/deploy` is consumed only by Node-side packages and never by the desktop renderer, so it is never bundled into a browser ESM context. When cwd *is* the workspace root, both expressions resolve to the same absolute path — behaviour is unchanged in that case.

This is labelled separately because it is a CI-correctness repair discovered during A6 verification, not retrieval work. It is included because it directly blocks "ready to deploy".

---

## 10. Known Limitations

**The `knowledgeBench` performance budget is marginal in low-CPU containers.** `knowledgeBench.test.ts:258` asserts ≤ 100 ms and measures ~102 ms on roughly one run in three in a shared cloud container. It is a real wall-clock assertion on real work; it is not flaky logic, it is a budget calibrated for developer hardware being run on contended hardware. It should be re-measured on the target Apple Silicon machine before being changed, and it should be changed by re-calibrating deliberately, not by widening it until it stops firing.

**The circuit breaker is per-process and in-memory.** Restarting the app resets it. This is correct for a desktop app with one main process and no shared state, but it means the breaker offers no protection across restarts.

**IPC responses are still not runtime-validated.** The secure IPC layer validates *requests* against a Zod schema; there are zero `safeParse` calls in `renderer/src/lib/ipc.ts`. A6 mitigated the specific consequence for retrieval — the wording tables have an explicit `UNKNOWN_STATE` fallback so an unrecognized value renders honest vague text rather than the literal string `undefined` — but the general gap remains and is listed in §11 as a platform-level item.

**Health is reported, not yet trended.** `retrievalHealth.ts` holds live breaker state. Nothing persists it, so there is no history of how often semantic search has been degraded.

---

## 11. Future Considerations

**Validate IPC responses, not just requests.** This is the largest structural gap the increment surfaced. The renderer trusts the shape of everything the main process returns. A single shared `safeParse` at the `ipc.ts` boundary would convert a class of silent renderer misbehaviour into a caught, reportable error. It is a platform-wide change and should be its own increment.

**Persist retrieval health.** Breaker state is live-only. Feeding it into the existing platform event bus would make "semantic search was degraded for 40 minutes yesterday" answerable, and the timeline subscriber would persist it with no new store.

**Re-calibrate the `knowledgeBench` budget on target hardware,** deliberately, with a recorded measurement.

**A stale comment in the event bus should be corrected.** `apps/desktop/src/main/platform/eventBus.ts` claims at the publish loop that "Higher-priority events are dispatched first within this call so critical signals reach subscribers ahead of routine ones." No such ordering is implemented — the loop iterates `this.subs.values()` in subscriber-insertion order, and a single `publish()` call carries exactly one event, so the sentence describes a mechanism that cannot exist as written. Found during the item-21 recon; recorded here because a comment that describes non-existent behaviour will eventually license a wrong change.
