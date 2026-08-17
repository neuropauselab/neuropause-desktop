# Phase I-A.3 — H-FINDING-4 Cohort-2A Implementation-Readiness (READ-ONLY)

**No production/test/frozen-surface change, no commit, no push.** Baseline HEAD `dc9e8f3`, branch
`cert/data-import-cst-integration`, working tree clean except the remaining-15 inventory doc. Labels:
`[PROVEN]`/`[PROVEN-ABSENT]`/`[INFERRED]`/`[DESIGN]`/`[OPEN]`/`[NOT PROVEN]`.

## 1. Repository state `[PROVEN]`
HEAD `dc9e8f3` (Cohort-1 governance `90527b4` + Option-C durability `dc9e8f3`). Clean tree.

## 2. Cohort-2A scope
`calendar.create`, `calendar.update`, `teams.createChannel` — the externally-visible / notification-
capable subset of the remaining 15. Cohort 2B NOT opened.

## 3. calendar.create analysis (`calendar.ts:58-67`, `eventBody :33-56`) `[PROVEN]`
POST `/me/events` with `eventBody(p, true)`. Params: `subject`, `start`, `end`, `body`/`bodyType`,
`location`, `timeZone`, `attendees[]`, `recurrence`, `onlineMeeting`/`isOnlineMeeting`. **If
`attendees` present → `body.attendees` → Graph SENDS invitations** (external communication). No
attendees → internal-only event. Target/account: `/me/events` on `accountId`; event id is
provider-assigned (not a param). **External consequence IS derivable from params** (attendees present).
Reversible (delete the event) WHEN internal; the sent invite is NOT un-sendable when external. Post-
state: the Graph response echoes an id/webLink — an ACKNOWLEDGEMENT, not an authoritative post-state
read (Profile A). No provider idempotency (two identical creates → two events, unless suppressed).

## 4. calendar.update analysis (`calendar.ts:69-73`) `[PROVEN]` — the pivotal finding
PATCH `/me/events/{eventId}` with `eventBody(p, false)` (only provided fields). Params: `eventId` +
any of the create fields. **Whether it notifies depends on the target event's EXISTING (server-side)
attendees**, which are **NOT in the request params**: changing time/subject/location on an event that
already has attendees triggers update notifications, and that attendee state is invisible to the
request. **Therefore calendar.update's external consequence is NOT fully derivable from params.** Its
`actionId + params` can correspond to an internal-only OR an externally-communicative effect depending
on non-derivable server state. **Answer to the Phase-4 question: NO — calendar.update cannot be
precisely classified from params; it must be governed CONSERVATIVELY (as potentially externally-
communicative).** `[PROVEN]`

## 5. teams.createChannel analysis (`teams.ts:115-123`) `[PROVEN]`
POST `/teams/{teamId}/channels` with `displayName`, `description`, `membershipType`
(standard|private). Creates a **team-visible** channel (collaborative visibility to members; a
standard channel is visible to all team members). No direct email/DM notification in this call.
Reversible via channel delete (PARTIALLY_REVERSIBLE — members may already have seen it). No provider
idempotency (two identical creates → two channels unless suppressed). Params (`teamId`, `displayName`,
`description`, `membershipType`) fully identify the operation.

## 6. Consequence classification `[PROVEN]`/`[INFERRED]`
All three: consequence **C3** (mutating → confirmation-gated; the human `confirmed` flag is the C3
approval) — matches the existing adapter `[PROVEN]`. External-communication:
- calendar.create → external IFF `attendees` present (**param-derivable**).
- calendar.update → external depending on **server-side existing attendees** (**NOT param-derivable**) ⇒ govern conservatively.
- teams.createChannel → externally-VISIBLE (team members), not a direct notification.

## 7. Reversibility classification `[PROVEN]`/`[DESIGN]`
- calendar.create: REVERSIBLE (no attendees) / notification-IRREVERSIBLE (with attendees).
- calendar.update: conditional and NOT param-derivable ⇒ conservatively treat as notification-capable.
- teams.createChannel: PARTIALLY_REVERSIBLE.
**Governing all three at the conservative `IRREVERSIBLE` tier is HONEST (never under-governs)** — they
are the externally-communicative subset and (for update) precision is impossible from params.
Over-labelling calendar.create-without-attendees as IRREVERSIBLE is stronger-than-needed, not unsafe.
A precise param-conditional reversibility for calendar.create is an OPTIONAL refinement, NOT required.
`[DESIGN]`

## 8. External-notification analysis `[PROVEN]`
calendar.create with attendees and calendar.update touching an attended event → Graph emails
invites/updates (irreversible communication). teams.createChannel → in-team visibility. This is why
2A sits at the higher-assurance tier and cannot be treated as "reversible internal" (unlike 2B).

## 9. Identity analysis `[PROVEN]`
IPC actor = `deps.actor()` (authenticated session `displayName ?? email`, never renderer, null→DENY);
worker = `user.id`. Established per-ingress model; unchanged.

## 10. Tenant analysis `[PROVEN]`
IPC tenant = `deps.workspaceId()`; worker = `activeTenantScope().tenantId`. Unchanged.

## 11. Authority analysis `[PROVEN]`
Same connector facts as Cohort-1: ownsAccount + `action.scopes` (Calendars.ReadWrite / Channel.Create)
+ token + `confirmed`, folded into one CST verdict by the adapter. Available for all three.

## 12. Canonical-identity analysis `[DESIGN]` (sufficient)
`sha256(canonicalize({tenantId,connectorId,accountId,actionId,params}))` uniquely represents each
consequential difference: same params → same identity; reordered object keys → same (canonicalize
sorts); different attendee list / subject / target (`eventId`/`teamId`) / membershipType → different
identity. Params are string/array/object → canonicalize handles them. NOTE: identity is over the
REQUEST params — for `calendar.update` this correctly identifies the ACTION; the non-param server-side
attendee state affects CONSEQUENCE (§4), not identity. Two identical creates → same identity → the
second is suppressed (prevents a duplicate event/channel — desirable). `[DESIGN sufficient]`

## 13. Binding analysis `[DESIGN]`
Single-call authorize-and-execute binding (as Cohort-1): the confirmation authorizes exactly these
params in one governed call; a changed consequential param is a different governed request. No
worker-style prior-approval binding exists or is needed on the IPC direct-action path.

## 14. Idempotency analysis `[DESIGN]` (reusable)
Routing through `governedAction` gives the same CST atomic admission + process-lifetime replay
suppression as Cohort-1, plus the committed durable store (§15). No provider idempotency (Graph does
not dedupe) — NeuroPause admission ≠ provider idempotency ≠ effect success.

## 15. Durability analysis `[DESIGN]` (reuse, no new store)
Reuses `cst/durableIdempotencyStore.ts` via the shared `m365ActionPorts` — same tenant scope
(TENANT/OWNER, tenant-embedding key), same synchronous atomic-rename persistence, same canonical
identity, same restart-hydration/replay. Single-process restart-durable single-use applies unchanged.
No new store required. `[DESIGN]`

## 16. Denial-before-effect `[PROVEN]` mechanism / `[NOT PROVEN]` for these ids
The `governedAction` denial-before-effect is proven action-agnostically (`governedAction.negative.test.ts`
using a stub action; `m365Write.test.ts` executor gate). For the SPECIFIC three ids routed through
`governedAction`, dedicated `effectCalls===0` tests do **not yet exist** — the implementation gate must
add them. `[PROVEN mechanism; NOT PROVEN per-id]`

## 17. Failure semantics `[PROVEN]` (mechanism unchanged)
Profile A holds: HttpError/AuthError/RateLimit/Input → EXECUTION_FAILED; NetworkError → UNKNOWN →
reconcile ({known:false}) → HOLD → no blind retry; VERIFIED_SUCCESS structurally unreachable. The Graph
create response (id/webLink/webUrl) is an ACKNOWLEDGEMENT, not an authoritative post-state read — no
special verification semantics required. `[PROVEN]`

## 18. Provider-idempotency distinction `[PROVEN-ABSENT]`
No provider idempotency for any of the three (duplicate create → duplicate event/channel absent
NeuroPause single-use). Graph success = ACKNOWLEDGED, never independently verified.

## 19. governedAction reuse analysis — **CAN THE EXISTING ADAPTER BE REUSED AS-IS? YES** `[DESIGN]`
Every input the adapter needs is available and its derivations are honest for 2A: actor/tenant
(authoritative), connector/account/target/actionId/params, ownership/scopes/token/confirmation,
canonical identity, CST authorization, atomic admission, durable ports, pre-effect denial,
reconciliation, Profile-A failure semantics. Derived governance class: policyAction
`connectors.m365.<id>`, resourceType `m365-write:<domain>`, **consequence C3 (correct)**, **reversibility
IRREVERSIBLE (conservatively honest for this externally-communicative subset)**, Profile A. **No
semantic extension is REQUIRED** for safe/honest 2A governance. (Contrast: Cohort 2B's reversible
actions WOULD need per-action reversibility — that is a 2B concern, not 2A.)

## 20. Required metadata `[DESIGN]`
**None strictly required.** Cohort 2A reuses the existing uniform class honestly (conservative). The
ONLY implementation change is routing (add the three ids to a Cohort-2A set and check it in the IPC
handler). An OPTIONAL refinement — param-conditional reversibility for `calendar.create` — is available
but not needed for a safe, honest certification.

## 21. Frozen-surface impact `[DESIGN]`
A future implementation would touch: `cst/governedAction.ts` (add a `GOVERNED_ACTION_COHORT2A` id set)
and `connectors/index.ts` (route those ids through `governedAction` with the durable ports).
**No** change to: the CST kernel, `durableIdempotencyStore.ts`, `sendTransition`/governedSend,
`mail.ts`, m365 `executor.ts`, `actionSdk.ts` (no per-action field needed for 2A), BoundDecisionClaim/
mint, `ExecuteEngine`/`ExecutionSession`/`ExecutionStore`, Boundary-B, worker surfaces, `runtimeCore`,
`contracts.ts`, `storeScope.ts`, `package.json`, Node engine. The CST kernel would NOT be modified.

## 22. Implementation-readiness classification — **A. IMPLEMENTATION-READY** `[DESIGN]`
Reuses `governedAction` AS-IS + the committed durable store + the unchanged CST kernel; no new
authority, no new decision contract, no new store. The only work is routing + dedicated per-id tests
(denial-before-effect, restart-durable single-use, external-notification honesty). The
inventory's "IRREVERSIBLE mislabel" concern does NOT block 2A (conservative labelling is honest for the
externally-communicative subset); it applies to 2B.

## 23. Exact permitted claim
> "The Cohort-2A M365 IPC actions (calendar.create, calendar.update, teams.createChannel) are
> implementation-ready to be governed through the committed governedAction/CST path — reusing the
> unchanged CST kernel, the durable idempotency store, authoritative IPC identity/context, canonical
> consequential-action identity, atomic process-lifetime + single-process-restart-durable admission,
> and pre-effect denial — WITHOUT a new authority, decision contract, or durable store. calendar.create
> is externally-communicative when attendees are present (param-derivable); calendar.update's external
> consequence depends on non-derivable server-side attendee state and must be governed conservatively;
> teams.createChannel is team-visible and reversible-by-delete. Governing all three at the conservative
> C3/irreversible tier is honest. Nothing is yet PROVEN for these three by dedicated tests — that is the
> implementation gate's task."

## 24. Exact non-claims
NOT claimed: that 2A is already implemented, tested, or certified · precise (non-conservative)
reversibility labels · provider idempotency · effect success · verification success · renderer
exclusion · cross-process/power-loss durability · that params capture calendar.update's external
consequence · that Cohort-1 closure extends to 2A. Cohort 2B NOT addressed. **IMPLEMENTED ≠ VERIFIED ≠
CERTIFIED ≠ UNIVERSAL.**

## 25. Recommended (separately-authorized) implementation gate
Route `calendar.create`, `calendar.update`, `teams.createChannel` through `governedAction` (new
`GOVERNED_ACTION_COHORT2A` set + handler branch) reusing the committed durable ports; add dedicated
tests: denial-before-effect (`effectCalls===0` for unknown/unconfirmed/unscoped/foreign-account/
non-canonical), restart-durable single-use per id, reordered-key/different-param identity, and an
explicit record that calendar.update is governed conservatively (its external consequence is not
param-derivable). Optionally add param-conditional reversibility for calendar.create. No frozen-surface
or kernel change. Start from `dc9e8f3`. This gate does NOT begin it.

## STOP
Read-only readiness analysis complete. No code, no tests, no commit, no push, no frozen surface changed.
