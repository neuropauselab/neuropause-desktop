# NeuroPause OS — Founder Test Build
## Known Limitations

Read this before drawing conclusions from the build. Everything below is known
and deliberate. Finding something *not* on this list is the useful outcome.

---

## 1 · The installer is not signed

Windows will show a SmartScreen warning on first run. NeuroPause does not yet
hold an Authenticode code-signing certificate — that is a commercial
certificate that has to be purchased and issued, and it has not been.

Verified, not assumed: the installer's PE certificate table is empty.

**Consequence.** Windows cannot tell the founder who published the file. The
SHA-256 checksum shipped alongside the installer is the only independent
integrity check available. A signed build removes the warning entirely.

**Status: NOT CONFIGURED.** Not a defect in the app; a missing purchase.

---

## 2 · Nobody on the team has run this on Windows

The engineering team works on macOS and Linux. The installer is produced by a
Windows CI runner, and its build gates pass there — but **no human has
installed this .exe and completed onboarding on a real Windows machine.**

**Consequence.** The founder is, at the moment of first launch, the first
person to have run this artifact. Anything Windows-specific — file paths,
permissions, display scaling, antivirus interference — is genuinely unknown
rather than merely untested.

**Status: NOT TESTED.** This is the single largest gap in the build.

---

## 3 · Program 13C is NOT CERTIFIED

The multi-tenant security certification is incomplete. Five runtime gates have
no evidence: runtime ownership, retention, background principal, queue
identity, and real backup/restore. Cross-tenant testing has covered reads but
not mutations.

**Consequence.** Do not treat this build as evidence that tenant isolation is
proven. It is evidence that the product runs.

See `ENGINEERING-STATUS.md` for the gate-by-gate position.

---

## 4 · The backend has never been examined by this programme

Seventeen rounds of certification touched `apps/desktop` and `packages/shared`
and made **zero** changes to `apps/backend`. The backend holds its own tenant
boundary — organizations, auth, its own database.

**Consequence.** "Certified" — when it eventually applies — will not cover the
backend unless that is scoped deliberately.

---

## 5 · No AI model is installed by default

On a fresh Windows machine there is no local AI model. NeuroPause will say so
and refuse to answer rather than sending the question somewhere.

**This is correct behaviour, not a failure.** If the founder chooses "Keep it on
this device", AI answers will be unavailable until a local model (for example
Ollama) is installed. Deterministic, non-AI answers still work.

---

## 6 · "Allow approved cloud AI" will not actually route externally

The founder's organization preference and the installation's platform policy
are two separate settings, and the effective behaviour is the stricter of the
two. This build has external processing disabled at the platform level.

**Consequence.** Choosing "Allow approved cloud AI" saves the preference, shows
an amber message explaining that the installation has not enabled external
processing, and keeps all work local. The preference takes effect automatically
if external processing is later enabled.

The amber message appearing **is** the feature. Its absence would be a defect.

---

## 7 · Empty screens on a fresh install

Many surfaces have no data until work is done in them. An empty screen should
say it is empty. A blank screen with no explanation is a defect worth reporting.

---

## 8 · Auto-update is configured but unproven for this build

The app is wired to an update feed at `neuropause033.com/updates`. This
manually-triggered founder build is not published to that feed, so the app will
not find an update. It should fail quietly, not error.

---

## 9 · Version numbering

The build reports `1.0.0-rc.15`. It is a **release candidate**, not a general
release, and it is built from a feature branch rather than a release tag. The
build provenance recorded in the artifact states the exact commit.

---

## 10 · What has NOT been verified on Windows at all

Every item here is untested rather than known-good:

- clean installation
- first launch and onboarding
- local AI mode end to end
- approved cloud mode end to end
- persistence across quit / reopen / reboot
- cross-tenant isolation at runtime
- uninstall and reinstall
- performance and launch time
- every product surface beyond the fact that it is compiled into the bundle
