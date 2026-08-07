# Installing NeuroPause Desktop

**Current as of v1.0.0-rc.14 lineage · Phase 8 (2026-08-07).** This guide is truthful about the signing state of the build you were given — ask your pilot contact which case applies.

## What you need

A Mac with Apple Silicon (M-series). The current pilot artifact is built for arm64 (`NeuroPause-arm64.dmg`); an Intel build is produced only on request (`package:mac:universal`). macOS 13 or later recommended.

## Install

Open the DMG and drag **NeuroPause** into **Applications**. Eject the DMG.

## First launch — read this part

**If your build is signed and notarized** (your pilot contact will say so explicitly — the pipeline signs only when Apple credentials are configured), macOS opens it normally. Skip ahead.

**If your build is UNSIGNED** — the default for pilot builds until the Apple Developer ID certificate is installed in CI — macOS Gatekeeper will refuse the first launch with "cannot be opened because the developer cannot be verified." This is expected, not a defect. To open it anyway:

1. In **Finder → Applications**, **right-click (or Control-click) NeuroPause → Open**.
2. In the dialog, click **Open**. (The right-click menu shows an Open button that the double-click dialog does not.)
3. If macOS still refuses: **System Settings → Privacy & Security**, scroll to the message about NeuroPause, click **Open Anyway**, then repeat step 1.

You only need to do this once — subsequent launches are normal.

## First run

The app starts with the onboarding wizard: review the bundled license and privacy notice, set up your organization, optionally connect accounts, and join the pilot. Everything runs locally — the app is offline-first and creates its data under your user Library. The **Getting Started** section (sidebar → System) keeps the checklist and the bundled documentation one click away.

## Updates

Updates are manual-consent: the app checks, tells you, and installs only when you choose restart-and-install. Channel selection is in Settings → Release Channel (Stable or Beta — both feeds are published by the release pipeline).

## Uninstall

Quit the app, delete **/Applications/NeuroPause.app**. Your data lives in `~/Library/Application Support/neuropause-desktop` — delete it only if you also want to remove all local records (consider **Operations → Recovery Center → Create backup** first).

## Trouble?

Open **Getting Started → Documentation → Troubleshooting**, or generate a support bundle (Operations → Release Diagnostics → Generate bundle — it reveals the file in Finder) and send it to your pilot contact. Bundles are redacted (no tokens, no connector secrets) before anything is written.
