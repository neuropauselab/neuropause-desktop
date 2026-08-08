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
