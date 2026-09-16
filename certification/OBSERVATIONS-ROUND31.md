## O-11 — A PARTIAL PATCH ERASED THE FIELD IT WAS NOT SENT FOR

**Status: FIXED in round31. Confirmed by executed negative control (3/9 fail against the verbatim prior line).**

`OrgStore.updateUser` applied its patch with `{ ...user, ...patch }`. Object spread
copies own enumerable keys *regardless of value*, and its only caller — the
`enterprise:org.updateUser` IPC handler at `enterprise/index.ts:2046` — builds the
patch as an object **literal** naming all six fields:

```ts
const patch = guardOwnerUserPatch(r.id, OWNER_USER_ID, {
  name: r.name, email: r.email, title: r.title,
  unitId: r.unitId, roleIds: r.roleIds, status: r.status,
});
```

`EnterpriseOrgUpdateUserRequest` (`packages/shared/src/ipc/contracts.ts:1299`)
declares every one of those `.optional()`. So a request that renames a member and
says nothing about their address arrives as `{ name: 'X', email: undefined, … }`
and **writes `email: undefined`**.

Three consequences, compounding:

1. Membership is decided by matching the signed-in address against this field.
   Erasing it removes the person from their own organization.
2. `JSON.stringify` omits `undefined`, so the erasure is persisted and survives
   every restart. Nothing else found in this program that breaks tenant
   resolution is persistent — a restart clears the rest.
3. `tenantContext.resolveFull()` tested it with `m.email !== null`, which is
   **true** for `undefined`, and then called `.trim()` on it — a `TypeError`
   thrown out of the one function whose documented contract, stated on
   `resolve()` a few lines above, is that it never throws.

On the seeded owner row all three compound: it is the root of first-claim-wins.

**Fix, two layers.** `updateUser` now drops keys whose value is `undefined`
before spreading — `Partial<Pick<…>>` already means "these fields", so honouring
that is the store's job, and fixing the caller would fix one caller. An explicit
`null` still clears, because `null` is a meaningful value here (an unclaimed
owner). Separately the resolver's membership predicate is now
`typeof m.email === 'string'`, which fails closed on every non-string. The owner
fallback is deliberately **not** relaxed the same way: a corrupt owner row must
keep refusing rather than become claimable by whoever signs in next.

Not the cause of the Windows outage — that one clears on restart and this one
does not — but it is a real defect on the same predicate, found while
instrumenting it.

---

## O-12 — THE OWNER-CLAIM SELF-HEAL CANNOT RUN WHILE THE FAULT IS PRESENT

**Status: FIXED in round 32 (2026-08-14). Decision by the founder: the owner-claim
path gets a narrow, explicit authority.** `setOwnerIdentity` is replaced by
`orgStore.claimOwnerIdentity(session)`: the first-claim rule (`decideOwnerClaim`)
now lives INSIDE the store method, the cross-tenant guard is structural
(`OWNER_USER_ID` in the SEEDED org, both compile-time constants) rather than
caller-scope-dependent, and a corrupt owner row (the O-11 disk shape) refuses
rather than becoming claimable. The claim therefore runs at boot, on sign-in,
and while tenant resolution is refusing — restoring the self-heal O-12 blocked.

`bindOwner` (`enterprise/index.ts:594`) is registered on `authService`
`'statusChanged'` and is the only non-IPC writer of the owner row. It calls
`orgStore.setOwnerIdentity`, which begins:

```ts
const owner = this.ownedUser(OWNER_USER_ID);
if (!owner) return;
```

`ownedUser` → `owns` → `callerOrgId()` → `this.scopeSource?.()?.tenantId`, and
that seam is bound to `activeTenantScope()` → `tenantContext.scope()`.

So **once tenant resolution refuses, `scope()` is null, `ownedUser` returns null,
and the owner-claim repair silently no-ops for the remaining life of the
process.** It does not cause the outage. It explains why the outage is permanent
until a restart, and it would defeat any in-process self-repair added later.

This is the correct behaviour for the Round 10 NEW-H6 fix taken on its own terms
— a mutation with no resolved tenant is refused, fail-closed — and it is also the
reason nothing can recover. Both are true. Resolving it means deciding whether
the owner-claim path is allowed a narrower authority than "the caller's resolved
tenant", which is an architectural decision for Saurabh, not a patch.

---

## O-13 — ANY `people:manage` HOLDER CAN REWRITE THE OWNER'S ADDRESS, IN-TENANT

**Status: FIXED in round 32 (2026-08-14). Decision by the founder: strip `email`
entirely.** `guardOwnerUserPatch` now strips `email` alongside `roleIds` and
`status` on any owner-row patch, closing both the takeover and the disarm. The
owner's binding changes only through the first-claim rule; ownership handoff,
when it exists, will be a dedicated explicit flow, not a member edit.

`guardOwnerUserPatch` (`enterprise/authzGate.ts:541`) strips `roleIds` and
`status` from a patch aimed at `user-owner`, and nothing else. This is documented
as deliberate in two places (`org/orgStore.ts:155`,
`tenancy/round10OrgOwnership.test.ts:14`) — Round 10 fixed the **cross-tenant**
takeover by scoping the write through `ownedUser`, and left the same-tenant case
alone.

Membership is decided by email on that row. Therefore, inside one organization,
any member holding `people:manage` can set `user-owner.email` to their own
address and become the Owner. The permission check does not stop it: a permission
answers "may this person do this kind of thing", not "to *this* row".

I have **not** changed this, because it is documented as a deliberate boundary
and reversing it without the founder would be exactly the kind of unilateral
architecture change this program forbids. Recording it so the decision is
explicit rather than inherited. Two options, both small:

- Strip `email` from an owner patch entirely — closes it, removes any
  "the owner changed their address" flow (which has no UI today).
- Strip it only when the incoming value is not a non-empty string — closes the
  *disarm* case (blanking the root of trust) while leaving re-addressing possible.

---

## W-10 — THE DIAGNOSTIC MOVED FROM THE GATE INTO THE RESOLVER

**Status: SHIPPED in round31.**

Round 28 (W-7) wired a `not_a_member` diagnostic into `createAuthorize`. On the
Windows machine it was written for, it printed **nothing** across a run in which
five screens were showing the refusal. `livesync:status` takes the refusal from
`resolveFull()` and throws it directly; it never calls `createAuthorize`. Neither
does any caller that reads `scope()`, sees null, and gives up.

That was my fifth misplacement in this thread and the lesson is general:
instrumenting a caller measures that caller. There are many callers and exactly
one resolver.

W-10 puts the hook inside `resolveFull()`, behind a single `refuse()` helper that
is the only way out of the function without a tenant, and pins that structurally
against the source so a ninth refusal reason cannot be added silently. It also
reports from the values the resolution **actually used** — W-7 re-read
`authService.getStatus()`, the org store and the workspace store *after*
`resolveFull()` had returned, which is a second sample of four mutable
singletons: if any changed in between, the log described a state that had not
produced the refusal it claimed to explain.

New log lines, all redacted (local parts reduced to a length, domains kept):

- `Tenant resolution LOST — first refusal after a working session` — carries
  `msSinceLastSuccess`. **This is the T1−T0 measurement**, in the log, without
  anyone having to notice the moment it broke.
- `Tenant refused` — throttled to one line per reason per minute, carrying
  `suppressedSinceLastLine`.
- `Tenant resolution RECOVERED` — closes the bracket with the outage duration.
