#!/usr/bin/env bash
#
# Build an offline / air-gapped deployment bundle for the NeuroPause backend.
#
# Produces a single tarball containing the backend image plus its Postgres and Redis
# images, an offline compose file that references them by tag (no build, no registry),
# an .env template, and a loader script. On an air-gapped host: extract, create .env,
# then run ./load-and-run.sh.
#
# Requires Docker on the BUILD host (with internet, to pull the datastore images).
#
# Usage:
#   scripts/build-offline-bundle.sh [IMAGE_TAG] [OUTPUT_DIR]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${1:-neuropause-backend:1.0.0}"
PG_IMAGE="postgres:16-alpine"
REDIS_IMAGE="redis:7-alpine"
OUT_DIR="${2:-${REPO_ROOT}/dist/offline-bundle}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

echo "==> Building backend image ${IMAGE_TAG}"
docker build -f "${REPO_ROOT}/apps/backend/Dockerfile" -t "${IMAGE_TAG}" "${REPO_ROOT}"

echo "==> Pulling datastore images"
docker pull "${PG_IMAGE}"
docker pull "${REDIS_IMAGE}"

echo "==> Saving images into the bundle"
docker save "${IMAGE_TAG}" "${PG_IMAGE}" "${REDIS_IMAGE}" -o "${STAGE}/images.tar"

if [ -f "${REPO_ROOT}/.env.example" ]; then
  cp "${REPO_ROOT}/.env.example" "${STAGE}/.env.example"
fi

echo "==> Writing offline compose"
cat > "${STAGE}/docker-compose.offline.yml" <<OFFLINE
name: neuropause-offline
services:
  postgres:
    image: ${PG_IMAGE}
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-neuropause}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: \${POSTGRES_DB:-neuropause}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U \${POSTGRES_USER:-neuropause} -d \${POSTGRES_DB:-neuropause}']
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  redis:
    image: ${REDIS_IMAGE}
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  backend:
    image: ${IMAGE_TAG}
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: postgresql://\${POSTGRES_USER:-neuropause}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-neuropause}
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - '127.0.0.1:\${BACKEND_PORT:-4000}:4000'
    restart: unless-stopped
volumes:
  pgdata:
  redisdata:
OFFLINE

echo "==> Writing loader"
cat > "${STAGE}/load-and-run.sh" <<'LOADER'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Loading images"
docker load -i "${HERE}/images.tar"
if [ ! -f "${HERE}/.env" ]; then
  echo "Create ${HERE}/.env from .env.example (set POSTGRES_PASSWORD and a >=32 char JWT_ACCESS_SECRET) first." >&2
  exit 1
fi
echo "==> Starting stack"
cd "${HERE}"
docker compose -f "${HERE}/docker-compose.offline.yml" up -d
echo "==> Backend is starting on loopback port 4000 (probe /live and /health)."
LOADER
chmod +x "${STAGE}/load-and-run.sh"

mkdir -p "${OUT_DIR}"
SAFE_TAG="$(echo "${IMAGE_TAG}" | tr ':/' '__')"
BUNDLE="${OUT_DIR}/neuropause-offline-${SAFE_TAG}.tar.gz"
tar -czf "${BUNDLE}" -C "${STAGE}" .

echo "==> Offline bundle written: ${BUNDLE}"
echo "    Transfer it to the air-gapped host, extract, create .env, then run ./load-and-run.sh"
