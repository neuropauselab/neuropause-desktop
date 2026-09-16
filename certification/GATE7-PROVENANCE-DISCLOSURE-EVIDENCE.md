# GATE 7 — DATA · dp:provenance disclosure

**Date:** 2026-08-30 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `ec01b08`
**Scope:** Gate 7, `dp:provenance` disclosure ONLY. Gates 1/4/10/11 untouched. The other two
Gate-7 HIGHs (provenance write-failure swallowed; "updated" runs render "0 imported") are import-write
/ renderer-count defects, out of scope for this disclosure task and left open below.

---

## STATUS

**RED → the dp:provenance disclosure is CLOSED at the root.** The gate row carried three HIGHs; this
task closes the disclosure one. Gate 7 stays **YELLOW** overall until the remaining two HIGHs are done.

## RESIDUAL (reproduced first, against the actual code)

`dp:provenance` (`IpcChannel.DataPlaneProvenance`) is channel-gated to **`data:read` alone**
(`channels.ts` → `RUNTIME_CHANNEL_PERMISSIONS[DataPlaneProvenance] = 'data:read'`). Its handler
(`dataPlane/index.ts`) was:

```ts
handler: async (p) => {
  await provenance.load();
  return provenance.forRecord((p as DataPlaneProvenanceRequest).recordId);
},
```

`forRecord` is tenant-scoped (P13A — solid, `provenanceTenancy.test.ts`), so **cross-tenant** access
was already closed. The leak was **within a tenant**, and had three parts, all reproduced by a failing
test (`provenanceDisclosure.test.ts`, 5 of 6 red before the fix):

1. **Redaction bypass.** `fields[].original` (and `transformation`, which embeds the value) returned
   the raw source cells verbatim — a monthly salary `₹1,25,000`, bank account, PAN — while the import
   PREVIEW (`dp:preview`) redacts the same value to `••••••••` and the EXPORT refuses it. Redacting on
   two surfaces and not the third is worse than redacting on none.
2. **No module read gate.** A caller holding the coarse `data:read` but NOT the HR module's own
   `people:read` still got the record. Export double-gates (`data:read` + `descriptor.permissions.read`,
   restricted values needing `permissions.write`); provenance gated on neither.
3. **Over-disclosure beyond the contract.** `forRecord` returns the raw `ProvenanceRecord`, typed as
   the narrower `DataPlaneProvenance`. TypeScript's structural typing let the extra fields —
   `tenantId`, `workspaceId`, connector origin (`accountId`, `syncRunId`…) and `sourceTrust` — serialize
   across IPC anyway. The reproduction confirmed `tenantId` and `workspaceId` on the wire.

## EXACT LEAK PATH

`renderer ipc.data.provenance(recordId)` → `IpcChannel.DataPlaneProvenance` (`data:read`) →
`dataPlane/index.ts` handler → `provenance.forRecord(recordId)` → **raw `ProvenanceRecord`** across IPC
→ `dataCommandCenter` `buildProvenance` → panel. Sensitive `fields[].original` + internal record
fields reach the renderer for any `data:read` user in the tenant, regardless of module permission.

## ROOT CAUSE

The provenance read was the one data-egress surface that never adopted the shared field-sensitivity
governance. `dp:preview` redacts; `dp:export`/`dp:export.plan`/`dp:exportable` double-gate on the
module's read permission and treat restricted/secret fields via `classifyField`. `dp:provenance`
returned the store record directly, so it was both un-redacted and un-gated, and it leaked internal
fields by returning a wider object than its declared type.

## FIX (fail-closed, least-privilege, mirrors dp:export / dp:preview)

One production file, `dataPlane/index.ts`:

- **New pure `redactProvenance(record, descriptor, mayAdminister): DataPlaneProvenance`.** Builds the
  DTO **field by field**, so only the declared contract crosses IPC — `tenantId`, `workspaceId`,
  connector origin and `sourceTrust` can no longer leak. Each field VALUE is classified with the shared
  `classifyField` (module key + label, with the source header as a floor so a "Bank A/c" column mapped
  to a generic key is still caught): `secret` is never shown, `restricted` only when the caller can
  administer the module, `normal` always. `original` and `transformation` are redacted together. This
  is exactly the `selectableFields` rule (`secret→never · restricted→mayAdminister · normal→always`).
- **Handler now applies the two gates.** `deps.authorize('data:read')`; fetch the tenant-scoped record;
  resolve the module descriptor and `deps.authorize(descriptor.permissions.read)` (a module you cannot
  read cannot be traced — refused, not silently redacted); probe `permissions.write` for
  `mayAdminister`. An **unknown module** (not in this build) cannot have its read permission checked, so
  `redactProvenance` receives `descriptor === null` and **hides every value** — deny-by-default.

**Legitimate provenance preserved:** source file, sheet, row, confidence, approver, imported-at and all
NON-sensitive field originals/transformations are returned unchanged; an administrator still sees the
restricted originals they are responsible for. Only secret values are withheld from everyone.

## FILES CHANGED

| File | Change |
|---|---|
| `apps/desktop/src/main/dataPlane/index.ts` | new pure `redactProvenance`; `dp:provenance` handler now two-gates (`data:read` + module read, `mayAdminister` for restricted) and returns a mapped, redacted DTO; imports `classifyField`/`classifyFieldName`/`moreRestrictive`/`sensitivityReason`/`REDACTED_MARKER` + types |
| `apps/desktop/src/main/dataPlane/provenanceDisclosure.test.ts` | **new** — 6 regression tests through the REAL handler + Zod + tenant-scoped store |

## SECURITY SCENARIOS VERIFIED

- A `data:read` **read-only** actor (no `people:manage`) gets provenance with salary, bank account and
  PAN **redacted to `••••••••`**; the serialized payload contains **none** of `₹1,25,000` / `125000` /
  bank / PAN / secret; ordinary fields and metadata are intact.
- An **administrator** (`people:manage`) sees the restricted originals — the trail still works — but a
  **secret** (`apiKey`) is withheld even from the administrator.
- A caller who **cannot read the module** (`people:read` absent) is **refused** — `data:read` is not
  enough (mirrors export).
- The payload carries **only the declared contract**: `tenantId`, `workspaceId`, `connector`,
  `sourceTrust` are absent from the wire.
- **Unknown module** → every field value hidden (fail-closed); metadata still returned.
- **Cross-tenant** record id → `null` (P13A boundary, unchanged and re-asserted).

## TESTS / RESULTS

- New `provenanceDisclosure.test.ts`: **6/6**.
- Affected `dataPlane` + `tenancy/provenanceTenancy` + renderer `dataCommandCenter`: **16 files /
  345 tests, 0 failures**.
- **Full `src/main` suite: 900 files / 9382 passed / 7 skipped / 0 failed.** The only production change
  is `dataPlane/index.ts`; the only added test is the new file (every other suite unchanged and green).
- Typecheck `tsconfig.node.json` **0** and `tsconfig.web.json` **0**; ESLint `--max-warnings 0` on the
  changed files **clean**.

## NEGATIVE CONTROLS (executed)

1. **Pre-fix reproduction:** the new suite ran **5 failed / 1 passed** against the original handler
   (raw salary/bank/PAN/secret returned; no `people:read` refusal; `tenantId`/`workspaceId` on the
   wire). Only the cross-tenant-null case passed.
2. **Mutation:** forcing `hide = false` in `redactProvenance` → **3 failed** (the value-redaction
   assertions), restore → **6 passed**. The redaction is load-bearing.

## REMAINING (why Gate 7 is not GREEN)

- **Provenance write-failure swallowed** — an import can report success with nothing persisted
  (`importer.ts` provenance append). Separate HIGH, not a disclosure — not addressed here.
- **"Updated" runs render "0 records imported"** (`dataCommandCenterModel.ts`). Renderer-count HIGH,
  not a disclosure — not addressed here.
- The redaction is enforced in the main process at the egress boundary; the ultimate authority remains
  the permission set the secure bridge resolves.

## EXACT NEXT COMMAND

```bash
cd ~/Desktop/neuropause-desktop && git push origin cert/data-import-cst-integration
cd apps/desktop && npx vitest run src/main/dataPlane/provenanceDisclosure.test.ts
```
