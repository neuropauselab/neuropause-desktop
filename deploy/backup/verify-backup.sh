#!/usr/bin/env bash
# NEMS Phase 5 — backup verification (honest checker).
# ---------------------------------------------------------------------------
# Verifies that a real, fresh, non-empty PostgreSQL backup exists in Spaces.
# Design follows the project's evidence discipline:
#   * Three distinct outcomes, three exit codes:
#       0 PASS       - a checked, fresh, non-empty (and with --deep, parseable) backup
#       1 FAIL       - the check ran and the answer is NO (missing / stale / empty / corrupt)
#       2 UNREADABLE - the check could NOT run (no creds, API error, unparseable)
#     A tool error is NEVER allowed to masquerade as "0 backups = fine". Missing
#     backups are a FAIL; an un-runnable check is UNREADABLE. Neither is a PASS.
#   * `--selftest` feeds known-good and known-bad inputs through the predicates
#     to prove they can actually FAIL (positive control). Run it in CI.
#
# Requirements: aws CLI (S3-compatible), GNU date, and for --deep, pg_restore.
# Env: BUCKET (required), ENDPOINT (default nyc3), PG_PREFIX, MAX_AGE_HOURS.
#      AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = Spaces keys.
#
# Usage:
#   BUCKET=my-nems-backups AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#     ./verify-backup.sh            # shallow: existence + freshness + non-empty
#   ... ./verify-backup.sh --deep   # also downloads newest and parses the archive
#   ./verify-backup.sh --selftest   # proves the checks have discriminating power
# ---------------------------------------------------------------------------
set -uo pipefail

: "${ENDPOINT:=https://nyc3.digitaloceanspaces.com}"
: "${PG_PREFIX:=pg/nems-prod-pg}"
: "${MAX_AGE_HOURS:=26}"
DEEP=0; SELFTEST=0

for a in "${@:-}"; do
  case "$a" in
    --deep) DEEP=1 ;;
    --selftest) SELFTEST=1 ;;
    "") : ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "UNREADABLE: unknown arg: $a" >&2; exit 2 ;;
  esac
done

# ---- pure predicates (exercised by --selftest) -----------------------------
# fresh <newest_epoch> <now_epoch> <max_hours>: rc 0 fresh, 1 stale, 2 unreadable
fresh() {
  case "${1}${2}${3}" in *[!0-9]*|'') return 2 ;; esac
  local age=$(( $2 - $1 ))
  { [ "$age" -ge 0 ] && [ "$age" -le $(( $3 * 3600 )) ]; }
}
# nonempty <size>: rc 0 (>0), 1 (==0), 2 (unreadable)
nonempty() {
  case "${1:-}" in ''|*[!0-9]*) return 2 ;; esac
  [ "$1" -gt 0 ]
}

selftest() {
  local fails=0 now=1000000000 rc
  echo "[selftest] positive controls — each check MUST be able to FAIL"

  fresh $(( now - 3600 )) "$now" 26; rc=$?
  if [ $rc -eq 0 ]; then echo "  ok   fresh(1h old)   -> PASS"; else echo "  BAD  fresh(1h old) rc=$rc"; fails=1; fi

  fresh $(( now - 48*3600 )) "$now" 26; rc=$?
  if [ $rc -eq 1 ]; then echo "  ok   fresh(48h old)  -> FAIL"; else echo "  BAD  fresh(48h old) rc=$rc (must be 1)"; fails=1; fi

  fresh "xx" "$now" 26; rc=$?
  if [ $rc -eq 2 ]; then echo "  ok   fresh(garbage)  -> UNREADABLE"; else echo "  BAD  fresh(garbage) rc=$rc (must be 2)"; fails=1; fi

  nonempty 4096; rc=$?
  if [ $rc -eq 0 ]; then echo "  ok   nonempty(4096)  -> PASS"; else echo "  BAD  nonempty(4096) rc=$rc"; fails=1; fi

  nonempty 0; rc=$?
  if [ $rc -eq 1 ]; then echo "  ok   nonempty(0)     -> FAIL"; else echo "  BAD  nonempty(0) rc=$rc (must be 1)"; fails=1; fi

  nonempty ""; rc=$?
  if [ $rc -eq 2 ]; then echo "  ok   nonempty(empty) -> UNREADABLE"; else echo "  BAD  nonempty(empty) rc=$rc (must be 2)"; fails=1; fi

  if [ $fails -eq 0 ]; then
    echo "[selftest] PASS — predicates have discriminating power"; return 0
  else
    echo "[selftest] BROKEN — a control did not behave; do not trust this checker"; return 1
  fi
}

if [ "$SELFTEST" = 1 ]; then selftest; exit $?; fi

# ---- live check ------------------------------------------------------------
command -v aws >/dev/null 2>&1 || { echo "UNREADABLE: aws CLI not found"; exit 2; }
[ -n "${BUCKET:-}" ] || { echo "UNREADABLE: set BUCKET (the backup bucket name)"; exit 2; }

q='sort_by(Contents,&LastModified)[-1].[Key,LastModified,Size]'
if ! out=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PG_PREFIX" \
           --endpoint-url "$ENDPOINT" --query "$q" --output text 2>/tmp/vb.err); then
  echo "UNREADABLE: list-objects-v2 failed: $(tr -d '\n' </tmp/vb.err)"; exit 2
fi
if [ "$out" = "None" ] || [ -z "$out" ]; then
  echo "FAIL: no PostgreSQL backups under s3://$BUCKET/$PG_PREFIX — expected a daily backup"; exit 1
fi

key=$(printf '%s\n' "$out" | awk '{print $1}')
lm=$(printf  '%s\n' "$out" | awk '{print $2}')
size=$(printf '%s\n' "$out" | awk '{print $3}')

if ! newest_epoch=$(date -d "$lm" +%s 2>/dev/null); then
  echo "UNREADABLE: cannot parse LastModified '$lm' (need GNU date)"; exit 2
fi
now=$(date -u +%s)

fresh "$newest_epoch" "$now" "$MAX_AGE_HOURS"; rc=$?
case $rc in
  1) echo "FAIL: newest backup '$key' is older than ${MAX_AGE_HOURS}h (LastModified=$lm)"; exit 1 ;;
  2) echo "UNREADABLE: freshness inputs invalid (epoch=$newest_epoch now=$now)"; exit 2 ;;
esac

nonempty "$size"; rc=$?
case $rc in
  1) echo "FAIL: newest backup '$key' is 0 bytes"; exit 1 ;;
  2) echo "UNREADABLE: size not numeric ('$size')"; exit 2 ;;
esac

echo "PASS(shallow): newest=$key size=${size}B fresh<=${MAX_AGE_HOURS}h"

if [ "$DEEP" = 1 ]; then
  command -v pg_restore >/dev/null 2>&1 || { echo "UNREADABLE(deep): pg_restore not on PATH"; exit 2; }
  tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
  if ! aws s3 cp "s3://$BUCKET/$key" "$tmp" --endpoint-url "$ENDPOINT" --only-show-errors; then
    echo "UNREADABLE(deep): download of '$key' failed"; exit 2
  fi
  if ! pg_restore --list "$tmp" >/dev/null 2>/tmp/vb.perr; then
    echo "FAIL(deep): '$key' is not a valid archive: $(tr -d '\n' </tmp/vb.perr)"; exit 1
  fi
  echo "PASS(deep): $key parses as a valid pg_restore archive"
fi

echo "OVERALL: PASS"
