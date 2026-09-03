# SESSION 67 — FINAL RELEASE READINESS & CUSTODY CONSOLIDATION

## 1 · Custody state (directive §1)

- **HEAD** `daa6a81` (S66) · branch `cert/data-import-cst-integration` · **remote** at S62
  `fb8f320`. **5 commits are local-only:** `2af9622` (S63) · `9b1ef87` (S64) · `3c8c977` +
  `203b15e` (S65) · `daa6a81` (S66). **Not pushed** — this directive does not authorize a push.
- **Production-source content, per commit (measured `git show --stat`):** exactly ONE commit
  carries any `src/main|src/renderer` non-test/non-e2e change — **`9b1ef87` (S64), one file:
  `enterprise/framework/moduleRegistry.ts`** (the single `ECONOMIC_DELETE_GUARD` reversal
  entry; gate-detector PROCEED, non-frozen). S63/S65/S66 are **docs/test/harness only** (0
  prod-src files each). All prior certification history is preserved; tree dirty only by the
  custody-protected `baseline.json` (untouched).

## 2 · rc.24 provenance (directive §2) — hashes re-verified this session

```
dmg   dist-seam-s64/NeuroPause-arm64.dmg          sha256 07d7ff7b…f71409   ✓ matches S64/S65/S66
exe   dist-seam-s64-win/NeuroPause-Setup.exe      sha256 010e9449…83e16a   ✓ matches S64
asar  (both platforms, byte-identical)            sha256 997f6f74…d22479   ✓ matches S64/S65/S66
build-info   version 1.0.0-rc.24 · commit 2af9622-dirty · connectorClientIds {}
```

**The `2af9622-dirty` stamp, explained honestly (not a defect, one caveat):** rc.24 was built
during S64 on the S63 HEAD `2af9622` with the S64 delete-guard change present in the working
tree but **not yet committed** (committed immediately after as `9b1ef87`). The `-dirty` marks
exactly that uncommitted delta. It is content-PROVEN to be the S64 fix: the asar carries the
guard string (`immutable historical evidence carrying a posted compensating GL entry` ×1) and
`finance-payment-reversals` ×3, and the full S57–S64 marker set was content-proven three
times (S64 §7, S65 integrity, S66 in-guest). **Consequence for lineage:** the artifact's
build-info points at `2af9622`+dirty, NOT at the clean pushed commit where the source now lives
(`9b1ef87`). Fine for a pilot (content-proven + functionally accepted); the reproducibility gap
matters only for unrestricted release — see §6.

## 3 · The authoritative release matrix (directive §3–4)

### ENGINEERING
| Item | Status | Evidence |
|---|---|---|
| ERP governed command spine | **GREEN** | S45–S64 fences present at HEAD (S63 §7 spot-read); renderer/AI direct-writes 0 (S63) |
| O2C | **GREEN** | packaged journey 9/9 + chain 27/27, Mac+Win (S56/S64) |
| Procurement | **GREEN** | packaged journey 10/10, Mac+Win (S56/S64) |
| Inventory / Warehouse | **GREEN** | S50/S55 fences (stock-ledger immutability, shipping/dispatch); in full suite |
| Finance / GL | **GREEN** | issued-invoice adjustment governed (S60); GL balances proven in reversal+DR drills |
| Payment reversals | **GREEN** | S61 built, S62 FG-activated + real-Electron, S64 delete-gap closed |
| Approval / SoD | **GREEN (for the defined subset)** | expense-claim `creator_cannot_approve` (S57); bill/spend policies live |
| Tenant isolation | **GREEN** | TENANT_SCOPE_VIOLATION pinned incl. reversal surface (S63); survived DR (S66) |
| Audit | **GREEN** | action-records/decision-records/holds captured + restored (S66) |
| Journal / idempotency | **GREEN** | same-key replay one-effect; recovered byte-identical through DR (S66) |
| Outbox / event durability | **GREEN** | S18 atomic record + S31 sink; at-least-once + eventId dedup; restored (S66) |
| Backup / restore | **GREEN** | canonical BackupManager round-trip, integrity 14/14 (S66) |
| Disaster recovery | **GREEN** | real destructive drill: loss → restore → relaunch, all invariants held (S66) |
| Security negatives | **GREEN** | S51/S53/S64 packaged negatives (origin fence, tenant/actor forgery, replay) |
| Packaged Mac acceptance | **GREEN** | rc.24 measured this session-arc: reversal 39, procurement 10/10, restart 4/4 (S64/S65) |
| Packaged Windows acceptance | **GREEN** | rc.24 real Win11 ARM64 VM: reversal 39, procurement 10/10, O2C 9/9, restart 4/4 (S64) |
| Full regression | **GREEN** | main 972/10,170/7, UI 80/455, typecheck, discipline 4/4 (S62/S63/S64) |

### DISTRIBUTION
| Item | Status | Evidence |
|---|---|---|
| macOS Developer ID signing | **GREEN** | measured on rc.24 app: Developer ID J3G89MY3QG, hardened runtime, verify exit 0 (S65) |
| macOS notarization | **OPERATOR-BLOCKED** | no Apple credentials (env/keychain/p8 all absent, re-measured S65) |
| Gatekeeper | **OPERATOR-BLOCKED** | `spctl` measured `rejected / Unnotarized Developer ID` (S65) — unblocks on notarization |
| Windows Authenticode | **OPERATOR-BLOCKED** | no cert (CSC/pfx absent); rc.24 PE security-dir = 0 (S65) |
| Windows SmartScreen | **GRAY** | reputation accrues post-release from signed downloads; cannot pre-measure (S65) |
| Updater | **POLICY/OPERATOR DECISION REQUIRED** | no mandatory-vs-optional ruling; feed host `neuropause033.com` had no A record (S54/S56) |
| Native Windows x64 | **GRAY (optional)** | all Win acceptance = real Win11 ARM64 kernel + MS x64 emulation (S53); native hw unproven |
| Mac/Win artifact reproducibility | **YELLOW** | build-info stamps `2af9622-dirty`, not a clean committed SHA — see §6 |

### POLICY
| Item | Status | Evidence |
|---|---|---|
| SO approval | **POLICY-BLOCKED (safe default in force)** | operator memo: choose no-approval or supply threshold+role (S57/S59 register) |
| O2C reversal / settlement | **CLOSED for defined semantics** + residual POLICY-BLOCKED | reversals/notes/clearing promoted (S57); partial credit notes / reopen-paid / cleared-reversal open |
| Deep Finance / HR authority | **PARTIAL** | expense self-approval CLOSED; payroll/fixed-assets/adjustments/period-reopen POLICY-BLOCKED (control plane unbuilt by operator ruling) |
| PO approve/send lifecycle | **POLICY-BLOCKED** | operator DECIDED "require before receiving"; commands don't exist (mechanism-absent) |
| Remaining legacy doors | **YELLOW (defined-legacy, memo'd)** | issued-invoice ADJ edits + DELETE reversals; importer reviewer-update bypass; procurement origin-fence carry |

## 4 · Release decisions (directive §5)

**A. Engineering-ready?** **YES.** Every engineering dimension is GREEN with runtime evidence;
RED = 0. The one prod-source change since S62 (the S64 delete-guard) is committed, pinned, and
in the accepted artifact. No closed gate reopened (§7 honored).

**B. Mac pilot-release-ready?** **YES, CONDITIONAL** — GO for a pilot where the operator
installs via right-click→Open (Gatekeeper bypass for un-notarized Developer ID). The signed,
content-proven, functionally-accepted rc.24 dmg is sufficient for a controlled pilot;
notarization is required only for frictionless/unrestricted distribution.

**C. Windows pilot-release-ready?** **YES, CONDITIONAL** — GO for a pilot accepting the
SmartScreen warning path (unsigned installer). Functionally accepted on the real Windows
runtime; Authenticode required for frictionless/unrestricted distribution.

**D. Unrestricted customer release-ready?** **NO** — blocked solely by external/operator
prerequisites (E/F) + the reproducibility build (§6). No engineering blocker remains.

**E. Exact external/operator actions remaining:** (1) Apple notarization credentials
(app-specific password or ASC API key) → notarize+staple rc.24 → Gatekeeper accept. (2) Windows
Authenticode (OV/EV) certificate → sign Setup.exe. (3) Updater ruling (mandatory vs optional);
if mandatory, a live update host. (4) SmartScreen reputation (accrues after signed distribution
— time, not an action).

**F. Exact policy decisions remaining:** SO approval interpretation · cleared-payment reversal /
partial credit notes / reopen-paid semantics · payroll+disbursement / fixed-asset /
stock-adjustment / period-reopen authority thresholds+roles · PO approve/send commitment. Each
has a filed memo and a one-sentence unblock; none blocks a pilot.

**G. Still requires engineering?** **Nothing release-blocking.** Optional: the reproducibility
build (§6, ~mechanical) and the SIGKILL-mid-restore DR hardening (§8).

## 5 · Strict residual counts

- **RED: 0**
- **YELLOW: 3 classes** — artifact reproducibility (build-info dirty stamp) · defined-legacy doors
  (issued-invoice ADJ/DELETE, importer reviewer-update, procurement origin-fence carry) · packed
  workspace `.ts` source hygiene (carried from S56).
- **GRAY: 3** — SmartScreen · native-x64 Windows · SIGKILL-mid-restore DR injection.
- **POLICY-BLOCKED: 5** — SO approval · cleared-reversal/partial-notes/reopen-paid · deep
  Finance+HR authority (payroll/fixed-asset/adjustment/period) · PO approve/send · (updater ruling
  overlaps operator).
- **OPERATOR-BLOCKED: 3** — macOS notarization (+ Gatekeeper) · Windows Authenticode · updater
  host (if ruled mandatory).

## 6 · Clean-lineage decision (directive §6)

**Recommendation: for UNRESTRICTED release, do ONE final clean reproducible build from the pushed
canonical commit; for the PILOT, the existing content-proven rc.24 is sufficient.** Reasoning is
provenance, not convenience: rc.24 is content-proven and functionally accepted, but its build-info
stamps `2af9622-dirty` — a build over S63 HEAD plus an uncommitted delta, not a clean committed
SHA. Unrestricted distribution deserves a build whose build-info points at a pushed, clean commit
(`9b1ef87` or later) so the shipped bytes are byte-reproducible from a named commit and the signing
step (which the operator must do anyway for notarization/Authenticode) starts from clean lineage.
**Do NOT rebuild merely to change metadata for a pilot** — the pilot's rc.24 is already proven.

## 7 · Optional hardening — SIGKILL-mid-restore (directive §8)

**Classification: RECOMMENDED HARDENING, not release-blocking.** The canonical restore writes
each file atomically (tmp + rename), so a crash mid-restore leaves every file either old-complete
or new-complete — never torn — and the pre-flight integrity gate + safety snapshot bound the blast
radius. The full happy-path DR round-trip is GREEN (S66). A SIGKILL-during-restore + reboot drill
would confirm the atomic-write invariant under real interruption; its absence is an unproven
strengthening, not a defect. Unnecessary for the current pilot scope; worth doing before
unrestricted GA.

## 8 · Recommended next gate

**S68 — one of two, operator's choice:** (a) the reproducibility release build from a pushed
clean commit (mechanical; produces the unrestricted-candidate artifact and the pushed lineage),
or (b) distribution-trust execution once the operator supplies notarization + Authenticode
credentials (the S65 staged runbook). Both are external/operator-gated; neither requires new ERP
engineering. The SIGKILL-mid-restore hardening is a smaller optional third.
