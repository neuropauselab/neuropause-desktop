# Phase I-A.3 — H-FINDING-4 Next M365 Coverage Inventory (READ-ONLY)

**READ-ONLY reality inventory. No implementation, no code/test change, no stage, no commit, no push.**
Baseline HEAD `d2c9827` (parent `cc184d0`), branch `cert/data-import-cst-integration`.
Labels: `[PROVEN]` / `[PROVEN-ABSENT]` / `[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

Two independent methods were used and agree: (a) direct source enumeration of the registry + governed
sets + IPC handler + executor call sites; (b) a read-only bypass sweep of every production path capable of
a Graph mutation. Where they agree the fact is labelled `[PROVEN]`.

---

## 1. Repository state `[PROVEN]`
- HEAD = `d2c9827308e52ea1123d827700064bcd9e05b226` (= expected). Parent = `cc184d0`. Branch = `cert/data-import-cst-integration`.
- Working tree: **0 tracked modifications, 0 staged**. Untracked: 6 preserved prior certification docs (2A/2B-i/2B/2B-ii readiness/evidence/design/discrepancy + remaining-15 inventory) — preserved, none deleted.
- Certification chain committed: `90527b4 → dc9e8f3 → 8846371 → cc184d0 → d2c9827`.

## 2. Complete M365 action inventory `[PROVEN]`
Registry = `ALL_M365_ACTIONS` (`connectors/m365/index.ts:16`) = `mailActions ⧺ calendarActions ⧺ driveActions ⧺ teamsActions ⧺ contactActions`. **34 registered actions: 29 `mutates:true`, 5 `mutates:false`.** (`aiDrafts.ts`/`m365Draft` is NOT in the registry — see §6.)

| Domain | Mutating (`mutates:true`) | Read-only (`mutates:false`) |
|---|---|---|
| mail (11) | send, saveDraft, reply, replyAll, forward, move, markRead, delete, restore, addAttachment | **downloadAttachment** |
| calendar (5) | create, update, delete, invite, respond | — |
| drive (8) | upload, rename, move, delete, createFolder, share, restoreVersion | **download** |
| teams (5) | sendChannelMessage, replyChannelMessage, sendChatMessage, createChannel | **listChannelMembers** |
| contacts (5) | create, update, delete | **search, detectDuplicates** |
| **Total** | **29** | **5** |

## 3. Governed cohort membership `[PROVEN]`
Source counts (`governedAction.ts`): Cohort-1 = **13**, Cohort-2A = **3**, Cohort-2B-i = **9**, Cohort-2B-ii = **3** → **28 governedAction** actions. `mail.send` → **governedSend** (1). **Total governed = 29.**

Automated cross-check (mutating registry vs governed union): `MUTATING NOT GOVERNED = NONE` · cohort overlap `NONE` · `governed-but-not-mutating (stale/typo) = NONE` · `read-only accidentally governed = NONE`. `[PROVEN]`

| Cohort | Route | Reversibility | Actions |
|---|---|---|---|
| governedSend | `sendTransition.ts` | IRREVERSIBLE | mail.send |
| Cohort-1 (13) | governedAction | IRREVERSIBLE | mail.reply, mail.replyAll, mail.forward, calendar.invite, calendar.respond, teams.sendChannelMessage, teams.replyChannelMessage, teams.sendChatMessage, mail.delete, calendar.delete, drive.delete, contacts.delete, drive.share |
| Cohort-2A (3) | governedAction | IRREVERSIBLE | calendar.create, calendar.update, teams.createChannel |
| Cohort-2B-i (9) | governedAction | REVERSIBLE | mail.saveDraft, mail.move, mail.markRead, mail.restore, mail.addAttachment, drive.rename, drive.move, drive.createFolder, contacts.create |
| Cohort-2B-ii (3) | governedAction | IRREVERSIBLE (drive.upload, drive.restoreVersion) / DIFFICULT_TO_REVERSE (contacts.update) | drive.upload, drive.restoreVersion, contacts.update |

## 4. IPC routing matrix `[PROVEN]`
IPC ingress = **one** write channel, `IpcChannel.M365ActionExecute` (`connectors/index.ts:528`), `audit:true`, wrapped by `gateConnectorHandlers`. Routing:
1. `actionId === 'mail.send'` → **governedSend** (`:542`).
2. `actionId ∈ Cohort-1∪2A∪2B-i∪2B-ii` → **governedAction** (`:577`, with `ALL_M365_ACTIONS.find` guard).
3. else → **`m365.execute` fallback** (`:596`).

Both CST routes pass authoritative identity/context: `tenantId = deps.workspaceId()`, `actorId = deps.actor() ?? ''` (empty ⇒ DENY; **no renderer fallback**). Because every mutating action is in a route (1) or (2), the fallback (3) receives **only the 5 read-only actions** (or an unknown id → `Unknown action` error, no effect). The other two M365 IPC channels are non-mutating: `M365ActionList` (`:526`, catalog) and `M365Draft` (`:600`, AI text via `aiEngine`, no Graph write). `[PROVEN]`

## 5. Worker routing matrix `[PROVEN]`
A **second** ingress exists and does **not** use the CST adapters. Chain:
`ExecuteEngine kind 'connector'` ← `createWorkforceActionExecutor(runBinding)` (`runtimeCore.ts:2542`) → `verifyBoundaryB(req, now)` (`workforceActionExecutor.ts`, DENY ⇒ `runBinding` NOT called, no effect) → `runBinding` case `'m365'` (`runtimeCore.ts:2509`) → **`connectors.m365Executor.execute(...)`** → `action.run` (`executor.ts:134`).

Worker-ingress governance stack = **Boundary-B** (authoritative Bound Decision Claim verification against binding + actor/tenant + temporal validity; Step-3A transport, Step-4 enforcement, Step-5 durable single-use admission — `boundaryBEnforcement.test.ts` controls 14/15/16) **+** the executor's own `ownsAccount` + confirmation gate + scope + token checks (`executor.ts:96-114`). It does **NOT** traverse `governedAction`/`governedSend`, so it does not carry the CST canonical-consequential-identity / kernel idempotency-replay / at-most-once-reconciliation properties; it enforces single-use via durable `decisionId` consumption instead. **WORKER GOVERNANCE ≠ IPC GOVERNANCE.** `[PROVEN]`

## 6. Bypass-path inventory `[PROVEN]` / `[OPEN]`
- **Only two** production call sites reach `M365Executor.execute`: `connectors/index.ts:596` (IPC fallback, read-only today) and `runtimeCore.ts:2509` (worker path). `[PROVEN]`
- **Direct Graph mutations outside the registry: NONE.** Every mutation verb (`postJson`/`patchJson`/`deleteJson`/`sendBinary`/ raw resumable `fetch PUT`) against the `GRAPH` base (`actionSdk.ts:12`) lives inside a `connectors/m365/{mail,calendar,drive,teams,contacts}.ts` WriteAction `run`. `drive.ts:83` raw `fetch` is a Graph-issued resumable-session URL inside the governed `drive.upload` action — in-registry, not a bypass. `[PROVEN]` (both methods; independent grep for out-of-registry Graph mutations returned empty.)
- **Read-only Graph clients (not mutations):** `connectionTest.ts:114` (`GET /me`), `unified/sync/adapters/entra.ts` (`/users|groups/delta`, `/organization` — GET only), `infrastructure/azure/*` (`GRAPH` used only as GET discovery + token audience; Azure **write** actions target `management.azure.com`/Key Vault, never Graph). `[PROVEN-ABSENT of Graph mutation]`
- **`m365Draft`** (`aiDrafts.ts`) — exposed via `M365Draft` IPC; calls local `aiEngine.run` only; **no Graph call, no M365 state mutation**. `[PROVEN-ABSENT of effect]`
- **Latent structural gap `[OPEN]`:** the IPC fallback branch (`:596`) is not cohort-guarded and the executor runs any `mutates:true` action given `confirmed`. A **future** mutating action added to `ALL_M365_ACTIONS` without cohort membership would silently mutate Graph through the ungoverned fallback. No compile-time or test guard currently forces `mutates:true ⇒ governed`. (Live gap = none at HEAD; latent regression risk = real.)

## 7. Remaining consequential actions (outside the 29 governed) `[PROVEN-ABSENT]`
**None.** All 29 `mutates:true` M365 actions are governed at IPC (28 governedAction + mail.send governedSend). The 5 remaining registered actions are `mutates:false` reads (downloadAttachment, drive.download, teams.listChannelMembers, contacts.search, contacts.detectDuplicates) — no consequential external write. There is **no ungoverned mutating M365 IPC action to place in a next cohort.**

## 8. Consequence classification of what remains
The only remaining registered actions are **read-only** (category: none of reversible-mutation / communicative / destructive / permission-changing / overwrite). Their consequence is **not applicable** (no durable-state mutation). The only *governance* delta that remains is not a new action but the **worker ingress** (§5) and the **latent fallback gap** (§6) — neither is a new M365 action.

## 9. Universal-governance assessment `[PROVEN]` (IPC) / `[NOT PROVEN]` (all-ingress uniform CST)
Question: *"Can the repository prove that every consequential M365 IPC action passes through NeuroPause governance before effect?"*
- **IPC ingress: PROVEN (at HEAD).** All 29 mutating actions route through governedSend/governedAction before effect; the fallback serves only reads; no out-of-registry Graph mutation exists. Contingency: PROVEN is guarded by the *current* action set, not by a structural invariant (§6 `[OPEN]`).
- **All-ingress uniform CST governance: `[NOT PROVEN]` / not the case.** The worker ingress (`runtimeCore.ts:2509`) reaches the effect through **Boundary-B + confirmation-gated executor**, a *different* governance mechanism, not the CST adapter. Both ingresses provide authoritative identity + denial-before-effect + durable single-use, but they are **not the same stack**, and the worker path is **not CST-governed**. Do **not** read "28+1 governed at IPC" as universal governance across ingresses.

**Verdict: PARTIALLY PROVEN.** IPC consequential mutation coverage is source-complete; cross-ingress *uniform CST* governance is not, and the latent fallback invariant is unguarded.

## 10. Frozen-surface verification `[PROVEN]`
Working tree has **0 tracked changes** at `d2c9827`, so all frozen surfaces are untouched: `@neuropause/cst` (vendored **1.3.0**), CST kernel, `durableIdempotencyStore.ts`, `sendTransition.ts`/governedSend, `mail.ts`, m365 `executor.ts`, `actionSdk.ts`, BoundDecisionClaim(/Mint), ExecuteEngine/ExecutionSession/ExecutionStore, Boundary-B, worker router/index/runtime, `runtimeCore.ts`, `contracts.ts`, `storeScope.ts`, `package.json`, Node engine (`>=20.11.0`). No inspection modified any file.

## 11. NEUROPAUSE-FINAL provenance assessment `[PROVEN]` / `[INFERRED]`
`~/Downloads/NEUROPAUSE-FINAL` present (outside the repo). Vendored `@neuropause/cst` = **1.3.0** (unchanged) `[PROVEN]`. The previously byte-verified relationship (CST 1.3.0 already integrated; frozen package unchanged; NPC/NPMS/CST/evidence separation intact) is unchanged — no new merge, no copy, no provenance change performed this gate. Full byte-equality was established in an earlier gate and is not re-run here `[INFERRED, prior-PROVEN]`. No discrepancy observed.

## 12. Remaining gaps
- `[OPEN]` **Worker-ingress CST parity** — the worker path is governed by Boundary-B, not the CST governedAction adapter; cross-ingress governance is not uniform. (Touches frozen `runtimeCore.ts`/worker surfaces — larger design gate.)
- `[OPEN]` **Unguarded `mutates:true ⇒ governed` invariant** — no test/compile guard prevents a future mutating action from silently using the ungoverned IPC fallback.
- `[OPEN]` (unchanged, prior) cross-process atomicity, power-loss/fsync durability, provider idempotency, effect success, verification success, renderer exclusion, universal NeuroPause OS governance — none opened.

## 13. Recommended next cohort `[DESIGN]`
**There is no next M365 *action* cohort — the mutating IPC surface is exhausted (29/29 governed).** The smallest logically coherent next gate is therefore a **coverage-invariant guard**, not a cohort:

- **Recommended (smallest, additive, no frozen surface):** a **read-only regression guard test** asserting that for every `a` in `ALL_M365_ACTIONS` with `a.mutates === true`, `a.id` is `mail.send` OR a member of exactly one governed cohort — failing if any mutating action could reach the `m365.execute` IPC fallback ungoverned. Closes the §6 `[OPEN]` latent gap.
  - Action IDs: none (meta-invariant over the registry). Consequence: prevents silent ungoverned mutation on future additions.
  - Mechanism: **reuse** existing exported cohort sets + `ALL_M365_ACTIONS`; **no** new governedAction call, **no** durable store, **no** new metadata, **no** production change. New tests only (one guard suite). Expected frozen surfaces: none touched. Certification boundary: "the IPC route cannot serve a mutating M365 action outside governedSend/governedAction" becomes a *structural* invariant, not a point-in-time observation. Non-claims: does not govern the worker ingress; does not add CST properties to the fallback; does not make governance universal across ingresses.
- **Larger subsequent gate (not next, flagged only):** bring the worker ingress (`runtimeCore.ts:2509`) under CST governedAction (or formally certify Boundary-B as CST-equivalent for M365 effects) to make cross-ingress governance uniform. This touches frozen `runtimeCore`/worker surfaces and requires its own design + authorization; **not** recommended as the immediate next step.

## 14. Certification boundary (this inventory)
> "At HEAD `d2c9827`, all 29 registered mutating Microsoft 365 actions are governed on the IPC write ingress — `mail.send` through governedSend and the other 28 through the parameterized governedAction/CST path — and no Microsoft Graph mutation exists outside the `connectors/m365/*` WriteAction registry. A second, distinct ingress (the worker/Boundary-B path at `runtimeCore.ts:2509`) reaches M365 effects through Boundary-B verification plus the confirmation-gated executor, NOT through the CST adapters. Coverage of the mutating IPC surface is source-complete; uniform CST governance across all ingresses is NOT established, and no structural invariant yet forces future mutating actions into a governed set."

## 15. Explicit non-claims
NOT claimed: universal M365 governance; universal NeuroPause OS governance; that the worker ingress is CST-governed; that IPC coverage is structurally guaranteed for future actions (it is point-in-time at HEAD); provider idempotency / reversibility; Graph effect / effect success / verification success; cross-process or power-loss durability; renderer exclusion. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.** **AUTHORITY ≠ DECISION ≠ ADMISSION ≠ EXECUTION ≠ EFFECT ≠ VERIFICATION ≠ CERTIFICATION.**

## STOP
Inventory only. HEAD unchanged (`d2c9827`); 0 production/test files changed; exactly one new investigation document; nothing staged, committed, or pushed; no frozen surface touched; NEUROPAUSE-FINAL untouched.
