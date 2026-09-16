#!/bin/bash
# Screendump the guest to PNG via the QEMU monitor socket, so an agent can Read
# it. Usage: shot.sh [name]   ->  prints the PNG path.
WORK="${NPVM_WORK:-$HOME/vm-win11}"
name="${1:-shot-$$}"
ppm="/tmp/$name.ppm"; png="/tmp/$name.png"
printf "screendump %s\n" "$ppm" | nc -U -w 3 "$WORK/mon.sock" >/dev/null 2>&1
sleep 1
sips -s format png "$ppm" --out "$png" >/dev/null 2>&1 && echo "$png" || echo "$ppm"
