# SESSION 54 — DISTRIBUTION TRUST + UPDATE CLOSURE

## 1 · Executive result

**Every distribution-trust gate is OPERATOR-BLOCKED on credentials/infrastructure that do not
exist in this environment — measured across exhaustive search spaces, not assumed — so no gate
moved to GREEN and none was fabricated.** What S54 DID close: the credential landscape is now
fully mapped with the exact operator runbook per gate; the final artifacts' custody, feeds,
and security posture were re-verified (independent two-agent sweep of both platform
artifacts); and full regression is green. **WINDOWS AUTHENTICODE: PENDING · MACOS
NOTARIZATION: PENDING · WINDOWS UPDATER: GRAY/OPERATOR-BLOCKED (the production update host
has NO A RECORD — there is no genuine update source to test against) · GLOBAL RELEASE: HOLD
on distribution trust only** — both platforms remain functionally GREEN (S51/S53, untouched).

## 2 · Baseline & custody (Phase 0/2)

HEAD `ac1671e` confirmed; tree dirty only by the custody-protected `baseline.json`. Version
`1.0.0-rc.22` both manifests. **No artifact was rebuilt, signed, or replaced this session** —
with no new credentials there was nothing honest to produce, and the certified artifacts stay
byte-preserved: mac dmg `689046b6…` OK · win Setup.exe `99a9a1b5…` OK · both asars
`a265c467…` (identical, re-compared). `verify:release` re-run PASS on BOTH dists.

## 3 · Credential discovery (Phase 1) — AVAILABLE / NOT AVAILABLE, search spaces stated

| Credential | State | Search space |
|---|---|---|
| Windows Authenticode cert/key | **NOT AVAILABLE** | CSC*/WIN_CSC env (0) · `*.pfx` via mdfind (0) · electron-builder.yml win signing keys (none) |
| Mac Developer ID Application | **AVAILABLE/CONFIGURED** | keychain codesigning identities (1) — already used by S51 |
| Apple notarization (app-specific pw) | **NOT AVAILABLE** | APPLE_* env (0) · notarytool keychain service item (absent, service-wide) · named profile probe (absent) |
| App Store Connect API key | **NOT AVAILABLE** | `AuthKey_*.p8` via mdfind (0) · `~/.private_keys` (absent) · ASC env (0) |
| Update server | **NOT AVAILABLE** | `app-update.yml` → `https://neuropause033.com/updates` (generic provider); **`host -t A neuropause033.com` → NO A RECORD, measured live this session** (MX exists; web host dead) |
| Product feed-override mechanism | **NONE EXISTS** | `appUpdater.ts` — no setFeedURL/env override; the baked app-update.yml is the only feed source |

No secret material was printed, exported, or touched (`DeveloperID.p12` untouched per
standing constraint; `.env.entra` never sourced).

## 4 · Why each gate stays where it is (Phases 3/4/8 — refusals, not failures)

- **Windows Authenticode (Phase 3):** nothing to sign WITH. Runbook: supply a pfx/token via
  `CSC_LINK` + `CSC_KEY_PASSWORD` (or configure `win.certificateSubjectName` for a machine
  store cert) → rebuild via the canonical `package:win` into a fresh dist dir → verify with
  the S52 PE-security-directory measurement AND in-guest `Get-AuthenticodeSignature` (the VM
  rig is proven) → then the Phase-6 signed-package spot check on the VM. SmartScreen
  reputation is a separate, time-accumulated fact — never claimable from Authenticode alone.
- **macOS notarization (Phase 4):** the cleanest custody path once credentials exist is
  `xcrun notarytool submit dist-seam-s51/NeuroPause-arm64.dmg --keychain-profile <p> --wait`
  → `xcrun stapler staple` → re-hash (stapling changes bytes — Phase 5 applies) → `spctl -a
  -vv` expecting acceptance → the Phase-7 Finder-path spot check. Credentials needed:
  `notarytool store-credentials` with an app-specific password, or an ASC API key. Signing
  itself is already DONE and verified (S51: Developer ID, hardened runtime, verify exit 0).
- **Windows updater E2E (Phase 8):** the ONLY feed source is the baked
  `https://neuropause033.com/updates`, and that host has no A record — there is no genuine
  update source. Redirecting the installed app's `app-update.yml` at a local server was
  REFUSED as "changing local files manually"/fake infrastructure (the directive's own
  exclusions); the product defines no sanctioned override. Runbook: bring the real update
  host live (publish rc.21 + rc.22 sets + beta.yml there), then the two-version scenario runs
  on the proven VM rig: install rc.21 → updater discovers rc.22 → download → integrity →
  install → relaunch → version + profile + journal-count assertions. Rollback semantics: the
  product configures `autoDownload=false / autoInstallOnAppQuit=false / allowDowngrade=false`
  (measured) — no formal rollback guarantee is defined, so none was invented (Phase 9:
  recorded, not tested).

## 5 · Security review of the FINAL artifacts (Phase 11) — two-agent sweep, CLEAN

Independent byte-level sweep (python exact-substring over raw bytes; search spaces stated per
claim; the shared asar scanned once — hash identity re-verified by BOTH agents):

- **Asar (both platforms, 59,194,373 B, all 4,786 packed files):** private-key headers 0/0/0 ·
  `sk-ant-` 1 (the product's OWN NP-013 redaction pattern) · `AKIA` 2 (the product's own
  secret-scanner regexes) · `xoxb-` 4 (6–8-char synthetic vault-test fixtures in packed
  workspace test sources) · `client_secret` 12 (OAuth FIELD names / type literals / a
  negative assertion — independently re-classified, not inherited) · `APP_SPECIFIC_PASSWORD`
  0 · dev endpoints 0×5 · **S51 strip set 0×4 (holds across even the 227 packed test
  files)** · debug switches 0×3 · no `.env`/`.pem`/`.p12`/`.pfx` anywhere (filesystem AND
  asar-path spaces both swept) · build-info `connectorClientIds: {}`.
- **Windows wrapper (112 files / 739,887,598 B excluding the asar):** all classes 0 real;
  608 raw `AKIA` hits are coincidental 4-byte substrings inside the stock Electron shell's
  embedded base64/WASM data — the AWS-key-shape regex with boundaries matches **0** across
  the whole space; `elevate.exe` byte-identical to the electron-builder NSIS toolchain copy;
  feed yml token-free; no key/cert/env files.
- **Hygiene observation (recorded, not a security hit):** the asar packs `@neuropause`
  workspace-package TypeScript SOURCES incl. test files — strip markers are 0 across them,
  so no bypass ships; slimming the packed file set is an artifact-size/hygiene follow-up.

The existing release verifier re-ran PASS on both dists (§2). No second scanner was created —
the sweep used the same byte-count instrument discipline as S51/S52.

## 6 · Full regression (Phase 12)

```
Full main            966 files · 10,124 passed · 7 skipped   (identical to S51/S52/S53)
Full UI              79 files · 448 passed — CLEAN on the first run this session
Release discipline   4/4 · Typecheck PASS
Lint (source scope)  exactly the 1 LOGGED pre-existing frozen-path error — unchanged
Source changes       ZERO product/test source changes this session (docs only)
```

Known classifications carried unchanged: the pre-existing lint error (PRE-EXISTING) ·
`previewNavReachability` parallel-load flake (YELLOW follow-up; did not recur this run) ·
F-S51-1 lint-sweep hygiene (YELLOW) · S49/S50 policy carry-forwards (untouched — Phase 13
honored: no business policy invented or altered).

## 7 · Decision matrix (Phases 14+)

- **WINDOWS DISTRIBUTION TRUST: PENDING OPERATOR CREDENTIALS** (functional GREEN, S53).
- **MACOS DISTRIBUTION TRUST: PENDING OPERATOR CREDENTIALS** — signing half GREEN (Developer
  ID + hardened runtime, verified), notarization half pending; Gatekeeper correctly REJECTS
  un-notarized Developer ID today (measured S51/S52) and cannot honestly read otherwise.
- **WINDOWS UPDATER: GRAY / OPERATOR BLOCKED** (no live update host; feed verified
  structurally only).
- **GLOBAL RELEASE: HOLD — on distribution trust ONLY.** Both platforms are functionally
  accepted end-to-end (S51 Mac, S53 Windows); local/pilot distribution of the existing
  artifacts remains covered by the S51 CONDITIONAL GO. Whether the updater is a MANDATORY
  release requirement is the operator's ruling — if optional, trust credentials alone
  complete the release; if mandatory, the update host must come first.

## 8 · Next recommended session

**The same S54 gate, re-run the day the operator supplies any of the three inputs** (Windows
cert · Apple notary credentials · a live update host). Every procedure, verifier, VM rig and
spot-check is staged and recorded above — the session is mechanical once the inputs exist.
Nothing else in the program is blocked on it: policy-memo closure or the pilot-feedback loop
are the productive parallel tracks.
