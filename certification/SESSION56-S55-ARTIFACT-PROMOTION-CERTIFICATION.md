# SESSION 56 — S55 ARTIFACT PROMOTION CERTIFICATION

## 1 · Executive result

**THE S55 FENCE SET IS PROMOTED AND PROVEN IN THE SHIPPABLE ARTIFACTS ON BOTH PLATFORMS.**
rc.23 built first-attempt from `7f1bd66` (mac signed / win unsigned-pending, both dists
protected); the byte-identical asar carries all 15 S55 refusal markers with the −87 test-file
exclusion effective; the security sweep is clean with every hit classified; and the fences
were DRIVEN LIVE against both packaged runtimes — **35 fence negatives + 20 S51 negatives +
procurement 10/10 + O2C chain 27/27 + O2C click 9/9 + restart 4/4 with a byte-identical
journal, on macOS AND on the real Windows 11 VM.** Full regression identical to S55
(967/10,137/7 · 79/448 · discipline 4/4). SOURCE = SHIPPED ARTIFACT again.

## 2 · Custody & provenance (Phases 0–3)

Baseline/HEAD `7f1bd66` confirmed (tree dirty only by the custody-protected `baseline.json` →
honest `-dirty` stamps). Version bumped rc.22 → **1.0.0-rc.23** via the sanctioned
`scripts/bump-version.cjs` (both manifests; discipline pins 4/4; CHANGELOG rc.23 section
added). Canonical chains, first attempt, exit 0, into fresh `dist-seam-s56/` (mac) +
`dist-seam-s56-win/` (win); `dist/`, `dist-seam-s48/51/52-win` byte-untouched (hash-checked).
`verify:release` PASS on both platforms.

```
MAC   NeuroPause-arm64.dmg           135,329,420 B  sha256 56b7bf215cd67ce8b92ff533c108c15df40a55ec0e6194887a5567bf1eb5e47f
      updater zip                    134,482,328 B  sha256 925206f3f8ce239080d139e9186c5532bcbd5daabad3324aaac46859f28d706c
WIN   NeuroPause-Setup.exe           111,849,139 B  sha256 62927d25e3e21b54bc6f85d7c59396d6b624a7baee884a8ecb666a554b7468b6
ASAR  (BOTH platforms, byte-identical) 57,959,887 B sha256 046ac064ee87a10bab77c8397d42a7ee5578264683c76e5c328b01c1fda2a599
      (rc.22 asar was 59,194,373 B — the S55 test-file exclusion working: −87 packed *.test.ts)
build-info  1.0.0-rc.23 · 7f1bd66-dirty · connectorClientIds {} (both wrappers)
SIGNING     mac SIGNED (Developer ID J3G89MY3QG, hardened runtime) · NOT notarized (skip marker)
            win UNSIGNED (PE security-directory size 0, measured — the signtool log line is
            asar-integrity stamping, as classified since S52)
```

## 3 · S55 fence presence in the artifact (Phase 4) — PASS 15/15 markers

Measured on the asar BYTES (python exact-substring, hits mapped to member files via the asar
directory header; one scan covers both platforms by hash identity, verified first): all
fifteen S55 refusal strings present, every hit inside `out/main/index.js` (one extra hit in a
packed shared-package source). Strip set 0×5. **Packed `*.test.ts` files: 0 (rc.22 had 87 —
delta −87, the S55 exclusion effective).** Recorded observation (not a failure): the asar
still packs 730 plain `.ts` workspace sources — the known hygiene residue, deliberately not
excluded in S55 (unproven safety of a broader glob).

## 4 · Security sweep (Phase 5) — PASS, every hit classified

S54 methodology re-run on the FINAL rc.23 bytes (not inherited): private-key headers 0×3 ·
`xoxb-` 0 (the rc.22 fixture hits vanished with the test-file exclusion) · `sk-ant-` 1 =
the product's own NP-013 redaction-pattern comment · `AKIA` 2 raw = the product's own
redaction/detection regex sources, bounded AWS-shape **0** · `client_secret` 10 = OAuth field
names/type literals, zero values · dev endpoints 0×3 · debug switches 0×3 ·
`APP_SPECIFIC_PASSWORD` 0 · no `.env/.pem/.p12/.pfx/.key` anywhere under either dist ·
`connectorClientIds {}` both wrappers · win shell AKIA substrings classified (coincidental
base64; AWS-shape 0). `app-update.yml` identical across platforms (generic provider,
neuropause033.com/updates, beta).

## 5 · Mac packaged acceptance (Phases 6–8)

**S56 negative harness (`e2e/s56PackagedNegatives.e2e.cjs`, the established invoke-door
mechanism, fixtures built through LEGITIMATE doors only): 35 PASS + RESULT on the rc.23
binary, fresh profile.** Twelve of fourteen S55 classes DRIVEN LIVE end-to-end — including
the full store-anchored circle for accounting periods (close action → edit-clear REFUSED →
canonical reopen WORKS), the cancelled-PO receiving refusal, the stock-ledger
posted-immutable/void-allowed/void-terminal triple, and SetStatus-'deleted' vs
archived-still-works. **No-over-fence controls all green**: quote draft→sent free, shipping
pending→cancelled free, PO-less receipt posts, normal bill edits save, canonical
reopen/void/Delete-door paths intact. **Honest scope, stated in the harness's own output:**
`bankReconciledAt` and the journal STORE-half are not live-drivable through legitimate
packaged doors (their states are only mintable by flows the harness cannot legitimately
reach) — covered by fence-presence bytes (§3) + the 13 S55 source pins; the journal
INPUT-half (forging `postedAt`) WAS driven live and refused. One harness fixture iteration
during bring-up (journal lines JSON must be a non-empty balanced array resolving real chart
codes — the S55 pins used raw-store fixtures and never exercised the create door; fixed,
zero assertion changes).

**Mac journeys (rc.23 binary, fresh profiles, clicks only):** procurement **10/10 + RESULT**
(structured lines, 50.00, linkage) · O2C click **9/9 + RESULT** · O2C chain **27/27 + RESULT,
exit 0** (tenant rejection, replay suppression, edit guards, durable journal) · restart flow:
kept-profile journey + `s48Restart` — results in §8's run log with the journal byte-compare.

## 6 · Windows packaged acceptance (Phase 12) — GREEN on the NEW artifact

The S53-proven Windows 11 (26100, ARM64) QEMU rig — used directly, no repeated environment
search. rc.23 installer downloaded INTO the guest, hash-verified there
(`62927D25…` exact match), silent-installed; installed `build-info` = **1.0.0-rc.23 /
7f1bd66-dirty**. Matrix on the running Windows binary (result-driven watchdog — the S53
exit-hang class now costs seconds, not 20-minute timeouts):

- **S56 fence negatives: 35 PASS + RESULT** — all drivable S55 classes held on Windows.
- **S51 governance negatives: 20 PASS + RESULT** (origin fence, replay, tenant, S50 fences).
- **Procurement journey 10/10 + RESULT** · **O2C chain 27/27 + RESULT** · **O2C click journey
  9/9 + RESULT** · kept-profile journey 9/9 · **restart 4/4 + RESULT** with
  `platform-command-journal.json` **byte-identical across the restart (4,633 B → 4,633 B,
  `cmp` clean on the host)**.

Windows Authenticode: still UNSIGNED/PENDING (measured on the PE bytes; functional acceptance
and distribution trust reported separately, as always).

## 7 · Updater (Phase 13)

GRAY unchanged — `neuropause033.com` still has no A record (re-measured in S54, feed host
dead); feed configuration verified structurally (identical yml both platforms). No fake
endpoint was created; the packaged app was not redirected.

## 8 · Full regression (Phase 14) + run log

```
Full main            967 files · 10,137 passed · 7 skipped   (IDENTICAL to S55)
Full UI              79 files · 448 passed · Discipline 4/4 · Typecheck PASS
npm run lint         exactly the 1 logged pre-existing frozen-path error (unchanged class)
MAC (rc.23)          s56 negatives 35 PASS · procurement 10/10 · O2C click 9/9 · chain 27/27
                     exit 0 · kept journey 9/9 · restart 4/4 · journal BYTE-IDENTICAL (cmp)
WIN (rc.23, real VM) stage-A hash-match + install + build-info 1.0.0-rc.23/7f1bd66-dirty ·
                     s56 negatives 35 · S51 negatives 20 · procurement 10/10 · chain 27/27 ·
                     O2C click 9/9 · kept 9/9 · restart 4/4 · journal 4,633→4,633 BYTE-IDENTICAL
Incidents            two harness-environment items, classified: one journal-create fixture
                     iteration (the create door requires non-empty balanced lines resolving
                     real chart codes — S55's raw-store pins never exercised it; fixed, zero
                     assertion changes) · the known exit-grace close-hang recurred on mac and
                     was absorbed on windows by the result-driven watchdog; one host command
                     re-run after my own grep-pipe swallowed harness output (instrument, §2 #24).
```

## 9 · Decision

**PACKAGED S55 GOVERNANCE: GREEN (both platforms, driven live).** MAC FUNCTIONAL GREEN ·
WINDOWS FUNCTIONAL GREEN (new artifact, real VM) · MAC DISTRIBUTION PENDING (notarization) ·
WINDOWS DISTRIBUTION PENDING (Authenticode) · UPDATER GRAY (host still has no A record) ·
POLICY-BLOCKED: the three memos (SO approval · O2C reversal/settlement/shipment-docs ·
deep-finance + HR authority). **GLOBAL RELEASE: CONDITIONAL GO** — the pilot-scope artifacts
now carry every certified fence; only distribution trust and the policy decisions stand
between rc.23 and unrestricted release.
