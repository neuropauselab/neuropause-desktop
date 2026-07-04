# DOWNLOAD-SETUP — Option C: self-hosted 1-click downloads

Downloads are served from **your own domain** (`neuropause033.com/downloads/`),
not GitHub. No repo visibility, no login wall — a stranger clicks one button and
the installer downloads. Your source stays private.

## What was built
- **`website/download.html`** — now links `https://neuropause033.com/downloads/
  NeuroPause-Setup.exe` (and the `.dmg`). OS auto-detect + one button + plain
  install steps (from the previous increment).
- **`.github/workflows/windows-release.yml`** — a new step uploads each freshly
  built installer to the droplet over SSH, so every future release auto-publishes
  to your domain. It's gated on a `DEPLOY_SSH_KEY` secret and never fails the
  build if the secret is absent.

## TWO things to do

### A. Serve TODAY's installer right now (5 minutes, makes downloads work immediately)
On your Mac — create the downloads folder on the droplet, then upload the .exe
you already built (download it from your GitHub Release first, or use a local
build). If you have the release .exe locally:
```
# make the served folder on the droplet
ssh root@64.227.128.218 'mkdir -p /opt/neuropause-site/website/downloads'

# upload the Windows installer (rename to the stable name the page expects)
scp "~/Downloads/NeuroPause Setup 1.0.0-rc.1.exe" \
  root@64.227.128.218:/opt/neuropause-site/website/downloads/NeuroPause-Setup.exe

# (optional) upload the macOS dmg too
scp ~/Desktop/neuropause-desktop/apps/desktop/dist/NeuroPause-*arm64.dmg \
  root@64.227.128.218:/opt/neuropause-site/website/downloads/NeuroPause-arm64.dmg
```
Then verify: `curl -I https://neuropause033.com/downloads/NeuroPause-Setup.exe`
→ `HTTP/2 200`. The download page is now fully functional for anyone.

### B. Automate it for every future release (one GitHub secret)
So CI uploads new installers automatically:
1. Create an SSH key for CI on your Mac:
   `ssh-keygen -t ed25519 -f ~/np-deploy -N ""`
2. Authorize it on the droplet:
   `ssh-copy-id -i ~/np-deploy.pub root@64.227.128.218`
   (or append `~/np-deploy.pub` to the droplet's `~/.ssh/authorized_keys`)
3. Add the **private** key as a GitHub secret: repo → Settings → Secrets and
   variables → Actions → New secret → name `DEPLOY_SSH_KEY`, value = contents of
   `~/np-deploy` (the file WITHOUT .pub). 
4. Next tagged release auto-uploads to `neuropause033.com/downloads/`.

## Deploy the updated page
```
scp website/download.html website/DOWNLOAD-SETUP.md \
  root@64.227.128.218:/opt/neuropause-site/website/
```

## Result
Visitor → neuropause033.com → Download → clean page → one OS-matched button →
`.exe` downloads from your domain → run. No GitHub, no login, no confusion.
The only first-launch step left is the unsigned-app "Run anyway" prompt, removed
later by a code-signing certificate.
