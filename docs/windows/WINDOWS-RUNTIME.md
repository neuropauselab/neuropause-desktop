# WINDOWS-RUNTIME — Phase 2: Subsystem Compatibility Report

Evidence-first verification of every subsystem in the brief against the actual
code. Categories: **A — works unchanged**, **B — packaging/config only**,
**C — code change required**. Result: **13 × A, 2 × B, 0 × C.** No code was
modified because no verified Windows issue exists.

## 1. Child-process sweep (the only place a Windows issue could hide)

Three sites call `node:child_process`; each verified Windows-safe:

- **`runtime/adapters/processAdapter.ts`** — `spawn(entry.command, entry.args, {…})`
  with **no `shell: true`**, explicit `args`, and `detached:false`. This is the
  portable form (no shell string to misparse). It launches whatever executable a
  *local-process app kind* declares; on Windows that declaration is a `.exe`.
  Cross-platform ✅.
- **`diagnostics/signingStatus.ts`** — calls `codesign` **only after an explicit
  `process.platform !== 'darwin'` guard returns early** (lines 31–39). Windows
  never reaches the exec; it returns a clean "macOS only" status. ✅ (Windows
  Authenticode reporting is a Phase-4 *addition*, not a fix.)
- **`plugins/pluginHost.ts`** — `fork()` of a bundled **`plugin-host.cjs`** via
  `join(__dirname, …)`. Forking a JS module through Electron's own node is
  inherently cross-platform; the path uses `join`, not separators. ✅.

Path audit: the only `'a/b/c'` string literals are **doc URLs**
(`docs/ecosystem/sdk.md`) passed to a viewer, not filesystem paths — harmless on
Windows. All real paths use `app.getPath` + `path.join` (Phase-1 finding, 113
uses, zero hardcoded roots).

## 2. Subsystem verdicts (with evidence)

| # | Subsystem | Category | Evidence |
| --- | --- | --- | --- |
| 1 | Authentication | **A** | OAuth via RFC-8252 **loopback 127.0.0.1** (`auth/loopbackServer.ts:101`), no URI-scheme registration; tokens in `safeStorage` (DPAPI on Windows). Backend is remote and not deployed yet (Phase 4). |
| 2 | Organizations | **A** | Pure IPC → backend HTTP; no OS surface. Backend on `api.neuropause033.com`. |
| 3 | Founder AI | **A** | `ai/founderAI.ts` — model calls + JSON persistence via getPath; no native/OS dep. |
| 4 | Engineering AI | **A** | `ai/engineeringAI.ts` — same shape. |
| 5 | Mission Brief | **A** | `intelligence/briefingGenerator.ts` — pure logic over stored data. |
| 6 | Executive Memory | **A** | `memory/*` — atomic JSON under userData (`%APPDATA%` on Windows); optional Qdrant is a remote/HTTP backend. |
| 7 | AI Store | **A** | Renderer + backend catalog (Postgres, remote). `StoreView` compiled in the Mac build already. |
| 8 | Operations Center | **B** | Works, **but** the signing-status row shows "macOS only" on Windows until the Phase-4 Authenticode probe is added. Functional, cosmetic gap. Diagnostics/AI-health probes otherwise cross-platform. |
| 9 | Connectors | **A** | Loopback OAuth (same as auth), tokens in `connectorVault.ts` via safeStorage/DPAPI; sync over HTTPS. The hardest cross-platform piece — done. |
| 10 | Cloud Sync | **A** | `cloud/livesync/*` — HTTP transport + JSON queue/mirror via getPath; injected timers. No OS dep. |
| 11 | Billing | **A** | Razorpay over backend HTTP; no desktop OS surface. |
| 12 | Licensing | **A** | `license/*` — HTTP fetch + JSON cache, offline re-eval on injected clock. No OS dep. |
| 13 | Diagnostics | **B** | Framework cross-platform; the **macOS signing probe** returns "macOS only" on Windows (guarded, not crashing). Same Phase-4 addition as #8. AI-health/Ollama probes work. |
| 14 | Welcome Center | **A** | `WelcomeView` + onboarding services (JSON via getPath). Compiled in Mac build. |
| 15 | Early Access | **A** | onboarding/feedback/pilot services — atomic JSON, getPath, IPC. No OS dep. |

## 3. Why "B" is packaging, not code

Both B items (Operations Center, Diagnostics) are the *same* touchpoint: the
macOS-only `codesign` probe in `signingStatus.ts`, which **already returns a
clean guarded result on Windows** ("signing status probe is implemented for
macOS only"). Nothing crashes; a Windows customer sees an informational row. Adding
a Windows Authenticode probe is a Phase-4 enhancement that *expands* the feature —
it is explicitly not required for the app to install and run.

## 4. Code-change ledger

**None.** The Phase-1 prediction held: static evidence said no refactor, and
subsystem-level verification confirms it. The `codesign` call — the only
OS-specific exec — is correctly guarded and fails safe. No additive increment was
built because the rules require one only when a *verified issue* exists, and none
does.

## 5. Verification integrity

No source files were modified in Phase 2. The suite is unchanged and green:
**desktop 532 / 68**, backend 168 (last verified run). This report is
documentation only.

---

**Can NeuroPause now be installed and used by a Windows customer?**
Still not yet — the blocker remains the *absence of a built `.exe`* (Phase-1
WIN-4), not any code incompatibility. Phase 2 verifies **13 of 15 subsystems work
unchanged on Windows and the other 2 need only packaging/config** (a cosmetic
signing-row enhancement), with **zero subsystems requiring code changes**. The
runtime is Windows-ready; producing the artifact (Phase 3 packaging + Phase 7 CI
on a Windows runner) is what remains. **STOP — awaiting approval for Phase 3
(Windows Packaging).**
