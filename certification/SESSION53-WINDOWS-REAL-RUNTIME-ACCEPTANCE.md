# SESSION 53 — WINDOWS REAL-RUNTIME ACCEPTANCE + DISTRIBUTION TRUST GATE

## 1 · Executive result

**WINDOWS FUNCTIONAL ACCEPTANCE: GREEN — measured on a real Windows 11 runtime, never
inferred.** The exact S52 rc.22 artifact (hash-verified in-guest) was installed, launched
fresh, and passed the complete acceptance matrix on the running Windows binary: procurement
click journey **10/10**, governance negatives **all 20 asserts**, O2C chain **27/27 twice**,
O2C click journey **9/9** (15 s to first transaction), restart durability **4/4** with a
byte-identical journal across the restart, persistence + security + tenant/actor boundaries
all held with the same refusal semantics as macOS. **WINDOWS DISTRIBUTION TRUST: PENDING
OPERATOR CREDENTIALS** (unsigned — measured two independent ways). **WINDOWS UPDATER: GRAY**
(feed metadata verified structurally; no actual update installation performed). The session
also corrected S52's false environment blocker (the VM existed; the sweep's search space was
wrong) and fixed one masked test-harness precondition. Source→package→runtime divergence:
**NONE observed** — identical assert sets, refusal strings and timings within near-parity of
the Mac runs.

## 2 · The environment — and the S52 correction that found it

**The S52 blocker's premise was FALSE and is corrected in place** (addendum in
`SESSION52-WINDOWS-ENVIRONMENT-BLOCKER.md`): a fully-installed Windows VM existed at
`~/vm-win11/` the whole time — the operator's own Gate-20 rc.20/rc.21 acceptance rig (built
15 Aug, last used 31 Aug), with launch script, QEMU-monitor keystroke injection, screenshot
tooling, host↔guest HTTP exchange (`uploadserver.py` :8099), and unattend-provisioned
autologon (`accept`). The S52 sweep checked hypervisor apps, `.utm` bundles and wine —
never `qemu-system-*` (present in `/opt/homebrew/bin`) nor disk images outside UTM's
container. **Third recorded instance of the confident-negative-over-narrow-search-space
class (§2 #30).**

**Measured guest environment (from inside the running guest, stage A):**

```
OS            Microsoft Windows 11 Pro · 10.0.26100 (build 26100) · ARM 64-bit
VM            qemu-system-aarch64 -accel hvf, 4 vCPU (virt-11.1), 8 GB RAM, 36.5 GB free,
              NVMe system disk, user-mode NAT (guest→host 10.0.2.2), interactive desktop
              session (explorer running), user `accept`
ARCH NUANCE   The guest kernel is genuine Windows 11 ARM64; the rc.22 artifact is x64 and
              executes under Microsoft's own x64-on-ARM emulation layer — a real Windows
              kernel and loader, NOT Wine, and NOT a native x64 machine. Recorded exactly;
              native-x64 hardware acceptance remains a distinct (weaker) residual.
DRIVE         keystroke-injected bootstrap (QEMU monitor sendkey) → cmd → curl from the host
              file server → staged PowerShell runners → evidence uploaded back per stage.
              One injection retry: the first attempt dropped a shift-chorded 'C' (path became
              ':\s53.cmd', && short-circuited, nothing ran) — retyped lowercase; harmless.
```

## 3 · Artifact identity (Phase 0/1) — verified IN-GUEST

Installer downloaded into the guest and hashed there: sha256
`99A9A1B531B336A56B26794F9D3C945672E7D00E3DC02D44F180A7A9AA28ACD6` — **exact match** to the
S52 record (111,956,195 B). No rebuild occurred; the tested bytes ARE the S52 bytes. Host
custody: `dist/`, `dist-seam-s48/`, `dist-seam-s51/`, `dist-seam-s52-win/` all untouched; the
S53 payload was STAGED (copies) into the VM folder, and the rc-era `NeuroPause-Setup.exe`
already in `~/vm-win11/` was left in place under its own name.

## 4 · Installation + first launch (Phase 2)

NSIS silent install (`/S`, perMachine=false — the established Gate-20 procedure): **PASS**,
46 s, into `C:\Users\accept\AppData\Local\Programs\NeuroPause\NeuroPause.exe`. In-guest
verification of the INSTALLED payload: `build-info.json` = `1.0.0-rc.22` / `a09ab09-dirty` /
channel beta / **0 baked client ids**; installed `app.asar` sha256
`A265C467D9EB9C307FBF8C25723350253E60E06B0DFEC815FA985E5BECFE3298` = **the S51-proven bytes,
re-verified from inside Windows**. A pre-existing rc-era profile was found and PRESERVED
(renamed `desktop.pre-s53-…`), then the probe ran on a fresh profile.

**Bare first-launch probe: `Startup complete` in 6 SECONDS** on a fresh profile, with
`Secure IPC handlers registered`=1, `Runtime core ready`=1, `Enterprise OS ready`=1,
`No handler registered` errors=0, `Runtime core failed to initialize`=0. No dev server, no
source renderer — the installed exe launched directly.

## 5–10 · Acceptance matrix — measured on the RUNNING Windows binary

Every run below executed the UNMODIFIED repo harness against the installed
`NeuroPause.exe` on the Windows guest, evidence uploaded per-run:

- **Procurement click journey (Phase 3): PASS 10/10 + RESULT** — onboarding by clicks,
  Procurement, New Purchase Request, **structured line editor (no JSON typed)**, governed
  create/Submit/Approve/Create-PO, PO visible, **total 50.00 derived main-side from the lines
  carried PR→PO, Source Request linkage shown**. Identical assert set to the Mac S51 run.
- **Governance negatives (Phase 4): PASS — all 20 asserts + RESULT ("ALL S51 PACKAGED
  GOVERNANCE NEGATIVES HELD")**, line-identical to the Mac run: received hand-set/leave
  refused · approved→draft reversal refused · convertedReceipt fabricate AND clear refused
  with the token surviving every probe (second Receive Goods stays refused) · positive
  controls (approve/send/receiveGoods actions, cancelled→draft recovery) intact · governed
  spine live (`CreatePurchaseRequest`/`SubmitPurchaseRequest`) · **same-key re-dispatch
  REPLAYS, PR pending exactly once** · the S46 origin fence refuses the governed key before
  record resolution. (Correction: S51's "21/21" figure counted the RESULT line; the harness
  has exactly 20 asserts — both platforms identical.)
- **O2C runtime chain (Phase 5): PASS 27/27 + RESULT, TWICE** — full
  Create→Ship→Invoice→Issue→Pay→PAID with real stock issue, settlement to zero,
  ConvertQuoteToSalesOrder, idempotent replay, **cross-tenant claim rejected
  (TENANT_SCOPE_VIOLATION)**, S45 edit-guard refusal, durable platform-command-journal
  carrying the O2C domain events — on the Windows filesystem.
- **O2C click journey (Phase 6): PASS 9/9 + RESULT** — clicks only, fresh profile,
  Customer → Sales Order → Ship → Invoice → Issue → cleared receipt → invoice shows PAID;
  **time-to-first-successful-transaction 15 s on Windows** (Mac packaged: 13 s — near parity
  under x64-on-ARM emulation).
- **Restart / durability (Phase 7): PASS 4/4 + RESULT ("RESTART DURABILITY VERIFIED on the
  packaged artifact")** on the kept-profile flow (kept O2C click journey 9/9 first, then the
  unmodified `s48Restart` harness): `isPackaged=true` from the running app, no repeated
  onboarding, the Sales Order survived, the invoice still PAID — and the durable journal was
  snapshotted BEFORE and AFTER the restart and compared on the host: **byte-identical
  (4,633 B → 4,633 B, `cmp` clean) — N→N, zero duplicate effects**, with all five governed
  O2C command names present in the Windows journal bytes.
- **Windows persistence (Phase 8): PASS** — profile at `C:\s53\keepprofile` (the
  `--user-data-dir` flag honored on Windows), 52 files; `platform-command-journal.json`
  4,633 B; `action-records.json` 2,823 B; `logs/audit.log` present (retrieved from the guest —
  the stage-C probe initially read the profile ROOT and reported ABSENT; corrected by
  measurement, the audit sink lives under `logs/` exactly as on macOS). Windows paths,
  AppData locations, atomic JSON stores, shutdown and relaunch all exercised by the matrix
  itself; no path-separator or locking defect surfaced in any run.
- **Security / tenant / actor (Phase 9):** covered by the negatives + chain runs above —
  tenant forgery rejected, origin unforgeable (`.strict()` bridge + fence measured live),
  replay suppressed, all on the packaged Windows runtime; no development bypass observed
  (strip markers are zero in the very asar bytes installed, §4).

## 11 · Authenticode / distribution trust (Phase 11)

**UNSIGNED — now measured TWO independent ways:** S52's PE security-directory read (size 0)
and in-guest `Get-AuthenticodeSignature` = `NotSigned` on both the downloaded installer and
the installed `NeuroPause.exe`. No Windows signing credentials exist in the environment;
**WINDOWS DISTRIBUTION TRUST = PENDING OPERATOR CREDENTIALS.** SmartScreen consequences of an
unsigned installer are a distribution fact, not a software defect. Functional acceptance and
distribution trust are reported separately throughout.

## 12 · Harness fix (one line, test-side, exposed by the guest)

`o2cRuntime.e2e.cjs:42` failed early without the MAC alternate build even when `NP_APP_BIN`
targets a packaged binary — masked on the Mac (where `out-seam-s45` exists), fatal in the
guest. Fixed to the guarded form the newer harnesses already use
(`!APP_BIN && !fs.existsSync(ALT_MAIN)`); the S48 packaged-mode precedent is unchanged in
behavior on the Mac. This is the only source change of the session (test harness, not
product).

## 13 · Source → package → runtime (Phase 12) — the three-layer table

| Capability | SOURCE (certified) | WINDOWS PACKAGE | RUNNING WINDOWS BINARY |
|---|---|---|---|
| S49 governed procurement commands | S49/S50 suites | asar = S51-proven bytes (hash) | journey 10/10 + negatives (dispatches live) |
| S50 PO received/reversal fences | 12 pins | fence prose in main bundle | refusals captured live (exact strings) |
| S50 convertedReceipt immutability | pins | prose present | fabricate+clear refused; token survived |
| S50 LinesEditor / pickers | 8 UI pins | renderer literals present | structured entry, no JSON; 50.00; linkage |
| S51 origin fence / idempotency / tenant | negatives+chain | single-router literal | origin refusal · replay=true · TENANT_SCOPE_VIOLATION |
| Durable journal / audit | suites | — | journal byte-identical across restart; audit.log in logs/ |

Byte identity was SUPPORTING evidence; every row's third column is a live Windows execution.

## 14 · Full regression (Phase 13, host)

```
Full main            966 files · 10,124 passed · 7 skipped   (identical to S51/S52)
Full UI              79 files · 448 passed (clean re-run; one parallel-load flake, see §15)
Release discipline   4/4 · Typecheck PASS
Lint (source scope)  exactly the 1 LOGGED pre-existing frozen-path error — unchanged
Source change        ONE line, test-harness only: o2cRuntime.e2e.cjs ALT_MAIN guard (§12) —
                     not in any vitest glob; counts unaffected; Mac behavior unchanged
```

## 15 · Incidents & classifications (Phase 14)

- **ENVIRONMENT (harness):** the UI-journey node processes complete every assert + RESULT,
  then hang in `app.close()` (main()'s finally awaits it → the exit timer never arms) — on
  Windows this cost the full stage watchdog per UI journey. Product behaved correctly; the
  chain/negatives/restart harnesses exit cleanly. Follow-up: arm the exit timer before close.
  A result-driven watchdog (`s53c2.ps1`) was staged but never needed — the original chain
  completed. Recorded, nothing hidden.
- **YELLOW (recurring):** `previewNavReachability.test.tsx` flaked in the full parallel UI run
  (2nd session in a row; green 3×3 in isolation + clean full re-run both times) — upgraded
  from per-session flake classification to a NAMED follow-up: stabilize under parallel load.
- **ENVIRONMENT (injection):** first bootstrap line dropped a shift-chorded 'C'; retyped
  lowercase. The stage-C persist probe read the profile root for `audit.log` (it lives in
  `logs/`) — corrected by retrieving the file from the guest.
- **PRE-EXISTING:** the source-scope lint error (logged); the S52 blocker premise (corrected
  in place, §2).

## 16 · Decisions & fences

**WINDOWS FUNCTIONAL ACCEPTANCE = GREEN** (built, installed, launched, operated, governed,
restarted, security-tested, regression-tested on a real Windows 11 runtime).
**WINDOWS DISTRIBUTION TRUST = PENDING OPERATOR CREDENTIALS** (Authenticode unsigned;
SmartScreen consequences follow). **WINDOWS UPDATER = GRAY** (structural only).
**WINDOWS FULL RELEASE READY: NO** — functional yes, trust pending; the two are not collapsed.
Honest bound, restated: the runtime is Windows 11 ARM64 executing the x64 artifact under
Microsoft's own emulation layer — a real Windows kernel; native-x64 hardware acceptance is a
residual (weaker than the signing fence, since every OS-level surface exercised is
architecture-independent Windows behavior).

**Remaining global fences:** Windows Authenticode certificate (operator) · macOS notarization
credentials (operator) · Windows updater end-to-end · native-x64 Windows spot-check
(optional hardening) · open policy memos · S48 pilot fences · lint-sweep hygiene (F-S51-1) ·
the flaky-test follow-up (§15).

**Next recommended session:** distribution-trust closure — the operator supplies the Windows
code-signing certificate and Apple notarization credentials; one session signs both platforms'
rc.22 artifacts, re-verifies hashes/signatures, and runs the updater end-to-end check. No
further functional gate stands open on either platform.
