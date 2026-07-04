# DOWNLOADS — how the download experience works

The Download section links both platforms to the **GitHub Releases** the CI
pipeline already publishes (verified: the green windows-release run publishes a
Release with the installer + latest.yml).

## Links
- macOS + Windows buttons → `…/neuropause-desktop/releases/latest` (always the
  newest release).
- Release notes → the Releases index.

## What's surfaced
Version (1.0.0-rc.1, from package.json — the source of truth), per-OS system
requirements, disk size, the optional Ollama note, and SHA-256 (electron-builder
emits `.blockmap`/checksums into each Release; the page points there rather than
hard-coding a hash that would go stale).

## First-launch honesty
Both cards state the unsigned-app prompt plainly (macOS right-click→Open;
Windows SmartScreen→Run anyway) — no pretending the RC is signed. This is the
truthful version of audit finding C7.

## The one real gate
The links resolve **only when the repository (or its Releases) is reachable by a
visitor**. The repo is currently private, so a logged-out prospect cannot
download. To open the funnel: make the repo public, or publish releases to a
public distribution repo/mirror and point the buttons there. This is the single
blocker between "site live" and "customer can download" — stated, not assumed.
