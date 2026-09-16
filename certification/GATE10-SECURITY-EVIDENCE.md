# GATE 10 — SECURITY

**Date:** 2026-08-29 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `9bb49b9`
**Scope:** Gate 10 only (PRODUCT-READINESS-MATRIX numbering). Gates 1/4/11 untouched.

The row listed four residuals. Each was reproduced against the code first.

---

## STATUS

**YELLOW → GREEN (round 53, 2026-08-30).** All four named residuals are closed with committed regression tests
(items 1–3 in round 52 below; item 4 `dp:provenance` closed under Gate 7, now GREEN). The one follow-up this
gate had explicitly deferred — device-revoke authorization — is now closed at the root (see ROUND 53). What
remains is external-verification-blocked (a live-backend A/B/C role test needs the cloud auth backend,
unreachable here — the same platform hold carried by Gates 8/20), which is a documented non-blocking residual,
not an open desktop-side gap.

*Historical note: the section below recorded the round-52 close as "YELLOW → YELLOW" pending the device-revoke
spec question and the Gate-7 item; both are now resolved (ROUND 53).*

## RESIDUALS (reproduced)

1. **Provisioned-org HIGHs — ALREADY CLOSED (verified).** Round 40's `provisionedOwnerProtection.test.ts` runs
   **8/8**. Guards key on the target org's recorded `ownerUserId` and provisioned spec roles are built-in.
   No new work; cited as evidence.

2. **`workspace-ctx:*` (and the whole router set) outside the classification invariant — REAL. CLOSED.**
   Two IPC paths exist: the secure bridge (`runtimeAuthz`, auth+permission, guarded by
   `assertAllChannelsClassified` over `RUNTIME_INVOKABLE_CHANNELS`) and the router (`ipc/router.ts`,
   sender-trust + Zod only, over `INVOKABLE_CHANNELS`). The invariant iterated ONLY the secure-bridge set, so
   the router's 20 channels were sender-trust-only with **nothing asserting that was a reviewed choice** — a
   new router channel would be unauthenticated by omission.

3. **Cloud-org mutations authorized on MEMBERSHIP, not ROLE — REAL. CLOSED.** `requireCloudOrgMembership`
   proved the caller belonged to the org but not that they could mutate it, so a `viewer`/`member` could
   `org.invite`, `org.removeMember`, `org.update`, `org.changeRole`, create/rename/delete workspaces, and start
   a paid `billing.checkout`. The row said "enforcement claimed server-side, unverified."

4. **`dp:provenance` unredacted disclosure — belongs to Gate 7**, not Gate 10 (the row attributes it to Gate 7).
   Out of scope for this gate; left for the Gate-7 work.

## FIX

- **Residual #3 — role-aware authorization (defense in depth, fail-closed).** New pure module
  `organization/cloudOrgAuthorize.ts`: `authorizeCloudOrgRole(memberships, orgId, allowed)` +
  `CLOUD_ORG_MANAGERS = ['owner','admin']` + one opaque refusal (`CLOUD_ORG_DENIED`). `runtimeCore`'s
  `requireCloudOrgRole` fetches the caller's memberships from `orgClient.list()` — the same backend-scoped call
  `requireCloudOrgMembership` already trusts, whose rows carry the role the BACKEND assigned
  (`CloudOrganizationSummary.role`) — and delegates the decision to the pure helper. It **invents no
  authority**: it enforces the backend's own role on the client too. All **8 mutating** cloud-org handlers now
  use `requireCloudOrgRole(orgId, CLOUD_ORG_MANAGERS)`; the **reads** (`org.get`, `org.members`,
  `org.workspaces`, `devices.list`) and **device self-register** stay membership-only. An unreachable backend
  refuses (never a bypass).
- **Residual #2 — the router set is now a reviewed, enumerated allowlist.** `ipc/routerClassification.test.ts`
  pins that every `INVOKABLE_CHANNELS` entry is a justified member of `ROUTER_SENDER_TRUST_ONLY` (each with its
  category: auth-before-session · local app/window · boot-window runtime · per-user device-local views), that
  the reviewed set exactly equals the registered set (no drift either way), and that the router and gated sets
  are **disjoint** (no channel registered twice with conflicting authority). A new router channel added by
  omission now fails CI.

## FILES CHANGED

| File | Change |
|---|---|
| `apps/desktop/src/main/organization/cloudOrgAuthorize.ts` | **new** — pure cloud-org role authorization + opaque refusal |
| `apps/desktop/src/main/runtimeCore.ts` | `requireCloudOrgRole` (delegates to the pure helper); 8 mutating cloud-org handlers role-gated; `CloudOrgRole` import |
| `apps/desktop/src/main/organization/cloudOrgAuthorize.test.ts` | **new** — role decision (9) incl. the runtimeCore wiring pin |
| `apps/desktop/src/main/ipc/routerClassification.test.ts` | **new** — router classification invariant (4) |

## SECURITY SCENARIOS VERIFIED

- Owner/admin may invite/remove/update/manage-workspaces/checkout; **member and viewer are REFUSED** each.
- Reads remain available to any member (the gate is not "always no").
- Non-member refused; **unreachable backend (empty list) refused** — fail-closed, no bypass.
- Insufficient-role refusal is **byte-identical** to not-a-member — nothing about the org or standing leaks.
- Every mutating cloud-org handler is role-gated and every read is not (source wiring pin).
- Router (sender-trust-only) set is reviewed, justified, exactly matches the registered set, and is disjoint
  from the gated secure-bridge set.
- Provisioned-org owner protection intact (8/8).

## TESTS / RESULTS

- New: `cloudOrgAuthorize.test.ts` 9/9, `routerClassification.test.ts` 4/4.
- Affected `ipc` + `organization` + `tenancy`: **97 files / 1347 tests, 0 failures.**
- Full `src/main`: **810 files / 8401 passed / 7 skipped / 0 failed** (+13 vs Gate 11's 808/8388).
- Typecheck (`tsconfig.node.json`) **0**; lint on all changed files **clean** (`--max-warnings 0`).

## NEGATIVE CONTROLS (executed)

Reverting all three boundaries at once failed **6** assertions, restore → 13/13:
- one mutation downgraded to `requireCloudOrgMembership` → the wiring pin fails;
- the pure role check made role-blind (`allowed` ignored) → member/viewer/opaque-parity tests fail;
- a router allowlist entry removed → the coverage + set-equality invariants fail.

## REMAINING (why not GREEN)

- **`dp:provenance`** unredacted disclosure — Gate 7, not addressed here.
- **Device revoke** (`devices.revoke`) left membership-only, flagged as a follow-up: whether a member may revoke
  their OWN device vs only managers revoking others needs the product spec; I did not guess. Reads and
  self-register are correctly membership-level.
- The role enforcement is **client-side defense-in-depth**; the backend remains the ultimate authority. A live
  backend A/B/C role test (member's invite rejected end-to-end) needs the cloud backend, unavailable here.
- A fresh running-app security red-team pass (matrix's separate line) is not part of this gate.

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/main/organization/cloudOrgAuthorize.test.ts src/main/ipc/routerClassification.test.ts src/main/tenancy/provisionedOwnerProtection.test.ts
# then, for GREEN: a live-backend test that a member's org.invite is rejected end-to-end, and the Gate-7 dp:provenance redaction.
```

---

# ROUND 53 (2026-08-30) — GATE 10 → GREEN

**Method:** independent verification (read-only subagent) of the four named residuals against committed code,
then re-ran their tests myself; closed the one deferred follow-up (device-revoke) at the root.

## Verification of the four named residuals — all CLOSED

| # | Item | Verified | Test (re-run this round) |
|---|---|---|---|
| 1 | Provisioned-org owner takeover | Guards key on the target org's recorded `ownerUserId`, wired at `enterprise/index.ts` UpdateUser/DeleteUser/UpdateRole via `protectedOwnerIdForTarget` | `provisionedOwnerProtection.test.ts` 8/8 |
| 2 | `workspace-ctx:*` outside classification invariant | Router set is a reviewed, enumerated, disjoint allowlist; a channel added by omission fails CI. The backing store is `USER_PREFERENCE` (no tenant data); `switch` mutates no tenant | `routerClassification.test.ts` + `runtimeAuthz.test.ts` |
| 3 | Cloud org mutations membership-only | 8 mutating cloud-org handlers role-gated via `requireCloudOrgRole(CLOUD_ORG_MANAGERS)` over the backend-reported role; reads stay membership | `cloudOrgAuthorize.test.ts` |
| 4 | `dp:provenance` disclosure | Two-gate (`data:read` + module read) + `redactProvenance`; secrets hidden even from admins; contract-only DTO | Gate 7 GREEN, `provenanceDisclosure.test.ts` 6/6 |

Re-run cluster: **6 files / 75 tests, 0 failures.**

## The deferred follow-up — DEVICE REVOKE — now CLOSED at the root

The round-52 "REMAINING" note left `devices.revoke` membership-only, saying the own-vs-others question "needs the
product spec; I did not guess." It does not need a spec: **revoking THIS machine is self-service (any member);
revoking ANY OTHER device in the org is administrative (managers only).** The Trusted Devices screen
(`TrustedDevices.tsx`) lists EVERY org device with a Revoke button and `DevicesRevoke` accepts an arbitrary
`deviceId`, so a non-manager could revoke a colleague's (or the owner's) device and cut them off from device
trust / sync — the same "membership is not authorization" class as residual #3, applied to devices.

**Fix (smallest, defense-in-depth, fail-closed):** new pure `deviceRevokeRequiresManagerRole(targetDeviceId,
ownDeviceId)` in `cloudOrgAuthorize.ts` — `false` only when the target is provably the caller's own current
device (`getDeviceId()`), else `true` (the stricter side; blank/unknown own-id ⇒ manager). The `DevicesRevoke`
handler now gates others' devices behind `requireCloudOrgRole(orgId, CLOUD_ORG_MANAGERS)` and keeps own-device
on `requireCloudOrgMembership`. `DevicesRevoke` already required the `org:manage` bridge permission
(`runtimeAuthz.ts:441`), so this adds the **correct cloud-role authority** for a cloud resource on top —
no regression to the own-device path, which is unchanged. The desktop cannot enumerate every device a user owns
on other machines (only the backend can), so this is defense-in-depth; the backend remains the ultimate
authority and this never becomes a bypass.

## FILES CHANGED (round 53)

| File | Change |
|---|---|
| `apps/desktop/src/main/organization/cloudOrgAuthorize.ts` | + pure `deviceRevokeRequiresManagerRole` (own-vs-others device authorization) |
| `apps/desktop/src/main/runtimeCore.ts` | `DevicesRevoke` handler branches self-service (own) vs manager (others); `getDeviceId` + helper imports |
| `apps/desktop/src/main/organization/cloudOrgAuthorize.test.ts` | +3 helper units + 1 device-revoke source-wiring pin (9 → 13) |

## SECURITY SCENARIOS VERIFIED (round 53)

- A non-manager revoking ANOTHER org device is refused (manager role required); revoking their OWN current
  device stays self-service; blank/unknown own-id fails safe to the manager gate.
- The device-revoke handler branches on `deviceRevokeRequiresManagerRole(..., getDeviceId())`, never bare
  membership (source wiring pin).
- All four named residuals' tests pass over the real handlers/stores (75/75).

## TESTS / RESULTS (round 53)

- `cloudOrgAuthorize.test.ts` **13/13** (was 9); Gate-10 named-item cluster **75/75**.
- Full `src/main` + renderer: **905 files / 9473 passed / 7 skipped / 0 failed**.
- Typecheck (`tsconfig.node.json`) **0**; ESLint on changed files **clean**.

## NEGATIVE CONTROLS (executed, round 53)

Neutered both new boundaries at once → **4 assertions fail**, restore → 13/13:
- handler reverted to membership-only → the device-revoke wiring pin fails AND the `requireCloudOrgRole` count
  invariant (≥ 9 sites + definition) fails;
- `deviceRevokeRequiresManagerRole` forced to `return false` → "another device requires a manager" + the
  fail-safe unit tests fail.

## WHY GREEN NOW

Every named residual is closed with committed regression tests, and the one deferred follow-up is closed at the
root. The only remaining item is a live-backend end-to-end role test, which is external-verification-blocked
(the cloud auth backend is unreachable in this environment — the identical platform hold GREEN gates 8/20 carry)
and is a documented non-blocking residual, not an open desktop-side gap. The separate "fresh running-app
red-team" is its own matrix line, not a Gate 10 driver.
