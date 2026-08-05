# INCREMENT 04 — A7 · The IPC Contract at the Renderer Boundary

**Status:** COMPLETE — all four gates closed. 51 files (6 new, 45 modified).
**Scope discipline:** the IPC pipeline was not redesigned. No channel was renamed, no handler was rewritten, no security stage was touched. The preload — the actual trust boundary — was not modified at all. Every change writes down a contract that already existed implicitly, and lets the compiler enforce it.

---

## 1. Repository Recon

The IPC boundary in this repository is well built on the request side and undescribed on the response side. That asymmetry is the whole of A7.

A renderer call enters through one preload bridge, `window.neuropause.invoke`, gated by `ALL_INVOKABLE_CHANNELS`. It lands in `main/ipc/secureBridge.ts`, which runs seven stages in a fixed order: sender-trust, authentication, RBAC permission, Zod `.strict()` request validation, timeout, audit, and error shaping. That pipeline is genuinely rigorous, and A7 changed none of it.

What it does not do is describe what comes back. `SecureHandlerDef.handler` returned `unknown`. The renderer's `invoke` returned `Promise<unknown>`. Every one of the ~630 methods on the renderer's `ipc` facade therefore ended in a hand-written assertion — `invoke(IpcChannel.X, p) as Promise<SomeShape>` — and nothing anywhere compared that assertion against what the handler actually returned. Two independent descriptions of one wire, on opposite sides of a process boundary, maintained by hand.

The push direction was worse. Every broadcast in the process funnels through a single primitive in `main/index.ts` — the only `webContents.send` anywhere — declared `broadcast(channel: string, payload: unknown)`. Each of the ~30 subsystems received that function as a dependency typed `(channel: string, payload: unknown) => void`, so at all 34 send sites the payload was contextually typed `unknown` and nothing about the value being sent was checked at all. The renderer then asserted a shape at each `subscribe` call.

Five of those channels were not merely unchecked but wrong by omission. `nps:progress`, `runtime:event`, `runtime:openApp`, `plugins:event` and `update:event` all originate from `node:events` emitters whose listeners are typed `(...args: any[]) => void`. The payload arrived at the send site as `any`, and `any` flows into `unknown` without complaint. `infra:event` was the sharpest case: `{ kind: 'resources', ...e }` with `e: any` collapses the entire object literal to `any`, discarding even the parts that had been written down correctly.

Three constraints from the existing repository shaped the design and are worth recording:

- **`apps/desktop/tsconfig.node.json` excludes `src/main/**/*.test.ts`.** Main-process test files are linted and run, but never typechecked. Any compile-time guard placed in a main test file is decorative.
- **`@typescript-eslint/no-explicit-any` is `warn`, and CI runs `eslint --max-warnings 0`.** Warnings are errors in practice, which is why the `any` leaks had to be fixed at their source rather than suppressed.
- **Electron IPC serializes only an error's `message`.** No custom property survives the trip to the renderer, so a renderer-side failure taxonomy cannot be derived from what the main process attaches.

---

## 2. Runtime Audit

Traced end to end, the undescribed response side produces four distinct classes of exposure. They were enumerated exhaustively before any code was written, because the size of each one decides the design.

**Category A — assertion disagrees with reality.** The renderer asserts shape `X`; the handler returns shape `Y`. Nothing catches it, and the renderer reads `undefined` off a field that was never sent. Two live instances were found, both documented in section 6.

**Category B — assertion is unstateable.** One channel serves two unrelated response shapes depending on its request, so no single type is correct. One instance: `kb:matrix`.

**Category C — structured-clone hazards.** A handler returning a value Electron cannot serialize (a class instance, a function, a `Map`) would throw at the boundary rather than at the type level. **Exhaustively audited: zero instances.**

**Category D — a handler resolving `undefined` under a non-void assertion.** **Exhaustively audited: zero instances.** No handler anywhere resolves to `undefined` while being cast to a non-void type.

That audit result is the single most important input to the architecture. C and D are the two failure modes that runtime response validation would catch and compile-time checking would not — and both are empty. What remains, A and B, is exactly what a type system catches for free.

---

## 3. Gap Analysis

The obvious increment was runtime Zod validation of responses, mirroring the request side. **It was designed, costed, and rejected.**

Validating responses means authoring roughly 1,990 new Zod schemas by hand from the existing TypeScript interfaces. Those schemas would be a *second description* of every response shape, hand-maintained alongside the first, with nothing keeping them in step. That is precisely the parallel system this engagement forbids — and it would recreate, at ten times the size, the exact defect it was meant to fix: two independent descriptions of one wire, free to drift.

It would also buy nothing measurable. Response validation's unique value is catching C and D, and the audit found zero of each. Against that, it adds a `safeParse` to every one of ~630 calls on the hot path.

So A7 closes the hole at **compile time** instead. One description, in the package both sides already import, checked by the compiler at both ends. The renderer cannot assert a shape the handler does not return, because the renderer no longer asserts at all.

The smallest increment that achieves this, and what was built:

1. A response map for the invoke direction, and the renderer's `invoke` made generic over it.
2. The main-process registration type made generic over the same map, so both ends answer to one source.
3. A broadcast map for the push direction, and the `broadcast` primitive made generic over it.
4. The `any` leaks fixed at their source, so the push map has real types to check.
5. The one duplicated contract collapsed into shared.
6. A runtime conformance guard for the one thing the compiler cannot reach.
7. Channel attribution on a rejected call.

---

## 4. Architecture

### The invoke direction

`packages/shared/src/ipc/responses.ts` (1,293 lines) declares `IpcResponseMap` — **629 channels**, each mapped to the type it resolves to. A compile-time guard rejects a key that is not an `IpcChannel` value, so a typo cannot sit in the map describing nothing while its channel looks uncovered.

The renderer's `invoke` became:

```ts
function invoke<C extends IpcResponseChannelName>(
  channel: C,
  payload?: unknown,
): Promise<IpcResponseOf<C>>
```

**636 call-site assertions were deleted.** Exactly **one** `as` remains in the renderer's IPC layer, inside `invoke` itself, where `Promise<unknown>` from the preload becomes `Promise<IpcResponseOf<C>>`. That is the honest location for it: it is the single point where an untyped wire becomes a typed value, and it is now the only place in the renderer that has to be trusted.

On the main side, `SecureHandlerDef` became a discriminated union:

```ts
export interface SecureHandlerDefFor<C extends IpcChannelName> {
  channel: C;
  schema: ZodSchema;
  handler: C extends keyof IpcResponseMap
    ? (payload: unknown) => IpcResponseMap[C] | Promise<IpcResponseMap[C]>
    : (payload: unknown) => unknown | Promise<unknown>;
  ...
}

export type SecureHandlerDef = { [C in IpcChannelName]: SecureHandlerDefFor<C> }[IpcChannelName];
```

This is the design decision the increment turns on. Because the union is discriminated by `channel`, an element written as `{ channel: IpcChannel.KbMatrix, ... }` is checked against *that channel's* contract specifically — which means the **~24 existing `const handlers: SecureHandlerDef[] = [...]` annotation sites gained full response checking without a single edit**. The registration idiom the repository already used did the work.

The bridge machinery itself takes `AnySecureHandlerDef`, the same interface with its channel binding erased. This is deliberate and documented in the code: the machinery validates, times, audits and shapes errors identically for every channel and never looks at what a handler returns. Given the discriminated union it would have to call a union of ~675 signatures to do that. The erasure is one-way and happens *after* the contract has been enforced at the registration site.

### The push direction

`packages/shared/src/ipc/broadcasts.ts` declares `IpcBroadcastMap` — **29 channels**. `main/index.ts`'s primitive is now generic:

```ts
function broadcast<C extends IpcBroadcastChannelName>(channel: C, payload: IpcBroadcastOf<C>): void
```

and every subsystem's dependency type changed from `(channel: string, payload: unknown) => void` to the exported `IpcBroadcaster`. That accounts for the thirty-odd two-line diffs in the file list: a subsystem that sends the wrong shape, or invents a channel, no longer compiles.

### Fixing `any` at the source

The five `any` leaks were not cast away at the send site. The six emitter classes that produced them were made generic, using the `EventEmitter<T>` support in `@types/node` 20:

| Class | File |
|---|---|
| `RuntimeSupervisor` | `main/runtime/supervisor.ts` |
| `DiscoveryStateStore` | `main/infrastructure/discoveryState.ts` |
| `ResourceStore` | `main/infrastructure/resourceStore.ts` |
| `PackageService` | `main/nps/packageService.ts` |
| `AppUpdater` | `main/services/appUpdater.ts` |
| `PluginHost` | `main/plugins/pluginHost.ts` |

The payload now has a real type before it ever reaches `broadcast`, which is what makes the broadcast map meaningful rather than ceremonial. **There are now zero `any` types in main, renderer and shared production code.**

### The duplicated contract

`WorkerPerformance`, `ExecutionStat`, `WorkforceBottleneck` and `WorkforceIntelligence` existed **twice**: once in the main process where the values are produced, once in `renderer/src/workforce/intelligenceTypes.ts` where they are consumed. The renderer copy described itself as a mirror and was field-for-field identical — with nothing checking that it stayed so.

They now live once, in `packages/shared/src/types/workforceIntelligence.ts`. The declarations are the main-process originals verbatim; this is a move, not a redesign. **Both sides re-export under the names they already used** (`WorkerPerf`, `ExecStat`), so every existing import path keeps resolving unchanged.

### The one thing the compiler cannot reach

The preload forwards a subscription only when the channel appears in `ALL_SUBSCRIBABLE_CHANNELS` — an ordinary array with no type-level relation to the broadcast map. The two can drift in either direction:

- **Described but not allowlisted:** compiles, typechecks, lints — then throws `Channel "…" is not subscribable` the first time the page mounts. *This has already happened once in this repository;* `connectorSyncSubscribe.test.ts` is the single-channel guard left behind by that incident.
- **Allowlisted but not described:** quieter and worse to find. Dead surface that looks live.

`broadcasts.ts` therefore emits one value, `BROADCAST_CHANNELS`, pinned to the map by a witness:

```ts
const BROADCAST_CHANNEL_WITNESS: Record<keyof IpcBroadcastMap, true> = { /* 29 entries */ };
export const BROADCAST_CHANNELS: readonly (keyof IpcBroadcastMap)[] =
  Object.keys(BROADCAST_CHANNEL_WITNESS) as (keyof IpcBroadcastMap)[];
```

A missing key fails to compile as a missing property (TS2741); an extra key fails as an excess one (TS2353). The runtime list cannot drift from the type-level map it stands in for.

**The witness lives in production code, not in the test.** `tsconfig.node.json` excludes main test files from typechecking, so a witness placed in `ipcContract.test.ts` would never have been checked and could have rotted silently — the exact failure it exists to prevent.

`ipcContract.test.ts` then compares the two sets in both directions, checks each list for duplicates, and pins the assumption itself by asserting that the preload still gates `subscribe` on `ALL_SUBSCRIBABLE_CHANNELS`. Without that last test the other four would be measuring a constant nothing reads.

### Channel attribution

When `invoke` rejects, the renderer receives a message and nothing else. `secureBridge.ts` deliberately replaces internal failures with a clean `IpcError` — correct, and it means a denial reads `Not authorized` with no indication of *what* was denied, and a timeout reads `Request timed out` with no indication of *what* timed out. Roughly eighty call sites render exactly that string.

The renderer is the one party that still knows: it named the channel when it made the call. `renderer/src/lib/ipcError.ts` records that fact onto the rejection on its way out of `invoke`.

The design is **strictly additive**, and that was established by survey before it was written: the renderer contains **zero** `instanceof <CustomClass>` checks on IPC errors, **zero** error-message string-matching, **zero** `JSON.stringify(err)`, and 79 `.message` reads that are all display or logging. That evidence permitted mutating in place — preserving object identity, `message` and `stack` — rather than wrapping in a subclass, which would have changed identity for every consumer to buy nothing.

Every branch of `attributeIpcChannel` is a refusal to make a failure worse: a non-object rejection is passed through, a frozen error is left alone, an already-attributed error keeps its first (innermost, most specific) attribution, and the `defineProperty` call is guarded so that attribution failing can never turn a handled rejection into a different unhandled one. The property is *enumerable* so devtools and `console.error` surface it unprompted, and *non-writable* so a later frame cannot rewrite the origin of a failure it did not cause.

Attribution is applied as a `.catch` link **on the returned chain**, not as a detached branch. A detached handler would rely on spec-guaranteed reaction ordering to beat the caller's own `.catch` — correct today, fragile to any future reordering. The existing `perfRecorder` branch keeps its documented "cannot affect the returned promise" guarantee untouched.

The accompanying log is `warn` (the production log threshold) and fires **once per channel per session**. Several renderer surfaces poll on an interval and swallow failures deliberately with `.catch(() => undefined)`; an unconditional warn would emit one line per channel per tick, forever, whenever the main process was down. First-failure-per-channel bounds the output at ≤29 lines while still recording that the channel failed at all.

### Considered and rejected

- **Response-side Zod validation** — the parallel-system problem, against zero Category C/D findings. Section 3.
- **Extending `perfRecorder` with failure counts** — ripples into the shared `IpcChannelStat` DTO and the perf overlay UI. Scope creep.
- **Wiring the channel into `WorkspaceErrorBoundary`** — IPC rejections do not reach React error boundaries. It would have been dead code.
- **Adding the channel to user-facing text in `retrievalStatus`** — an internal channel name is diagnostic in a console and noise in a UI panel.

---

## 5. Implementation

**6 new files (1,911 lines):**

| File | Lines |
|---|---|
| `packages/shared/src/ipc/responses.ts` | 1,293 |
| `packages/shared/src/ipc/broadcasts.ts` | 224 |
| `packages/shared/src/types/workforceIntelligence.ts` | 107 |
| `apps/desktop/src/renderer/src/lib/ipcError.test.ts` | 120 |
| `apps/desktop/src/renderer/src/lib/ipcError.ts` | 96 |
| `apps/desktop/src/main/ipc/ipcContract.test.ts` | 71 |

**45 modified files: +1,122 / −1,639.** The largest is `renderer/src/lib/ipc.ts` at +776 / −1,448 — a net removal of 672 lines, which is what deleting 636 assertions looks like. `main/ipc/secureBridge.ts` is +52 / −5 (the generic registration type). Roughly thirty subsystem files are +2 / −1 — the `IpcBroadcaster` signature swap.

No placeholders. No TODOs. No mocks. No parallel systems. No functionality removed.

---

## 6. Two real defects, found by writing the contract down

Neither was on the work list. Both were exposed by the exercise of stating what a channel returns, which is the strongest argument for the increment.

**`kb:matrix` served two unrelated response shapes.** The channel took an optional `assetId` and, when present, returned an *impact analysis* instead of the relationship matrix. Its response type was therefore unstateable — and the practical consequence was live: **`kb.impact()` called without an `assetId` silently returned the relationship matrix, typed as an impact analysis.** The renderer would read fields that were never sent.

Fixed by splitting: `kb:impact` is a new channel with a **required** `assetId`, and `KbMatrixRequest` is now `z.object({}).strict()`, so a stray `{ assetId }` fails validation loudly instead of quietly swapping the response out from under the caller's type.

**`sandbox:validation.run` reintroduced an impossible error branch.** After executing a run, the handler called `buildRunDetail(out.run.id)` — going back through a lookup for a run it had *just finished executing*, which reintroduced a `{ error: 'not_found' }` branch. Unreachable in practice, but the renderer's declared response is `ValidationRunDetail`, so that branch was a lie the old `as` cast covered up. Now built from the output directly via a total `detailFromOutput` helper: the output *is* the detail, so there is nothing to look up and nothing to miss.

---

## 7. Behaviour changes (disclosed)

1. **New channel `kb:impact`**, added to `IpcChannel` and `ALL_INVOKABLE_CHANNELS`, gated on `knowledge:read` exactly as `kb:matrix` is.
2. **`kb:matrix` now rejects `{ assetId }`.** Previously it accepted it and returned a different shape. Callers wanting impact analysis use `kb:impact`; the renderer's `kb.impact()` was updated accordingly. This is the fix for the defect above, not a regression.
3. **A rejected `invoke` now carries an enumerable, non-writable `ipcChannel` property.** `message`, `stack` and object identity are unchanged, so all 79 `.message` display sites, both error boundaries, and `retrievalStatus.ipcErrorDetail` behave exactly as before.
4. **One `warn` per channel per session** on first IPC failure. Silent in a healthy session.

Everything else is type-level and erased at build time.

---

## 8. Verification

| Gate | Command | Result |
|---|---|---|
| Lint | `eslint . --max-warnings 0` | **EXIT 0** (58.4 s) |
| Typecheck | `npm run typecheck --workspaces` | **EXIT 0** (4 m 23 s) |
| Tests | `npm test` (root, all workspaces) | **44/44 workspaces pass** |
| Desktop tests | `vitest run` | **555 files / 5,273 tests passed** |
| Build | `electron-vite build` | **EXIT 0** — main, preload, renderer bundles emitted, zero errors |

Test count moved from 5,253 to 5,273: **+20**, exactly the 5 in `ipcContract.test.ts` and the 15 in `ipcError.test.ts`. Test files 553 → 555.

**Zero `any` types** remain in `apps/desktop/src/main`, `apps/desktop/src/renderer/src` and `packages/shared/src` production code. (Ten grep hits survive; all ten are the English word "any" inside prose comments.)

### Every guard was proven to bite before it was trusted

A guard that has never failed is a guard nobody has tested. Eight negative controls were run across the increment, each reverted and the file verified byte-identical to its backup afterwards:

| Control | Expected | Observed |
|---|---|---|
| Witness missing a key | compile error | **TS2741** |
| Witness with a stray key | compile error | **TS2353** |
| Map channel removed from allowlist | test names it | `[ 'catalog:list' ]` |
| Allowlist channel removed from map | test names it | `[ 'catalog:search' ]` |

The two witness controls were initially run together, and the combined run reported only the TS2353 — the excess-property error masked the missing-property one. They were re-run **separately** to confirm both directions bite independently. A combined control that passes for one reason is not a control.

### Backward compatibility

- The preload — the actual trust boundary — was **not modified**. Both allowlists, both guards, and the throw on a non-subscribable channel are untouched.
- All seven `secureBridge` pipeline stages are unchanged, in unchanged order.
- No channel was renamed or removed. No handler's runtime behaviour changed except the two defect fixes in section 6.
- Every moved type is re-exported under its original name from its original module.
- `ThemeChangedPayload` is retained as a `@deprecated` alias of `ThemeChangedEvent`.

---

## 9. Known limitation carried forward

`knowledgeAssets/knowledgeBench.test.ts:258` remains wall-clock sensitive under container contention (~102 ms against a 100 ms budget on roughly one run in three; 74.8 ms isolated). It passed in this increment's full run at **223 ms for the file**. Deliberately not loosened — a guard that widens whenever it fires is not a guard. Re-measure and re-calibrate deliberately on the target Apple Silicon machine in **A17**.

---

## 10. How to run

```bash
npm install                 # repo root
npm run typecheck --workspaces
npx eslint . --max-warnings 0
npm test
npm run build --workspace apps/desktop
npm run dev  --workspace apps/desktop   # Electron dev
```

Nothing about the build, dev or packaging story changed in A7. No new dependency was added.

---

## 11. What A7 leaves for A8

A8 is **migration-engine coverage for the enterprise record stores and the timeline**. It is the second of the two findings that affect everything already shipped: only `0001-baseline` is registered, and the record stores and timeline sit outside the migration engine entirely. Like A7, no amount of new module work makes the product deployable while it is open — and unlike A7, its failure mode is user data rather than developer error.
