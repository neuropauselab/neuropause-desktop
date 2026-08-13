# NeuroPause — macOS Phase 6 Operator Certification

**Purpose:** the one Phase 6 item that cannot be completed in the engineering environment. This session runs in a Linux container; the bridge to the developer Mac executes inside an isolated Linux VM and cannot launch the packaged app. **Nothing below has been performed — every result column is blank by design.** Fill it in on the Mac.

**Build under test:** `1.0.0-rc.15` · branch `phase6-stage13-enterprise-digital-twin-platform`

## Why this matters more than usual

`runtimeCore` refuses to start if any runtime IPC channel is neither RBAC-gated nor public-allowlisted. That check runs at **boot**, not in the test suite. Phase 6 added 11 `dp:*` channels.

Mitigation already in place: `apps/desktop/src/main/dataPlane/wiring.test.ts` replicates that invariant against the real registries and handler definitions, and it passes. So the *classification* failure mode is covered by `test:release`. What is still unproven is everything only a running app exercises: preload exposure, window lifecycle, the renderer round-trip, and the runtime behaviour of `authService.getStatus()` and `workspaceStore.activeWorkspaceId()` that the Data Plane subsystem is bound to.

## T0 — Preconditions

```bash
cd ~/Desktop/neuropause-desktop
git rev-parse HEAD && git rev-parse @{upstream}   # expect identical
npm run typecheck:release && npm run lint:release && npm run test:release
```

| Expected | Result |
|---|---|
| HEAD == upstream, clean tree | |
| 5,838 tests green, 635 files | |

## T1 — Boot (the critical test)

```bash
npm run infra:up          # postgres + redis
npm run db:migrate
npm run dev
```

| # | Check | Expected | Result |
|---|---|---|---|
| 1.1 | App window opens | Window renders; no crash | |
| 1.2 | **No ungated-channel refusal** | Console does **NOT** contain `Refusing to start:` or `ride on sender-trust alone` | |
| 1.3 | Data Plane subsystem started | Log line `INFO (data-plane) Data Plane ready { channels: 11, entities: 8 }` | |
| 1.4 | No unhandled main-process error | Clean startup log | |

**If 1.2 fails, stop.** Capture the full message — it names the offending channels — and report it. That is the exact failure this pass was designed to prevent.

## T2 — Preload + renderer bridge

In the renderer DevTools console (View → Toggle Developer Tools):

```js
typeof window.neuropause?.invoke     // expect "function"
typeof window.neuropause?.subscribe  // expect "function"
```

| # | Check | Expected | Result |
|---|---|---|---|
| 2.1 | Bridge exposed | both `"function"` | |
| 2.2 | Non-invokable channel rejected | `await window.neuropause.invoke('not:a:channel')` rejects with *"is not invokable"* | |

## T3 — Data Plane round-trip (unauthenticated)

```js
await window.neuropause.invoke('dp:ontology', {})
```

| # | Check | Expected | Result |
|---|---|---|---|
| 3.1 | Before sign-in | Rejects with *"Sign in to continue."* — `requireAuth` is working | |

## T4 — Data Plane round-trip (authenticated)

Sign in through the UI, then in the console:

```js
// 4.1 — ontology
const ont = await window.neuropause.invoke('dp:ontology', {});
console.log(ont.entities.length, ont.supportedFormats, ont.unsupportedFormats.map(f => f.format));

// 4.2 — inspect a real spreadsheet (pick any .xlsx you have)
const buf = await (await fetch('file:///Users/YOU/path/to/any.xlsx')).arrayBuffer();
const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
const inspection = await window.neuropause.invoke('dp:inspect', { filename: 'any.xlsx', contentBase64: b64 });
console.log(inspection);

// 4.3 — analyze (writes nothing)
const plan = await window.neuropause.invoke('dp:analyze', { filename: 'any.xlsx', contentBase64: b64 });
console.log(plan.planId, plan.totals, plan.tables.map(t => [t.tableName, t.entityId, t.band]));

// 4.4 — history
await window.neuropause.invoke('dp:history', {});
```

| # | Check | Expected | Result |
|---|---|---|---|
| 4.1 | Ontology | 8 entities; `pdf` and `image` listed as unsupported with reasons | |
| 4.2 | Inspect | Correct format, sheet names, row count | |
| 4.3 | Analyze | A `planId`, routed tables with confidence bands; **no records created anywhere** | |
| 4.4 | History | `[]` on a fresh profile, or prior runs | |

## T5 — Approval gate and segregation of duties

```js
// Attempt to import a HIGH-RISK table (customers/employees/invoices) with no approval.
await window.neuropause.invoke('dp:import', { planId: plan.planId, approvals: [] });
```

| # | Check | Expected | Result |
|---|---|---|---|
| 5.1 | No approval given | Every high-risk table returns `awaiting_approval`; `totals.imported === 0` | |
| 5.2 | Nothing written | Open the matching Business module — no new records | |
| 5.3 | With approval, holding `data:approve` | `status: "imported"`; records appear in the module | |
| 5.4 | Without `data:approve` (remove the scope from your role) | Rejects naming `data:approve` | |

## T6 — Provenance

```js
// Take a record id from the module you just imported into.
await window.neuropause.invoke('dp:provenance', { recordId: 'rec_...' });
```

| # | Check | Expected | Result |
|---|---|---|---|
| 6.1 | Lineage returned | Source file, sheet, row, per-field original + transformation | |

## T7 — Mapping memory + tenant isolation

```js
const sig = 'manual-test-signature';
await window.neuropause.invoke('dp:mapping.save', { signature: sig, entityId: 'customer', columns: [{ header: 'Cust_Name', fieldKey: 'name' }] });
await window.neuropause.invoke('dp:mappings', {});          // expect 1
await window.neuropause.invoke('dp:mapping.forget', { signature: sig });
```

| # | Check | Expected | Result |
|---|---|---|---|
| 7.1 | Save then list | One mapping, `version: 1` | |
| 7.2 | Re-save | `version: 2` | |
| 7.3 | Switch workspace, list | `[]` — no cross-workspace leakage | |
| 7.4 | Forget | `{ forgotten: true }` | |

## T8 — Lifecycle: restart, logout, recovery

| # | Check | Expected | Result |
|---|---|---|---|
| 8.1 | Quit and relaunch | Imported records still present; session restored | |
| 8.2 | Force-quit mid-session, relaunch | Local data intact; no corruption | |
| 8.3 | Logout → login | Credentials cleared then restored | |
| 8.4 | Stop the backend, then `dp:analyze` | Analysis still works (it is local); AI Store degrades honestly | |
| 8.5 | Corrupt file through `dp:inspect` | Honest `unsupported` + reason, no crash | |

## T9 — Existing surfaces unaffected (regression)

| # | Surface | Expected | Result |
|---|---|---|---|
| 9.1 | Today / Work Hub | Loads | |
| 9.2 | Business → Finance, CRM, HR | Records load and save | |
| 9.3 | Operations | Honest status; no false "Live" | |
| 9.4 | Knowledge, AI Workforce | Load | |
| 9.5 | Command Palette (⌘K) | Reaches every surface | |

## Sign-off

| Field | Value |
|---|---|
| Tester | |
| Date | |
| macOS / hardware | |
| Commit tested | |
| T1.2 (boot, no channel refusal) | PASS / FAIL |
| Overall | PASS / FAIL / BLOCKED |

**Until T1 and T4 pass, Phase 6 wiring is COMPLETE BUT DEVICE UNVERIFIED — not VERIFIED.** Do not record it as verified in any closeout without the results above filled in.


---

# RESULTS — run 2026-08-08 (Apple Silicon, dev mode)

**Outcome: PASS** for the items exercised. Recorded from the operator's terminal and DevTools console.

| Check | Evidence | Result |
|---|---|---|
| T1.1 App launches | Window opened; `Startup complete { complete: true }` | **PASS** |
| **T1.2 No ungated-channel refusal** | No `Refusing to start:` anywhere in the boot log | **PASS** |
| T1.3 Data Plane started | `INFO (data-plane) Data Plane ready { channels: 11, entities: 8 }` | **PASS** |
| T1.4 Secure IPC registered | `INFO (secure-ipc) Secure IPC handlers registered { count: 652 }` | **PASS** |
| T2.1 Preload bridge exposed | `window.neuropause.invoke` callable from the renderer | **PASS** |
| T4.1 `dp:ontology` round-trip | Returned **8** entities | **PASS** |
| Engine on-device | `scripts/dataplane-check.ts` over a messy CSV: 2 importable of 4, 1 duplicate ("Pvt Ltd" ≡ "Private Limited"), 1 incomplete, approval required — output identical to the build environment | **PASS** |
| Backend round-trip | `/auth/token/refresh` 200, `/auth/me` 200, session restored | **PASS** |

**Not exercised in this run:** T5 (approval gate / SoD through the UI), T6 (provenance), T7 (mapping memory via IPC), T8 (restart / logout / recovery), T9 (regression sweep of existing surfaces). These remain open; the underlying behaviours are covered by automated tests but are not device-confirmed.

## Defects found by this run (both pre-existing, neither Phase 6)

1. **Startup race — renderer calls IPC before handlers are registered.**
   `apps/desktop/src/main/index.ts` awaits `authService.restoreSession()` *before* `initRuntimeCore()`, and `initRuntimeCore` is what calls `registerSecureHandlers`. The window is live during that gap, so any renderer call fails with `No handler registered for '<channel>'`. Observed: `flags:get`. The gap in this run was **24.7 s** (legacy handlers at `20.849`, secure handlers at `45.544`). Self-heals once startup completes. **Fix: move session restore off the critical path.**

2. **Session restore took ~24.4 s.** Succeeded on `attempt: 1`, and the backend logged the refresh request only at the 24-second mark — so the time was spent *before* the HTTP call, most likely macOS Keychain access via `safeStorage`. A reinstalled Electron binary changes app identity and can invalidate keychain ACLs. Plausible, not proven.

3. **Environment (resolved during the run):** the Electron binary was missing after a lockfile change (`npm rebuild electron`), and `@neuropause/companion-protocol` / `@neuropause/solution-packs` were externalized while shipping raw TypeScript, which broke `ERR_MODULE_NOT_FOUND` at launch. Fixed by adding them to `BUNDLED_WORKSPACE_PACKAGES` in `electron.vite.config.ts`. Neither was caused by Phase 6; both were only discoverable by launching the app.
