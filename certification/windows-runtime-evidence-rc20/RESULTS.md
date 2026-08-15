# WINDOWS RUNTIME ACCEPTANCE — rc.20 (Gate 20)

**Date:** 2026-08-15
**Machine/environment:** Windows 11 Pro **ARM64** (build 10.0.26100.1, 24H2),
guest VM on this Apple-Silicon Mac (QEMU `qemu-system-aarch64`, HVF
acceleration, EDK2/TianoCore UEFI). The rc.20 installer is an x64 NSIS binary
run under Windows 11 ARM64's built-in **x64 emulation** — a real Windows
runtime, with that emulation caveat recorded.
**Artifact:** `NeuroPause-Setup.exe` 1.0.0-rc.20, built from tag `v1.0.0-rc.20`
(commit `efe8196`), SHA-256
`e861228f2af873a8d67036fbb0407a6e8acab07f3bb5b6f009815f824ac8bc90`.

## Provenance — verified ON the Windows machine (not just on the host)
- `installer.sha256 = E861228F2AF873A8D67036FBB0407A6E8ACAB07F3BB5B6F009815F824AC8BC90`
- `sha256.match = True`
- Embedded `build-info.json`: `version=1.0.0-rc.20  commit=efe8196  dirty=False  channel=beta`
- Installed to `C:\Users\accept\AppData\Local\Programs\NeuroPause\NeuroPause.exe`

## PASS — core boot-health / IPC / tenant / persistence matrix (section B: 1,2,4,7,8)
Captured from `%APPDATA%\@neuropause\desktop\logs\app.log` across 7 real launches.

| Check | Result |
|---|---|
| B1 fresh-install first launch | `process.running.after.launch=True`; `Startup complete … complete:true` (window-created + runtime-core-ready phases, ~1.3 s) |
| Secure IPC registration | `Secure IPC handlers registered {"count":722}` — all 722 handlers, on Windows |
| B2 org/workspace resolution | `Organization runtime ready {"orgs":1,"units":13,"roles":6,"users":1}` (fresh seed); `Workspace manager ready {"workspaces":1,"active":"workspace-default"}` |
| B4 no-handler errors | `no.handler.errors=0` (no `no handler registered for dp:history` or any channel) |
| B8 repeated launch ×5 | launches 1-5: `no-handler=0  init-fail=0` every time — **no IPC registration race, no runtime-init failure, no splash deadlock** |
| B7 restart persistence | `Tenant resolution LOST=0` on the healthy profile; `workspace-default` active after restart |
| runtime-init failures | `runtime.init.fail=0` across all launches |
| W-10 boot-window diagnostic | `tenant.refused=2` at first boot (the redacted boot-window bracket), then resolves — no persistent `not_a_member` |

The original Gate 20 fault class — the Windows `not_a_member` tenant-resolution
outage — **does not reproduce**: tenant resolution comes up cleanly, the seeded
org loads, and restart persistence holds, all on real Windows.

## Rendered UI on Windows (visual evidence)
`np-signin-honest-error.png` — the app window renders on the Windows desktop:
"Welcome to NeuroPause / Sign in to your AI operating layer", and — with no
auth backend configured (`backendUrl:null`) — the **honest error state** the
certification demanded: *"NeuroPause cannot reach its AI service right now. The
service refused the connection. … Nothing is wrong with this computer. [Retry]"*
No blank screen, no fabricated success. (`np-window-desktop.png` shows the
running app window/menus.)

## NOT exercised on Windows (honest residuals — why this stays YELLOW, not GREEN)
These section-B items are gated behind **signing in**, which needs the cloud
auth backend — unavailable in this offline VM (the app correctly refuses and
says so). They are verified on macOS on the identical binary and are
code-present in the Windows `app.asar` (marker audit), but were not driven here:
- B3 signed-in active-tenant context (post-sign-in `Tenant refused` absence)
- B5 import / export flows
- B6 Business / Assistant views responding to input
- B9 owner-row hardening spot-checks (O-11/O-13 + round-40 provisioned-owner)
- Graceful **shutdown-flush** line (`Shutdown flush complete`): a force-kill
  correctly runs no flush, and the harness could not drive the app's real
  `app.quit` (tray/menu) across the session boundary; macOS-proven (round 37,
  `ran:7`) and code-present in this Windows binary.

## Reproduction
Host toolchain in `~/vm-win11/` (not committed): `run-vm.sh` (QEMU launch),
UUP-built `26100.1_PROFESSIONAL_ARM64_EN-US.ISO`, `uploadserver.py` (host
file/GET + evidence/PUT over QEMU NAT `10.0.2.2:8099`), `gate20run.ps1` /
`run2.ps1` (the acceptance runner). Logs in this folder are the verbatim guest
uploads.
