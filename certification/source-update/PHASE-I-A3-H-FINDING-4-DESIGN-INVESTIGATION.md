# Phase I-A.3 — H-FINDING-4 Design Investigation (READ-ONLY)

M365 non-`mail.send` write-action governance. **No production/test/frozen-surface change, no commit,
no push.** Baseline HEAD `9ef3914`, branch `cert/data-import-cst-integration`. Labels: `[PROVEN]` /
`[INFERRED]` / `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

## 1. Repository baseline `[PROVEN]`
HEAD `9ef3914` (`certification: close mail.send governed-ingress coverage`). Working tree clean except
the prior gate's uncommitted read-only inventory doc. Matches expected state — no discrepancy.

## 2. Scope
The **28 consequential (`mutates:true`) M365 write actions other than `mail.send`**, their two known
ingresses, and whether the M365 IPC ingress can reach `mail.send`-parity governance from existing source.

## 3. 28-action inventory `[PROVEN]` (source-cited)
| Domain | Actions (`mutates:true`, excl. mail.send) | Effect verbs (m365Write.test.ts / adapters) |
|---|---|---|
| mail (9) | saveDraft, reply, replyAll, forward, move, markRead, delete, restore, addAttachment (`mail.ts:132-140`) | POST/PATCH/DELETE Graph; reply*/forward = external send |
| calendar (5) | create, update, delete, invite, respond (`calendar.ts:103-107`) | POST/PATCH/DELETE `/me/events`; invite/respond = external |
| drive (7) | upload, rename, move, delete, createFolder, share, restoreVersion (`drive.ts:165-172`) | PUT/PATCH/DELETE; share = createLink (permission grant) |
| teams (4) | sendChannelMessage, replyChannelMessage, sendChatMessage, createChannel (`teams.ts:137-140`) | POST messages/channels = external comms |
| contacts (3) | create, update, delete (`contacts.ts:98-100`) | POST/PATCH/DELETE `/me/contacts` |
No per-action behavior assumed identical beyond the shared executor gate — verbs verified in
`m365Write.test.ts:72-104` and the adapters.

## 4. Ingress inventory `[PROVEN]`
Two per action (re-verified last gate; no third caller of `M365Executor.execute`/`action.run`):
- **Worker:** approval → claim → Boundary B → `runBinding` (`runtimeCore.ts:2508`) → `M365Executor.execute`.
- **M365 IPC:** `M365ActionExecute` (`connectors/index.ts:467`) → **`m365.execute(...)`** (`:500`) → `M365Executor.execute` (non-`mail.send` branch; `mail.send` alone takes `governedSend`).

## 5. IPC execution trace (non-`mail.send`) `[PROVEN]`
`renderer → M365ActionExecute (RBAC connectors:manage, gateConnectorHandlers) → schema
M365ActionExecuteRequest (contracts.ts:465, NON-strict) → m365.execute → M365Executor.execute`:
ownsAccount (`executor.ts:96`) → confirmed gate (`:101`, `mutates && confirmed!==true`) → scope
(`:108`) → token (`:113`) → audited fan-out → `action.run`. Controls present: RBAC, ownership, scope,
token, confirmation, pre-effect denial. **Absent on this path:** strict schema, authoritative
reconstruction, binding digest, decision object, claim, nonce, expiry, durable consumption. `[PROVEN]`

## 6. CST analysis (`cst/sendTransition.ts`) — generic vs mail-specific `[PROVEN]`
| Element | Nature |
|---|---|
| `CstKernel.run(request, effect)` | **action-agnostic** engine `[PROVEN]` |
| `idempotencyKey = sha256(tenant\|connector\|account\|action.id\|params)` (`:158-162`) | **generic** (uses `action.id`+params) `[PROVEN]` |
| `scopesOk = action.scopes.every(...)` (`:175`); ownership/token folded into ONE policy grant | **generic** `[PROVEN]` |
| `action.run(...)` (`:266`) as the effect | **generic** `[PROVEN]` |
| `RESOURCE_TYPE='m365-send'` (`:61`), `SEND_ACTION='connectors.m365.send'` (`:63`) | **mail-specific constants** `[PROVEN]` |
| `consequence='C3'` (`:179`), `reversibility='IRREVERSIBLE'` (`:214`) | **hardcoded** for send `[PROVEN]` |
| `expectedPostState={sendResolved:true}` (`:183`), **Profile A** (no remote observation) | **mail-specific semantics** `[PROVEN]` |
| stores `ClaimStore`+`IdempotencyStore` (`:96-97`) | **in-memory, process-lifetime, NOT crash-durable** (`:89`) `[PROVEN]` |
**Conclusion:** the CST **kernel** is generic; **`governedSend` is a `mail.send`-specific adapter**. Its
idempotency is already generic in shape but **not durable**, and its consequence/reversibility/policy/
resource/profile are **hardcoded** for send. `[PROVEN]`

## 7. Worker comparison `[PROVEN]`
Worker ingress governs any m365 binding uniformly: `verifyBoundaryB` (exact 8-field digest) + durable
`decisionId` consumption (ExecutionStore, restart-hydrated) + pre-effect denial. **This already covers
all 29 actions when reached via the worker path.** `[PROVEN]` (mechanism proven Step 4/5.)

## 8. Authority analysis `[PROVEN]`
IPC non-`mail.send`: authorization = RBAC + ownsAccount + scope + token + confirmation, all pre-effect.
**PARTIALLY GOVERNED** — authorization present; no decision/binding/consumption. RBAC+confirmed **is not**
Boundary B or CST (not claimed equivalent).

## 9. Identity analysis `[PROVEN]`
IPC actor = `deps.actor()` = `displayName ?? email` (`runtimeCore.ts:479-483`); worker = `user.id`.
IDENTITY DIFFERENCE — OPEN (same as mail.send).

## 10. Tenant analysis `[PROVEN]`
IPC tenant = `deps.workspaceId()` (workspace); worker = `activeTenantScope().tenantId` (org).
TENANT DIFFERENCE — OPEN.

## 11. Binding analysis `[PROVEN]`/`[NOT PROVEN]`
IPC non-`mail.send`: `accountId` is ownership-bound (`ownsAccount`) `[PROVEN]`; `connectorId/actionId/
params` are consumed as-supplied with **no digest and no claim to verify against** ⇒ **PARTIAL BINDING**;
the consequential content (which item/message/event/link) is **unbound**. `[NOT PROVEN]` exact.

## 12. Renderer-trust analysis `[PROVEN]`
`M365ActionExecuteRequest` (`contracts.ts:465`) is **NOT `.strict()`**. Renderer supplies
`connectorId, accountId, actionId, params, confirmed`. Only `accountId` is authoritatively bound (to
workspace ownership); no authoritative reconstruction of `connectorId/actionId/params`. Conceptual test —
renderer changes target/actionId/params (owned account, scope granted, confirmed): **the action
executes**. Classification: **a missing exact-binding guarantee + intentional direct-action trust model**
(the user names what to do), **not** an authorization weakness per se (ownership/scope/token/confirm all
enforced). A single generic `confirmed:true` authorizes any owned target/params. `[PROVEN]`

## 13. Consumption / idempotency analysis `[PROVEN absent]`
IPC non-`mail.send`: **NONE.** `M365Executor.execute` records write-health telemetry (writeCount,
lastWriteAction — `m365Write.test.ts:237-240`) but performs **no dedup/consumption**. Only `governedSend`
(mail.send) has CST idempotency, and that is in-memory. `[PROVEN]`

## 14. Replay analysis `[NOT PROVEN / absent]`
Same confirmed request twice ⇒ `action.run` twice ⇒ **two effects** (no consumption). `[PROVEN absent]`

## 15. Concurrency analysis `[OPEN]`
No serialization ⇒ concurrent duplicates each reach the effect. `[NOT PROVEN safe]`

## 16. Restart analysis `[OPEN]`
No durable consumption ⇒ restart has no replay memory. `[NOT PROVEN safe]`

## 17. Lost-response analysis `[OPEN]`
No idempotency + generic executor error mapping (unlike CST's Profile-A UNKNOWN) ⇒ a caller retry after a
lost response re-invokes the effect. `[NOT PROVEN safe]`

## 18. Effect-reachability analysis `[PROVEN]`/`[NOT PROVEN]`
Proven deny-before-effect (existing `m365Write.test.ts`, action-agnostic gate): unknown action; unconfirmed
mutation (`events=0`); missing scope; **foreign account — before any other gate, `events=0`, nothing
reached Graph**. These distinguish DENY from effect-unreachable. `[PROVEN]`. **Not proven** (no such
control exists): modified target/params, replay, concurrent duplicate, restart replay, expiry. `[NOT PROVEN]`

## 19. Option A — GENERALIZE CST `[DESIGN]/[OPEN]`
The kernel is generic and the idempotencyKey is generic, so a **parameterized governed-action adapter**
(like `governedSend` but per-action) is structurally plausible. **But it requires, from source that does
not exist today:** per-action governance metadata — `consequence`, `reversibility`, policy-action id,
resource-type, profile, postcondition — which the `WriteAction` type (`actionSdk.ts:36-43`) does **not**
carry (only `id/label/domain/scopes/mutates/run`). It would also touch frozen `sendTransition.ts`,
`actionSdk.ts`, `connectors/index.ts`, and its consumption would remain **in-memory** unless CST stores are
made durable. It need not change `mail.send` (additive) and needs no new identity/tenant source. **Feasible
but not read-only-derivable; requires new per-action metadata + frozen-surface changes + a durability
decision.** `[OPEN]`

## 20. Option B — EXECUTOR-LEVEL ASSURANCE `[OPEN]`
The executor already holds authorization + confirmation. To add durable consumption + exact binding it
would need: a canonical binding (it has connector/account/action/params — no actor/decisionId unless
added), a replay key (an idempotencyKey-style hash is derivable), and **a durable store (none exists at the
executor level; ExecutionStore is worker-scoped)** plus **a decision identity** (the only "decision" is the
renderer `confirmed` boolean — not authoritative). Requires inventing a store + decision contract →
forbidden here. `[OPEN]`

## 21. Option C — NEW GOVERNED DECISION CONTRACT `[OPEN]`
A `BoundDecisionClaim`-equivalent for the IPC path presumes a governed decision the IPC path does not have
(it is a direct user confirmation, not a proposal approval). This duplicates worker governance and needs a
new authority object + durable store + renderer-exclusion (strict schema). Same blocker the cross-ingress
design investigation recorded: **no shared/authoritative decision identity exists on the IPC path.** `[OPEN]`

## 22. Option D — INDEPENDENT PER-INGRESS GOVERNANCE / effect-domain coverage `[PROVEN principle]/[NOT PROVEN for 28]`
The certification principle (H-FINDING-3) allows different mechanisms per ingress **provided each ingress
has authoritative pre-effect governance, denial-before-effect, AND defined replay/idempotency semantics.**
The worker ingress meets all `[PROVEN]`. The IPC ingress meets authorization + denial `[PROVEN]` but has
**no defined replay/idempotency and no exact binding** `[NOT PROVEN]`. So Option-D coverage for the 28 is
**NOT PROVEN as-is** — the IPC ingress would need at least durable idempotency (for irreversible/
destructive/permission-changing actions) to qualify.

## 23. Frozen-surface impact `[DESIGN]`
Any closure touches frozen surfaces: `sendTransition.ts` (Option A), `actionSdk.ts` (per-action metadata),
`connectors/index.ts` (routing), `m365/executor.ts` (Option B), `contracts.ts` (strict schema / carried
context), and requires a **durable store** (none exists for this path). **None modified here.** Missing
invariant: *no consequential M365 IPC write effect (beyond mail.send) is admitted twice, and target/params
are bound to the authorization.*

## 24. Certification implications `[PROVEN]`
`mail.send` certification stands (unchanged, scoped). The 28 have **full worker-ingress coverage** but only
**partial IPC-ingress governance** (authorization + confirmation + denial; no replay/binding/consumption).
Effect-domain coverage for the 28 is **NOT PROVEN** until the IPC ingress gains at least durable
replay/idempotency (and, ideally, exact binding) — via a separately-authorized gate.

## 25. Action classification (Part 13, from adapter semantics) `[INFERRED]`
- **Externally-communicative / IRREVERSIBLE:** mail.reply/replyAll/forward, calendar.invite/respond,
  teams.sendChannelMessage/replyChannelMessage/sendChatMessage. **Highest** assurance need (a duplicate
  = a duplicate external message; no consumption today).
- **Destructive:** mail.delete, calendar.delete, drive.delete, contacts.delete. High.
- **Permission-changing:** drive.share (createLink — external access grant). High.
- **Data-mutating (lower/reversible-ish):** mail.saveDraft/markRead/move/restore/addAttachment,
  calendar.create/update, drive.upload/rename/move/createFolder/restoreVersion, teams.createChannel,
  contacts.create/update.
The first three classes especially need IPC-ingress replay/binding control they currently lack. (Class
labels are `[INFERRED]` from HTTP verb/label; `WriteAction` declares no reversibility field.)

## 26. Recommended next gate `[DESIGN]`
A **separately-authorized** design→implementation gate. Most source-aligned path: **Option A** —
introduce per-action governance metadata on `WriteAction` and a parameterized governed-action adapter over
the existing CST kernel, routing consequential non-`mail.send` IPC writes through it, additive to
`mail.send`. Requires an explicit **durability decision** (in-memory parity with mail.send, or a durable
store). Alternatively, scope the first increment to the **irreversible/destructive/permission-changing**
subset. Do not invent a decision contract or store in the investigation; those are implementation decisions
for the authorized gate.

## 27. Explicit non-claims
NOT claimed: all M365 actions governed · universal governance · mechanism equivalence · that RBAC+confirmed
equals Boundary B/CST · replay/binding/consumption for the 28 IPC actions · durable IPC idempotency · that
CST is already generic for these actions · effect/verified success. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠
UNIVERSAL.**

## 28. Final decision
The CST kernel is generic but `governedSend` is a `mail.send` adapter; the `WriteAction` type lacks the
per-action governance metadata a generalization needs, and no durable consumption exists for the IPC path.
**H-FINDING-4 cannot be closed read-only.** Worker ingress = governed `[PROVEN]`; IPC ingress = partially
governed `[PROVEN]`, coverage NOT PROVEN. Closure requires a separately-authorized gate (recommended:
Option A).

---

### H-FINDING-4 — decision table
| Field | Value |
|---|---|
| Effect domain | 28 non-`mail.send` consequential M365 write actions (mail×9, calendar×5, drive×7, teams×4, contacts×3) |
| Ingresses | 2 (Worker, M365 IPC) — no third `[PROVEN]` |
| Governance | Worker: GOVERNED `[PROVEN]`; IPC: PARTIALLY GOVERNED `[PROVEN]` |
| Exact binding | Worker: exact `[PROVEN]`; IPC: partial (account only) `[NOT PROVEN]` |
| Replay | Worker: durable `[PROVEN]`; IPC: none `[NOT PROVEN]` |
| Concurrency | Worker: single-admission `[PROVEN]`; IPC: unprotected `[OPEN]` |
| Restart | Worker: durable `[PROVEN]`; IPC: none `[OPEN]` |
| Renderer control | IPC: target/action/params/confirmed caller-supplied (schema non-strict) `[PROVEN]` |
| Pre-effect denial | Both: `[PROVEN]` (IPC: unknown/unconfirmed/unscoped/foreign-account, effect unreachable) |
| Coverage | **NOT PROVEN** (IPC ingress lacks replay/binding/consumption) |
| Classification | Closure path = **Option A (generalize CST adapter)**, `[DESIGN]/[OPEN]` — needs new per-action metadata + durability + frozen-surface changes |
| Certification | `mail.send` stands; 28 not certifiable for coverage as-is |
| Next gate | Separately-authorized Option-A design→implementation (or irreversible-subset first) |

## STOP
Read-only design investigation complete. No code, no tests, no commit, no push, no frozen surface changed.
