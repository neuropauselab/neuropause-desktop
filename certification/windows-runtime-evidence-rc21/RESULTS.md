# WINDOWS RUNTIME ACCEPTANCE — rc.21 (Gate 20, round 62)

**Date:** 2026-08-31
**Machine/environment:** Windows 11 Pro **ARM64** (build 10.0.26100, 24H2),
QEMU/HVF guest on this Apple-Silicon Mac. The rc.21 installer is an x64 NSIS
binary run under Windows 11 ARM64's inbox **x64 emulation** — a real Windows
runtime, with that emulation caveat carried forward from the rc.20 run.
**Artifact:** `NeuroPause-Setup.exe` 1.0.0-rc.21, 111,916,344 B,
SHA-256 `bac27d0b1beb44e949c034d357624b8ee391b33868022d0abd3507d82cbb0ec9`.

## Why this run exists

The rc.20 run recorded B3/B5/B6/B9 as *"gated behind signing in, which needs the
cloud auth backend."* Round 61 measured that to be **true of that binary and
false of the product**: rc.20 was cut 2026-08-15 and local-first mode (S17)
landed 2026-08-18, so rc.20 shipped the sign-in wall with no offline entry path.
The gate was **artifact-blocked, not machine-blocked**. This run uses the first
Windows artifact that contains local-first mode.

## Provenance — verified ON the Windows machine

| Field | Value |
|---|---|
| `INSTALLER_SHA256` | `BAC27D0B…0EC9` |
| `SHA256_MATCH` | **True** (against the host-built artifact) |
| `BUILD_VERSION` | `1.0.0-rc.21` |
| `BUILD_COMMIT` | `1d232de-dirty` |
| `BACKEND_URL` | *(empty)* — offline by construction |

**Provenance ceiling, stated:** `dirty=true`. Measured on the host, the dirty
delta contains **no bundled source** — it is `THIRD-PARTY-NOTICES.md`
(regenerated *by this build*), the custody-protected `certification/baseline.json`,
and 8 untracked non-bundled items. `apps/desktop/src/**`, `packages/**` and the
manifests are clean at HEAD `1d232de`. This is a **local acceptance artifact,
not a distributable release artifact**.

## THE CLAIM macOS PROVABLY COULD NOT MAKE — now closed

NSIS cannot be unpacked on macOS (no 7-Zip in any form), so round 61's marker
counts were about the *staging tree*, never bytes extracted from the installer.
This run read the markers from **the asar the NSIS payload actually installed**:

| Marker | Installed asar | Host staging tree | rc.20 |
|---|---|---|---|
| `Working locally` | **2** | 2 | **0** |
| `device.invalid` | **3** | 3 | **0** |
| `Sign in to your AI operating layer` | 1 | 1 | 1 |
| `dp:import` | 6 | 6 | 6 |
| `assistant:conversations` | 5 | 5 | 5 |

Installed asar: 59,002,481 B. Staging and installed agree exactly. **The
installer-payload identity gap recorded as unclosable on the host is closed.**

## PASS — section B items driven on Windows, in LOCAL MODE, with NO backend

Six scripted launches on a **fresh profile** (the prior profile was renamed
aside, not deleted — preserved as `desktop.pre-rc21-20260831072859`), plus two
interactive launches.

| Check | Result |
|---|---|
| **B1** fresh install → first launch | `APP_INSTALLED=True`; `Startup complete … complete:true`, 647 ms / 822 ms |
| **B1 (local-first entry — the rc.20 blocker)** | `INFO (auth) Entering device-local mode (no cloud account)` — **8 launches, 8 entries**. Visually: the window titled *"NeuroPause — Today's Intent"* offers **"Try Free Locally"**. rc.20 could only show *"Sign in to your AI operating layer."* |
| Secure IPC registration | `Secure IPC handlers registered {"count":723}` ×8 (rc.20: 722) |
| **B2** org/workspace resolution | `Organization runtime ready` ×6 · `Workspace manager ready` ×6 · `Runtime core ready` ×6 |
| **B3** active tenant context | `Tenant resolution LOST=0`. Boot-window bracket: 2 refusals (`not_loaded`) then `RECOVERED` after **54 ms** — no persistent refusal, and **no sign-in required to reach it** |
| **B4** no-handler errors | **0** across every launch |
| **B7** restart persistence | `LOST=0` on the healthy profile across 8 launches; `PROFILE_FILES=34` persisted |
| **B8** repeated launch ×5 | `no-handler=0`, `runtime-init-fail=0` on every launch — no IPC-registration race |
| **B10** (partial) AI routing | The privacy step ran live and reported honestly: *"No local AI is set up yet… AI requests will fail on this device rather than being sent anywhere."* No Ollama on the guest, so the **honest-offline branch** is the correct expected result and is what appeared |

## User workflow driven interactively on the Windows desktop

Keyboard/mouse via the QEMU monitor, in the interactive session:
**"Try Free Locally"** → **"Where should your AI work?"** → *Keep it on this
device* → **workspace type** (Start Professional) → **"Let's get to know you"**
discovery step. Screenshots `win-01`…`win-04`. Focus rings render and Tab
navigation works, so the Gate-12 keyboard-accessibility work holds on Windows.
The onboarding persisted (24 experience-profile writes in the log).

## NOT exercised — why this stays YELLOW, not GREEN

The PASS bar is *"every item in B clean."* These were not driven and are **not**
claimed:

- **B5** import / export flows
- **B6** Business / Assistant views responding to input
- **B9** owner-row hardening spot-checks (O-11/O-13)
- **B11** provisioned-org owner protection (round 40) — never reported in the
  rc.20 run either, neither as PASS nor as residual; named here so it stops
  being invisible
- Graceful `Shutdown flush complete`: the runner force-stops the app, so `0` is
  the **expected and honest** result, not a failure

Each needs sustained GUI interaction (file pickers, form editing) driven over a
QEMU framebuffer, at an 800×600 screen smaller than the app window. That is a
tooling limit of this harness, not a product limitation and not a platform one.

## What this run establishes, and what it does not

**Establishes:** the Gate-20 artifact block is cleared; local-first mode is
present in the installed Windows bytes and entered on every launch; the core
boot-health / IPC / tenant / persistence matrix passes on real Windows with no
cloud backend; the onboarding workflow is drivable to the discovery step.

**Does not establish:** B5/B6/B9/B11; graceful shutdown; distribution readiness
(unsigned-for-distribution, `-dirty` provenance); any claim about native x64
Windows rather than ARM64 x64-emulation.
