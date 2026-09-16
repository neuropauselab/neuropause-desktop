#!/bin/bash
# Type an ASCII string into the guest via QEMU-monitor `sendkey`, then optional
# Enter. Usage: typekeys.sh '<text>' [enter]
#
# GOTCHA: shift-modified keys (UPPERCASE and some symbols) drop intermittently
# under load. Prefer lowercase everywhere possible — cmd/diskpart/PowerShell
# paths and switches are case-insensitive, and diskpart accepts lowercase drive
# letters. When you must send uppercase (passwords), verify with a screenshot.
WORK="${NPVM_WORK:-$HOME/vm-win11}"
send(){ printf "sendkey %s\n" "$1" | nc -U -w 1 "$WORK/mon.sock" >/dev/null 2>&1; sleep 0.22; }
str="$1"; i=0
while [ $i -lt ${#str} ]; do
  c="${str:$i:1}"
  case "$c" in
    [a-z]) send "$c" ;;
    [A-Z]) send "shift-$(echo "$c" | tr A-Z a-z)" ;;
    [0-9]) send "$c" ;;
    ':') send "shift-semicolon" ;; ';') send "semicolon" ;;
    '\') send "backslash" ;; '/') send "slash" ;;
    '.') send "dot" ;; ',') send "comma" ;;
    '-') send "minus" ;; '_') send "shift-minus" ;;
    ' ') send "spc" ;; '=') send "equal" ;; '+') send "shift-equal" ;;
    '&') send "shift-7" ;; '|') send "shift-backslash" ;;
    '>') send "shift-dot" ;; '<') send "shift-comma" ;;
    '"') send "shift-apostrophe" ;; "'") send "apostrophe" ;;
    '(') send "shift-9" ;; ')') send "shift-0" ;; '*') send "shift-8" ;;
    '!') send "shift-1" ;; '@') send "shift-2" ;; '#') send "shift-3" ;;
    '$') send "shift-4" ;; '%') send "shift-5" ;; '^') send "shift-6" ;;
    '?') send "shift-slash" ;;
    *) echo "unhandled char: $c" >&2 ;;
  esac
  i=$((i+1))
done
[ "$2" = "enter" ] && send ret
