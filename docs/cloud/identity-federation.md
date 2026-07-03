# Identity Federation

> `apps/desktop/src/main/cloud/identity/`

Enterprise SSO over SAML and OpenID Connect, SCIM provisioning, and a tenant MFA
policy.

## Model

- **SsoConnection** — `{ protocol (saml|oidc), status, issuer, entityId, ssoUrl,
  clientId, domains[], attributeMapping, enforced, ... }`.
- **ScimConfig** — `{ status, tokenLast4, endpoint, provisioned, lastSyncAt }`.
- **MfaPolicy** — `{ required, methods (totp|webauthn|sms), graceDays }`.
- **FederatedIdentity** / **FederationResult** — the mapped identity and the
  authenticate/deny decision.

## The federation engine (`federation.ts`, pure)

`evaluateFederation(connection, assertion, mfaPolicy)` performs real protocol
modeling:

1. connection must be `active`;
2. assertion `issuer` must match the connection;
3. for SAML, `audience` must match the connection `entityId`;
4. the email domain must be allowed by the connection;
5. claims are mapped to the identity via `attributeMapping`;
6. MFA is enforced against the tenant policy.

`buildTestAssertion(connection)` produces a representative assertion so the UI's
**Test** action exercises the full engine and shows the mapped identity (or the
rejection reason).

## Behavior

`FederationStore` seeds an active Okta SAML connection and a disabled Entra OIDC
connection for the home tenant, SCIM disabled, and an optional MFA policy
(`totp`, `webauthn`). Operations: create/update/enable/enforce/delete a
connection, toggle SCIM (issues a token, last-4 retained), record a SCIM sync,
and set the MFA policy.

## Seam

This validates assertion **structure** and maps attributes; it does not perform
a network round-trip to a live IdP, verify a SAML XML signature, or fetch OIDC
JWKS. Those validators drop in behind the same `evaluateFederation` interface.
SCIM records counts; there is no live SCIM server.
