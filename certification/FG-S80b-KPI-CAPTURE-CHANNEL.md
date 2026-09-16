# FG GATE — FG-S80b · governed `kpi:capture` on-demand IPC channel

**Status:** PRESENTED, NOT APPLIED. Closes the S80 F-P45 finding (`FINDING-S80-BACKGROUND-CAPTURE-VISIBILITY.md`): the background capture writes under `organization.id` (fan-out) while the Executive Center reads under `currentPrincipal().tenantId`, so a local-mode user never sees the KPI intelligence. This gate adds a governed on-demand capture that runs **under the caller's own principal** — the same identity the read uses — making writer = reader.

## Required literal token (operator must supply verbatim)

```
AUTHORIZED: FG-S80b — kpi:capture governed IPC channel (channels.ts enum + allowlist, 2 additive lines), per gate doc
```

Per the constitution + the FG-S80b change-control rule: descriptive approval is not consent; only this literal token is. A diff that changes after the token requires a new token.

## Exact frozen change (packages/shared — the ONLY frozen file)

`packages/shared/src/ipc/channels.ts`, **2 additive lines**:
1. In the `IpcChannel` enum, beside `ExecutiveCenterSnapshot`: `KpiCapture: 'kpi:capture',`
2. In the renderer-invokable channel allowlist (the array containing `IpcChannel.ExecutiveCenterSnapshot`, ~line 1277): `IpcChannel.KpiCapture,`

No `contracts.ts` change: the request reuses the existing `EmptyRequest` schema (the renderer sends nothing — tenant is resolved in main). No `responses.ts`/`broadcasts.ts` change. No `runtimeCore.ts` change. No `baseline.json` change.

## Non-frozen accompaniment

- `apps/desktop/src/main/analyticsPlatform/kpiIntelligenceInstance.ts` — export `captureForCurrentPrincipal()`: resolve the authoritative actor/tenant via the existing `auth/governedActor` / `currentPrincipal()` (NEVER a renderer-supplied id), call the existing `captureForScope({ tenantId, workspaceId })` for that principal, return `{ ok: true, captured: boolean }`. This is the identity fix — capture now writes under the SAME principal the executive-snapshot read filters by.
- `apps/desktop/src/main/enterprise/executiveCenterSubsystem.ts` — register one `SecureHandlerDef` on `IpcChannel.KpiCapture`, `schema: EmptyRequest`, guarded by the existing auth + the executive read permission (RBAC preserved), handler = `captureForCurrentPrincipal()`. Reuses the KPI capture service, snapshot store, and the existing `executiveCenter:snapshot` read — no new engine/store/channel-for-read.
- `apps/desktop/e2e/s80KpiExceptionJourney.e2e.cjs` — drive `kpi:capture` then read `executiveCenter:snapshot`: create below-safety product → **invoke `kpi:capture`** → assert exception on the snapshot → restock → **invoke `kpi:capture`** → assert recovered → invoke again → assert no duplicate historical observation → tenant isolation.

## Governance / threat analysis (both directions)

- **Renderer cannot supply a tenant:** the schema is `EmptyRequest` (`z.object({}).strict()`) — any extra field is rejected; the handler resolves tenant solely from the main-process principal, so `organization.id` / another tenant cannot be injected.
- **RBAC preserved:** the handler runs under the same `requireAuth` + permission the executive read uses; an unauthorized caller is refused.
- **Tenant-isolated:** capture writes under `currentPrincipal()`; the read filters by `currentPrincipal()`; a caller only ever captures + sees its own tenant's rows.
- **Immutability + dedup preserved:** it calls the unchanged `captureAndEvaluate` — deterministic snapshot id per (tenant, kpi, period) ⇒ idempotent, historical observations never overwritten; exception transitions deduped by `<exceptionId>#<transitionSeq>`; unconfigured/null thresholds fail-closed.
- **No direct renderer→store / AI→store:** the handler is the only new entry point; it invokes the service, not the store; AI has no role.
- **Backout:** the enum entry + allowlist entry are additive; removing them + the handler reverts cleanly (the background service remains as the periodic path).

## Verification plan (on the Mac, after the token)

Change-control choreography (no `baseline.json` re-record per operator standing instruction): apply the 2 frozen lines + the non-frozen accompaniment → focused KPI/security/tenant tests → IPC/preload + executiveCenter tests → typecheck node+web → lint → full main + full UI suites → build → the updated real-Electron `s80KpiExceptionJourney` (fresh local profile: create→capture→exception→restock→capture→recover→re-capture-no-dup→tenant isolation). Claim GREEN only on the real-Electron pass.

## ⛔ BLOCKED — NO FROZEN EDIT

The literal FG-S80b token is **not** present in the directive. No frozen file has been edited. Supply the token above verbatim to proceed.
