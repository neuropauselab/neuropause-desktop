# LAUNCH 03 — Connector OAuth Apps (Tier-A four)

Closes audit finding **A5-2**: the exact env names, scopes, endpoints, and
redirect mechanics below are read from `manifests.ts`, `oauthEngine.ts`, and
`loopbackServer.ts` — not guessed. Scope: the four live-sync connectors only
(GitHub, Notion, Slack, Google Calendar); the other twelve follow the same
pattern later.

## 0. How the flow works (verified)

Connect → the app opens the provider's consent page in your **system browser**
→ provider redirects to a one-shot local listener at
`http://127.0.0.1:<random-port>/callback/<random-32-hex>` → PKCE code exchange
→ tokens land **encrypted** in `connector-vault.bin`. Strict `state` checking,
an unguessable path, and PKCE make interception impractical. Client IDs come
from environment variables at desktop launch; a missing ID simply disables
that connector's Connect button.

## 1. The redirect-URI truth (decides each console's setup)

The port **and the path are randomized per attempt** — by design. Consequence
per provider policy:

- **Google** (Desktop-app client type): loopback with any port/path is allowed
  — **works today, no URI to register**. Start here.
- **GitHub / Notion / Slack**: their consoles register an exact callback and
  (GitHub ignores the *port* for loopback but) **match the path** — a random
  path cannot match. → **Finding LAUNCH-03-2**: these three need a small
  engine option (fixed `/callback` path per manifest, random port + state +
  PKCE retained). **Shipped in LAUNCH-03b**: those three manifests now use a fixed
  `/callback` path (random port, state, and PKCE unchanged) — register the
  callback exactly as written below and connect.

## 2. Provider micro-steps

**Google Calendar — do this one now (end-to-end today).**
console.cloud.google.com → create project `NeuroPause` → **APIs & Services →
OAuth consent screen**: External → app name NeuroPause, your email → add
yourself under **Test users** → save. **Enabled APIs**: enable *Google
Calendar API*. **Credentials → Create credentials → OAuth client ID → Desktop
app** → name `NeuroPause Desktop` → Create → copy **Client ID** and **Client
secret**. No redirect URI is asked for — Desktop type covers loopback.

**GitHub (prepare; connects after 03b).** github.com → Settings → Developer
settings → **OAuth Apps → New OAuth App** → name `NeuroPause`, homepage
`https://YOURDOMAIN.com`, callback `http://127.0.0.1/callback` → Register →
copy Client ID → **Generate a new client secret** → copy once. Scopes
(`read:user`, `repo`, `notifications`) are requested at connect time, not in
the console.

**Notion (prepare).** notion.so/my-integrations → New integration → make it
**Public** → redirect URI `http://127.0.0.1/callback` (if the console demands
https, note it — that extends LAUNCH-03-2) → copy OAuth client ID + secret.

**Slack (prepare).** api.slack.com/apps → Create New App → From scratch →
**OAuth & Permissions** → add redirect URL `http://127.0.0.1/callback` (Slack
may insist on https — same note) → **User Token Scopes**: `channels:read`,
`channels:history`, `users:read` → copy Client ID + secret.

## 3. Environment names (from manifests.ts) and dev usage

| Provider | Client ID env | Client secret env |
| --- | --- | --- |
| GitHub | NEUROPAUSE_GITHUB_CLIENT_ID | NEUROPAUSE_GITHUB_CLIENT_SECRET |
| Notion | NEUROPAUSE_NOTION_CLIENT_ID | NEUROPAUSE_NOTION_CLIENT_SECRET |
| Slack | NEUROPAUSE_SLACK_CLIENT_ID | NEUROPAUSE_SLACK_CLIENT_SECRET |
| Google (Calendar/Drive) | NEUROPAUSE_GOOGLE_CLIENT_ID | NEUROPAUSE_GOOGLE_CLIENT_SECRET |

Dev launch with Google wired (one line, then Connectors → Google Calendar →
Connect; approve in the browser; watch events land in the Timeline):

```
cd ~/Desktop/neuropause-desktop/apps/desktop
NEUROPAUSE_GOOGLE_CLIENT_ID=YOUR_ID NEUROPAUSE_GOOGLE_CLIENT_SECRET=YOUR_SECRET npm run dev
```

Secrets hygiene: password manager only; never in git; per LAUNCH-02's pattern,
**client IDs may be baked into packaged builds** (they are public by design) —
**secrets must never be** (Finding **LAUNCH-03-1**: extend the
generate-build-info baking to client IDs; providers that require a secret at
token exchange need the device-flow/relay decision before packaged
distribution of that connector).

## 4. Ledger

**A5-2 — closed** (names enumerated above). **LAUNCH-03-1 — closed** (client ids bake via generate-build-info; secrets
never — enforced by the `_CLIENT_ID` filter; tested). **LAUNCH-03-2** — fixed-callback-path
option for exact-match providers; GitHub/Notion/Slack connect after it lands
(code, queued). Google Calendar has **no blockers** — it is your first
end-to-end connector today.

**Your action:** run the Google steps, then the dev-launch line, and paste
what the Connectors view and Timeline show. Say **go** for **LAUNCH-03b** —
the two small engine changes (fixed path option + client-ID baking), each
tested and shipped in the usual verified increments.
