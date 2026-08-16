# Phase I-A.3 — M365 Write/Action Effect-Domain Inventory (READ-ONLY)

**No production/test/frozen-surface changed. No commit, no push.** Baseline HEAD `9ef3914`,
branch `cert/data-import-cst-integration`, working tree clean. Labels: `[PROVEN]` / `[INFERRED]`
/ `[DESIGN]` / `[OPEN]` / `[NOT PROVEN]`.

## 1. Repository baseline `[PROVEN]`
HEAD `9ef3914` (mail.send governed-ingress coverage committed). Clean tree.

## 2. Scope
All **consequential (`mutates:true`) Microsoft 365 write actions** and their ingresses. `mail.send`
is already certified (prior gate); its scoped closure is **not** generalized here.

## 3. Effect-domain inventory `[PROVEN]` (`connectors/m365/{mail,calendar,drive,teams,contacts}.ts`)
**29 consequential actions** (6 read-only excluded). Each `run` is a Graph write.
- **mail (10):** `send`*, `saveDraft`, `reply`, `replyAll`, `forward`, `move`, `markRead`, `delete`, `restore`, `addAttachment` (`mail.ts:131-140`). (* certified.)
- **calendar (5):** `create`, `update`, `delete`, `invite`, `respond` (`calendar.ts:103-107`).
- **drive (7):** `upload`, `rename`, `move`, `delete`, `createFolder`, `share`, `restoreVersion` (`drive.ts:165-172`).
- **teams (4):** `sendChannelMessage`, `replyChannelMessage`, `sendChatMessage`, `createChannel` (`teams.ts:137-140`).
- **contacts (3):** `create`, `update`, `delete` (`contacts.ts:98-100`).
Several are **IRREVERSIBLE** (sends, invites, forwards, deletes) — the same reversibility class CST
treats specially for `mail.send`.

## 4. Known ingress inventory `[PROVEN]`
Re-verified all callers of the consequential path (`grep`, non-test): `runtimeCore.ts:2509` (worker
`runBinding`), `connectors/index.ts:481` (`governedSend`, mail.send IPC), `connectors/index.ts:500`
(`m365.execute`, all OTHER actions IPC). `action.run` only via those two executors. **No third
ingress** (no automations/webhooks/AI/assistant caller). Search scope: `apps/desktop/src/main`.
```
Each consequential M365 action
   ├── INGRESS W (worker): approval → claim → Boundary B → runBinding → M365Executor.execute
   └── INGRESS I (M365 IPC): renderer → M365ActionExecute → { mail.send: governedSend | else: M365Executor.execute }
```

## 5. Source map `[PROVEN]`
IPC handler `connectors/index.ts:467-502`; schema `M365ActionExecuteRequest` `contracts.ts:465`;
executor `connectors/m365/executor.ts:78-` (gates at :96 ownsAccount, :101 confirmed, :108 scope,
:113 token, then `action.run`); worker `runtimeCore.ts:2493-2540` (m365 :2508); Boundary B
`workforce/execution/boundaryB.ts`; CST `cst/sendTransition.ts`; executor tests `m365Write.test.ts`.

## 6. Request schema / trust boundary `[PROVEN]`
`M365ActionExecuteRequest` = `{ connectorId, accountId, actionId, params, confirmed }`, **NOT
`.strict()`** (`contracts.ts:465`). Field classification for the IPC ingress:
| Field | Class |
|---|---|
| connectorId (target) | **CALLER-CONTROLLED** |
| accountId | **CALLER-CONTROLLED**, but bound to workspace ownership by `ownsAccount` (`executor.ts:96`) `[PROVEN]` |
| actionId | **CALLER-CONTROLLED** |
| params (the consequential content) | **CALLER-CONTROLLED**, **not** bound to any authorization decision `[PROVEN]` |
| confirmed | **CALLER-CONTROLLED** boolean |
| actor | AUTHORITATIVE — `deps.actor()` (not caller) |
| tenant | AUTHORITATIVE — `deps.workspaceId()` (not caller) |
| decision / claim / policy / binding / correlationId | **absent** on this path |
Worker ingress: renderer supplies **none** of these (`ExecuteRunRequest` `.strict()`).

## 7. Actor identity `[PROVEN]`
Worker: `session.user.id`. M365 IPC: `deps.actor()` = `displayName ?? email` (`runtimeCore.ts:479-483`).
**IDENTITY DIFFERENCE — OPEN** (same as mail.send; not equivalence).

## 8. Tenant identity `[PROVEN]`
Worker: `activeTenantScope().tenantId` (org). M365 IPC: `deps.workspaceId()` (workspace).
`workspaceId != tenantId` (different granularity). **TENANT DIFFERENCE — OPEN** (not asserted equal).

## 9. Authority / governance `[PROVEN]`
- **Worker ingress (all 29):** Boundary B (`verifyBoundaryB`) before `runBinding` + Step-5 durable
  `decisionId` consumption. **GOVERNED** `[PROVEN]` (mechanism proven Step 4; action-agnostic).
- **M365 IPC — mail.send:** CST kernel (`governedSend`). **GOVERNED** `[PROVEN]` (certified).
- **M365 IPC — other 28:** `M365Executor.execute` — ownsAccount → confirmed → scope → token →
  `action.run`, all pre-effect. **PARTIALLY GOVERNED** `[PROVEN]`: authorization + confirmation +
  pre-effect denial are present; **no decision claim, no exact binding, no idempotency/consumption**.
  RBAC (`connectors:manage`, `gateConnectorHandlers`) gates the channel. **RBAC + confirmed is NOT
  equivalent to Boundary B or to CST** (explicitly not claimed).

## 10. Decision identity `[PROVEN]`/`[NOT PROVEN]`
Worker: `proposal.verdict.requestId` (authoritative, unique, durable, links to execution) `[PROVEN]`.
M365 IPC other-28: the "decision" is the caller's `confirmed:true` boolean — **no authoritative
decision id, no requestId, no idempotencyKey, no approval id** on the executor path. `[NOT PROVEN]`
(absent). mail.send IPC has a CST `requestId`/`idempotencyKey` (not shared here).

## 11. Binding `[PROVEN]`/`[NOT PROVEN]`
Worker: 8-field digest, recomputed + verified at Boundary B ⇒ **EXACT BINDING PROVEN**.
M365 IPC other-28: the executor consumes caller-supplied `connectorId/accountId/actionId/params`
directly; `accountId` is ownership-bound `[PROVEN]`, but **target/actionId/params are NOT bound to
any authorization decision** — no digest, no claim to verify against. ⇒ **PARTIAL BINDING** (account
ownership only); the consequential content (which file/event/message) is unbound. `[NOT PROVEN]` exact.

## 12. Consumption / idempotency `[PROVEN absent]`
Worker: durable `decisionId` (ExecutionStore, restart-hydrated, concurrency-safe) `[PROVEN]`.
M365 IPC other-28: **NONE.** `M365Executor.execute` has no idempotency/consumption (only
`governedSend`/CST does, only for mail.send). ⇒ a confirmed duplicate **sends again**; concurrent
duplicates ⇒ two effects; restart ⇒ no replay memory. `[PROVEN absent / OPEN]`

## 13. Final enforcement point `[PROVEN]`
IPC other-28: last gate before effect = the executor sequence (ownsAccount → confirmed → scope →
token) at `executor.ts:96-119`, all **before** `action.run`. Unknown/unconfirmed/unscoped/unowned
requests are refused pre-effect. **BUT** a valid-shaped, confirmed, owned, scoped request with
**caller-controlled target/params** reaches the effect — and a **replay** reaches the effect again.

## 14. Effect reachability `[PROVEN]`
- Deny (unknown/unconfirmed/unscoped/foreign-account) ⇒ effect NOT reached `[PROVEN]` (§15).
- Authorized + confirmed ⇒ effect reached (as intended).
- **Replay of an authorized action ⇒ effect reached AGAIN** (no consumption) `[PROVEN absent]`.

## 15. Negative-control evidence (`m365Write.test.ts`) `[PROVEN]`/`[NOT PROVEN]`
Existing executor controls (action-agnostic; the gate logic keys on `mutates`/`scopes`, not the id):
| Category | Evidence | Status |
|---|---|---|
| unknown action | "refuses an unknown action" | `[PROVEN]` |
| missing confirmation | "refuses a mutating action without confirmation" — `events=0` | `[PROVEN]` deny-before-effect |
| missing scope | "fails closed when the required Graph scope is not granted" | `[PROVEN]` |
| foreign account (identity/ownership) | "refuses an account the caller's workspace does not own — BEFORE any other gate" — `events=0`, nothing reached Graph | `[PROVEN]` deny-before-effect |
| valid path | "executes a confirmed, scoped write + audit" | `[PROVEN]` |
| modified target / modified params | — | `[NOT PROVEN]` (no binding to violate) |
| expired authorization | — | `[NOT PROVEN]` (no temporal claim on this path) |
| replay | — | `[NOT PROVEN]` (no consumption; PROVEN absent) |
| concurrent duplicate | — | `[NOT PROVEN]` (no consumption) |
| restart replay | — | `[NOT PROVEN]` (no durable consumption) |
| renderer tampering (params) | — | `[NOT PROVEN]` (params accepted as-is) |
Per Part 11: **no new tests written**; absent proofs recorded as NOT PROVEN.

## 16. Renderer-control analysis `[PROVEN]`
On the IPC other-28 path the renderer controls the consequential fields (target/actionId/params) and
the confirmation boolean. The only authoritative binding is `accountId → workspace ownership`. The
confirmation is **generic** ("this modifies data"), **not** bound to the specific target/params. So a
single `confirmed:true` authorizes deleting/sending/modifying **any owned resource** the caller names.

## 17. Restart/replay analysis `[OPEN]`
No consumption ⇒ no replay protection across restart or duplicate submission for the 28. (mail.send
IPC has in-memory CST idempotency; worker has durable consumption.)

## 18. Concurrency analysis `[OPEN]`
No serialization on the executor path ⇒ concurrent duplicates each reach the effect.

## 19. Option-D applicability `[NOT PROVEN]`
The Option-D principle requires **every** known ingress to have authoritative pre-effect governance
**and** demonstrable denial-before-effect **and** defined replay/idempotency semantics. For the 28:
- Worker ingress: satisfies all (Boundary B + durable consumption). `[PROVEN]`
- M365 IPC ingress: satisfies authorization + confirmation + denial-before-effect `[PROVEN]`, but has
  **no defined replay/idempotency control and no exact binding**. `[NOT PROVEN]`
⇒ **Option-D effect-domain coverage is NOT PROVEN for the 28 non-mail.send consequential actions.**

## 20. Effect-domain coverage classification
- **mail.send:** already **certified** (prior gate) — unchanged.
- **Other 28 (mail write ×9, calendar ×5, drive ×7, teams ×4, contacts ×3):**
  **COVERAGE = NOT PROVEN.** Worker ingress governed `[PROVEN]`; M365 IPC ingress **partially
  governed** (authorization + confirmation + pre-effect denial, but no idempotency/consumption, no
  exact binding, no decision identity, renderer-controlled consequential fields).
  **Classification to close the gap: OPTION C** — reaching mail.send-parity coverage on the IPC ingress
  requires a durable consumption/idempotency primitive + an authoritative binding/decision for these
  actions (not present, and not derivable without new authority). This is a **separately authorized
  gate**; not chosen to force closure.

## 21. H-FINDING-3 impact `[PROVEN]`/`[OPEN]`
- The `mail.send` scoped closure is **unchanged** (not reopened).
- These 28 are **not** a new bypass introduced by this work — the RBAC+confirmed executor path is
  pre-existing. But relative to the certification principle they are a **new coverage FINDING**:
  consequential M365 write actions (including IRREVERSIBLE ones) have **only partial governance** at
  the M365 IPC ingress (authorization + confirmation, **no** replay/binding/decision control).
- Recommend a new finding id (e.g. **H-FINDING-4: M365 non-mail.send IPC write actions lack durable
  replay control and exact-binding governance**) and a separate integration gate. `[DESIGN]`

## 22. Newly discovered discrepancies `[PROVEN]`
None that block the investigation; the material finding is §20/§21 (partial IPC governance for the 28).
No source could-not-be-traced condition arose; no STOP condition triggered.

## 23. Frozen surfaces that would be required for implementation (Part 16 — NOT modified) `[DESIGN]`
Closing the gap would touch: `connectors/index.ts` (IPC handler routing), `connectors/m365/executor.ts`
(add durable consumption/binding), `packages/shared/src/ipc/contracts.ts` (strict schema / carried
context), possibly a durable idempotency store, and identity/tenant wiring for normalization. **All
frozen — separate authorization required.** Required invariant currently missing: *no consequential
M365 IPC write effect (beyond mail.send) is admitted twice, and its target/params are bound to the
authorization.* Minimum change: add durable idempotency + bind params to the confirmation at the
executor/IPC seam — a new authorized gate (do NOT invent a decision contract or store here).

## 24. Recommended next gate `[DESIGN]`
A **read-only design investigation** for closing H-FINDING-4: options to give the M365 IPC write path
(a) durable idempotency/consumption and (b) target/params-bound authorization — evaluating whether
CST (`governedSend`) generalizes to non-mail.send actions, or a minimal executor-level idempotency
extension suffices, and whether the worker ingress already provides sufficient coverage for
worker-originated actions. Then a separately-authorized implementation gate.

## 25. Explicit non-claims
NOT claimed: all M365 actions governed · all enterprise actions governed · universal governance ·
mechanism equivalence · that RBAC+confirmed equals Boundary B or CST · replay protection for the 28
IPC actions · exact binding for the 28 IPC actions · shared consumption · durable IPC idempotency ·
provider idempotency · effect/verified success. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## STOP
Read-only inventory complete. Coverage for the 28 non-mail.send consequential M365 write actions is
**NOT PROVEN** at the M365 IPC ingress. No code, no tests, no commit, no push, no frozen surface changed.
