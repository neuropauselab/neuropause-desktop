# SESSION 65 — DISTRIBUTION TRUST CLOSURE AGAINST rc.24

**Class:** distribution-trust measurement against the rc.24 artifacts only. No ERP business logic changed · no new infrastructure · no D8–D11 · no PO approve/send · no bank-reconciled-reversal change · no new updater architecture. **No production source touched — measurement + certification only.** Every trust dimension is separated into GREEN / OPERATOR-BLOCKED / GRAY / POLICY-BLOCKED, and GREEN is claimed only where actual evidence exists.

## Executive result

The rc.24 artifacts are **byte-for-byte the S64-certified artifacts** (all four hashes re-verified this session), and the shipped payload is content-proven to carry the full S57–S64 governance with the e2e strip set at zero and zero baked client-ids. Distribution *signing trust* is exactly where S64 left it, now re-measured directly: **macOS notarization and Windows Authenticode are OPERATOR-BLOCKED on absent credentials**, SmartScreen is GRAY, the updater ruling is a POLICY/OPERATOR decision, and the DR drill is not claimed. Nothing was fabricated; no self-signed certificate was generated; no fake endpoint was created.

## 1 · Custody — GREEN

| Item | Value | State |
|---|---|---|
| HEAD | `9b1ef87` (`feat(erp-s64): close the reversal-record delete gap + promote rc.24`) | matches S65 baseline ✓ |
| Remote HEAD | `fb8f320` (S62) — **S63 `2af9622` + S64 `9b1ef87` are UNPUSHED** | operator push owed (Mac) |
| S64 certification | `certification/SESSION64-REVERSAL-DELETE-GUARD-AND-RC24-CERTIFICATION.md` present, records rc.24 promotion | ✓ |
| rc.24 source identity | build-info `version 1.0.0-rc.24 · commit 2af9622-dirty · channel beta · branch cert/data-import-cst-integration` (both platforms identical) | ✓ |
| rc.24 Mac dmg | `dist-seam-s64/NeuroPause-arm64.dmg` 135,354,937 B · sha256 `07d7ff7bfc5b1bd18b98a97c92c30341cc55e76efb4194e435280ec3f0f71409` | == S64-recorded ✓ |
| rc.24 Win Setup.exe | `dist-seam-s64-win/NeuroPause-Setup.exe` 111,852,524 B · sha256 `010e944951b525f81d5206d4a5802365b04116a313d88e37052724d45483e16a` | == S64-recorded ✓ |
| rc.24 asar (both) | 57,980,577 B · sha256 `997f6f7484fb8d76fa59344553f8639bf8a46ffc5b65bd4f2de33ec85fd22479` | == S64-recorded ✓ |
| Mac/Windows asar byte identity | Mac asar sha256 == Win asar sha256 (`997f6f74…`) | **byte-identical ✓** |

No rebuild was performed — custody was established on the artifacts as they stand.

## 2 · macOS distribution trust — code-signing GREEN (S64-measured) · **NOTARIZATION = OPERATOR-BLOCKED**

- **Code signing:** the rc.24 `.app` is SIGNED with Developer ID Application (Team **J3G89MY3QG**), hardened runtime (S64-measured on macOS). `codesign`/Gatekeeper re-verification is a **macOS-only** operation and cannot run in this Linux environment — it is the operator's re-check on the Mac (the payload is byte-identical, so the S64 measurement stands).
- **Notarization:** `dist-seam-s64/notarization-status.json` = `{ state: "skipped", notarized: false, version: "1.0.0-rc.24", reason: "one or more Apple credentials are absent" }`. Re-measured this session: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY`/`APPLE_API_ISSUER` — **all absent**. `scripts/notarize.cjs` therefore skips (never fabricates).

**MAC NOTARIZATION = OPERATOR-BLOCKED.** Operator prerequisite: valid Apple Developer ID notarization credentials on the signing Mac, then `notarize → staple → codesign -v → spctl --assess (Gatekeeper) → independent notary verify`, recording the dmg hash before/after the (payload-preserving) staple. No credentials were fabricated; no fake notary endpoint was used.

## 3 · Windows distribution trust — **AUTHENTICODE = OPERATOR-BLOCKED**

- **PE signature (measured this session):** `NeuroPause-Setup.exe` PE Certificate Table (data directory #4) RVA = 0, size = 0 → **UNSIGNED**. (Recorded state, now directly re-measured on the current bytes.)
- **Certificate:** no Authenticode certificate is available — `CSC_LINK` / `CSC_KEY_PASSWORD` / `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` all absent. A self-signed certificate would NOT be production trust and was deliberately not generated.

**WINDOWS AUTHENTICODE = OPERATOR-BLOCKED.** Operator prerequisite: a legitimate Authenticode (EV or OV) certificate + signing config, then `signtool sign /fd sha256 /tr <timestamp> Setup.exe → verify PE signature → verify chain → verify timestamp → verify Authenticode in Windows`, preserving the asar/payload (record signer identity + before/after hashes). Windows-side verification is a Windows operation; `signtool` exists in this Linux env but there is no cert, so no signing was attempted.

## 4 · SmartScreen — GRAY

No real reputation evidence exists (reputation accrues from signed-artifact download volume over time, which cannot be measured pre-release and must never be fabricated). Authenticode success alone does not close SmartScreen. **SMARTSCREEN = GRAY / operator-dependent** — unchanged.

## 5 · Updater — POLICY / OPERATOR DECISION REQUIRED

No operator ruling has been supplied on whether the current `electron-updater` feed is (A) mandatory for this release or (B) optional/non-blocking. No ruling doc exists in the corpus (prior distribution certs record the updater as GRAY, not as a decision). Per the directive, the answer is not invented. **UPDATER = POLICY/OPERATOR DECISION REQUIRED.** If the operator rules it *mandatory*, the update host (`beta.yml` / `beta-mac.yml` feed) must be proven LIVE before closure — no fake endpoint was created.

## 6 · rc.24 integrity — GREEN (payload == the S64-certified payload)

The strongest integrity proof is byte-identity: the rc.24 asar sha256 `997f6f74…` equals the S64-recorded value exactly (§1), so the application payload IS the S64-certified payload, unchanged. Corroborated by a fresh marker scan of the asar bytes:

| Check | rc.24 asar | State |
|---|---|---|
| `ClearCustomerPayment` / `ClearVendorPayment` | 7 / 7 | present ✓ |
| `ReverseCustomerPayment` / `ReverseVendorPayment` | 3 / 4 | present ✓ |
| `finance-payment-reversals` (S62 registration) | 3 | present ✓ |
| S64 delete-guard string ("immutable historical evidence carrying a posted compensating GL entry") | 1 | present ✓ |
| S60 econ-edit fence ("cannot be economically edited") | 1 | present ✓ |
| `ConvertQuoteToSalesOrder` (S57) | 5 | present ✓ |
| STRIP `__NP_E2E__` / `NEUROPAUSE_E2E_VERIFY` / `e2eSeed` / `PR-PILOT-1` | 0 / 0 / 0 / 0 | clean ✓ |
| build-info `connectorClientIds` | `{}` | no baked client-ids ✓ |
| build-info `backendUrl` | `null` | no baked dev endpoint ✓ |
| build-info provenance | `2af9622-dirty` | honest `-dirty` stamp ✓ |

No stripped governance, no new client-ids/secrets, no debug/dev endpoints introduced (the `http://localhost`/`http://127.0.0.1` strings that exist are part of this byte-identical certified payload — the OAuth loopback + the `app.isPackaged`-gated local-backend fallbacks + OAuth parameter *names*, not active endpoints; unchanged from the S64-certified bytes). **RC.24 INTEGRITY = GREEN.**

## 7 · Full distribution regression — GREEN by byte-identity (S64 packaged runtime, reused per directive §7)

The directive says *reuse the established S64 harnesses* and *do not rerun the entire program*. Because the rc.24 bytes are byte-identical to those S64 exercised (§1), S64's packaged runtime acceptance IS the current rc.24 acceptance:
- **Mac (packaged rc.24):** reversal journey 39 PASS + RESULT · procurement 10/10 · kept-profile + restart 4/4 with `platform-command-journal.json` byte-identical across restart.
- **Windows (real Windows 11 26100 ARM64 VM, rc.24 installed + in-guest hash-verified):** reversal journey 39 PASS + RESULT · procurement 10/10 · O2C 9/9 · restart 4/4 with the journal byte-identical (4,633 B → 4,633 B, `cmp` clean).

Re-running requires macOS/Windows (this environment is Linux aarch64); the operator may re-run on the Mac/VM, but with byte-identical artifacts it is evidentially redundant. **DISTRIBUTION FUNCTIONAL ACCEPTANCE = GREEN (inherited by proven byte-identity).**

## 8 · Disaster recovery — NOT claimed (not conflated)

DR is deliberately **not** folded into distribution trust and is **not** claimed GREEN — no drill was run this session. The exact remaining DR requirement (for a later, dedicated session): backup the packaged-runtime durable stores (`platform-command-journal.json`, the enterprise module stores, audit/outbox) → destroy the profile → restore → verify schema/record counts → verify critical evidence rows (a reversal record + its `-REV` journal entry survive intact) on the restored packaged runtime. **DR = PENDING DRILL (operator/Mac).**

## 9 · Matrix

| Dimension | Mac rc.24 | Windows rc.24 |
|---|---|---|
| Artifact hash | dmg `07d7ff7b…` | Setup.exe `010e9449…` |
| asar hash | `997f6f74…` (byte-identical to Win) | `997f6f74…` |
| Code signing | **SIGNED** (Dev ID J3G89MY3QG, hardened runtime; S64-measured) | **UNSIGNED** (PE cert dir = 0, measured) |
| Notarization | **OPERATOR-BLOCKED** (Apple creds absent) | n/a |
| Certificate | Developer ID (present) | **OPERATOR-BLOCKED** (no Authenticode cert) |
| Gatekeeper / Authenticode | Gatekeeper pending notarization (macOS re-check) | **OPERATOR-BLOCKED** (unsigned) |
| SmartScreen | n/a | **GRAY** (no reputation evidence) |
| Updater | **POLICY/OPERATOR DECISION REQUIRED** | **POLICY/OPERATOR DECISION REQUIRED** |
| Payload integrity | **GREEN** (== S64-certified asar) | **GREEN** (same asar) |
| Functional acceptance | **GREEN** (S64 packaged runtime) | **GREEN** (S64 Windows VM runtime) |

## FINAL — S65 GREEN only where evidenced

- **GREEN:** custody (all hashes + Mac/Win asar byte-identity re-verified) · rc.24 payload integrity (== S64-certified, strip 0, no baked client-ids/endpoints) · macOS code-signing (S64-measured) · Windows-unsigned-as-a-measured-fact · distribution functional acceptance (S64 packaged runtime, inherited by byte-identity).
- **OPERATOR-BLOCKED:** macOS notarization (Apple credentials absent) · Windows Authenticode (no legitimate certificate).
- **GRAY:** SmartScreen (no reputation evidence).
- **POLICY/OPERATOR DECISION REQUIRED:** updater ruling (mandatory vs optional) — and, if mandatory, a proven-live update host.
- **PENDING DRILL:** disaster recovery (not conflated, not claimed).

No product failure is implied by the blocked branches: they are external/operator prerequisites (Apple credentials, an Authenticode certificate, the updater ruling + host, a DR drill), each named exactly. No ERP behavior was changed to green the matrix; no credential, certificate, endpoint, or reputation evidence was fabricated. **The distribution-trust dimensions that have actual evidence are GREEN; the rest are honestly recorded as their true operator prerequisites and STOP there.**
