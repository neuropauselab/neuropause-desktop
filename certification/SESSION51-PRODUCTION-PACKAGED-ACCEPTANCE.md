# SESSION 51 — PRODUCTION REPACKAGE + PACKAGED ACCEPTANCE GATE

**Purpose:** S49 closed governed Procurement UI; S50 hardened PO status, references and line
editing; the packaged rc.21 artifact predated both. S51 produced the first shippable artifact
containing S49+S50 and proved it behaves exactly like the certified source/runtime path.
SOURCE CERTIFIED ≠ RELEASE CERTIFIED — this session closed that gap.

## 1 · Release custody (Phase 0)

HEAD `f453b1c` confirmed. Working tree dirty by exactly TWO honestly-recorded items at build
time: the custody-protected `certification/baseline.json` (pre-existing, never staged — standing
law) and the deliberate rc.22 version bump (committed with this session). Protected artifacts
preserved and re-verified after packaging: `dist/` (15-Aug rc.20 set, mtimes unchanged),
`dist-seam-s48/` (rc.21), `dist-seam-b13/`. The S51 build wrote ONLY `dist-seam-s51/` (the
S48-proven dist-protecting output override). Armed-`out/` status: already MOOT (recorded in S48 —
rebuilt by a prior session); the canonical chain rebuilt `out/` as it always does.
`.env.entra` never sourced; env swept clean of `*CLIENT_ID*`/`ENTRA*` before building.

## 2 · Provenance (Phase 2/9)

```
SOURCE COMMIT        f453b1c   (PACKAGED COMMIT stamp: f453b1c-dirty — baseline.json + version bump)
VERSION              1.0.0-rc.22       CHANNEL beta
PLATFORM             macOS             ARCHITECTURE arm64
BUILD                canonical package:mac chain (notices → build-info → electron-vite build →
                     electron-builder --mac --arm64 --publish never -c.directories.output=dist-seam-s51
                     → verify:release --dist dist-seam-s51) — FIRST ATTEMPT, exit 0, no fix-rebuild loop
ARTIFACT             dist-seam-s51/NeuroPause-arm64.dmg          135,569,974 B
                     sha256 689046b65f4eee9518bb0b1a5a52bbe072e450167047faa2ab4f887f6feedeaa
UPDATER ZIP          NeuroPause-1.0.0-rc.22-arm64-mac.zip        134,718,825 B
                     sha256 82ccbb9bee86a4bbafceb04b9a4ee92deb7ead89abc730c30bdbe4d7708a34cd
APP.ASAR             59,194,373 B
                     sha256 a265c467d9eb9c307fbf8c25723350253e60e06b0dfec815fa985e5becfe3298
VERIFY:RELEASE       PASS ×7 (artifacts present; beta-mac.yml v1.0.0-rc.22 parity; sha512 feed↔binaries)
BUILD-INFO           {"version":"1.0.0-rc.22","commit":"f453b1c-dirty","channel":"beta",
                     "connectorClientIds":{}}   ← ZERO baked client ids (F-B22-4 bound re-measured clean)
SIGNING              PASS — Developer ID Application (Team J3G89MY3QG), HARDENED RUNTIME
                     (flags=0x10000), codesign --verify --deep --strict exit 0, timestamped;
                     standard Electron entitlement set (allow-jit etc. — recorded, not judged)
NOTARIZATION         PENDING OPERATOR CREDENTIALS — notarize.cjs skip-marker written
                     (notarization-status.json: skipped); Gatekeeper spctl REJECTS as expected for
                     un-notarized Developer ID. DISTRIBUTION gate, not a software defect.
NOTICES              THIRD-PARTY-NOTICES.md regenerated WITH drift (67 packages; dependency set
                     changed since S48) — committed with this session, not hidden.
```

## 3 · Shipped-content proof (Phase 1/3) — measured ON THE ASAR BYTES

Source markers verified at HEAD first (all S49+S50 markers present in source, build-inclusion
via the static import graph). Then the 59,194,373-byte asar was scanned by exact UTF-8 substring
counts (python; shell grep avoided — ugrep alias + BSD binary misclassification), every hit
mapped to its member file via the asar's own directory header:

- **S49 markers 11/11 PRESENT** — all eight command identifiers + the three guard prose strings,
  each confirmed IN `out/main/index.js` (renderer copies are the minified IPC call sites).
- **S50 main markers 3/3, exactly 1 each, in the main bundle** — the received fence, the
  reversal fence, the convertedReceipt fence prose.
- **S50 renderer literals 4/4, exclusively in renderer assets** — 'Subtotal (derived)',
  'could not be read as a table', '(unresolved)', 'Add line' ×3 (LinesEditor + ReferenceField
  shipped in `EnterpriseModuleScreen-DQNBbHP1.js`).
- **STRIP 6/6 at ZERO across the ENTIRE asar** (not just out/): `__NP_E2E__`,
  `NEUROPAUSE_E2E_VERIFY`, `e2eSeed`, `procurementUiJourney`, `PR-PILOT-1`,
  `installE2eSeedPrincipal` — no dev bypass, no journey material, no seed shipped.
- **Single router**: `platform:command.dispatch` channel literal occurs EXACTLY ONCE in the main
  bundle (preload=1 bridge, renderer=4 call sites, shared contract source=1) — one registration
  site, no second dispatcher. (Textual evidence; runtime single-dispatch is proven behaviorally
  by the idempotency/journal asserts below.)
- Incidental (recorded): the asar ships the shared package's TypeScript SOURCES under
  `node_modules/@neuropause/shared/src` — pre-existing packaging shape, contributes to identifier
  counts, strip-clean too.

## 4 · Packaged real-user procurement journey (Phase 4) — PASS 10/10

The rc.22 binary (`NP_APP_BIN`), FRESH profile, clicks/typing only, zero seeding/IPC/fixtures:
onboarding → Business → Procurement → New Purchase Request → **structured line editor (SKU-PILOT
× 10 @ 5, derived-subtotal preview — no JSON typed anywhere)** → governed create → Submit →
Approve → Create Purchase Order → PO visible → **PO total 50.00 derived main-side from the lines
carried PR→PO** → **Source Request linkage visible**. All ten asserts + RESULT green.

## 5 · Packaged governance negatives (Phase 5) — 21/21 HELD

`e2e/s51PackagedNegatives.e2e.cjs` (same legitimate mechanism class as the S45/S48 chain
harness — drives only `window.neuropause.invoke`, the exact door every renderer control uses; no
new IPC, no backdoor), against the rc.22 binary on a fresh profile:

- hand-set draft→**received** REFUSED (status unchanged after) · leaving received REFUSED ·
  approved→**draft** reversal REFUSED · `convertedReceipt` FABRICATE and CLEAR both REFUSED ·
  CONTROL: a second Receive Goods stays refused — the token survived every probe · POSITIVE
  CONTROLS: approve/send/receiveGoods actions all work (the fence touches only the edit door);
  cancelled→draft recovery edit still SAVES (no invented policy shipped).
- governed spine live in the artifact: `CreatePurchaseRequest` + `SubmitPurchaseRequest`
  dispatches ok; **same-key re-dispatch REPLAYS (`replayed === true`), PR pending exactly once**.
- S46 origin fence live packaged: the legacy action door refuses the governed `ship` key BEFORE
  record resolution ("must be performed through its governed command").
- Tenant forgery (TENANT_SCOPE_VIOLATION), pending-order CONFLICT, the S45 order-status edit
  guard, and durable-journal event presence are asserted by the packaged O2C chain run (§6).

Honest bound carried from S49 (unchanged by S51, a custody session): `GOVERNED_ONLY_ACTIONS`
covers the four O2C keys only — procurement actions on the legacy door remain renderer-routed +
module-guarded, not origin-fenced (YELLOW carry-forward, recorded in the S49 matrix).

## 6 · Packaged O2C regression (Phase 6) — GREEN

`o2cRuntime.e2e.cjs` against the rc.22 binary: **27/27 PASS + RESULT, twice** (two clean runs) —
full chain Create→Ship→Invoice→Issue→Pay→PAID with real stock issue, settlement to zero balance,
ConvertQuoteToSalesOrder, idempotent replay, cross-tenant claim rejected (TENANT_SCOPE_VIOLATION),
edit-guard refusal, durable platform-command-journal carrying the O2C domain events. Click
journey packaged: `o2cUiJourney` **9/9 + RESULT**, time-to-first-successful-transaction 13 s.

## 7 · Packaged restart / durability (Phase 7) — PASS 4/4

`s48Restart.e2e.cjs` re-used unchanged against rc.22 on the kept O2C-journey profile:
`isPackaged=true` asserted from the running app · no repeated onboarding (persisted first-run
state honored) · SO-PILOT-1 survived the restart · invoice still PAID · **journal record count
unchanged across restart (5 → 5) — no duplicate effects**. The S48-documented same-profile
evidence limitation applies verbatim and is not overstated. One harness-environment incident on
the way there, classified: the kept-profile journey's exit-grace hang held the profile's
SingletonLock so the chained restart launch stalled (the B.24/S48-measured signature on the same
profile by design of the kept-profile flow); the journey's five governed commands were verified
DURABLE from `platform-command-journal.json` before the restart phase re-ran clean — the product
behaved correctly throughout.

## 8 · Full regression (Phase 12) + run log

```
Full main            966 files · 10,124 passed · 7 skipped   (IDENTICAL to S50 — decision-neutral)
Full UI              79 files · 448 passed                    (identical to S50)
Typecheck            node + web PASS
Lint (source scope)  src + ui-tests + e2e: exactly 1 error — the LOGGED pre-existing frozen-path
                     defect (cst/sendTransition.negative.test.ts unused import; CLAUDE.md §1
                     defect log; never fixed in passing). All S50/S51-touched files clean.
Packaged runs        procurement journey 10/10 · negatives 21/21 · O2C chain 27/27 ×2 ·
                     O2C click journey 9/9 · restart 4/4
```

Failure classifications (nothing suppressed):

- **Version-discipline correction, SELF-CAUGHT before the suite reported it:** the first bump used
  `npm version` inside `apps/desktop`, which moves ONE manifest — the repo's own
  `releaseDiscipline.test.ts` requires root+desktop to move TOGETHER via
  `scripts/bump-version.cjs` (the da36851 two-binaries-one-version class). Wrong instrument,
  right intent (§2 #24 family). Corrected with the sanctioned `npm run version:bump -- 1.0.0-rc.22`
  + the CHANGELOG rc.22 section; discipline pins 4/4; full main re-run GREEN at identical counts.
  The pre-fix in-flight run's 2 main failures were exactly these pins mid-correction. The
  ARTIFACT is unaffected — it was built from the desktop manifest and stamps rc.22 consistently
  across build-info, feed, and Info.plist.
- One pre-fix full-UI run flagged 1 test — the S50-classified parallel-load flake class (ran
  during concurrent packaged-Electron activity); clean re-run 79/448/0.
- **F-S51-1 (YELLOW, recorded not fixed):** `npm run lint` (`eslint .`) is RED by sweep — 7,318
  of its 7,319 errors are the UNTRACKED session build-output dirs (`out-seam-*`, `out-run`
  minified bundles) that postdate the eslint ignore configuration; a permanently-red verifier is
  corrosive (§2 #4) but the ignore-list fix is tooling hygiene outside a custody session's scope.
  Every session's "Lint PASS" claim was and remains a SOURCE-SCOPE claim.

## 9 · Divergence check (Phase 10)

Source pins (12+8 S50, S49 suites), unpackaged runtime (S50's out-seam-s45 runs), and the
packaged rc.22 runs assert the SAME behaviors with the SAME refusal strings and the SAME
positive controls — no divergence observed in: procurement create/actions, PO fences,
convertedReceipt guard, reference pickers (journey linkage), LinesEditor (journey + literals),
O2C command path, tenant isolation, idempotency, durable journal. **RELEASE NOT STOPPED.**

## 10 · Windows (Phase 11)

**GRAY / UNTESTED.** No Windows build was produced or interactively tested in S51. Source-only
claims are not acceptance. Windows is the dedicated next release gate.

## 11 · Remaining release fences

- NOTARIZATION — PENDING OPERATOR CREDENTIALS (distribution validation, not software validation).
- Windows GRAY/untested.
- Policy memos open (SO approval, reversals, ClearCustomer/VendorPayment, importer economic rows).
- S49/S50 YELLOW carry-forwards: procurement legacy-door origin fence, F-S50-1…7.
- Evidence limitations, stated: restart harness same-profile limitation (S48); asar single-router
  evidence is textual + behavioral, not a formal whole-bundle dispatch proof; the packaged
  negative for actor forgery rests on the `.strict()` bridge contract asserted by the chain
  harness rather than a dedicated packaged probe.

## 12 · Final status

SOURCE **GREEN** (f453b1c, untouched) · PACKAGING **GREEN** (first-attempt canonical chain,
dist-protected) · SHIPPED CONTENT **GREEN** (S49 11/11 · S50 3/3+4/4 · strip 6×0) · PACKAGED
PROCUREMENT **GREEN** · PACKAGED PO GOVERNANCE **GREEN** · PACKAGED O2C **GREEN** · SIGNING
**GREEN** · NOTARIZATION **HOLD (operator)** · WINDOWS **GRAY**.
