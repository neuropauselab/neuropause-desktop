/**
 * Identity federation engine (pure). Validates an inbound SAML or OIDC assertion
 * against a configured SSO connection, maps its claims to a federated identity,
 * and enforces the tenant MFA policy.
 *
 * Honest seam: this is real protocol *modeling* — issuer/audience/domain checks
 * and attribute mapping — not a network round-trip to a live IdP. It is
 * deterministic and unit-tested, and structured so a real SAML/OIDC validator
 * (signature + JWKS verification) drops in behind the same interface.
 */
import type { FederatedIdentity, FederationResult, MfaPolicy, SsoConnection } from '@neuropause/shared';

export interface IdpAssertion {
  issuer: string;
  audience?: string;
  subject: string;
  email: string;
  displayName?: string;
  claims: Record<string, string>;
  groups?: string[];
  mfa?: boolean;
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function mapAttribute(connection: SsoConnection, assertion: IdpAssertion, field: string, fallback: string): string {
  const claimKey = connection.attributeMapping[field];
  if (claimKey && assertion.claims[claimKey]) return assertion.claims[claimKey];
  return fallback;
}

export function evaluateFederation(connection: SsoConnection, assertion: IdpAssertion, mfaPolicy: MfaPolicy): FederationResult {
  if (connection.status !== 'active') {
    return { ok: false, identity: null, reason: `Connection "${connection.name}" is ${connection.status}.`, mfaRequired: false };
  }
  if (assertion.issuer !== connection.issuer) {
    return { ok: false, identity: null, reason: 'Issuer mismatch.', mfaRequired: false };
  }
  if (connection.protocol === 'saml' && assertion.audience && assertion.audience !== connection.entityId) {
    return { ok: false, identity: null, reason: 'Audience (entity id) mismatch.', mfaRequired: false };
  }
  if (connection.domains.length > 0 && !connection.domains.map((d) => d.toLowerCase()).includes(domainOf(assertion.email))) {
    return { ok: false, identity: null, reason: `Email domain not allowed for this connection.`, mfaRequired: false };
  }

  const mfaSatisfied = assertion.mfa === true;
  const mfaRequired = mfaPolicy.required && !mfaSatisfied;

  const role = mapAttribute(connection, assertion, 'role', 'member');
  const identity: FederatedIdentity = {
    subject: assertion.subject,
    email: mapAttribute(connection, assertion, 'email', assertion.email),
    displayName: mapAttribute(connection, assertion, 'displayName', assertion.displayName ?? assertion.email),
    connectionId: connection.id,
    protocol: connection.protocol,
    groups: assertion.groups ?? [],
    mfaSatisfied,
    mappedRole: role,
  };

  if (mfaRequired) {
    return { ok: false, identity, reason: 'MFA is required by tenant policy but was not satisfied.', mfaRequired: true };
  }
  return { ok: true, identity, reason: 'Authenticated.', mfaRequired: false };
}

/** A representative successful assertion for the connection — used to test it. */
export function buildTestAssertion(connection: SsoConnection): IdpAssertion {
  const domain = connection.domains[0] ?? 'example.com';
  const roleClaim = connection.attributeMapping['role'] ?? 'role';
  const emailClaim = connection.attributeMapping['email'] ?? 'email';
  const nameClaim = connection.attributeMapping['displayName'] ?? 'name';
  return {
    issuer: connection.issuer,
    audience: connection.protocol === 'saml' ? connection.entityId : undefined,
    subject: `user-${connection.id.slice(0, 12)}`,
    email: `jordan@${domain}`,
    displayName: 'Jordan Lee',
    claims: { [emailClaim]: `jordan@${domain}`, [nameClaim]: 'Jordan Lee', [roleClaim]: 'admin' },
    groups: ['Engineering', 'Admins'],
    mfa: true,
  };
}
