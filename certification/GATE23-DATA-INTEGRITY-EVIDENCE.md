# GATE 23 — DATA INTEGRITY (name uniqueness)

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `c323b8c` (Gate 13)
**Policy (operator):** workspace names unique case-insensitively WITHIN the tenant; organization names unique
case-insensitively GLOBALLY; enforced at create AND rename; fail closed with a clear user-facing message;
preserve tenancy/authorization/data-integrity boundaries.

The row was **YELLOW**; round 43 closed org-creation atomicity. The remaining substantive data-integrity item
was "no org/workspace NAME uniqueness" — now closed.

---

## ROOT CAUSE (reproduced against the code)

Independent inspection of every create/rename path found **no name-uniqueness check anywhere** (grep of
name/duplicate/exists/unique across `src/main` returned only unrelated noise). So two organizations could share a
name globally, and two workspaces could share a name within one tenant — nothing rejected it. The local
enterprise stores are the in-product, testable enforcement surface; the cloud `orgClient` create/rename POST to a
backend that is authoritative for cloud uniqueness (client-side would only advise), so it is not the enforcement
point here.

The enforcement chokepoints (each covers ALL in-product callers):
- **Org create:** `orgStore.createOrganization` — the single site; provisioning routes through it
  (`deps.createOrganization`). There is **no local org-rename** method/handler/UI, so "enforce at rename" is N/A
  in-product for orgs (cloud rename is backend-owned).
- **Workspace create:** `workspaceStore.create(name, organizationId)` — covers both the direct
  `EnterpriseWorkspaceCreate` handler and provisioning's first-workspace create; `organizationId` is the tenant
  scope, no cross-store lookup.
- **Workspace rename:** `workspaceStore.rename(id, name)` — future-proofed (no handler/UI yet) using the target's
  own `organizationId`, excluding the row's own id.

Seeding (`applySeed`/`buildSeed`) writes via `Map.set` **directly**, bypassing these mutators, so the seeded
names (`'NeuroPause'`, `'Default Workspace'`) never trip the new checks on normal boot.

## FIX (smallest, fail-closed)

- **`orgStore.createOrganization`** — before creating, reject (throw) if any existing org has the same
  `name.trim().toLowerCase()`: `An organization named "<name>" already exists.` (Also retired the now-stale "no
  caller" comment.)
- **`workspaceStore`** — new private `assertNameFreeInTenant(name, organizationId, exceptId?)` that throws if a
  workspace in the SAME `organizationId` (excluding `exceptId`) has the same case-insensitive name:
  `A workspace named "<name>" already exists in this organization.` Called by `create` and `rename`.

The throws propagate through the existing handlers to the secure bridge and surface in the renderer's `role=alert`
convention with **no renderer change** — the `EnterpriseWorkspaceCreate` handler already throws for the
tenant-mismatch case and only `audit()`s AFTER a successful create, so a rejected duplicate is never persisted or
audited. No tenancy/authorization/data-integrity boundary is touched (the checks read only within the store's own
data and, for workspaces, only within the given tenant scope).

## FILES CHANGED

| File | Change |
|---|---|
| `src/main/enterprise/org/orgStore.ts` | global case-insensitive org-name uniqueness in `createOrganization` (fail closed) |
| `src/main/enterprise/workspace/workspaceStore.ts` | `assertNameFreeInTenant` + calls in `create` and `rename` (within-tenant, case-insensitive) |
| `src/main/enterprise/org/orgStore.test.ts` | +3 org uniqueness pins |
| `src/main/enterprise/workspace/workspaceStore.test.ts` | +5 workspace uniqueness pins |

## REGRESSION TESTS (all six required scenarios)

1. **Duplicate workspace name, same tenant → rejected** — `workspaceStore.test.ts` (the second create throws; the
   tenant still has exactly one).
2. **Same workspace name, different tenants → allowed** — two `create('Operations', 'org-a'|'org-b')` both succeed.
3. **Duplicate organization name, globally → rejected** — `orgStore.test.ts` (second `createOrganization` throws;
   exactly one remains).
4. **Case-insensitive collisions → rejected** — org (`'  neuropause '` vs seeded `'NeuroPause'`; `'ALPHA
   INDUSTRIES'` vs `'Alpha Industries'`) and workspace (`'  operations '` vs `'Operations'`).
5. **Rename collision → rejected** — renaming a sibling to another sibling's name (case-insensitive) throws; the
   name is left unchanged.
6. **Valid unique create/rename → succeeds** — unique org/workspace create; unique rename; renaming a workspace
   to its OWN name (no self-collision); renaming to a name used only in another tenant.

## USER WORKFLOW VERIFIED

Enforced at the store chokepoints reached by the create handlers. `EnterpriseWorkspaceCreate` (index.ts) calls
`workspaceStore.create` with no try/catch and already throws for the mismatch case, so the uniqueness throw
surfaces identically via the secure bridge → renderer `role=alert`; `EnterpriseOrganizationCreate` →
`provisionOrganization` → `orgStore.createOrganization` throws before the workspace is created (and the Gate-23
rollback covers any mid-provision throw). A rejected duplicate is never persisted (verified) nor audited. A full
driven-UI click-through of *create* is limited by the pre-existing absence of a shipped enterprise create form
(Gate-26 note) — so verification is at the handler + store integration level, appropriate for this store-layer
data-integrity invariant.

## TESTS / RESULTS

- `orgStore.test.ts` 18 (+3), `workspaceStore.test.ts` 9 (+5) — 27/27 in the pair.
- Full main suite: **9502 passed / 7 skipped / 0 failed** (no existing flow broke).
- Full UI suite: **55 files / 344 passed / 0 errors** (no renderer change).
- Typecheck node **0**; ESLint on changed files **clean**.

## NEGATIVE CONTROL (executed)

Neutered both checks (org throw removed; `assertNameFreeInTenant` early-return) → **5 rejection tests fail** (org
global + case-insensitive; workspace same-tenant + case-insensitive + rename-collision), while the "allowed"
tests (different tenant, unique create) correctly still passed; restore → 27/27.

## GATE 23 RESULT

**YELLOW → GREEN.** The substantive data-integrity gap (org/workspace name uniqueness) is closed at the store
chokepoints, at both create and rename, case-insensitively, fail-closed, tenant-scoped for workspaces and global
for orgs — negative-controlled, no existing flow broken, no security/tenancy/authorization boundary weakened.
Remaining (non-blocking, cosmetic — not a data-integrity defect): pre-P13A provenance rows still read "No imports
yet" (display copy only).

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/main/enterprise/org/orgStore.test.ts src/main/enterprise/workspace/workspaceStore.test.ts
```
