# GATE 10 — SECURITY

**Date:** 2026-08-29 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `9bb49b9`
**Scope:** Gate 10 only (PRODUCT-READINESS-MATRIX numbering). Gates 1/4/11 untouched.

The row listed four residuals. Each was reproduced against the code first.

---

## STATUS

**YELLOW → YELLOW, with two residuals CLOSED at the root and one verified already-closed.** The fourth belongs
to Gate 7. Not GREEN because a broader running-app red-team pass and the Gate-7 item remain.

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
