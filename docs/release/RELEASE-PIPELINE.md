# NeuroPause Desktop — Release Pipeline

This document defines the release lifecycle for NeuroPause Desktop: the stages a
build passes through, how versions are assigned, how a bad release is rolled
back, what compatibility guarantees hold across versions, and how long a release
is supported. It describes the process that operates the machinery delivered in
Release 1.0 (packaging/signing/notarization, the self-update service with
release channels, and the migration / backup / recovery / diagnostics systems).

---

## 1. Lifecycle stages

```
Development → Internal → Beta → Release Candidate → Production → Hotfix → Maintenance
```

Each stage maps to an **update channel** (`internal`, `beta`, `stable`) and a
build provenance recorded in `resources/build-info.json` (version, channel,
commit, build time) and surfaced on the Release Diagnostics page.

### Development
Local, unsigned, unpackaged builds (`npm run dev`). `app.isPackaged` is false,
so the self-update service is inert and signing status reports
*not-applicable*. No channel; never distributed. CI runs typecheck (node + web),
the full test suite, and lint on every change.

### Internal (channel: `internal`)
Signed, notarized builds for the team. Published to the `internal` update feed.
Purpose: dogfooding and validation of the packaging + update path itself. Allows
prerelease versions (e.g. `1.1.0-internal.3`). Crash reporting and diagnostics
are exercised here before any external exposure.

### Beta (channel: `beta`)
Signed, notarized builds for external testers who opt into the Beta channel from
Settings. Published to the `beta` feed; accepts prerelease tags
(`1.1.0-beta.2`). Purpose: validate features and migrations against real-world
data and hardware diversity. Beta feedback gates promotion to RC.

### Release Candidate (channel: `beta`, prerelease `-rc.N`)
A frozen, beta-channel build proposed for production: `1.1.0-rc.1`. No new
features — only fixes for blockers found in beta. An RC is promoted to Production
unchanged (same artifact, re-tagged) once it meets the exit criteria below. This
is the **Pilot Program** milestone that follows Release 1.0 Stage 2.

### Production (channel: `stable`)
The general-availability build on the `stable` feed. Stable resolves to the
`latest` published release and never accepts prerelease versions
(`allowsPrerelease(stable) === false`). Auto-download is disabled by default;
the user is notified and chooses when to download and when to install on
restart. Downgrades are disallowed (`allowDowngrade: false`).

### Hotfix
An expedited patch for a production defect or security issue. Branches from the
released production tag (not from `main`), carries a patch-version bump
(`1.1.0 → 1.1.1`), and ships through an abbreviated Internal → Production path.
Hotfixes are the mechanism for urgent rollback-by-roll-forward (see §3).

### Maintenance
Once a minor line is superseded, it enters maintenance: it receives security and
critical-stability fixes only (as hotfixes), no features, for the support window
defined in §5. After the window closes, the line is end-of-life and users are
prompted to move to a supported line.

### Stage exit criteria

| Stage → next      | Gate |
| ----------------- | ---- |
| Dev → Internal    | typecheck + tests + lint green; signed & notarized build produced |
| Internal → Beta   | update path verified end-to-end; no open P0/P1; migrations apply cleanly on dogfood data |
| Beta → RC         | feature-complete; beta crash-free sessions above threshold; all migrations reversible |
| RC → Production   | zero open blockers; RC soak period elapsed with no regressions |
| Production → Maint | a newer minor line reaches Production |

---

## 2. Versioning strategy

NeuroPause Desktop follows **Semantic Versioning** — `MAJOR.MINOR.PATCH` — with
prerelease identifiers for non-production channels.

- **MAJOR** — incompatible changes to persisted data or the IPC/extension
  contract that cannot be migrated transparently. Rare, and always paired with a
  migration (§4) and a compatibility note (§4).
- **MINOR** — backward-compatible features and additive schema changes.
- **PATCH** — backward-compatible bug and security fixes; hotfixes.
- **Prerelease** — `-internal.N`, `-beta.N`, `-rc.N` order from least to most
  stable. Version comparison and channel rules are implemented in
  `services/updater/updateChannels.ts` (`compareVersions`, `isNewerVersion`,
  `allowsPrerelease`).

There are two **independent** version numbers, deliberately decoupled:

1. **App version** — the SemVer above, the user-facing release identity.
2. **Data version** — a monotonic integer (`data-version.json`) owned by the
   migration engine. It increments only when persisted data needs structural
   change, so a string of app releases can share one data version. Per-store
   schema versions (e.g. the registry's `SCHEMA_VERSION`) handle their own
   internal upgrades beneath this app-level coordinator.

---

## 3. Rollback strategy

Rollback is layered, from cheapest to most involved:

1. **Halt distribution.** Because auto-install is off and auto-download is
   opt-in, un-publishing or re-pointing a channel feed stops further spread
   immediately; clients that have not installed are unaffected.
2. **Roll forward via Hotfix.** The primary mechanism. Production never
   downgrades in place (`allowDowngrade: false`), so a defective `1.2.0` is
   superseded by `1.2.1` rather than reverted. `pickRollbackTarget()` records
   the last-known-good version in `update-history.json` to identify the target.
3. **Restore user data.** If a release shipped a data migration that proves
   harmful, the **pre-migration backup** taken automatically before every
   migration run is restored (the migration engine does this itself on a failed
   step; an operator can do it manually from the Recovery Center). Backups carry
   per-file sha256 integrity and a safety backup is taken before any restore.
4. **Local recovery.** End users on a bad build use the Recovery Center: Safe
   Mode (launch with plugins skipped), Disable Plugins, Reset Settings (settings
   only, never data), Restore Backup, Repair Installation, or Verify Integrity.

Every migration and recovery action is recorded — migrations to
`migration-audit.json`, side-effecting IPC calls to the audit log — so a
rollback is always traceable.

---

## 4. Compatibility policy

- **Data compatibility (forward).** Each release migrates older persisted data
  up to its data version on launch, in order, with a backup first and an
  automatic restore on failure. A user upgrading across several releases is
  migrated through each intermediate version transparently.
- **Data compatibility (backward).** Persisted data is **not** guaranteed to be
  readable by an *older* app version. This is why production does not downgrade
  in place; recovery from a newer-data state is via Restore Backup.
- **IPC / extension contract.** The secure IPC channel set and the plugin/app
  permission model are additive within a MAJOR line: new channels and
  capabilities may be added in MINOR releases; existing channel contracts are
  not broken except across a MAJOR bump. Installed apps and plugins that target
  a MAJOR line keep working across MINOR/PATCH updates.
- **Connector contract.** Connector account data and tokens persist across
  updates; connectors degrade gracefully (reported in diagnostics) rather than
  breaking when a provider or scope changes.
- **Breaking-change protocol.** A MAJOR release ships with: a migration that
  upgrades data to the new version, a compatibility note in the release notes,
  and a verified Restore-Backup path for users who need to step back.

---

## 5. Long-term support (LTS) policy

- **Current line.** The latest production MINOR line receives all features,
  fixes, and security updates.
- **Previous line.** The immediately preceding MINOR line enters Maintenance and
  receives security and critical-stability hotfixes for **90 days** after its
  successor reaches Production.
- **Designated LTS line.** Selected lines may be marked LTS and supported for a
  longer, announced window (security + critical fixes) for users who cannot
  adopt every MINOR. LTS builds ship on the `stable` channel with their own
  patch stream.
- **End of life.** When a line's window closes, it stops receiving updates and
  the app surfaces an upgrade prompt. EOL lines remain functional locally; only
  update delivery ends.
- **Security exception.** A severe security issue may be patched on any
  in-window line regardless of feature status, delivered as a hotfix.

---

## 6. Pipeline ↔ machinery map

| Pipeline concern        | Implemented by |
| ----------------------- | -------------- |
| Build provenance        | `scripts/generate-build-info.cjs` → `resources/build-info.json`; `buildInfo.ts` |
| Packaging               | `electron-builder.yml`, `npm run package` |
| Signing / notarization  | hardened-runtime entitlements + `scripts/notarize.cjs`; verified at runtime by `diagnostics/signingStatus.ts` |
| Channels & updates      | `services/appUpdater.ts`, `services/updater/updateChannels.ts`, `updater/` IPC |
| Version detection / migration | `migration/migrationEngine.ts`, `migration/migrations.ts`, `releaseOps/` |
| Backup / restore        | `backup/backupManager.ts`, `releaseOps/` (scheduled + IPC) |
| Crash capture           | `services/crashReporter.ts` |
| Diagnostics             | `diagnostics/releaseDiagnostics.ts` composing the platform health report |
| Recovery actions        | `recovery/recoveryService.ts` |
| Support bundle          | `support/supportBundle.ts` |

See also `docs/release/PACKAGING-SIGNING-NOTARIZATION.md` for the signing and
notarization runbook.
