# NeuroPause — Security posture at the launch commit

## Credentials

- Provider AI keys: backend environment only (gateway). Device-direct lanes store user keys in Electron safeStorage (`vault.bin`, mode 0600) and never expose them to the renderer (`apiKeyGuard.ts`, redaction tests).
- Session tokens: access JWT (HS256, `iss`/`aud`/`alg` pinned, 15 min) in main-process memory; refresh token (48 bytes, stored server-side as SHA-256) in the encrypted vault.
- Apple/Windows signing secrets: GitHub Actions secret manager only. Presence measured by name; no value was read.

## Fixed in this branch (measured live)

| Finding | Effect before | Fix |
| --- | --- | --- |
| Refresh-token reuse "chain burn" ran inside a transaction that the subsequent `throw` rolled back | reuse answered 401 but no session was revoked; the successor token still refreshed | burn on the autocommit pool (`auth/session.ts`) — live journey step "rotated chain is burned" now 401 |
| Revoked device still heartbeat/re-registered | revocation was a label | `device_revoked` 403 on heartbeat and re-register; cross-user rebind refused |
| Password reset left sessions valid | old credential holder stayed logged in | `revokeAllSessions` on reset |
| Edge 5xx treated as credential rejection on the desktop | outage destroyed the stored refresh token | transient class widened (`backendFailure.ts`) |
| No AI rate/cost bound on the device | unbounded model calls | `AiBudget` (runs/min, tokens/day) |
| AI provider credential could live on the client | key custody on every device | server-side gateway lane |

## Known open items (RED unless accepted by a release owner)

- No `trust proxy` configuration: per-IP limits behind Cloudflare/nginx collapse to one bucket.
- OAuth auto-link by email without a verified-email precondition (github profile path / microsoft / apple).
- Access tokens are unrevocable for up to 15 minutes after logout.
- `AssistantAsk` is a public IPC channel (no auth) on the legacy assistant lane.
- Email verification / password reset mail is not deliverable in production (logging mailer only).
- No account-deletion endpoint.
- Secret scanning / SAST / DAST tooling is not wired into CI; the artifact secret scan in `verify-mac-artifact.cjs` covers the shipped bundle only.
- Windows artifacts unsigned; macOS artifacts unnotarized.

## Reporting

Use the security contact published on the website only after the mailbox is verified (see USER-SUPPORT.md). No contact address is asserted here.
