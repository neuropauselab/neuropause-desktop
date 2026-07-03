# Authentication

This document explains how sign-in works in NeuroPause Desktop, why it is
structured the way it is, and exactly what you need to configure to make each
provider work. It reflects the code that ships in Phase 1 — nothing here is
aspirational.

> **TL;DR for the impatient:** the desktop app never sees an OAuth client
> secret. It opens the system browser, the **backend** does the secret-bearing
> token exchange with the provider, and the desktop app receives only a
> short-lived one-time code that it trades for NeuroPause's own JWTs. The
> refresh token is stored encrypted in the macOS Keychain.

---

## 1. Why not just do OAuth inside the Electron window?

Two reasons, both non-negotiable for a production desktop app:

1. **Client secrets cannot live in a desktop binary.** Anything shipped to a
   user's machine is extractable. Google/GitHub/Microsoft "web application"
   clients have a secret; that secret must stay on a server you control.
2. **Embedded web-views for OAuth are an anti-pattern.** Providers actively
   discourage (and increasingly block) auth inside embedded web-views because
   the host app can read the credentials. The correct pattern for native apps
   is [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252):
   use the **system browser** plus a **loopback redirect**, hardened with
   **PKCE**.

So NeuroPause uses a *backend-mediated* native OAuth flow. The backend holds
the provider secrets; the desktop app holds nothing sensitive except its own
refresh token, which is encrypted at rest.

---

## 2. The end-to-end flow

```
┌──────────────┐         ┌─────────────────┐        ┌──────────────┐        ┌────────────┐
│   Desktop    │         │  System Browser │        │   Backend    │        │  Provider  │
│ (main proc)  │         │   (Safari etc)  │        │  (Express)   │        │ (Google…)  │
└──────┬───────┘         └────────┬────────┘        └──────┬───────┘        └─────┬──────┘
       │                          │                        │                      │
       │ 1. make PKCE verifier +  │                        │                      │
       │    challenge + state     │                        │                      │
       │ 2. start loopback server │                        │                      │
       │    on 127.0.0.1:<rand>   │                        │                      │
       │                          │                        │                      │
       │ 3. open browser ─────────▶  GET /auth/:provider/start?…                  │
       │                          │   (challenge, state,   │                      │
       │                          │    redirect=loopback) ─▶                      │
       │                          │                        │ 4. stash flow in     │
       │                          │                        │    Redis, 302 ──────▶│
       │                          │                        │                      │ 5. user
       │                          │                        │                      │  consents
       │                          │  6. provider 302 back to                      │
       │                          │     /auth/:provider/callback?code ◀───────────│
       │                          │                        │ 7. exchange code for │
       │                          │                        │    provider tokens   │
       │                          │                        │    (server secret) ─▶│
       │                          │                        │ 8. resolve/create    │
       │                          │                        │    NeuroPause user   │
       │                          │  9. 302 to loopback    │                      │
       │ 10. GET loopback?code ◀──┤     with one-time code │                      │
       │     (one-time NP code,   │                        │                      │
       │      bound to challenge) │                        │                      │
       │                          │                        │                      │
       │ 11. POST /auth/token { code, verifier } ─────────▶│ 12. verify PKCE,     │
       │                          │                        │     mint app JWTs    │
       │ 13. { accessToken, refreshToken, … } ◀────────────│                      │
       │                          │                        │                      │
       │ 14. access token → memory                         │                      │
       │     refresh token → Keychain (encrypted)          │                      │
       ▼                          │                        │                      │
```

Key properties:

- **State** is a CSRF guard. The desktop generates it, passes it through, and
  refuses the loopback hit if the returned `state` doesn't match.
- **PKCE** binds the final token exchange to the same client that started the
  flow. The backend stores the `code_challenge` alongside the one-time code; at
  `/auth/token` it recomputes `base64url(sha256(verifier))` and compares. A
  stolen one-time code is useless without the verifier, which never left the
  desktop's memory.
- The **loopback server** listens on `127.0.0.1` on an OS-assigned random port,
  at an unguessable random path, and shuts down the moment it has its result
  (or after a timeout).

---

## 3. Token model

| Token | Lifetime (default) | Where it lives | Notes |
|-------|--------------------|----------------|-------|
| **Access token** (JWT) | 15 min (`JWT_ACCESS_TTL`) | Desktop **main-process memory only** | Never written to disk, never exposed to the renderer. |
| **Refresh token** | 30 days (`JWT_REFRESH_TTL`) | macOS Keychain via Electron `safeStorage` | Stored as encrypted ciphertext in `userData/vault.bin` (mode `0600`). |

On the backend, refresh tokens are **not stored in plaintext**. A SHA-256 hash
of each refresh token is kept in the `auth_sessions` table. Refresh performs
**rotation with reuse detection**: presenting a token that has already been
rotated (or a revoked one) is treated as a compromise signal and burns the
whole session chain for that user.

On the desktop, `restoreSession()` runs at launch: if a refresh token exists in
the Keychain, it is exchanged for a fresh access token and the user's profile
(`/auth/me`) before the window decides between the login and home screens.

---

## 4. Configuring providers

All provider configuration is **server-side**, in `apps/backend/.env`. Leaving a
provider's variables blank simply disables it — the backend's `/auth/providers`
endpoint reports only the enabled ones, and an attempt to start a disabled
provider returns a clean error.

For every web OAuth provider, the **redirect URI** you register with the
provider must be:

```
{PUBLIC_BACKEND_URL}/auth/{provider}/callback
```

With the defaults that is, for example:

```
http://127.0.0.1:4000/auth/google/callback
http://127.0.0.1:4000/auth/github/callback
http://127.0.0.1:4000/auth/microsoft/callback
http://127.0.0.1:4000/auth/apple/callback
```

> Some providers (notably Google) reject `localhost`/loopback as a *web* client
> redirect in production and require a real HTTPS origin. For local development
> the values above work; for distribution you will host the backend at a real
> HTTPS domain and register that instead.

### Google

1. Google Cloud Console → **APIs & Services → Credentials**.
2. Create an **OAuth client ID** of type **Web application**.
3. Add the redirect URI above.
4. Copy the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. On the **OAuth consent screen**, add the `openid`, `email`, and `profile`
   scopes.

### GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set the **Authorization callback URL** to the redirect URI above.
3. Copy the values into `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
4. GitHub does not always return an email on the userinfo endpoint; the backend
   requests the `user:email` scope and reads the primary verified address.

### Microsoft

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. Add a **Web** redirect URI matching the one above.
3. Create a **client secret** under **Certificates & secrets**.
4. Fill `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.
5. `MICROSOFT_TENANT` controls who can sign in: `common` (any Microsoft
   account), `organizations`, `consumers`, or a specific tenant GUID.

### Apple

Apple is the fiddliest because the **client secret is a short-lived ES256 JWT
that you generate**, not a static string.

1. Apple Developer → **Certificates, Identifiers & Profiles**.
2. Create an **App ID**, then a **Services ID** — the Services ID identifier is
   your `APPLE_CLIENT_ID`.
3. Configure **Sign in with Apple** on the Services ID and add the redirect URI
   above as a **Return URL**. Apple requires HTTPS for return URLs in
   production.
4. Create a **Sign in with Apple key** (a `.p8` file). Note its **Key ID**
   (`APPLE_KEY_ID`) and your **Team ID** (`APPLE_TEAM_ID`).
5. Put the contents of the `.p8` file into `APPLE_PRIVATE_KEY` (PEM, newlines
   preserved — wrap in quotes in the `.env`).

The backend mints the Apple client secret JWT on demand from these values.
Apple's callback is delivered as an HTML form POST (`response_mode=form_post`),
which is why the callback route accepts both `GET` and `POST`.

> **Security hardening TODO (tracked, not yet done):** the Apple path currently
> *decodes* the returned `id_token` to read the subject/email but does **not yet
> verify its signature** against Apple's JWKS. Before shipping Apple sign-in to
> real users, add JWKS fetching + signature verification. This is called out
> explicitly so it is not mistaken for finished work.

---

## 5. Email + password

Email auth is included as a first-class fallback:

- Passwords are hashed with **Argon2id** (`@node-rs/argon2`), never stored or
  logged in plaintext.
- The same JWT access/refresh model applies after a successful email login or
  registration.
- Basic validation runs on both client (format, length ≥ 8) and server.

This is intentionally minimal in Phase 1. Production-readiness for the email
path still needs: email verification, password-reset flows, and rate-limit /
lockout tuning on the login endpoint (a basic rate limiter is already wired).

---

## 6. What is deliberately *not* finished in Phase 1

Being honest about the edges so they are not mistaken for oversights:

- **Apple `id_token` signature verification** — see the TODO above.
- **Email verification & password reset** — not implemented yet.
- **CSRF/login rate-limit tuning** — a limiter exists; the thresholds are
  development defaults.
- **Refresh-token storage portability** — `safeStorage` is solid on macOS
  (Keychain-backed). The Windows/Linux backends of `safeStorage` are weaker and
  will need review when those platforms become targets.
- **Secret management** — provider secrets live in `.env` for local dev. A real
  deployment should use a managed secret store (e.g. cloud secrets manager),
  not a file on disk.

These are normal Phase-1-of-many boundaries, not shortcuts that compromise the
parts that *are* built. The parts that are built — PKCE native flow, encrypted
refresh storage, hashed server-side sessions with rotation/reuse detection,
Argon2 passwords, validated IPC — are done properly.
