# SESSION 68 — CLEAN REPRODUCIBLE RELEASE CANDIDATE

## Executive result

**The first clean-lineage rc.24 exists and is reproducibility-proven.** Built from the clean
committed SHA `8079ec7` with a genuinely clean tracked tree — build-info stamps
`8079ec7 · dirty:false` (no more `2af9622-dirty`) — and the **application payload is BYTE-IDENTICAL
to the S64/S65/S66 rc.24**: the S68 asar sha256 `997f6f74…d22479` equals the certified rc.24 asar
exactly, on both platforms. Same committed source → same bytes. The only artifact differences are
the honest, expected metadata ones (build-info commit + timestamps). Fresh Mac functional
acceptance passed on the new candidate; Windows behavior is proven by asar byte-identity to the
S64 real-VM run. Distribution trust is unchanged (signed / not-notarized / unsigned-Windows) —
nothing fabricated.

## 1 · Custody

- HEAD `8079ec7` (S67) · branch `cert/data-import-cst-integration` · remote `fb8f320` (S62) —
  S63–S67 remain local-only (no push authorized this directive).
- **S64 delete-guard confirmed in the COMMITTED tree:** `git show HEAD:…/moduleRegistry.ts`
  contains the guard string ×1 (committed, not merely working-copy).
- **Production source tree CLEAN** — no uncommitted `src/` changes; the sole tracked
  modification was the custody-protected `certification/baseline.json`.
- **`baseline.json` preserved byte-identical** across the build: stashed before (sha
  `2990dd1b…60cd`), popped after, re-hashed identical. Never discarded, never edited.
- All S63–S67 certification history intact.

## 2 · Clean release source (the honest provenance path)

The canonical commit carrying all S64–S67 production + certification state is **HEAD `8079ec7`**
(S64's one prod-source file + every cert through S67). The build ran in the main checkout with a
GENUINELY clean tracked tree, achieved without touching source or committed files:
1. `baseline.json` stashed (git's own preservation primitive) → restored byte-identical after.
2. `THIRD-PARTY-NOTICES.md` left as the COMMITTED certified bytes (not re-derived — a clean-SHA
   build must not introduce dep-drift).
3. Untracked build-output dirs (`dist-seam-*`, `out-seam-*`, `e2e-artifacts`) and pre-existing
   untracked evidence/harness files added to LOCAL `.git/info/exclude` (non-committed,
   non-source) so `git status --porcelain` reflects the clean *tracked payload-determining* tree.
   Every excluded entry was first verified to be a build artifact or pre-existing non-payload
   file — **no untracked source exists** (measured).

Result: `git status --porcelain` = 0 lines (tracked tree clean, baseline stashed) →
`generate-build-info.cjs`'s `git status --porcelain !== ''` check returns clean →
**commit `8079ec7`, dirty:false**. No `NEUROPAUSE_BUILD_COMMIT` override was used (overriding
while dirty is exactly the provenance lie the `-dirty` suffix exists to prevent, §7).

*(A `git worktree` at `8079ec7` was attempted first — the textbook-cleanest path — but building there
with symlinked `node_modules` hit a vite subpath-resolution error (`@noble/hashes/./utils`), a known
symlink hazard; the main-tree + stash approach is equivalent in provenance and builds cleanly.)*

## 3 · Release build — artifacts

```
COMMITTED SHA   8079ec7  ·  dirty:false        VERSION  1.0.0-rc.24        PLATFORM mac arm64 + win x64
build-info      version 1.0.0-rc.24 · commit 8079ec7 · dirty false · connectorClientIds {}
MAC dmg   dist-seam-s68/NeuroPause-arm64.dmg          135,347,634 B  sha256 7afb26df199401dd6987eec54586f9858c32767f6bf4cdd63cac4df177e15d8a
MAC zip   NeuroPause-1.0.0-rc.24-arm64-mac.zip                       (updater payload)
WIN exe   dist-seam-s68-win/NeuroPause-Setup.exe      111,852,624 B  sha256 7a381aaaea6296d11d0b0b8dc261222da703bc7d8bfbfbbe3dad83b9e9615f66
ASAR      (both platforms, byte-identical)             57,980,577 B  sha256 997f6f7484fb8d76fa59344553f8639bf8a46ffc5b65bd4f2de33ec85fd22479
SIGNING   mac SIGNED (Developer ID J3G89MY3QG, hardened runtime) · NOT notarized (skip marker)
          win UNSIGNED (PE security-dir size 0, measured)
REPRODUCIBILITY  build-info.json is an extraResource (Contents/Resources/), read at runtime by
                 buildInfo.ts — NOT baked into the asar. Therefore same committed source ⇒
                 byte-identical asar; the commit string never enters the payload.
```

## 4 · Payload integrity — content-proven on the S68 asar (direct, not inherited)

`ReverseCustomerPayment` 3 · `ReverseVendorPayment` 4 · `finance-payment-reversals` 3 ·
`ClearCustomerPayment` 7 · `ConvertQuoteToSalesOrder` 5 · S64 delete-guard string 1 · S55
`Posted entries are immutable` 4. **Strip set 0×4** (`__NP_E2E__`, `NEUROPAUSE_E2E_VERIFY`,
`e2eSeed`, `PR-PILOT-1`). All S57–S67 production state present; the S66 DR recovery state is the
same `BackupManager`/`storePaths` code carried in this identical asar. No baked client-ids.

## 5 · Artifact comparison vs rc.24 (every difference explained)

| Component | rc.24 (S64) | S68 clean | Explanation |
|---|---|---|---|
| **asar** | `997f6f74…` | `997f6f74…` | **BYTE-IDENTICAL** — zero ERP/runtime payload change (build-info not in asar) |
| build-info commit | `2af9622-dirty` | `8079ec7` | the point of S68 — clean committed SHA |
| build-info buildTime | (S64 time) | (S68 time) | fresh build timestamp — expected |
| dmg sha | `07d7ff7b…` | `7afb26df…` | wraps the changed build-info.json + fresh timestamps — expected |
| exe sha | `010e9449…` | `7a381aaa…` | same reason — expected |

**UNEXPLAINED PAYLOAD DIFFERENCES: NONE.** The asar (the entire application/runtime payload) is
byte-identical; every hash that differs differs solely because of the metadata resource and
timestamps, which is exactly what a clean-lineage rebuild is expected to change.

## 6 · Functional acceptance

- **Mac (NEW candidate, measured this session):** reversal journey **39 PASS + RESULT** (customer +
  vendor reversal, original immutable, document re-opens, idempotent replay, D6 + S64 delete
  refusals) · procurement journey **10/10 + RESULT**, both on the packaged S68 dmg, fresh profiles.
- **Windows:** the S68 Windows asar is **byte-identical** to the rc.24 Windows asar that passed the
  full S64 real-VM matrix (reversal 39, procurement 10/10, O2C 9/9, restart 4/4, journal
  byte-identical). The wrapper differs only in the build-info commit string — an external resource
  read at runtime, never executed as ERP logic — so runtime behavior is provably identical. A VM
  re-run is available but evidentially redundant against byte-identity (recorded honestly as
  inherited-by-proof, not as a fresh S68 measurement).

## 7 · Provenance

**ACHIEVED — the artifact reports a committed SHA, not dirty:** in-artifact build-info =
`1.0.0-rc.24 · 8079ec7 · dirty:false`. The clean build was achieved without any provenance patch:
no source modified, no committed file changed, no commit override; the tree was made genuinely
clean (stash + local-exclude of non-payload artifacts) and the payload built from it is
byte-faithful to `8079ec7` (proven by asar identity).

## 8 · Classification

- **RED: 0** · **YELLOW: 0 new** (the S67 artifact-reproducibility YELLOW is now RESOLVED — this is
  the clean-lineage build; other S67 YELLOWs (legacy doors, packed-source hygiene) unchanged and
  out of S68 scope).
- **GRAY:** SmartScreen · native-x64 Windows · SIGKILL-mid-restore DR injection (all carried, S67).
- **POLICY-BLOCKED:** SO approval · reversal/settlement residuals · deep Finance+HR authority · PO
  approve/send (carried, S67 — out of S68 scope).
- **OPERATOR-BLOCKED:** macOS notarization · Windows Authenticode · updater ruling+host (carried).

## FINAL DECISION

**YES — this IS the canonical unrestricted-release candidate.** rc.24 at clean SHA `8079ec7` has:
committed-SHA provenance (no dirty), a byte-identical-to-certified payload (reproducibility
proven), content-proven S57–S67 governance, strip-clean bytes, and fresh Mac functional
acceptance with Windows behavior proven by byte-identity. It supersedes the `2af9622-dirty` rc.24
as the release artifact of record.

**It is NOT yet cleared for unrestricted GA** — unchanged from S67, the only remaining blockers are
external/operator: macOS notarization credentials, Windows Authenticode certificate, the updater
ruling (+ live host if mandatory), and the open business-policy decisions. None is engineering.
The distribution-trust step (which the operator must perform for notarization/Authenticode anyway)
now starts from clean lineage.

**Recommended next: S69** — distribution-trust execution against this clean candidate once the
operator supplies notarization + Authenticode credentials (the S65 staged runbook), OR the operator
authorizes pushing the local S63–S68 chain so the clean SHA is on the remote before signing.
