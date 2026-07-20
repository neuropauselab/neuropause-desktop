#!/usr/bin/env bash
# NeuroPause — reproducible cold-start + live-metrics capture.
#
# Boots the production backend build against a migrated DB + Redis, measures the
# time from spawn to the first healthy /health, then snapshots the real /metrics
# gauges. Writes bench/results/startup.json. Every value is measured, not assumed.
#
# Prereqs: a migrated Postgres + Redis reachable via apps/backend/.env (same env
# the app itself uses). Run from the repo root:
#   bash bench/startup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-4000}"
BASE="http://127.0.0.1:${PORT}"
OUT="bench/results/startup.json"
mkdir -p bench/results

# Load the same env the backend uses (DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET).
if [ -f apps/backend/.env ]; then
  set -a
  # shellcheck source=/dev/null
  . apps/backend/.env
  set +a
fi

# Stop any backend already bound to the port so we measure a true cold start.
pkill -f 'apps/backend/dist/index.js' 2>/dev/null || true
sleep 1

t0=$(date +%s.%N)
node apps/backend/dist/index.js >/tmp/np_startup.log 2>&1 &
BE_PID=$!

healthy=""
for _ in $(seq 1 150); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/health" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then healthy=$(date +%s.%N); break; fi
  sleep 0.1
done

if [ -z "$healthy" ]; then
  echo "backend did not become healthy" >&2
  tail -20 /tmp/np_startup.log >&2
  kill "$BE_PID" 2>/dev/null || true
  exit 1
fi

# awk formats with a leading zero so the value is valid JSON (bc would emit ".48").
start_sec=$(awk "BEGIN{printf \"%.3f\", ${healthy} - ${t0}}")
health_json=$(curl -s "${BASE}/health")

# Snapshot the real metrics gauges (idle, immediately after boot).
metrics=$(curl -s "${BASE}/metrics")
rss=$(echo "$metrics" | awk '/^neuropause_backend_resident_memory_bytes /{print $2}')
heap=$(echo "$metrics" | awk '/^neuropause_backend_heap_used_bytes /{print $2}')
pool_total=$(echo "$metrics" | awk -F'[ }]' '/neuropause_pg_pool_connections\{state="total"\}/{print $(NF)}')

cat > "$OUT" <<JSON
{
  "cold_start_to_healthy_sec": ${start_sec},
  "health": ${health_json},
  "metrics_idle": {
    "resident_memory_bytes": ${rss:-null},
    "heap_used_bytes": ${heap:-null},
    "pg_pool_total": ${pool_total:-null}
  },
  "note": "Measured by bench/startup.sh: spawn -> first /health 200. Metrics are the idle snapshot right after boot. Under-load memory/pool figures are captured by bench/http-load.mjs runs (see PERFORMANCE-BENCHMARKS.md)."
}
JSON

echo "cold start -> healthy: ${start_sec}s"
echo "wrote $OUT"
# leave the backend running for subsequent harnesses
