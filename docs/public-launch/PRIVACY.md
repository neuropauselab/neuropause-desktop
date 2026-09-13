# NeuroPause — Privacy and data handling (engineering description)

This is an engineering inventory, not a privacy policy. A policy for publication requires legal review (WAITING_FOR_HUMAN).

## Data inventory (measured where stated)

| Data | Where | Encryption | Third party | Deletion / export |
| --- | --- | --- | --- | --- |
| Account (email, display name, argon2id password hash) | backend Postgres `users` | at rest: deployment-dependent | none | no self-service deletion endpoint (gap) |
| Sessions (refresh token hashes, user agent) | `auth_sessions` | hashed | none | revoked on logout / reset / reuse detection |
| Device registry (device id, platform, version, trust status) | `devices` | — | none | owner/admin remove |
| Organization membership | `organizations`, `memberships` | — | none | — |
| AI prompts / responses (gateway lane) | not stored by the gateway; audit line carries ids and token counts only | — | the configured model provider receives message content (ollama: local; anthropic/openai: external) | n/a |
| AI prompts / responses (device lanes) | desktop conversation store under `userData` | Electron safeStorage for credentials only | provider chosen by the user's AI mode ("Private First" prefers local) | local delete |
| Local evidence / action records | `userData` (execution store, action records, CST ledgers) | none | none | local |
| Update preferences / history | `userData/update-prefs.json`, `update-history.json` | none | update feed host receives version + platform | local |
| Crash / diagnostics | local logs (redaction test `logger.redaction.test.ts`) | none | none unless the user exports | local |

## Data that leaves the device

- To the NeuroPause backend: authentication, device registration, organization data, gateway AI requests (message content).
- To the model provider (gateway lane): the messages and tool definitions of a request; never device credentials.
- To the update host: version/channel/platform when checking for updates.

## Not measured

Backend at-rest encryption, backup encryption and retention are deployment properties of the production host, which was unreachable (HTTP 530) during measurement. Recorded as NOT_MEASURED in `24_PRIVACY_REGISTER.json`.
