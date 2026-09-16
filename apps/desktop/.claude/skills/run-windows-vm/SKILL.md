---
name: run-windows-vm
description: Build, boot, and drive a Windows 11 ARM64 VM on an Apple-Silicon Mac to install and runtime-test the NeuroPause desktop app (Gate 20 Windows acceptance). Use when asked to run the Windows build, verify the Windows installer at runtime, capture Windows app.log, or reproduce the Windows acceptance procedure — when no physical Windows machine is available.
---

There is no physical Windows machine here, but Gate 20 (Windows runtime
acceptance) needs real Windows runtime evidence. This skill stands up
Windows 11 **ARM64** as a QEMU + HVF guest on the Mac and drives it to install
and exercise the app. The rc.20 x64 installer runs under Windows' inbox **x64
emulation** — real runtime, with that caveat recorded. It produced the evidence
in `certification/windows-runtime-evidence-rc20/`.

Everything operates from a work dir (default `~/vm-win11`, override `NPVM_WORK`).
Scripts here are relative to this skill; copy or point at them from the work dir.

## Prerequisites (Homebrew)

```bash
brew install --cask utm            # brings utmctl; optional
brew install qemu aria2 cabextract wimlib cdrtools
# UEFI firmware ships with qemu: /opt/homebrew/share/qemu/edk2-aarch64-code.fd
```

## Build the Windows 11 ARM64 ISO (once, ~4.5 GB download)

UUP dump builds an official ISO. `chntpw` is NOT in Homebrew and its only use is
an optional WinPE registry tweak — patch it out (we supply our own autounattend):

```bash
mkdir -p ~/vm-win11 && cd ~/vm-win11
# get a UUP "download package" for a Win11 ARM64 build (uupdump.net -> get.php),
# unzip it, then before running the macOS downloader:
sed -i '' 's/ chntpw//' uup_download_macos.sh                 # prereq loop
sed -i '' 's/ chntpw//' files/convert.sh                      # its prereq loop
# and neuter the single `echo '...' | chntpw -e "$tempDir/SOFTWARE"` block in
# files/convert.sh (replace with `: chntpw-skip`) — Windows Setup boots fine
# without that InstRoot tweak. Then:
./uup_download_macos.sh            # downloads + converts -> uup/*.ISO
```

Run the downloader **detached** (`run_in_background: true`) — a foreground shell
teardown kills aria2 mid-download; it resumes from `.aria2` control files.

## Disks, firmware, autounattend

```bash
cd ~/vm-win11
qemu-img create -f qcow2 win11.qcow2 64G
cp /opt/homebrew/share/qemu/edk2-aarch64-code.fd QEMU_EFI.fd
dd if=/dev/zero of=QEMU_VARS.fd bs=1M count=64
qemu-img create -f raw results.raw 1G        # evidence-exchange disk (optional)
curl -LO https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win.iso
# autounattend (guest/autounattend.xml here) -> a Joliet ISO Setup can read:
mkdir ua && cp <skill>/guest/autounattend.xml ua/
mkisofs -J -r -V UNATTEND -o unattend.iso ua/
```

The sample `autounattend.xml` bypasses TPM/SecureBoot/RAM checks, creates a
local admin `accept` / `Gate20!accept`, auto-logons, **disables UAC**, and
enables OpenSSH server on first logon. It is NOT reliably auto-detected off a CD
by 24H2 Setup — treat the scripted install below as the primary path.

## Install (the reliable, scripted path)

```bash
cp <skill>/scripts/run-vm.sh ~/vm-win11/ && cp <skill>/scripts/*.sh ~/vm-win11/
NPVM_WORK=~/vm-win11 ~/vm-win11/run-vm.sh --install &      # detached
```

Then, using the QEMU monitor over `~/vm-win11/mon.sock` (screenshots with
`scripts/shot.sh`, typing with `scripts/typekeys.sh`):

1. The firmware drops to a UEFI shell if you press keys early. From it, launch
   the CD loader: `typekeys.sh 'fs0:\efi\boot\bootaa64.efi' enter`, then **burst
   spacebar** to clear "Press any key to boot from CD or DVD" (its input isn't
   caught reliably — hammer `sendkey spc` at ~0.25 s for ~15 s).
2. In WinPE, Setup shows a driver prompt (it can't lay the image itself here).
   Press **Shift+F10** for a command prompt and script the install:
   ```
   diskpart:  select disk 0 / clean / convert gpt
              create partition efi size=200 / format quick fs=fat32 label=sys / assign letter=s
              create partition msr size=16
              create partition primary / format quick fs=ntfs label=win / assign letter=w
   ```
   (ALL lowercase — uppercase drops; diskpart takes lowercase letters.)
3. The install media is on **virtio-scsi** (invisible to WinPE without vioscsi).
   Hot-add the Windows ISO as USB via the monitor so WinPE sees it:
   ```
   drive_add 0 if=none,id=winmedia,file=<...>.ISO,readonly=on,media=cdrom
   device_add usb-storage,drive=winmedia,id=wmdev
   ```
   It appears as a new letter (e.g. `E:`). Then:
   `dism /apply-image /imagefile:e:\sources\install.wim /index:1 /applydir:w:\`
4. `bcdboot w:\windows /s s: /f uefi`
5. Inject the NIC driver so the installed OS has networking:
   hot-add `virtio-win.iso` as USB too, then
   `dism /image:w:\ /add-driver /driver:f:\netkvm /recurse /forceunsigned`
6. Place the unattend for OOBE: `copy d:\autounattend.xml w:\windows\panther\unattend.xml`
7. Reboot into the installed system (kill this QEMU, relaunch without `--install`).

OOBE may still show region/keyboard; the account/autologon/SSH from the unattend
do land, so it reaches the desktop. If it stalls at OOBE, Shift+F10 → create the
account + set autologon in registry, or Ctrl+Shift+F3 for audit-mode desktop.

## Drive the installed system

Relaunch: `~/vm-win11/run-vm.sh &` (attaches `results.raw` + virtio CD). It
autologons to the desktop. Two channels:

- **Screendump + sendkey** (reliable): `shot.sh name` → Read the PNG;
  `typekeys.sh '<lowercase cmd>' enter`. Open an elevated cmd via Win+R → `cmd`.
- **HTTP over NAT** (reliable for file transfer + long runs): the guest reaches
  the host at **`10.0.2.2`**. Run `python3 scripts/uploadserver.py` on the host
  (serves the work dir on `:8099`, GET for downloads, **PUT** saves to
  `uploads/`). In the guest, one focused lowercase line bootstraps everything:
  `curl -s -o c:\b.cmd http://10.0.2.2:8099/bootstrap.cmd & c:\b.cmd`
  (`guest/bootstrap.cmd` downloads the runner + installer, runs it, PUTs the
  results back). Read results on the host in `uploads/`.

**SSH is present (host:2222) but flaky** — it wedges after a couple of
connections and one-shot exec/SCP hang; only a single `-tt` interactive session
is semi-reliable. Prefer HTTP-over-NAT.

## The acceptance run

`guest/acceptance-runner.ps1` is the runner: verifies the installer SHA-256,
silent-installs, launches the app on the **interactive desktop via a scheduled
task** (`schtasks /run` — a plain `Start-Process` from a non-interactive session
won't render the Electron window), then greps `app.log` for the boot-health
matrix (Startup complete, `Secure IPC handlers registered {count}`, Organization
runtime ready, AI engine configured, repeated-launch ×5 no-handler/no-init-fail,
restart persistence). The log lives at
`%APPDATA%\@neuropause\desktop\logs\app.log` — NOT `%APPDATA%\NeuroPause`.

## Gotchas (all hit for real; keep them)

- **usb-storage of a 4 GB ISO hangs the UEFI boot.** Boot the install ISO from
  **virtio-scsi CD** (`scsi-cd`). Hot-add ISOs as usb-storage only AFTER WinPE
  is up (past firmware), where usbstor is inbox.
- **Display: use `-device ramfb`, not `virtio-gpu-pci`.** virtio-gpu's scanout
  goes stale to `screendump` (blank/frozen frames while the guest actually runs);
  ramfb captures reliably.
- **`sendkey` drops shift-modified keys under load.** Use lowercase; verify any
  required uppercase (passwords) by screenshot.
- **"Press any key to boot from CD"** input isn't caught reliably — burst it, or
  from the UEFI shell launch `bootaa64.efi` directly.
- **System disk = NVMe** (`-device nvme`) — Windows 11 ARM64 has the inbox
  driver, so WinPE/Setup sees it with no driver load. virtio-blk would need a
  driver first.
- **A secondary NVMe (results.raw) comes up OFFLINE.** In-guest diskpart:
  `select disk 1 / online disk / attributes disk clear readonly`, then select
  its volume and `assign letter=d`.
- **Launch the GUI via `schtasks`, not `Start-Process`,** so the Electron window
  renders in the interactive session (a non-interactive/SSH session is session-0
  isolated).
- **A force-kill runs NO shutdown flush** (correct). To see
  `Shutdown flush complete` you must drive the app's real quit (menu/Alt+F4 to
  the focused window) — the harness couldn't do that across the session boundary.

## Cleanup

Graceful VM shutdown: `printf 'system_powerdown\n' | nc -U ~/vm-win11/mon.sock`
(fallback `quit`). Stop the host server: `pkill -f uploadserver.py`. The work
dir (multi-GB disks/ISOs) is NOT committed — only these scripts are.
