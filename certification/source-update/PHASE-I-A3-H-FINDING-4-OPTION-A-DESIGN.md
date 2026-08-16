# Phase I-A.3 — H-FINDING-4 Option-A Design Investigation (READ-ONLY)

Parameterized CST governed-action adapter for the 28 non-`mail.send` M365 write actions. **No
production/test/frozen-surface change, no commit, no push.** Baseline HEAD `9ef3914`, branch
`cert/data-import-cst-integration`. Labels: `[PROVEN]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository baseline `[PROVEN]`
HEAD `9ef3914`; clean except two prior read-only docs. Matches expected state.

## 2. Investigation scope
Whether the **existing CST kernel** can back a parameterized governed-action adapter for the 28 IPC
write actions via **per-action metadata**, preserving `mail.send`, without a new authority — and,
separately, what **durability** model certifiability requires.

## 3. Current H-FINDING-4 state `[PROVEN]`
Worker ingress governed (Boundary B + durable consumption). IPC non-`mail.send`: RBAC + ownership +
scope + token + confirmation + pre-effect denial `[PROVEN]`; no exact binding / decision identity /
durable consumption / replay / restart / concurrency-safe single-use / renderer exclusion `[NOT PROVEN]`.

## 4. CST kernel analysis (`node_modules/@neuropause/cst/src/kernel.ts`) `[PROVEN]`
`CstKernel.run(req: TransitionRequest, effect: Effect)` is **fully generic / action-agnostic**. Pipeline:
`identify → govern → approval → CLAIM → revalidate → idempotency → execute → observe → verify → evidence`.
| Property | Source | Class |
|---|---|---|
| request structure | `TransitionRequest` (actor, action, consequence, target, approval?, idempotencyKey, expectedPostState, evidence, quantities?, relationships?) | `[PROVEN]` |
| authorization | `policy.evaluate(actor.id, action, consequence)` (`:156`) | `[PROVEN]` |
| tenant isolation | `actor.tenantId === target.tenantId` (`:150`) | `[PROVEN]` |
| approval binding/scope/expiry/consumed/constraints/SoD | `:199-252` (NP-NC-03/04/05/14/15) | `[PROVEN]` |
| **atomic claim (concurrency)** | `claims.claimAtomic(key, actor)` — "one atomic winner, or none" (`:264-272`, NP-NC-07) | `[PROVEN]` |
| **idempotency (replay)** | `idempotency.acquire(key)` → fresh/DONE/IN_FLIGHT; replay returns original, never re-executes (`:283-346`, NP-NC-08) | `[PROVEN]` |
| **preflight reconcile (restart)** | `reconcile(key)` before effect (`:353-366`, NP-NC-16) | `[PROVEN]` (needs reconciler + durable intent) |
| crash / lost-response | exception ⇒ IN_FLIGHT stays, HOLD OUTCOME_UNKNOWN, never re-execute (`:387-402`, NP-NC-13) | `[PROVEN]` |
| denial-before-effect | every `halt(...)` returns `executed:false` **before** `effect()` (`:83-96`) | `[PROVEN]` |
| effect at-most-once | single `await effect(...)` (`:388`), fencing token | `[PROVEN]` |
| post-state verification | authoritative observe; UNKNOWN never promoted (`:406-456`) | `[PROVEN]` |
**The kernel already provides every generic governance control** the worker path was built to provide.
Its ASSURANCE LEVEL is set by the injected `claims`/`idempotency` stores + `reconcile`.

## 5. governedSend analysis (`cst/sendTransition.ts`) `[PROVEN]`
Mail-specific **adapter** over the generic kernel. Hardcoded: `RESOURCE_TYPE='m365-send'` (`:61`),
`SEND_ACTION='connectors.m365.send'` (`:63`), `consequence='C3'` (`:179`), `reversibility='IRREVERSIBLE'`
(`:214`), `expectedPostState={sendResolved:true}` (`:183`), **Profile A** (no remote observation).
Generic: `idempotencyKey=sha256(tenant|connector|account|action.id|params)` (`:158`), scope check via
`action.scopes` (`:175`), `action.run` as effect (`:266`), stores `createGovernedSendPorts()` =
**in-memory** `ClaimStore`+`IdempotencyStore` (`:96`, declared Node-20 limit `:89`).

## 6. WriteAction analysis (`connectors/m365/actionSdk.ts:36-43`) `[PROVEN]`
`WriteAction = { id, label, domain, scopes, mutates, run }`. **No governance metadata**: no
consequence, reversibility, resourceType, policy-action, profile, expectedPostState, or parameter
sensitivity. That is the missing input a parameterized adapter needs.

## 7. Proposed governance metadata model (DESIGN — NOT added) `[DESIGN]`
Per-action metadata a `governedAction` adapter would require, and whether source provides it:
| Field | Why | Source today | Derivable? | New authority? | Frozen surface |
|---|---|---|---|---|---|
| consequence (C-class) | kernel needs it for approval-required logic | absent (send hardcodes C3) | per-action decision | no | actionSdk.ts / new registry |
| reversibility | outcome/verification profile | absent (`WriteAction` has none) | from verb/semantics `[INFERRED]` | no | actionSdk.ts |
| resourceType / policy-action id | approval scope + policy grant | send hardcodes | per-action constant | no | actionSdk.ts + policy |
| expectedPostState / profile | verification (Profile A vs B) | send hardcodes Profile A | per-action | no | actionSdk.ts |
| confirmation requirement | already `mutates` | **present** (`mutates`) | yes | no | — |
| binding/params sensitivity | idempotencyKey scope | params already hashed generically | yes | no | — |
None require a **new authority source** (actor/tenant/policy exist). All are **static per-action
metadata**, but the field carrier (`WriteAction`) is a **frozen surface**.

## 8. Parameterized governed-action architecture (DESIGN) `[DESIGN]`
```
WriteAction + per-action metadata → governedAction(adapter) → CstKernel.run → action.run → effect
```
Additive sibling to `governedSend`, both over the SAME kernel:
```
                 CstKernel (unchanged)
            ┌──────────┴───────────┐
       governedSend            governedAction
        (mail.send)         (other 28 M365 writes)
```
**Structurally supported by existing abstractions** — the kernel takes a generic `TransitionRequest`
+ `Effect`; `governedSend` is proof a domain adapter composes cleanly. `[DESIGN feasible]`

## 9. Exact binding analysis `[DESIGN]`/`[PROVEN]`
CST binds the approval to `target{tenantId,resourceType,resourceId}` + `action` (NP-NC-05, `kernel:224-228`)
and binds params via the content `idempotencyKey`. **Key distinction from the worker path:** the IPC
model **authorizes-and-executes in one call** over the renderer's inputs (the confirmation IS the
decision over these exact inputs) — there is **no prior approved binding to diff against**, so worker-
style "execution matches a pre-existing decision" is **not applicable** (and not needed). The binding
guarantee is "this confirmation authorizes exactly this target/action/params", true by construction in
a single governed call. `[DESIGN]` Renderer still supplies target/params (direct-action model, §18).

## 10. Canonicalization analysis `[PROVEN]`/`[OPEN]`
CST's `idempotencyKey` uses `JSON.stringify(params)` inside a sha256 (`sendTransition.ts:158-162`) —
**NOT** the repo's canonical JSON. `JSON.stringify` is **order-sensitive** and rejects nothing, so
`{a,b}` vs `{b,a}` hash differently ⇒ the same semantic action could produce two keys, weakening
dedup. The worker path uses `util/canonicalJson` (sorted keys, fail-closed) for its digest. A
generalized adapter SHOULD canonicalize params, but the current CST key does not. **Reusing the
existing CST key as-is is `[NOT PROVEN]` sufficient for "same action ⇒ same binding"**; a canonical
form is a design requirement (do not invent the rule here). `[OPEN]`

## 11. Identity analysis `[PROVEN]`
IPC actor = `deps.actor()` = `displayName ?? email`; worker = `user.id`. CST consumes `actor.id`
generically. A generalized adapter could pass `user.id` for a stronger identity, but that changes CST's
authorization identity (frozen wiring). IDENTITY DIFFERENCE — OPEN (unchanged from mail.send).

## 12. Decision-identity analysis `[PROVEN]`
CST distinguishes: `transitionId` (claim/atomicity key), `requestId` (request instance), `idempotencyKey`
(content/replay), `executionId` (per-attempt). **CST does NOT need the worker `decisionId`** — its
governance is self-contained (approval + atomic claim + idempotency). So the generic model does **not**
require unifying with `proposal.verdict.requestId`. `idempotencyKey ≠ decisionId` semantically
(content vs governance-decision) — **not unified** (correct). `[PROVEN]`

## 13. Consumption-identity analysis `[PROVEN]`
The consumption/replay key is the `idempotencyKey` (content hash). The atomicity key is `transitionId`.
Both are per-transition, derived from tenant/connector/account/action/params — **generic**, works for
any action. `[PROVEN]` (subject to §10 canonicalization).

## 14. Durability analysis (the separate sub-gate) `[PROVEN]`/`[OPEN]`
- CST in-memory stores (`stores.ts` `ClaimStore`/`IdempotencyStore`): **in-process atomic claim** +
  **process-lifetime idempotency**; **NOT restart-durable**. `[PROVEN]`
- **CST ships a durable store** (`durable.ts` `DurableStore`/`DurableIdempotencyStore`/`DurableClaimStore`):
  SQLite, PRIMARY-KEY single-winner claims, intents that **outlive the process**, fencing tokens, lease
  takeover. `[PROVEN it exists]`
- **But it needs `node:sqlite` (Node ≥22)**; the app declares a **Node-20 durability limit**
  (`sendTransition.ts:24,89`; `importTransition.ts:12`), `engines.node >=20.11.0`, and **`DurableStore`
  is wired NOWHERE** in the app. `[PROVEN blocked at runtime]`
- Existing durable authority reusable? The worker `ExecutionStore` (atomic fs.rename JSON, Node-20-safe)
  is durable but **worker-scoped** — reusing it for IPC CST intents = **cross-domain coupling** to a
  frozen surface, semantically questionable. `[OPEN]`
- **Certifiable durability TODAY = process-lifetime idempotency + in-process atomic concurrency** (=
  `mail.send` parity), **NOT restart-durable**. Restart-durable single-use for the IPC path requires
  either node:sqlite runtime support, or a **new** Node-20 durable store (forbidden here), or reusing
  ExecutionStore (coupling). `[OPEN]`
Separations preserved: process-lifetime idempotency ≠ restart-durable single-use ≠ hard-power-loss.

## 15. Replay analysis `[PROVEN]`/`[OPEN]`
Kernel idempotency (NP-NC-08) suppresses a replay of the SAME key without re-executing, in-process.
Restart replay: only safe with a durable intent + reconciler (§14) ⇒ `[OPEN]` today. Profile-A
`reconcile → {known:false}` ⇒ IN_FLIGHT replay HOLDs (never re-sends) — safe but not "resolved".

## 16. Concurrency analysis `[PROVEN]`/`[OPEN]`
`claimAtomic` is single-winner **within a process** (in-memory) — CHECK→RESERVE atomic (NP-NC-07).
Cross-process/host single-winner needs the SQLite `DurableStore` (unavailable) ⇒ cross-process
concurrency `[OPEN]`. In a single-process Electron main, in-process atomicity is the operative scope.

## 17. Crash / lost-response analysis `[PROVEN]`
Kernel semantics defined: crash-before-admission (no intent), crash-after-admission/before-effect
(intent IN_FLIGHT → reconcile, never re-execute), crash-during/after-effect (IN_FLIGHT/UNKNOWN → HOLD),
retry (reconcile or HOLD). **With in-memory stores these hold only within the process lifetime**;
restart resets them ⇒ durability caveat (§14). `[PROVEN semantics]/[OPEN durability]`

## 18. Renderer-trust analysis `[PROVEN]`
`M365ActionExecuteRequest` non-strict; renderer supplies connector/account/action/params/confirmed.
A governedAction adapter would govern them exactly as `governedSend` governs mail.send inputs
(authorize-and-execute over the caller's inputs). This is the intended **direct-action** trust model,
not renderer exclusion — unchanged from the certified mail.send path. `[PROVEN]`

## 19. Mail.send regression analysis `[PROVEN/DESIGN]`
Additive design: `governedSend` unchanged for `mail.send`; `governedAction` new for the 28; kernel
shared and unmodified. mail.send negative controls, denial, idempotency, policy, effect reachability
are untouched. **ADDITIVE, not replacement** `[DESIGN, structurally supported]`.

## 20. 28-action feasibility matrix `[DESIGN]/[INFERRED]`
All 28 share: worker ingress governed `[PROVEN]`; IPC currently partial `[PROVEN]`; CST-compatible
(effect = `action.run`, scopes present, params hashable) `[DESIGN]`; need per-action metadata `[OPEN]`;
process-lifetime idempotency feasible `[DESIGN]`; restart-durable `[OPEN]`; canonical params needed
`[OPEN]`. Per-domain effect type (from adapters): mail-write (send-like reply/replyAll/forward =
external-comm; move/markRead/restore/addAttachment/saveDraft = data-mutating; delete = destructive);
calendar (create/update = mutating; delete = destructive; invite/respond = external-comm); drive
(upload/rename/move/createFolder/restoreVersion = mutating; delete = destructive; share = permission-
changing); teams (all sends = external-comm; createChannel = mutating); contacts (create/update =
mutating; delete = destructive). No action is CST-incompatible; none needs a new authority. `[DESIGN]`

## 21. Risk ordering `[INFERRED]`
Cohort 1 (highest assurance need, do first): external-communicative + destructive + permission-changing
— mail.reply/replyAll/forward, calendar.invite/respond, teams.sendChannelMessage/replyChannelMessage/
sendChatMessage, mail.delete, calendar.delete, drive.delete, contacts.delete, drive.share.
Cohort 2: reversible data-mutating — the remainder. Basis: HTTP verb + external visibility (`[INFERRED]`;
`WriteAction` declares no reversibility field, so this is not a source-declared classification).

## 22. Option A/B/C/D comparison `[DESIGN]`
| | A: param CST adapter | B: executor-level | C: new decision contract | D: independent coverage |
|---|---|---|---|---|
| Source compatibility | HIGH (kernel generic) | rebuilds kernel controls | duplicates worker | principle only |
| Duplication | none (reuse kernel) | high | high | n/a |
| New authority | NO | NO | likely | NO |
| Binding | CST approval+idem | must build | new claim | per-ingress |
| Durability | in-memory now / durable OPEN | needs new store | needs new store | inherits |
| Frozen surfaces | actionSdk, sendTransition/new adapter, connectors | m365 executor + new store | contracts + store | none |
| Risk | moderate (additive) | high | high | low but leaves gap |
| mail.send impact | none (additive) | none | none | none |
| Certification strength | mail.send parity (durable OPEN) | rebuild | strong but heavy | partial |
**A is the realization mechanism for D's coverage of the IPC ingress.**

## 23. Frozen-surface impact `[DESIGN]`
Would require (NOT modified here): `actionSdk.ts` (per-action metadata) or a new metadata registry;
`sendTransition.ts` or a new `governedAction.ts`; `connectors/index.ts` (route non-mail.send through
the adapter). **CST kernel: NO change.** Durable restart-safety: node:sqlite runtime OR a new store.

## 24. Required implementation scope (for a future authorized gate) `[DESIGN]`
(1) per-action governance metadata; (2) a `governedAction` adapter (parameterized `governedSend`);
(3) route the 28 IPC actions through it; (4) canonicalize params for the idempotencyKey; (5) durability
decision (declare in-memory parity, or wire a durable store when the runtime allows). Additive; kernel
untouched.

## 25. Required tests (future gate) `[DESIGN]`
Per-action: authorized/confirmed → effect once; unauthorized/unowned/unscoped/unconfirmed → deny,
effect 0; replay (same params) → suppressed, effect 0; concurrent duplicate → ≤1; modified params →
different key (not a silent second send under canonicalization); mail.send controls unchanged
(regression). Restart-replay only if durable store wired.

## 26. Migration considerations `[DESIGN]`
Additive routing: `mail.send` stays on `governedSend`; the 28 move from raw `m365.execute` to
`governedAction`. Behavior change for the 28: adds idempotency + governed denial semantics (a confirmed
duplicate would be suppressed rather than re-sent) — a strengthening, but a behavior change to verify.

## 27. Rollback considerations `[DESIGN]`
Because it is additive and routed at `connectors/index.ts`, rollback = restore the `m365.execute`
branch. No schema/store migration if durability stays in-memory. `[DESIGN]`

## 28. Certification implications `[PROVEN]`/`[OPEN]`
Option A can bring the 28 IPC actions to **`mail.send`-parity** governance (authoritative pre-effect
authorization + approval binding + in-process atomic claim + process-lifetime idempotency + denial-
before-effect) **additively, reusing the unchanged CST kernel**. It does **not** reach worker-parity
(durable restart-safe consumption) without resolving the Node-20/durable-store `[OPEN]`. Not certifiable
today (unimplemented); the DESIGN is source-supported for parity.

## 29. H-FINDING-4 status `[OPEN]`
Design path CONFIRMED (Option A, additive CST governed-action adapter). Closure requires a separately-
authorized implementation gate + a durability decision. Coverage for the 28 remains **NOT PROVEN** until
then. `mail.send` certification unchanged.

## 30. Recommended next gate `[DESIGN]`
A **separately-authorized** implementation gate for a `governedAction` CST adapter + per-action metadata,
scoped first to Cohort 1 (irreversible/destructive/permission-changing), declaring **process-lifetime
idempotency parity** with `mail.send` and treating **restart-durable consumption as a distinct OPEN
sub-gate** (node:sqlite or a Node-20 durable store). Canonicalize params. Additive; kernel untouched.

---

## H-FINDING-4 — OPTION-A DESIGN STATUS
| Property | Status |
|---|---|
| CST kernel genericity | `[PROVEN]` fully generic / action-agnostic |
| governedSend genericity | `[PROVEN]` mail.send-specific adapter (hardcoded resource/action/consequence/reversibility/profile) |
| WriteAction metadata | `[PROVEN]` absent — needs per-action governance metadata |
| Exact binding | `[DESIGN]` CST binds approval→target/action + idem→params; single-call authorize-and-execute (no prior-decision diff) |
| Canonicalization | `[NOT PROVEN]` CST key uses `JSON.stringify` (order-sensitive); canonical form is a design requirement |
| Decision identity | `[PROVEN]` CST self-contained (transitionId/idempotencyKey); worker decisionId NOT required |
| Consumption identity | `[PROVEN]` idempotencyKey (content) generic across actions |
| Durable consumption | `[OPEN]` in-memory today; DurableStore exists but node:sqlite/Node-20 blocked, wired nowhere |
| Replay safety | `[PROVEN]` in-process; `[OPEN]` restart |
| Concurrency safety | `[PROVEN]` in-process atomic claim; `[OPEN]` cross-process |
| Restart safety | `[OPEN]` (needs durable intent + reconciler) |
| Lost-response semantics | `[PROVEN]` kernel IN_FLIGHT→reconcile/HOLD, never re-execute |
| Renderer trust | `[PROVEN]` direct-action model, governed (not exclusion) — unchanged from mail.send |
| Mail.send preservation | `[DESIGN]` additive sibling adapter; kernel unchanged |
| 28-action compatibility | `[DESIGN]` all CST-compatible; none needs new authority |
| Universal M365 governance | `[NOT PROVEN]` / not claimed |

**RECOMMENDED OPTION:** A (parameterized CST governed-action adapter + per-action metadata, additive).
**REASON:** the CST kernel already provides every generic governance control; only an adapter +
per-action metadata + routing are missing; it reuses the kernel unchanged and preserves mail.send.

**FROZEN SURFACES THAT WOULD REQUIRE AUTHORIZATION:** `connectors/m365/actionSdk.ts` (metadata),
`connectors/index.ts` (routing), `cst/sendTransition.ts` or a new `cst/governedAction.ts`. Kernel: none.

**NEW AUTHORITY REQUIRED:** NO.
**NEW DURABLE STORE REQUIRED:** NO for mail.send-parity (in-memory) · OPEN for restart-durable.
**NEW DECISION CONTRACT REQUIRED:** NO (CST approval + idempotency are self-contained).
**IMPLEMENTATION READY:** NO (needs a separately-authorized gate).
**CERTIFIABLE TODAY:** NO (unimplemented).

### PERMITTED CLAIM
> "The CST kernel is generic and action-agnostic and already provides authoritative pre-effect
> authorization, atomic single-winner claim, idempotency/replay handling with reconciliation, and
> denial-before-effect for any (actor, action, target, params) transition. `governedSend` is a
> `mail.send`-specific adapter over that kernel. A parameterized `governedAction` adapter plus
> per-action governance metadata could bring the 28 non-`mail.send` M365 IPC write actions to
> `mail.send`-parity governance (process-lifetime idempotency + in-process atomicity + denial-before-
> effect), additively and without changing the kernel or a new authority — this is a source-supported
> DESIGN, not an implemented or certified result. Restart-durable single-use remains OPEN (Node-20/
> node:sqlite), and the current CST idempotency key is not canonicalized."

### NON-CLAIMS
No universal M365 governance · no universal NeuroPause OS certification · no shared worker/IPC decision
identity · no durable CST replay protection (in-memory today) · no exact IPC binding in the worker
sense · no renderer exclusion · no provider idempotency · no effect/verified success · no mechanism
equivalence · no implementation authorization · Option A is NOT proven implemented.

### NEXT GATE
Separately-authorized implementation gate for the `governedAction` adapter + per-action metadata
(Cohort 1 first), with a distinct durability sub-gate. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## STOP
Read-only design investigation complete. No code, no tests, no commit, no push, no frozen surface changed.
