# GATE 11 — DATABASE (data durability)

**Date:** 2026-08-29 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `9227e57`
**Scope:** Gate 11 only (PRODUCT-READINESS-MATRIX numbering). Gates 1 and 4 untouched.

The matrix row (rc.18) listed four "Remaining REDs". Each was reproduced against the code first.

---

## STATUS

**YELLOW → YELLOW, with the two most damaging RED drivers CLOSED** (reset-on-corrupt for both secret vaults;
both vaults now inside backup), verified by executed tests + negative controls. Two residuals remain and are
stated honestly rather than claimed closed (migration ordering is latent-not-live; full registry completeness).
Not GREEN, because the residuals are real and one needs the running app to prove.

## ROOT CAUSES (reproduced)

1. **Reset-on-corrupt in both secret vaults — REAL, HIGH.** `connectors/connectorVault.ts` and
   `security/secureStore.ts` each caught any non-ENOENT read/parse error and `return {}`. The next
   `writeVault` (any connect/disconnect, any token refresh) then atomically overwrote the file — **silently
   destroying every stored credential / the refresh token, with no copy and no signal.** These were the two
   stores that never adopted the round-33 `storeEnvelope` quarantine machinery. This is the class round 33
   closed everywhere else; the secret vaults are where it is most damaging.

2. **Both vaults outside the backup registry — REAL.** `vault.bin` and `connector-vault.bin` were absent from
   `DOMAIN_FILES` (`storage/storePaths.ts`), so a corruption/delete had no restore path — and even with the
   quarantine fix, a quarantined vault had no good copy to restore from.

3. **Migrations run after stores load — LATENT, not a live bug.** `releaseOps.runStartupMigrations()` runs at
   `runtimeCore.ts:1619`, after ~7 store `.load()` calls. Literally "after stores load." BUT the only registered
   migrations are `0001-baseline` (a no-op version stamp) and `0002-store-schema-stamp` (adds `schemaVersion`
   and **leaves unparseable files untouched**). Neither transforms a store's data shape, and the envelope reads
   an un-stamped file as v1, so an already-loaded store is unaffected. The ordering is a hazard for a FUTURE
   data-transforming migration, not a current data-loss path.

4. **~40 persisted paths outside the backup registry — PARTIALLY REAL.** The two named highest-value omissions
   were the secret vaults (fixed in #2). A full file-by-file audit of every persisted path against `DOMAIN_FILES`
   was not completed this gate; the registry lock in `storePaths.test.ts` remains the ratchet.

## FIX

- **connectorVault.ts / secureStore.ts:** the corrupt-read branch now calls `quarantineFile()` (the shared
  round-33 primitive), preserving the bytes to `<file>.quarantined-<ts>` and logging at `error`, before
  returning empty. **No behavior change on the happy path or ENOENT (first run).** Nothing is decrypted,
  exposed, or weakened — a corrupt secret file is preserved for recovery instead of destroyed. Fail-closed is
  strengthened: the live map is empty (the file was unreadable) and the credentials are recoverable.
- **storePaths.ts:** `vault.bin` and `connector-vault.bin` added to the `configuration` domain. Both hold only
  safeStorage (OS-keychain) ciphertext, so a backup copy is undecryptable on any other machine — same-machine
  restore durability with no widening of the secret's blast radius. They enter the install-wide backup /
  pre-migration snapshot, not the per-tenant archive path (F22).

## FILES CHANGED

| File | Change |
|---|---|
| `apps/desktop/src/main/connectors/connectorVault.ts` | corrupt read → quarantine-not-reset (+ import) |
| `apps/desktop/src/main/security/secureStore.ts` | corrupt read → quarantine-not-reset (+ import) |
| `apps/desktop/src/main/storage/storePaths.ts` | `vault.bin` + `connector-vault.bin` added to backup registry |
| `apps/desktop/src/main/connectors/connectorVault.test.ts` | **new** — quarantine regression (2 tests) |
| `apps/desktop/src/main/security/secureStore.test.ts` | +2 quarantine regression tests |
| `apps/desktop/src/main/storage/storePaths.test.ts` | +1 registry-coverage assertion for the vaults |

## TESTS / RESULTS

- `connectorVault.test.ts` 2/2 · `secureStore.test.ts` 13/13 (+2) · `storePaths.test.ts` (+1) — pass.
- Affected suites `connectors` + `security` + `storage`: **28 files / 266 tests, 0 failures.**
- Full `src/main`: **808 files / 8388 passed / 7 skipped / 0 failed.**
- Typecheck (`tsconfig.node.json`): **0 errors.** Lint on all six changed files: **clean** (`--max-warnings 0`).

## NEGATIVE CONTROLS (executed)

Reverting all three fixes at once failed exactly the three new assertions —
`3 failed | 17 passed` — then restoring returned them to green:
- connector-vault quarantine reverted → its corrupt-bytes-preserved test fails;
- secure-vault quarantine reverted → its test fails;
- registry entries removed → the coverage assertion fails.

## RECOVERY / BACKUP SCENARIOS VERIFIED (headless)

- Corrupt `vault.bin` → read returns null, bytes preserved to `vault.bin.quarantined-<ts>`, next write does NOT
  overwrite the corrupt file in place, exactly one quarantine copy with bytes intact.
- Corrupt `connector-vault.bin` → same, with a fresh credential written afterward and the quarantine copy intact.
- Missing vault → first-run empty, NOT quarantined (no false quarantine on a clean install).
- Both vault filenames are covered by the backup registry (`covered('vault.bin') && covered('connector-vault.bin')`).

## END-TO-END NOTE

Verified at the store level (real files, real quarantine, real round-trip) and by full regression. The packaged
launched-app restore-from-backup path (`backup:restore` copying a good vault back over a quarantined one) is
covered by `backupManager.test.ts`'s atomic-copy tests but was **not** driven on the launched macOS app this
gate — that GUI run is the same class of evidence Gate 4/8 use and is the honest next step for a GREEN.

## REMAINING (why not GREEN)

- **Migration ordering (Defect 3):** left as-is deliberately. Reordering the composition-root boot sequence is
  unverifiable from CI and would risk the GREEN Gate-1 bootstrap; the current migrations are provably
  non-transforming, so there is no live defect. A future data-transforming migration MUST run before the store
  loads it — flagged here and in the row.
- **Registry completeness (Defect 4):** the two named vaults are covered; a full persisted-path census against
  `DOMAIN_FILES` remains. The `storePaths.test.ts` lock is the ratchet that keeps new critical stores covered.
- **Pre-existing Gate-11 residuals unchanged:** the corrupt-recovery fix does not itself back-fill an already-
  destroyed vault (nothing can); it stops the destruction going forward and enables restore.

## EXACT NEXT COMMAND

Prove restore-from-backup on the launched app (macOS), then close Defect 4 with a census:
```bash
cd apps/desktop
npx vitest run src/main/connectors/connectorVault.test.ts src/main/security/secureStore.test.ts src/main/storage/storePaths.test.ts
# then, for GREEN: drive backup:restore of a good vault over a quarantined one on the built app,
# and audit every persisted top-level file against DOMAIN_FILES.
```
