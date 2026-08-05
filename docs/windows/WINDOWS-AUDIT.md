# WINDOWS-AUDIT — Phase 1: Compatibility Audit

Evidence-first recon of the existing repository against every Windows risk in the
brief. Headline: the codebase was written cross-platform from the start — **no
macOS-only lock-in was found in application logic**. The one Windows gap is the
*build target*, which is scaffolded-but-commented in `electron-builder.yml`, not
missing.

## 1. Audit matrix

| Concern | Finding | Evidence | Windows status |
| --- | --- | --- | --- |
| Electron compatibility | Electron 30.5.1; inherently cross-platform | build log | ✅ |
| electron-builder config | Windows/NSIS block present but commented (lines 84–91) | `electron-builder.yml` | 🟡 enable (Phase 3) |
| Windows build targets | none active | same | 🟡 Phase 3 |
| **Native dependencies** | **Only `@node-rs/argon2`** (Rust, prebuilt per-platform) and rollup (dev). No keytar, no better-sqlite3, no node-gyp/bcrypt/robotjs | `find *.node`, package.json grep | ✅ argon2 ships a win32-x64 prebuilt — no compiler needed |
| Node modules | pure-JS otherwise | grep | ✅ |
| **File system paths** | 113 uses of `app.getPath`/`path.join`; **zero hardcoded `/Users`, `/tmp`, `/var`, `C:\`, `~/`** | path grep (empty risk set) | ✅ |
| **Keychain replacement** | Uses Electron **`safeStorage`**, not macOS Keychain directly. On Windows safeStorage is backed by **DPAPI** automatically | `security/secureStore.ts`, `connectors/connectorVault.ts` | ✅ same code, OS-appropriate backend |
| Auto updater | `electron-updater` present; feed key already channel-aware (`beta`) | Phase-2 audit, builder | 🟡 add win feed (Phase 5/7) |
| Notifications | Electron `new Notification().show()` — cross-platform | `platform/index.ts:105` | ✅ (Windows shows native toast; app id set by installer) |
| Deep links / OAuth callback | **Loopback `127.0.0.1` random port (RFC 8252)** — NOT a custom URL scheme | `auth/loopbackServer.ts:101` | ✅ zero OS registration needed; the hardest cross-platform OAuth problem is already solved |
| Local storage | atomic JSON under `app.getPath('userData')` (per-OS correct dir) | 46-file ledger (RC1-04) | ✅ resolves to `%APPDATA%` on Windows |
| Database paths | Postgres/Redis are the **backend's** concern (remote; not deployed yet — Phase 4); the desktop holds no DB path | RC1-02/03 | ✅ N/A to Windows client |
| Logging | pino to userData; path via getPath | RC1-04 | ✅ |
| Crash reporting | local export store, path-safe | RC1-04, Part 6 | ✅ |
| `process.platform === 'darwin'` guards | **Correctly branched, not blocking**: `index.ts:96` (quit-on-close only off-Mac — standard), `menu.ts:12` (`isMac` menu shape), `signingStatus.ts:31` (returns non-mac cleanly) | grep (20 hits, all conditional) | ✅ these are cross-platform *correctness*, not macOS lock-in |

## 2. What is genuinely macOS-specific

Only three touchpoints, all already conditionalized so they degrade correctly:

1. **Window-close behavior** (`index.ts:96`) — on macOS the app stays in the dock
   when all windows close (HIG); `if (process.platform !== 'darwin') app.quit()`
   already gives Windows the expected quit-on-close. Correct as-is.
2. **Menu shape** (`menu.ts`) — `isMac` builds the Apple menu; the else-branch is
   a standard Windows menu. Correct as-is.
3. **Signing status probe** (`signingStatus.ts:31`) — returns a non-mac result off
   Darwin; Windows Authenticode reporting is a Phase-4 *addition*, not a fix.

No filesystem, storage, auth, or IPC code is macOS-bound.

## 3. Risks explicitly cleared

- **safeStorage/DPAPI**: `isEncryptionAvailable()` is checked before every
  encrypt/decrypt in both `secureStore.ts` and `connectorVault.ts`, so on a
  Windows box without DPAPI (rare) the code fails safe rather than crashing.
- **OAuth**: loopback flow means no `setAsDefaultProtocolClient`, no URI-scheme
  registration, no installer deep-link plumbing — the callback works identically
  on Windows the day the `.exe` is built.
- **argon2**: `@node-rs/argon2` is prebuilt-binary (Rust/NAPI); electron-builder
  bundles the win32-x64 `.node` automatically — no Visual Studio Build Tools on
  the user's machine.

## 4. Findings

- **WIN-1** — enable the commented Windows/NSIS target in `electron-builder.yml`
  (Phase 3; additive, macOS untouched).
- **WIN-2** — provide `resources/icon.ico` (macOS uses `.icns`; the default icon
  warning already appears in your Mac build too — one asset serves both).
- **WIN-3** — Authenticode signing is optional-but-recommended (Phase 4);
  unsigned `.exe` installs behind a SmartScreen "More info → Run anyway", exactly
  analogous to the Mac right-click-Open you already used.
- **WIN-4** — a Windows artifact must be **built on Windows** (electron-builder
  constraint); a macOS host cannot emit a proper NSIS installer. Phase 7 (GitHub
  Actions windows-runner) is the clean, machine-free path.

## 5. Verdict

The application layer is **Windows-ready today**. No refactor is required — only
(a) enabling the build target, (b) one `.ico`, and (c) a Windows build machine or
CI runner. Phases 3–8 are additive packaging/CI/doc work; **Phase 2 will now
verify each subsystem behaves on Windows**, but the static evidence predicts no
code changes.

---

**Can NeuroPause now be installed and used by a Windows customer?**
Not yet — no Windows artifact exists (WIN-4). But the audit finds **zero
macOS-specific blockers in application code**: every subsystem (auth via
loopback OAuth, safeStorage→DPAPI secrets, getPath storage, cross-platform
notifications) is already Windows-compatible. The remaining work is packaging and
CI, not engineering. **STOP — awaiting approval for Phase 2.**
