# Runbook — OAuth / login outage

**Scenario:** Users cannot authenticate (OAuth login failing or redirect mismatch).
**Fires as:** SEV2 (login broken) — SEV1 if it blocks all access
**Owner:** platform-oncall
**Backing alerts:** (no dedicated metric — user-reported or synthetic login check; documented gap)

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- Users report failed logins; auth requests error. **Note:** there is no OAuth-specific Prometheus metric (a documented instrumentation gap), so detection is via user reports or an external synthetic login check, not an alert.

## Diagnosis

- Route: the `/auth` prefix is part of the committed `HTTPRoute nems-backend` — confirm it is reachable (`gateway-failure.md` if the whole edge is down).
- Config: `PUBLIC_BACKEND_URL=https://api.neuropause033.com` and `JWT_ACCESS_TTL=900` in the backend config are correct.
- Redirect URI: the authorized redirect URI in the Google Cloud Console must exactly match what the backend sends (this was 3-way verified in Phase 4.8; a Console change or URL drift breaks it).
- Credentials: the OAuth client id/secret the backend uses are intact (not rotated/expired).
- Provider: check Google Identity status; check clock skew on nodes.
- Logs: `kubectl -n nems-prod logs deploy/nems-backend | grep -i -E 'oauth|redirect|token|jwt'`.

## Recovery

- Redirect-URI mismatch → fix the authorized URI in the Google Cloud Console (an external, human change) so it matches the backend.
- Invalid/rotated client secret → restore or rotate the credential and update the secret; `rollout restart` the backend.
- Provider outage → nothing to fix locally; communicate status and wait.
- The backend code is immutable in this phase — do not change application code; this is configuration/credential/IdP remediation only.

## Validation

- A real end-to-end login completes and a token is issued; a protected endpoint accepts it. (Phase 4 left a real Google login as an open verification item — a live login is the true test.)

## Escalation

- Identity-provider outage → comms + wait; credential/config problem persisting → Incident Commander; scope-wide lockout → SEV1.

## Related

`gateway-failure.md`, `backend-down.md`
