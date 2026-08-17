# Phase I-A.3 — M365 Remaining-15 Write/Action Effect-Domain Inventory (READ-ONLY)

**No production/test/frozen-surface change, no commit, no push.** Baseline HEAD `dc9e8f3`, branch
`cert/data-import-cst-integration`, working tree clean. Labels: `[PROVEN]`/`[PROVEN-ABSENT]`/
`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `dc9e8f3` (Cohort-1 governance `90527b4` + Option-C durability `dc9e8f3` committed); clean tree.

## 2. Source-derived action inventory `[PROVEN]`
29 mutating (`mutates:true`) M365 actions in `connectors/m365/{mail,calendar,drive,teams,contacts}.ts`.
Excluded: 13 Cohort-1 (governed via `governedAction`, durable) + `mail.send` (via `governedSend`) = 14.

## 3. Exact remaining-action count = **15** `[PROVEN]` (`29 − 14`)
| Domain | Remaining actions |
|---|---|
| mail (5) | `saveDraft`, `move`, `markRead`, `restore`, `addAttachment` |
| calendar (2) | `create`, `update` |
| drive (5) | `upload`, `rename`, `move`, `createFolder`, `restoreVersion` |
| teams (1) | `createChannel` |
| contacts (2) | `create`, `update` |

## 4. Effect-domain classification (by actual adapter semantics) `[INFERRED]`
- **Externally-communicative / notification-capable (higher consequence):** `calendar.create`,
  `calendar.update` — accept an `attendees` param (`calendar.ts:47-48`); Graph POST/PATCH `/me/events`
  with attendees **sends invitations**, so with attendees these are externally-communicative and the
  sent notification is not un-sendable. `teams.createChannel` — creates a team-visible channel
  (collaborative; reversible via delete). `[PROVEN]` the attendees path exists.
- **Reversible internal data mutation (lower consequence):** `mail.saveDraft` (draft, not sent),
  `mail.markRead` (toggle), `mail.move` (folder move), `mail.restore` (un-delete), `mail.addAttachment`
  (to a message/draft), `drive.upload/rename/move/createFolder/restoreVersion` (file ops),
  `contacts.create/update`. `[INFERRED]` from HTTP verb + endpoint.
The 15 are NOT homogeneous — see §12.

## 5. Ingress inventory `[PROVEN]`
Two ingresses per action; no third caller of the effect (re-verified prior gates):
- **Worker:** `runBinding` case `'m365'` (`runtimeCore.ts:2508-2509`) → `M365Executor.execute`, AFTER
  Boundary B (`verifyBoundaryB` gates every m365 binding — Step 4).
- **M365 IPC:** `M365ActionExecute` handler (`connectors/index.ts`) → `mail.send`→`governedSend`;
  `GOVERNED_ACTION_COHORT1.has(id)`→`governedAction`; **else → `m365.execute(...)`** (raw executor).
  **All 15 are NOT in the Cohort-1 set** (verified) → they hit the **raw `m365.execute` fallback**
  (`connectors/index.ts:584`). `[PROVEN]`

## 6. Worker-path analysis `[PROVEN]`
Governed uniformly: Bound Decision Claim + Boundary-B pre-effect verification + durable `decisionId`
consumption (Step-4/5). Action-agnostic; covers all 15 when reached via the worker path.

## 7. IPC-path analysis `[PROVEN]` / `[PROVEN-ABSENT]`
`M365Executor.execute` gates (action-agnostic, `executor.ts:96-119`): ownsAccount → `mutates &&
confirmed` → scope → token → `action.run`. Present: RBAC (`connectors:manage`), account ownership,
scope, token, human confirmation, pre-effect denial `[PROVEN]`. **Absent:** CST, `governedAction`,
Boundary B, decision identity, exact binding, idempotency/consumption, durability `[PROVEN-ABSENT]`.
Identical posture to the 13 Cohort-1 actions BEFORE the `governedAction` adapter.

## 8. Identity analysis `[PROVEN]`
IPC actor = `deps.actor()` (authenticated session `displayName ?? email`, never renderer, null→DENY);
worker actor = `user.id`. Difference is the established per-ingress trust model (unchanged). `[PROVEN]`

## 9. Tenant analysis `[PROVEN]`
IPC tenant = `deps.workspaceId()`; worker = `activeTenantScope().tenantId`. Established difference.

## 10. Authority analysis `[PROVEN]`
IPC (15) = RBAC + ownership + scope + token + confirmation = authorization + pre-effect denial;
**PARTIALLY GOVERNED** (no decision/binding/consumption). Worker = Boundary B (full). RBAC+confirmed
is NOT equivalent to CST/Boundary-B (not claimed).

## 11. Policy analysis `[PROVEN-ABSENT]` (IPC)
The raw executor path applies no CST policy/consequence/approval object — only the boolean `confirmed`
gate. (governedSend/governedAction use a CST `PolicyStore` + C3 approval; the 15 IPC path does not.)

## 12. Decision-identity analysis `[PROVEN-ABSENT]` (IPC)
The 15 IPC "decision" is the renderer `confirmed:true` boolean — no `decisionId`/`requestId`/
`idempotencyKey`/approval object. Worker = `proposal.verdict.requestId`.

## 13. Canonical-identity analysis `[PROVEN-ABSENT]` (IPC as-is) / `[DESIGN]` (if routed)
The raw executor computes no canonical identity. If routed through `governedAction`, the existing
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` would apply unchanged and is
sufficient (params are string/array/object; e.g. `drive.upload`/`mail.addAttachment` carry base64
content strings, which canonicalize fine). `[DESIGN]`

## 14. Binding analysis `[PROVEN-ABSENT]` (IPC)
Raw executor binds only `accountId` (ownership); target/action/params are caller-supplied and unbound.
Worker = exact 8-field digest. If routed through `governedAction`, the single-call authorize-and-execute
binding applies (as for Cohort-1).

## 15. Consumption / idempotency analysis `[PROVEN-ABSENT]` (IPC)
The raw executor has NO idempotency/consumption (write-health telemetry only). A confirmed duplicate
re-executes; concurrent duplicates each execute. Worker = durable `decisionId`. If routed through
`governedAction`, the actions would share `m365ActionPorts` (the committed `DurableIdempotencyStore`) →
single-process restart-durable single-use, no new store. `[DESIGN]`

## 16. Durability analysis `[PROVEN-ABSENT]` (IPC) / `[DESIGN]`
No durability on the raw executor path. Reusable durable store exists (Cohort-1's) if routed. Provider
idempotency is NOT provided by any path (Graph does not dedupe these) — NeuroPause admission ≠ provider
idempotency ≠ effect success.

## 17. Pre-effect-denial analysis `[PROVEN]`
IPC executor denial-before-effect is proven action-agnostically (`m365Write.test.ts`:
unknown/unconfirmed/unscoped/foreign-account → deny, `events===0`, nothing reached Graph). Applies to
all 15 (same gate). `[PROVEN]`

## 18. Executor / effect reachability `[PROVEN]` / `[NOT PROVEN]`
Authorization-failure → executor unreachable → effect 0 `[PROVEN]`. Replay / modified-target /
modified-params / restart controls → `[NOT PROVEN]` (no such control on the raw executor path).

## 19. Renderer-trust analysis `[PROVEN]`
`M365ActionExecuteRequest` non-strict; renderer supplies connector/account/action/params/confirmed. The
15 are governed by authorization + confirmation, NOT renderer exclusion (direct-action model). No
change from Cohort-1's trust posture.

## 20. Provider-idempotency distinction `[PROVEN-ABSENT]`
None of the 15 has provider idempotency; the Cohort-1 durable store proves NeuroPause single-process
admission only, NOT provider dedup, NOT effect success. Must not be conflated.

## 21. Effect-verification status `[PROVEN-ABSENT]`
Profile-A model (no authoritative remote observation) applies; VERIFIED_SUCCESS is unreachable. Effect
success / verification NOT claimed for any of the 15.

## 22. Cross-ingress classification `[PROVEN]`
**OPTION C — different mechanisms, equivalence NOT established** for the 15: worker (Boundary-B/claim/
durable) vs IPC (RBAC+confirmed raw executor). Coverage NOT PROVEN at the IPC ingress. Same posture the
13 Cohort-1 actions had before `governedAction`.

## 23. Comparison with Cohort-1 (Phase-6 answers) `[DESIGN]`
| # | Question | Answer |
|---|---|---|
| 1 | Does `governedAction` already route these? | **No** — not in `GOVERNED_ACTION_COHORT1` `[PROVEN]` |
| 2 | Same connector facts (ownsAccount/scopes/token)? | Yes (same executor deps) `[PROVEN]` |
| 3 | Existing metadata derivation valid? | **Partially** — see #4/#5 |
| 4 | consequence=C3 valid? | Defensible (all mutate → confirmation-gated); conservative for low-risk ones `[DESIGN]` |
| 5 | reversibility=IRREVERSIBLE valid? | **NO** — the 12 reversible actions would be MISLABELED; calendar.create/update are conditionally external. Honest reuse needs PER-ACTION reversibility `[DESIGN/OPEN]` |
| 6 | expectedPostState (Profile A) valid? | Yes (no remote observation oracle) `[INFERRED]` |
| 7 | Canonical identity sufficient? | Yes `[DESIGN]` |
| 8 | Same `action.run` governance assumptions? | Yes (pure Graph write) `[PROVEN]` |
| 9 | Action-specific semantics preventing reuse? | calendar.create/update send invites with attendees → higher consequence than "reversible" `[PROVEN]` |
| 10 | Current durable store covers them? | Yes if routed (shared ports) `[DESIGN]` |
| 11 | New authority required? | **No** `[PROVEN]` |
| 12 | New decision contract required? | **No** `[PROVEN]` |
| 13 | New durable store required? | **No** `[PROVEN]` |
| 14 | Frozen surface touched (future impl)? | `governedAction.ts` (metadata + cohort set) + `connectors/index.ts` (routing); possibly `actionSdk.ts` if per-action reversibility becomes a field; **NO** kernel/store/Node change `[DESIGN]` |
**Core finding:** `governedAction` is STRUCTURALLY reusable (kernel + durable store + canonical
identity), but its UNIFORM Cohort-1 governance class (`C3`/`IRREVERSIBLE`/Profile-A) is NOT honest for
reversible actions. Covering the 15 requires **per-action reversibility (and possibly consequence)
metadata** — the generalization the Option-A design flagged. `[DESIGN]`

## 24. Proposed cohorts (source-grounded, NOT invented) `[DESIGN]`
- **Cohort 2A — externally-visible / notification-capable (higher assurance):** `calendar.create`,
  `calendar.update` (invite side effect when attendees present), `teams.createChannel`. Treat closer to
  Cohort-1; reversibility is PARTIAL (the record is editable/deletable, a sent invite is not).
- **Cohort 2B — reversible internal data mutation (lower assurance):** `mail.saveDraft`, `mail.markRead`,
  `mail.move`, `mail.restore`, `mail.addAttachment`, `drive.upload`, `drive.rename`, `drive.move`,
  `drive.createFolder`, `drive.restoreVersion`, `contacts.create`, `contacts.update`.
Common to both: same connector facts, same `action.run`, same durable store, CST kernel reusable,
`governedAction` reusable IF per-action reversibility metadata is added. No new authority/decision
contract/store. Frozen surfaces a future impl would touch: `governedAction.ts`, `connectors/index.ts`
(+ optionally `actionSdk.ts`).

## 25. Frozen surfaces `[PROVEN]`
Unchanged this gate (read-only): CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend,
`mail.ts`, m365 `executor.ts`, `actionSdk.ts`, BoundDecisionClaim/mint, `ExecuteEngine`/`ExecutionSession`/
`ExecutionStore`, Boundary-B, `workforceActionExecutor`, worker router/index/runtime, `runtimeCore`,
`contracts.ts`, `storeScope.ts`, `package.json`, Node engine.

## 26. H-FINDING-4 status (for the 15) `[OPEN / PARTIALLY GOVERNED]`
Worker ingress governed `[PROVEN]`; M365 IPC ingress authorization + confirmation + pre-effect denial
`[PROVEN]` but no decision/binding/idempotency/durability `[PROVEN-ABSENT]`. **Effect-domain coverage
NOT PROVEN at the IPC ingress.** The committed Cohort-1 (13 + durability) closure is **unchanged**.

## 27. Exact permitted claims
> "There are exactly 15 remaining consequential M365 write actions beyond the certified Cohort-1 and
> mail.send. Each is governed on the worker ingress (Boundary-B + durable decisionId consumption) and,
> on the M365 IPC ingress, is authorized (RBAC + account ownership + scope + token + human confirmation)
> with demonstrated denial-before-effect, but has NO decision identity, exact binding, idempotency, or
> durability on that ingress. The existing CST kernel and the committed durable idempotency store are
> reusable to close the IPC gap, and no new authority, decision contract, or durable store is required;
> however, honest reuse of the governedAction adapter requires per-action reversibility (and possibly
> consequence) metadata, because the 15 are not all irreversible — notably calendar.create/update send
> invitations when attendees are present."

## 28. Exact non-claims
The 15 are NOT: IPC-governed with idempotency/binding/durability · restart-durable on IPC · provider
idempotent · effect-successful · verified · renderer-excluded · mechanism-equivalent across ingresses ·
covered by the Cohort-1 adapter as-is. NOT claimed: universal M365 governance, universal certification.
Cohort-1 closure is NOT extended to these. **IMPLEMENTED ≠ VERIFIED ≠ CERTIFIED ≠ UNIVERSAL.**

## 29. Recommended next gate (design → implementation; separately authorized)
A **Cohort-2 governedAction extension** that (a) adds **per-action reversibility (and consequence)
metadata** so the governance class is honest per action, (b) routes the 15 (or a subset, e.g. Cohort 2B
first as the lowest-risk, then Cohort 2A with the invite semantics reviewed) through the existing
`governedAction` + the committed durable store, reusing the CST kernel unchanged, and (c) proves
denial-before-effect + restart-durable single-use per action. No new authority, decision contract, or
store. Start from `dc9e8f3`. This gate does NOT begin it.

## STOP
Read-only inventory complete. No code, no tests, no commit, no push, no frozen surface changed.
