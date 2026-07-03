# NeuroPause Desktop — Installation Guide

Release Candidate 1 (`1.0.0-rc.1`) · macOS on Apple Silicon.

## Requirements

- A Mac with **Apple Silicon** (M1 or newer).
- **macOS 12 (Monterey)** or later.
- ~300 MB of free disk space.
- Internet access for sign-in and updates (the app also starts offline; see the
  Troubleshooting guide).

## Install

1. Download **`NeuroPause-1.0.0-rc.1-arm64.dmg`** from the link your pilot contact
   sent you.
2. Double-click the `.dmg` to open it.
3. Drag the **NeuroPause** icon into the **Applications** folder.
4. Eject the disk image.
5. Open **Applications** and double-click **NeuroPause**.

Because this build is **signed and notarized by Apple**, macOS opens it normally.
The first launch may show a one-time "downloaded from the Internet" confirmation —
click **Open**.

> If you ever see an "unidentified developer" block, the build you have is not the
> notarized one — please request the correct DMG from your pilot contact.

## First launch

On first launch NeuroPause:
- initializes your local data store and stamps the data version,
- shows the sign-in screen.

Sign in with Google, GitHub, Microsoft, Apple, or email. See the **Quick Start
Guide** for what to do next.

## Updates

NeuroPause is on the **Release Candidate** update channel and checks for updates
automatically. When an update is available you'll be notified; downloading and
installing are your choice (updates never install silently). You can review update
status anytime in **Operations → Release → Updates**.

## Uninstall

1. Quit NeuroPause.
2. Move **NeuroPause** from Applications to the Trash.
3. (Optional) Remove local data at
   `~/Library/Application Support/neuropause-desktop`.

Before uninstalling, you can export a support bundle or create a backup from
**Operations → Recovery** if you want to preserve diagnostics or data.

## Backend (optional, for full functionality)

Some features (such as the AI Store catalog) talk to a backend service. If your
pilot includes it, your contact will share its address. The local surfaces —
diagnostics, recovery, workspace, memory — work without the backend.
