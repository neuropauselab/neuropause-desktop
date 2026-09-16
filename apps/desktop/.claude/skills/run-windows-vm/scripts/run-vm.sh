#!/bin/bash
# Launch a Windows 11 ARM64 VM (QEMU + HVF) on an Apple-Silicon Mac.
# Work dir (disks, ISOs, firmware, monitor socket) defaults to ~/vm-win11;
# override with NPVM_WORK. See the skill's SKILL.md for the full workflow.
#
#   run-vm.sh --install   # boot the Windows install ISO (first time)
#   run-vm.sh             # boot the installed system + attach the data disk
#
# SSH host:2222 -> guest:22 (flaky under load — prefer HTTP-over-NAT, see skill).
# VNC :5. QEMU monitor on $WORK/mon.sock (screendump + sendkey via nc -U).
set -e
WORK="${NPVM_WORK:-$HOME/vm-win11}"
cd "$WORK"

FW="${NPVM_FIRMWARE:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}"
WIN_ISO="$(ls -1 uup/*.ISO win/*.iso *.ISO 2>/dev/null | head -1)"

EXTRA=()
if [ "$1" = "--install" ]; then
  [ -z "$WIN_ISO" ] && { echo "no Windows ISO found under $WORK"; exit 1; }
  # Windows install ISO on a virtio-scsi CD-ROM. NOT usb-storage: a 4 GB ISO
  # on usb-storage hangs the UEFI USB stack at boot. virtio drivers +
  # autounattend ride along; unattend on usb-storage (inbox usbstor).
  EXTRA=(
    -device virtio-scsi-pci,id=scsi0
    -drive file="$WIN_ISO",media=cdrom,if=none,id=wincd,readonly=on
    -device scsi-cd,drive=wincd,bus=scsi0.0,bootindex=0
    -drive file=virtio-win.iso,media=cdrom,if=none,id=viocd,readonly=on
    -device scsi-cd,drive=viocd,bus=scsi0.0
    -drive file=unattend.iso,media=cdrom,if=none,id=uacd,readonly=on
    -device usb-storage,drive=uacd
  )
elif [ -f results.raw ]; then
  # Evidence-exchange NVMe (guest formats + writes here). Windows keeps a
  # secondary disk OFFLINE by default — online it in-guest with diskpart.
  EXTRA=(
    -drive file=results.raw,if=none,id=res,format=raw
    -device nvme,drive=res,serial=npresults
    -device virtio-scsi-pci,id=scsi0
    -drive file=virtio-win.iso,media=cdrom,if=none,id=viocd,readonly=on
    -device scsi-cd,drive=viocd,bus=scsi0.0
  )
fi

rm -f mon.sock
exec qemu-system-aarch64 \
  -M virt,highmem=on -accel hvf -cpu host -smp 4 -m 8192 \
  -drive if=pflash,format=raw,file="$FW",readonly=on \
  -drive if=pflash,format=raw,file=QEMU_VARS.fd \
  -device ramfb \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0,hostfwd=tcp::2222-:22 \
  -drive file=win11.qcow2,if=none,id=hd,format=qcow2,cache=writeback \
  -device nvme,drive=hd,serial=npsys,bootindex=1 \
  "${EXTRA[@]}" \
  -vnc :5 -monitor unix:mon.sock,server,nowait -serial null
# NB: -device ramfb (NOT virtio-gpu-pci). virtio-gpu's scanout goes stale to
# `screendump`; ramfb is a plain GOP framebuffer that screendumps reliably.
