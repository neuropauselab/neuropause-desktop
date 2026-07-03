# LAUNCH 01 — Deploy the Backend Publicly (security-first micro-steps)

Goal: your backend live at `https://api.YOURDOMAIN.com`, TLS-only, databases
unreachable from the internet, secrets generated on the server. Time: ~45 min.
Cost: a small VM (~$6/mo) + a domain. Every command is paste-ready; replace
`YOURDOMAIN.com` and `SERVER_IP` only.

Verified security facts this runbook builds on: Postgres and Redis have **no
port mappings** in `docker-compose.prod.yml` (internal-only ✓); the backend
publishes `4000` on all interfaces (**LAUNCH-SEC-1**, fixed in step 6, because
Docker bypasses the Ubuntu firewall); the app enforces JWT secret ≥ 32 chars at
boot, helmet, Redis rate limiting, 256kb body caps (audit doc 03).

## 0. What you need first

A VM: Ubuntu 24.04, 2 GB RAM (DigitalOcean, Hetzner, or Lightsail — create via
their website, add your SSH key or a root password, note the public IP). A
domain you own. Your GitHub account + a Personal Access Token (repo scope).

## 1. Point DNS at the server

In your domain registrar: add an **A record**, host `api`, value `SERVER_IP`.
Wait a few minutes.

## 2. Log in, update, firewall

```
ssh root@SERVER_IP
apt update && apt upgrade -y
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
apt install -y unattended-upgrades git
```

Only SSH, HTTP, HTTPS are open. (Docker can bypass ufw — step 6 handles that.)

## 3. Install Docker

```
curl -fsSL https://get.docker.com | sh
docker --version
```

## 4. Get the code (private repo)

```
git clone https://github.com/dishantdobariya91-debug/neuropause-desktop.git /opt/neuropause
cd /opt/neuropause
```

When prompted: Username `dishantdobariya91-debug`, Password = your **token**
(never your GitHub password; typing shows nothing — that's normal). Do not put
the token in the URL — it would be saved in shell history.

## 5. Generate production secrets

```
cp .env.example .env
chmod 600 .env
echo "JWT SECRET:"; openssl rand -hex 32
echo "DB PASSWORD:"; openssl rand -hex 16
```

Copy both values somewhere safe (your password manager). **Never reuse your
laptop's dev secrets in production.**

```
nano .env
```

Set exactly these (leave OAuth and Razorpay lines empty for now):

- `NODE_ENV=production`
- `PUBLIC_BACKEND_URL=https://api.YOURDOMAIN.com`
- `JWT_ACCESS_SECRET=` the 64-char value from above
- `POSTGRES_PASSWORD=` the 32-char value from above
- `DATABASE_URL=` keep it as-is but replace only the password segment with the
  same 32-char value (user, host `postgres`, db name stay unchanged)
- `REDIS_URL` unchanged

Save with Ctrl-O, Enter, Ctrl-X.

## 6. Security fix LAUNCH-SEC-1 — bind the app port to loopback

```
sed -i 's#${BACKEND_PORT:-4000}:4000#127.0.0.1:${BACKEND_PORT:-4000}:4000#' docker-compose.prod.yml
grep -n "127.0.0.1" docker-compose.prod.yml
```

The grep must print the ports line containing `127.0.0.1`. Now only programs on
the server itself (Caddy, next step) can reach the backend; the internet gets
TLS or nothing. Commit it later from your Mac too so the fix lives in git.

## 7. TLS with Caddy (automatic HTTPS certificates)

```
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
printf "api.YOURDOMAIN.com {\n  reverse_proxy 127.0.0.1:4000\n}\n" > /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy fetches and renews certificates itself. HTTP on 80 auto-redirects to
HTTPS.

## 8. Launch the stack

```
cd /opt/neuropause
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

First build takes a few minutes. `ps` must show backend, postgres, redis all
**healthy** — the image runs migrations before serving, so no extra step.

## 9. Verify — from your Mac's terminal

```
curl https://api.YOURDOMAIN.com/live
curl https://api.YOURDOMAIN.com/health
```

Both return 200 (health lists postgres/redis ok). Then the real smoke test:

```
cd ~/Desktop/neuropause-desktop/apps/desktop
NEUROPAUSE_BACKEND_URL=https://api.YOURDOMAIN.com npm run dev
```

Sign in inside the app — you are now using your production server. Create your
account there (production's database starts empty; your laptop data does not
move — by design).

## 10. Nightly backups

```
crontab -e
```

Add this line (choose nano if asked), then save:

```
0 3 * * * cd /opt/neuropause && bash scripts/backup-db.sh >> /var/log/neuropause-backup.log 2>&1
```

## 11. Updating the server later

```
cd /opt/neuropause && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

## 12. Security posture (what you now have)

Unique server-generated secrets in a root-only `.env` (600); TLS-only public
surface via Caddy with auto-renewing certificates; app port loopback-bound;
Postgres/Redis unreachable from the internet (verified, not assumed); firewall
allowing only 22/80/443; automatic OS security updates; boot-refusal on weak
JWT secrets; helmet, rate limiting, and body caps already in the app (audit doc
03); nightly database backups with retention. Deferred to the next launch docs:
per-connector OAuth keys (exact env names enumerated from `manifests.ts` in
LAUNCH-03) and secret-rotation drill (A9 runbook).

**Your next action:** buy the VM + domain, run steps 1–10, and paste the two
`curl` outputs from step 9. In parallel I proceed to **LAUNCH-02 — packaging
and signing the Mac app** (the `.dmg`), which needs your final domain from this
document baked in.
