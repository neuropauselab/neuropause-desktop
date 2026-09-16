# SESSION 151 — FULL-PLATFORM RELEASE-READINESS AUDIT + OPERATOR ACCEPTANCE MATRIX
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD 7704a77 · DOCS-ONLY (zero source, zero frozen)
### Verdict: **NO NEW ENGINEERING BLOCKER on the install→use→release path.** Remaining gates are operator/environment (B) and business-policy (C); a small set are explicitly deferred (D). Source deliberately NOT modified.

---

## 0 · Audit method + freshness
HEAD moved past S150 (`d4d6cc6`) via merge `7704a77` (pilot lifecycle backend + web + PauseCloud boundary).
**Measured, not assumed:** `git diff d4d6cc6 HEAD -- apps/desktop packages/shared` is EMPTY — the merge touched
only `apps/web` + backend/pilot, so the desktop app and all frozen contracts are byte-identical to S150. The
S150 desktop regression therefore remains the current state: **full main 10,845 passed / 7 skipped, full UI
539 passed** (S150), with **typecheck node/web = 0/0 re-run at HEAD 7704a77 this session**. Release
infrastructure inspected first-hand from `apps/desktop/package.json`, `electron-builder.yml`,
`scripts/{notarize,generate-build-info,generate-sbom,verify-release-artifacts,verify-sbom,verify-packaged-content,verify-acceptance-artifact}.cjs`,
`verify-e2e-strip.sh`, and `.github/workflows/{macos-release,windows-release,desktop-ci,certification-freeze}.yml`.

## 1 · Current overall readiness classification
**BUILD-COMPLETE + PACKAGE-CAPABLE, PENDING OPERATOR/ENVIRONMENT RELEASE CERTIFICATION.**
Source → build → package → verify is engineered and reproducible from Linux CI. Package → install → first-run
→ authenticate → operate → restart/recover → update → trusted-release requires execution on real macOS/Windows
hardware with real signing/notarization credentials and updater hosting — none of which can be produced or
proven from Linux CI, and none of which is a missing piece of code. **This is NOT GA; the evidence supports
"release-candidate, operator-certification pending," not "generally available."**

## 2 · Exact remaining blockers (by the install→use→release path)
The critical path is: SOURCE → BUILD → PACKAGE → INSTALL → FIRST RUN → AUTHENTICATE → OPERATE → TRANSACT →
RESTART/RECOVER → UPDATE → RELEASE. Blockers, in path order:

| Stage | State | Blocker class | Note |
|---|---|---|---|
| SOURCE | GREEN | — | typecheck 0/0, main 10,845/7, UI 539 (desktop unchanged since S150) |
| BUILD | GREEN | — | `electron-vite build`; verify-e2e-strip; verify:packaged |
| PACKAGE (mac) | ENGINEERED | **B** | `package:mac` → dmg+zip arm64, hardenedRuntime, entitlements, afterSign notarize; needs Developer ID cert (Mac keychain) |
| PACKAGE (win) | ENGINEERED | **B** | `package:win` → nsis+zip+portable x64; needs Authenticode cert + Windows build host |
| INSTALL / FIRST RUN | ENGINEERED, unproven on real OS | **B** | fresh-profile boot, onboarding, local-first mode all tested in-app (prior sessions); needs real macOS/Windows install run |
| AUTHENTICATE | ENGINEERED | **B** | local-first + OAuth connectors; live OAuth consent is operator-at-keyboard |
| OPERATE / TRANSACT | GREEN (governed) | — | governed command spine + reads live; journal-post runtime-proven (B.10) |
| RESTART / RECOVER | ENGINEERED, one edge | **B** (+ **A-minor**) | crash-recovery + durable journals tested; boot-fatal-on-corrupt-ledger is a known fail-closed edge (see §9) |
| BACKUP / RESTORE | ENGINEERED | **B** | backup registry + round-trip tests exist; DR drill is an operator run |
| UPDATE | ENGINEERED | **B** | generic HTTPS updater (neuropause033.com/updates, channel beta); needs updater host deploy + a real upgrade/rollback run |
| RELEASE / TRUST | ENGINEERED | **B** | notarization (mac) + SmartScreen reputation (win) + signed feed; all credential/hosting gated |

**There is no stage whose blocker is missing code.** Every stage past PACKAGE is gated by credentials,
hardware, or hosting — category B.

## 3 · Category separation (no mixing)
**A — REAL ENGINEERING (present-but-non-release-critical; do NOT fix this session):**
- Boot-fatal on a corrupt `journal-post-transitions.json` (B.11 finding): module-scope hydration of the durable
  ledger throws at startup ⇒ app fails to boot. Fail-closed (no duplicate effect), same shape as the M365
  ledger (`connectors/index.ts`), pre-existing. A boot-resilience seam, not a happy-path blocker.
- Pre-existing frozen `contracts.ts` lint escape (`AiPullModelRequest`) — recorded do-not-fix-in-passing; not
  a release blocker.
Neither blocks install→use; both are recorded, non-frozen-untouchable-in-passing, and out of scope here.

**B — OPERATOR / ENVIRONMENT VERIFICATION (the actual release gate):** see §5–§9.

**C — BUSINESS-POLICY DECISION REQUIRED (STOP-class, no code without a ruling):**
- Sandbox authoring delete/ownership/retention semantics.
- ABAC enforcement / delegation / JIT authority policy.
- S138 inbound-event correlation semantics.
- Posting-ownership decision (task #96, Option A/B/C).
- Any undefined accounting / approval / SoD rule.

**D — EXPLICITLY DEFERRED / NON-BLOCKING (do NOT reopen; audit found none is a current release blocker):**
- Persistence migration into the parallel persistence runtime.
- S132 dependency remediation (SBOM + workflow hardening already landed; no current release-blocking CVE
  surfaced in this audit).
- Advanced/autonomous AI; parallel runtime activation; duplicate infrastructure.

**E — FUTURE PRODUCT ENHANCEMENT:** remaining dark surfaces (Sandbox authoring UI once policy is ruled;
FG-gated report modules — Trial Balance/P&L/BS). Not release gates.

## 4 · Complete install-to-use critical path (what a real user does)
1. Download the signed `NeuroPause-arm64.dmg` (mac) or `NeuroPause-Setup.exe` (win) from the trusted feed.
2. Install (dmg drag-to-Applications / nsis wizard) — Gatekeeper (mac) / SmartScreen (win) must pass.
3. Launch → fresh-profile boot → first-run onboarding (Skip setup / Skip tour) → shell mounts in local-first
   mode (no sign-in wall).
4. Authenticate optionally (connect an org / OAuth connector) — or keep working locally.
5. Operate the enterprise platform (ERP/CRM/finance/procurement/inventory/mfg/maintenance/projects,
   intelligence, memory, sandbox, federation, developer/ecosystem) through governed command + read paths.
6. Transact a governed workflow (e.g. journal post; M365 mail.send on the certified vertical) → proposal →
   confirm → execute → verify → evidence.
7. Quit and relaunch → durable state recovers; in-flight actions reconcile (never a duplicate effect).
8. Receive an in-app update from the HTTPS feed → upgrade → relaunch → (rollback path available).

## 5 · Mac release requirements (operator)
- [ ] macOS 12+ Apple-Silicon build host with Xcode CLT.
- [ ] **Developer ID Application** certificate in the login keychain (signing).
- [ ] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env set (notarization) +
      `NEUROPAUSE_REQUIRE_NOTARIZATION=true` for a release build.
- [ ] Run `npm run package:mac` → dmg+zip; `notarize.cjs` staples and writes `dist/notarization-status.json`.
- [ ] `npm run verify:release` PASS (sha512 feed ↔ binaries).
- [ ] Gatekeeper assessment PASS on a clean Mac (`spctl -a -vv` on the installed app).
- [ ] macOS Keychain live check on the packaged app (S116-O1 harness on real hardware).

## 6 · Windows release requirements (operator)
- [ ] Windows x64 build host.
- [ ] **Authenticode / EV code-signing** certificate; `CSC_LINK` + `CSC_KEY_PASSWORD` (or `WIN_CSC_*`) set.
- [ ] Run `npm run package:win` → nsis + zip + portable; `verify:release -- --platform win` PASS.
- [ ] SmartScreen reputation: submit to Microsoft / accumulate installs (EV cert accelerates trust).
- [ ] Clean-VM install + launch of `NeuroPause-Setup.exe` (per-user, dir-choice, shortcuts).

## 7 · First-user acceptance requirements
- [ ] Fresh, previously-nonexistent user profile.
- [ ] Install → launch → onboarding (Skip setup → Skip tour) → shell mounts local-first (no sign-in wall).
- [ ] Memory: search + Rebuild index + Rebuild semantic index (S147/S148) render truthful states.
- [ ] Sandbox: open an artifact's content (S150) renders inline/empty/unauthorized truthfully.
- [ ] Governed transaction: create a Sales Order / post a journal → proposal → confirm → verified → evidence.
- [ ] All statuses honest (Connected/Synced/HELD/ACKNOWLEDGED/VERIFIED/NOT GOVERNED derived from evidence).

## 8 · Upgrade / recovery requirements
- [ ] Deploy the updater feed (`beta*.yml` + payloads, aliased to `latest*.yml`) to
      `https://neuropause033.com/updates` (DNS + HTTPS host — a money/DNS operator gate).
- [ ] In-app update: install N → publish N+1 → in-app upgrade → relaunch on N+1 → prove a rollback.
- [ ] Restart durability: quit mid-workflow → relaunch → state recovers, no duplicate effect (crash-recovery
      harness on the installed build).
- [ ] Backup/restore DR drill: `make backup` → destroy → restore → verify schema + counts + critical evidence.

## 9 · Security / governance release gates
- [ ] `verify-e2e-strip.sh` PASS on the packaged asar (no test seeds/sentinels ship).
- [ ] `verify:sbom` PASS; SBOM + provenance attached to the release.
- [ ] Frozen-surface integrity: `certification/verify-freeze.sh` / `gate-detector.sh` reconciled at the release
      commit (note: the standing `SOURCE FAIL` is the baseline lagging landed non-frozen work — F-P25
      conflation — not a frozen surface moving; re-record the baseline at the sanctioned checkpoint).
- [ ] Governed-vertical evidence: M365 mail.send LIVE-VERIFIED + journal-post RUNTIME-PROVEN carried into the
      packaged artifact (B.13 packaged-runtime acceptance).
- [ ] **Boot-resilience decision (A-minor):** accept the corrupt-ledger fail-closed edge for RC, or schedule a
      boot-resilience seam (recommended before GA, not before RC).
- [ ] SLO baselines measured on the installed build (availability, proposal/governance/execution/verification
      latency, UNKNOWN-resolution, recovery, evidence durability) — measure-then-target, never invented.

## 10 · Recommended S152
**No feature work.** Choose ONE operator-executed release track and run its §5–§9 checklist on real hardware,
capturing evidence back into `certification/`:
1. **macOS RC certification** — signing + notarization + Gatekeeper + keychain live-check + packaged-runtime
   acceptance on Apple Silicon (highest leverage; the mac path is the most complete). OR
2. **Updater/host + upgrade/rollback** — deploy the feed to `neuropause033.com/updates` and run a real
   N→N+1→rollback cycle. OR
3. **Business-policy rulings (C)** — resolve Sandbox authoring delete/ownership and task #96 posting-ownership
   so the remaining dark authoring surfaces become buildable (each then a small non-frozen slice).
The engineering platform is release-candidate; the remaining path to a trusted release is operator/environment
execution and a few policy rulings — not more code.

**No source modified. No frozen surface touched. No speculative feature. No GA claim. Desktop app + frozen
contracts byte-identical to S150; release infrastructure verified present and engineered; the gates to GA are
operator/environment (B) and business-policy (C). macOS/keychain/notarization/Windows-signing NOT claimed from
Linux CI.**
