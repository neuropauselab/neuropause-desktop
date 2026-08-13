#!/usr/bin/env bash
# ============================================================================
# NeuroPause — bring the API up on one host, with TLS, in one command.
#
# Replaces the Kubernetes path for the current population (one sign-in, pilots
# later). Uses the repository's own docker-compose.prod.yml unchanged and adds
# a Caddy TLS edge on top.
#
# Run ON THE SERVER, from the repository root, as a user in the docker group.
#
#   bash deploy-single-host.sh
#
# It refuses rather than guesses: missing DNS, missing secrets, or a port
# already in use stop it before anything starts, because a half-started stack
# is harder to diagnose than one that never started.
# ============================================================================
set -uo pipefail

DOMAIN="${NP_DOMAIN:-api.neuropause033.com}"
COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.edge.yml)

say()  { printf '\n=== %s ===\n' "$1"; }
die()  { printf 'REFUSING — %s\n' "$1" >&2; exit 1; }

say "preflight"

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
[ -f docker-compose.prod.yml ] || die "run this from the repository root (docker-compose.prod.yml not found)"
[ -f docker-compose.edge.yml ] || die "docker-compose.edge.yml not found — copy it and Caddyfile to the repo root"
[ -f Caddyfile ] || die "Caddyfile not found — copy it to the repo root"

# The overlay uses `ports: !reset []`, which older Compose versions cannot parse.
# Checking a version number would be a proxy; asking THIS docker to merge the two
# files is the thing itself. `config` needs no daemon and starts nothing.
"${COMPOSE[@]}" config >/dev/null 2>/tmp/np-merge.err || {
  printf 'REFUSING — this Docker Compose cannot merge the two files:\n'
  head -5 /tmp/np-merge.err
  printf '\nThe overlay uses `ports: !reset []`, which needs Compose v2.24 or newer.\n'
  printf 'Upgrade the compose plugin, or delete the `backend: ports: !reset []`\n'
  printf 'block — the backend publishes only on 127.0.0.1, so losing the reset\n'
  printf 'costs a redundant loopback binding, not exposure.\n'
  exit 1
}

# DNS must already point here, or the HTTP-01 challenge cannot complete and
# Caddy will retry against a name that resolves elsewhere.
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
[ -n "$RESOLVED" ] || die "$DOMAIN does not resolve. Create the A record first."
PUBLIC=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
if [ -n "$PUBLIC" ] && [ "$RESOLVED" != "$PUBLIC" ]; then
  printf 'WARNING: %s resolves to %s but this host is %s.\n' "$DOMAIN" "$RESOLVED" "$PUBLIC"
  printf 'If Cloudflare is proxying (orange cloud), the HTTP-01 challenge will fail.\n'
  printf 'Set the record to DNS-only, or press Ctrl-C now.\n'
  sleep 5
fi

for p in 80 443; do
  if ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$p\$"; then
    die "port $p is already in use — stop the process holding it (often nginx or apache)"
  fi
done

# Secrets. .env is never generated silently: a value invented here would end up
# in production without anyone deciding it.
[ -f .env ] || die ".env not found. Copy .env.example to .env and fill it in."
missing=()
for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET; do
  v=$(grep -E "^${k}=" .env | head -1 | cut -d= -f2-)
  [ -n "$v" ] || missing+=("$k is empty")
done
# The placeholder is the one that shipped in .env.example and boots fine.
if grep -qE '^JWT_ACCESS_SECRET=(replace|your|changeme)' .env; then
  missing+=("JWT_ACCESS_SECRET is still the example placeholder")
fi
# PUBLIC_BACKEND_URL is the same shape of trap and was missed on the first pass:
# zod gives it a default of http://127.0.0.1:4000 and it BOOTS FINE WRONG. The
# backend builds OAuth redirect URIs as ${PUBLIC_BACKEND_URL}/auth/<p>/callback,
# so left at localhost the first provider anyone configures fails with a callback
# mismatch that reads like a provider misconfiguration.
PBU=$(grep -E '^PUBLIC_BACKEND_URL=' .env | head -1 | cut -d= -f2-)
if [ -z "$PBU" ]; then
  missing+=("PUBLIC_BACKEND_URL is unset — it must be https://$DOMAIN")
elif [ "$PBU" != "https://$DOMAIN" ]; then
  missing+=("PUBLIC_BACKEND_URL is '$PBU' — it must be https://$DOMAIN")
fi
if [ ${#missing[@]} -gt 0 ]; then
  printf 'REFUSING — .env is not production-ready:\n'; printf '  - %s\n' "${missing[@]}"
  printf '\nGenerate a secret with:  openssl rand -base64 48\n'
  printf 'Changing JWT_ACCESS_SECRET invalidates every existing session.\n'
  exit 1
fi

say "build and start"
"${COMPOSE[@]}" up -d --build || die "compose failed — see the output above"

say "waiting for the backend"
for i in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T backend node -e \
      "fetch('http://127.0.0.1:4000/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "backend alive after ${i}s"; break
  fi
  [ "$i" -eq 60 ] && { "${COMPOSE[@]}" logs --tail 40 backend; die "backend did not become alive in 60s"; }
  sleep 1
done

say "waiting for the certificate"
# Caddy obtains the certificate on first request. Give it a minute; a failure
# here is almost always DNS or a proxied record, not the container.
for i in $(seq 1 60); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/live" 2>/dev/null || echo "")
  [ -n "$code" ] && { echo "TLS answering after ${i}s (HTTP $code)"; break; }
  [ "$i" -eq 60 ] && { "${COMPOSE[@]}" logs --tail 40 edge; die "no TLS response after 60s — check DNS and that Cloudflare is DNS-only"; }
  sleep 1
done

say "smoke test"
echo "--- /live (process alive, no database required)"
curl -fsS "https://$DOMAIN/live" && echo
echo "--- /health (checks database and redis; 503 when either is down)"
curl -sS -o /tmp/np-health -w 'HTTP %{http_code}\n' "https://$DOMAIN/health"; cat /tmp/np-health; echo
echo "--- /auth/providers (empty array is correct until a provider is configured)"
curl -fsS "https://$DOMAIN/auth/providers" && echo

say "done"
cat <<TXT
The API is up at https://$DOMAIN

Point a desktop build at it without rebuilding:
  NEUROPAUSE_BACKEND_URL=https://$DOMAIN

Operate it:
  ${COMPOSE[*]} ps
  ${COMPOSE[*]} logs -f backend
  ${COMPOSE[*]} down          # stop, keeping data volumes

Two things this script did NOT do, deliberately:
  - No backup schedule. Add one before a pilot organization signs in, and
    prove it by restoring into a throwaway container and counting rows.
  - No alerting. Until something tells a human the API stopped, the detection
    mechanism is a user failing to sign in.
TXT
