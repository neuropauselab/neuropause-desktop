# Remaining commands — freeze, then deploy

Two machines. **A, B, E, F run on your Mac. D runs on the server.**
Every block has a verify line. Stop at the first one that does not match.

---

## A · Mac — clear the lock, pin Node

```bash
cd ~/Desktop/neuropause-desktop
rm -f .git/index.lock
git status --short | head
```

**Verify:** no lock error, and you see `M`/`R`/`??` rows.

```bash
cat .nvmrc
nvm install && nvm use
node --version
```

**Verify:** prints `v20.x`. If `nvm: command not found`, install it
(`brew install nvm`, then follow the shell-init note it prints) or use any Node 20
you have — the pin is what matters, not the tool that provides it.

---

## B · Mac — the static gates, under Node 20

```bash
npm run typecheck
npm run lint
npm test -w @neuropause/desktop
```

**Verify:** typecheck 0 · lint 0 · node 770/8055/0 · UI 13/133/0.
`npm test -w @neuropause/desktop` runs **both** suites — it is the repository's own
command, not a substitute.

### G0e · negative controls — each must bite, then be reverted

```bash
# control 1 — the contrast test must FAIL
sed -i '' 's/font-semibold text-accent-fg/font-semibold text-white/' \
  apps/desktop/src/renderer/src/screens/LoginScreen.tsx
npx vitest run --config apps/desktop/vitest.ui.config.ts \
  --root apps/desktop ui-tests/loginProviders.test.tsx
git checkout -- apps/desktop/src/renderer/src/screens/LoginScreen.tsx
```

**Verify:** `1 failed` naming *the submit button does not paint accent-on-accent*.

```bash
# control 2 — the provider tests must FAIL (three of them)
sed -i '' 's/{providers.map(/{PROVIDER_CATALOGUE.map(/' \
  apps/desktop/src/renderer/src/screens/LoginScreen.tsx
sed -i '' 's/{providers.length > 0 ? (/{true ? (/g' \
  apps/desktop/src/renderer/src/screens/LoginScreen.tsx
npx vitest run --config apps/desktop/vitest.ui.config.ts \
  --root apps/desktop ui-tests/loginProviders.test.tsx
git checkout -- apps/desktop/src/renderer/src/screens/LoginScreen.tsx
git status --short | grep LoginScreen || echo "reverted cleanly"
```

**Verify:** `3 failed`, then `reverted cleanly`.
**A control that does not bite is not a control** — if either passes, stop and say so.

---

## C · Mac — commit, freeze, record

```bash
git add -A
git commit -m "fix(13c): round21 provider discovery + accent foreground; forensic scripts to .cjs; certification tooling"
git status --porcelain=v1 -- . ':(exclude)certification' | wc -l
```

**Verify:** prints `0`. The source tree is clean; `certification/` is excluded by design.

```bash
bash freeze-baseline.sh
```

**Verify:** prints `BASELINE-<64 hex>` and `worktree_clean: true`.
**Copy that hash.** Everything below is recorded against it.

```bash
bash record-gate.sh G0  PASS --command "bash freeze-baseline.sh"        --evidence "clean tree, BASELINE-<hash>"
bash record-gate.sh G0b PASS --command "node --version"                 --evidence "v20.x matches .nvmrc"
bash record-gate.sh G0c PASS --command "npm run typecheck"              --evidence "0 errors"
bash record-gate.sh G0d PASS --command "npm run lint"                   --evidence "0 errors"
bash record-gate.sh G0e PASS --command "two reverted regressions"       --evidence "control 1: 1 failed; control 2: 3 failed; both reverted"
bash record-gate.sh --list
```

**Verify:** `5/24 required gates PASS · NOT CERTIFIED — 19 not PASS`.
If any row refuses, the refusal is the finding — send it to me rather than working around it.

---

## D · The server

### D1 · Which host? — Mac

```bash
doctl compute droplet list --format ID,Name,PublicIPv4,Status,Region
```

**One exists** → note its IP, skip to D2.
**None** → create one:

```bash
doctl compute ssh-key list                       # note a fingerprint
doctl compute image list-application | grep -i docker
doctl compute droplet create neuropause-api \
  --region nyc3 --size s-2vcpu-4gb \
  --image <the docker image slug from above> \
  --ssh-keys <fingerprint> --wait
doctl compute droplet list --format Name,PublicIPv4
```

Record `NEW_IP`.

### D2 · DNS, before anything else

`api.neuropause033.com` still points at **134.199.250.188**, the destroyed load
balancer. In Cloudflare, change the `A` record to `NEW_IP` and keep it
**DNS-only (grey cloud)** — a proxied record breaks Caddy's HTTP-01 challenge.

```bash
dig +short api.neuropause033.com
```

**Verify:** returns `NEW_IP`, from your network **and a phone hotspot.**
Do not proceed until both agree. DNS must be right *before* the deploy, because
the certificate cannot issue otherwise.

### D3 · On the server

```bash
ssh root@NEW_IP
docker --version && docker compose version     # install Docker if absent
git clone https://github.com/<org>/<repo>.git neuropause && cd neuropause
```

The repo is private — use a PAT or add a read-only deploy key. Do not paste
either into a chat.

```bash
cp .env.example .env
openssl rand -base64 48        # JWT_ACCESS_SECRET
openssl rand -base64 32        # POSTGRES_PASSWORD
nano .env
```

Set exactly these, and **do not reuse the example placeholder for the JWT**:

```
POSTGRES_PASSWORD=<generated>
JWT_ACCESS_SECRET=<generated>
PUBLIC_BACKEND_URL=https://api.neuropause033.com
NODE_ENV=production
SEED_STORE_ON_BOOT=false
```

Copy the three edge files to the repository root on the server
(`Caddyfile`, `docker-compose.edge.yml`, `deploy-single-host.sh`), then:

```bash
bash deploy-single-host.sh
```

**Verify:** it prints `/live` alive, `/health` **HTTP 200** with
`database: up, redis: up`, and `/auth/providers` → `{"providers":[]}`.
An empty array is correct — the desktop now renders from it, so empty means no
buttons rather than four dead ones.

Every refusal it prints is a real blocker, not a nuisance. The `PUBLIC_BACKEND_URL`
check in particular exists because that value boots fine wrong.

---

## E · Mac — prove it from outside, then record G3

```bash
curl -sS -o /dev/null -w 'live  %{http_code} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s\n' \
  --max-time 10 https://api.neuropause033.com/live
curl -sS -o /dev/null -w 'ready %{http_code} total=%{time_total}s\n' \
  --max-time 10 https://api.neuropause033.com/health
curl -sS https://api.neuropause033.com/health; echo
openssl s_client -connect api.neuropause033.com:443 \
  -servername api.neuropause033.com </dev/null 2>/dev/null | openssl x509 -noout -subject -dates -ext subjectAltName
```

**Verify:** both `200`, `connect` non-zero, and the SAN contains
`api.neuropause033.com`. **Repeat from a phone hotspot** — one network is not
evidence, and my last DNS claim was wrong for exactly that reason.

```bash
cd ~/Desktop/neuropause-desktop
bash record-gate.sh G3 PASS \
  --command "curl -sSI https://api.neuropause033.com/health" \
  --evidence "HTTP 200 database:up redis:up, from home network and hotspot, cert SAN verified"
```

---

## F · Mac — G5, which G3 just unblocked

```bash
cd ~/Desktop/neuropause-desktop
export NEUROPAUSE_BACKEND_URL=https://api.neuropause033.com
npm run dev:desktop
```

**Verify:** first log line reads `backendUrl: 'https://api.neuropause033.com'`.
No reachability notice. **No OAuth buttons** — the catalogue is server-driven and
the server has none configured. Register with *Create one*, reach onboarding.

```bash
bash record-gate.sh G5 PASS \
  --command "npm run dev:desktop against production" \
  --evidence "registered <address>, session issued, reached FirstRunExperience"
bash record-gate.sh --list
```

**Verify:** `7/24 required gates PASS`.

**This is also where F-7 and F-8 lose their `(dev)` labels** — for the first time
they are observed against the shipped configuration rather than a local backend.

---

## What is still not closed after all of this

G1 build · G2 wiring census · G4 real hardware · G6–G9 governance (Saurabh owns
the input) · G10–G13 runtime · G14 recovery · G15 restore · G16 cross-platform ·
G17 production smoke · G18 provenance · G19 defects.

**Seventeen of twenty-four.** `record-gate.sh --list` is the authority, not this
file, and not me.

Two things to add before anyone but you signs in: a **backup schedule proven by a
restore**, and **one external uptime check on `/health`**. The last outage's
detection mechanism was a founder failing to log in.
