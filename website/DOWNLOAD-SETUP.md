# DOWNLOAD-SETUP — making 1-click download actually work

This delivers the clean download experience you asked for: **one button →
NeuroPause-Setup.exe → run**, with dead-simple on-screen steps and OS
auto-detection. `website/download.html` is that page.

## What was built (customer-facing)

- **`website/download.html`** — a dedicated download page that:
  - auto-detects Windows vs macOS and shows ONE big button for the right OS
  - links the **direct installer file** (not the confusing multi-file Releases
    page), so it's a true one-click download
  - shows 3 plain-English steps + a friendly "why the warning?" note (no jargon)
- **`electron-builder.yml`** — installer files now have **stable, space-free
  names** (`NeuroPause-Setup.exe`, `NeuroPause-arm64.dmg`) so the button's direct
  link always resolves to the newest release, regardless of version number.
- **`index.html`** — the main site's Download buttons now point at this clean
  page instead of the raw GitHub Releases list.

## The ONE thing only you can do: make Releases reachable

The download links point at your GitHub Releases. **Your repository is private**,
so a logged-out visitor who clicks Download gets a 404 / login wall — this is the
"confusing" part you're hitting. A stranger cannot download from a private repo's
Releases. Pick one:

### Option A — make the repository public (simplest, free)
GitHub → your repo → **Settings** → scroll to **Danger Zone** → **Change
visibility** → **Make public**. Your code becomes visible, but the download
"just works" for everyone, 1-click, no login. Best if the code being open is
acceptable.

### Option B — a public releases-only mirror (keeps code private)
Create a **separate public repo** (e.g. `neuropause-releases`) that holds ONLY
the built installers — no source. Change the CI publish target + the download
page's `BASE` url to that repo. Customers download from the public mirror; your
source stays private. A bit more setup; I can wire this for you.

### Option C — host the installers on your own server
You already run a droplet serving `neuropause033.com`. The CI could upload the
`.exe`/`.dmg` to `/opt/neuropause-site/downloads/` and the button link at
`https://neuropause033.com/downloads/NeuroPause-Setup.exe`. Fully self-hosted,
no GitHub dependency for downloads. I can wire this too.

**Recommendation:** Option A if open-source is fine (zero ongoing work), else
Option C (you already own the infrastructure).

## After you pick an option

Rebuild once (tag a release) so the installers carry the new stable names, then
the download page delivers the true 1-click experience. The only remaining
first-launch friction is the unsigned-app prompt (macOS right-click-Open /
Windows "Run anyway"), which a code-signing certificate removes — a separate,
optional polish step.

## Deploy the new page (same as the site)
```
scp website/download.html website/DOWNLOAD-SETUP.md root@64.227.128.218:/opt/neuropause-site/website/
```
Then it's live at https://neuropause033.com/download.html
