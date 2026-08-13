# NeuroPause OS — Engineering Status
## Founder Test Build · Windows x64

**12 August 2026** · branch `feat/understanding-holds-motion-system`

> **The commit this document describes is the one in `release-manifest.json`,
> beside the installer.** It is deliberately not repeated here. An earlier draft
> pinned a commit by hand and was stale within the hour — the same defect as a
> build asserting a commit whose tree it did not contain, one document further
> out. The manifest reads its value from the build-info embedded in the artifact;
> nothing about it is typed by a person.

This document accompanies the Founder Test Build and states, without softening,
what has evidence behind it and what does not.

---

## Verdict

```
PROGRAM 13C            NOT CERTIFIED
FOUNDER BUILD          TEST BUILD — not production-ready
WINDOWS SIGNING        NOT CONFIGURED
```

A build being installable is not the same as a product being certified. This
build is installable. The certification is incomplete and is documented below
rather than glossed.

---

## Automated gates

All green at the commit recorded in `release-manifest.json`.

| Gate | Result |
|---|---|
| Desktop node suite | **765 files / 8018 tests, 0 failures** |
| Desktop UI suite (mounted components, jsdom) | **11 files / 116 tests, 0 failures** |
| Backend unit suite | **37 files / 418 tests** |
| Backend integration (real Postgres 16 + Redis 7) | **2 files / 17 tests** |
| Typecheck (node + web) | clean |
| Lint (`--max-warnings 0`) | clean |
| Performance benchmark (`npm run bench`) | compose 18.6ms against a 100ms budget |
| Working-copy integrity | 2415 files, digest verified against the committed tree |

Both desktop suites and both backend suites now run in CI and in the release
gate. Until 12 August two of them ran nowhere: the desktop UI suite had been
red since 11 August and was invoked by no workflow, and the backend integration
suite was green but ungated. Eight release tags shipped without either.

---

## Runtime certification gates

Gate status is unchanged by this build. Packaging an application does not
certify it.

| Gate | Status |
|---|---|
| D-5 AI policy intersection law | **PASS** — 9/9 exhaustive + 7 composition tests + negative control |
| Fresh install can complete onboarding | **PASS** — both routing paths, asserted on a mounted component |
| Restriction notice is visible to the user | **PASS** — asserted, previously rendered for ~4ms and was unreadable |
| Tenant RBAC / cross-tenant reads | **PASS** (unit + runtime reads) |
| F22 tenant-domain honesty (19 domains) | **PASS** |
| Channel → store coverage | **PARTIAL** — 2 declarations |
| 1 · Native launch, packaged artifact | **PARTIAL** — Windows payload built and verified; not launched by anyone |
| 2 · Real A/B/C tenants | **PASS** |
| 3 · Cross-tenant matrix | **PARTIAL** — reads only; mutations not run |
| 4 · Runtime ownership | **NOT TESTED** |
| 5 · Retention | **NOT TESTED** |
| 6 · Background principal | **NOT TESTED** |
| 7 · Queue identity | **NOT TESTED** |
| 8 · Restart persistence | **PASS** |
| 9 · Restart after forced termination | **PASS** |
| 10 · Real backup / restore | **NOT TESTED** |
| Fresh running-app red team | **NOT TESTED** |

**Five gates have no evidence.** They require per-subsystem setup against a
running application and cannot be satisfied by unit tests, static analysis, or
a successful build.

---

## Windows-specific status

| | |
|---|---|
| Packaging system | electron-builder 26.15.3 (no second framework introduced) |
| Electron / Node | 42.8.1 / 20 |
| Target | Windows x64 — NSIS installer, portable, zip |
| Payload | **BUILT and verified** — `NeuroPause.exe`, machine `0x8664`, PE32+ |
| Fixes present in bundle | verified by inspecting the packaged `app.asar`: the D-5 preference channels, the restriction notice copy, and the Round 17h error copy are all present |
| Code signing | **NOT CONFIGURED** — verified: PE certificate table empty |
| Installed and run on Windows | **NOT TESTED — by anyone** |

---

## Build provenance

The artifact records where it came from, and marks itself if it did not come from
a clean tree. Read the actual values from `release-manifest.json`:

```
version · commit · branch · dirty · buildTime · platform · architecture
```

Every one of those is read from the build-info that `electron-builder` embedded
in this installer, not asserted by whoever assembled the handoff.

This mechanism was added on 12 August after a defect in which three different
things carried version `1.0.0-rc.15` — a tag, a build claiming a different
commit, and the bits inside it, which matched neither. A build over uncommitted
changes now appends `-dirty` to the commit and warns.

---

## What this build is evidence of

- The application compiles, bundles and packages for Windows x64 from a known commit.
- Every automated gate in the repository passes at that commit.
- The onboarding defect that made a fresh install unusable is fixed, and the fix is present in this artifact.

## What this build is not evidence of

- That the application installs and runs on Windows. **Nobody has tried.**
- That tenant isolation holds at runtime. Five gates are untested.
- That the product is ready for anyone outside this evaluation.

---

## Honest next steps, in order

1. A human installs this `.exe` on a real Windows machine and completes onboarding.
2. Purchase an Authenticode certificate, so the founder — and later, customers — are not asked to click through a security warning.
3. Close gates 4, 5, 6, 7 and 10 against a running application.
4. Complete the cross-tenant mutation matrix.
5. Decide whether `apps/backend` is in scope for Program 13C. It has never been examined.
