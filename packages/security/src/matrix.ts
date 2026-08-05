/**
 * Production Readiness Matrix + Security Threat Model (NCEA 14.0, deliverables
 * 16/18). The honest ledger of what is proven with real crypto/logic here
 * (VERIFIED) versus what needs external enterprise infrastructure (INFRA-PENDING).
 * A test enforces the invariants — nothing needing a live IdP, real KMS/HSM, or an
 * external auditor is marked verified; certification is never claimed.
 */
export type Evidence = 'verified' | 'infra-pending';

export interface CapabilityEntry {
  id: string;
  area: string;
  capability: string;
  evidence: Evidence;
  note?: string;
}

export const SECURITY_MATRIX: CapabilityEntry[] = [
  // ── VERIFIED (real crypto / logic executed in tests) ──
  { id: 'authn.totp', area: 'authentication', capability: 'TOTP (RFC 6238) generate + verify', evidence: 'verified' },
  { id: 'authn.pkce', area: 'authentication', capability: 'PKCE S256 challenge/verify', evidence: 'verified' },
  { id: 'authn.recovery', area: 'authentication', capability: 'Single-use hashed recovery codes', evidence: 'verified' },
  { id: 'authn.tokens', area: 'authentication', capability: 'Hashed API/service tokens + magic links', evidence: 'verified' },
  { id: 'authn.passkey', area: 'authentication', capability: 'WebAuthn assertion (Ed25519) verify', evidence: 'verified', note: 'full CBOR/COSE attestation is infra-pending' },
  { id: 'session.timeouts', area: 'session', capability: 'Idle + absolute timeout, rotation, revocation', evidence: 'verified' },
  { id: 'authz.rbac', area: 'authorization', capability: 'RBAC permission resolution + wildcards', evidence: 'verified' },
  { id: 'authz.abac', area: 'authorization', capability: 'ABAC attribute conditions', evidence: 'verified' },
  { id: 'authz.leastpriv', area: 'authorization', capability: 'Deny-by-default, explicit deny wins', evidence: 'verified' },
  { id: 'authz.delegation', area: 'authorization', capability: 'Time-bounded delegation + JIT + audited impersonation', evidence: 'verified' },
  { id: 'policy.engine', area: 'policy', capability: 'Versioned policy evaluation + simulation + testing', evidence: 'verified' },
  { id: 'tenant.isolation', area: 'tenancy', capability: 'Cross-tenant denied unless delegated + audited', evidence: 'verified' },
  { id: 'keys.envelope', area: 'keys', capability: 'AES-256-GCM envelope encryption', evidence: 'verified' },
  { id: 'keys.rotation', area: 'keys', capability: 'Per-tenant key rotation, re-wrap, revocation', evidence: 'verified' },
  { id: 'security.signing', area: 'security', capability: 'HMAC request signing + nonce replay protection', evidence: 'verified' },
  { id: 'security.headers', area: 'security', capability: 'CSP + security headers + CSRF + rate limit', evidence: 'verified' },
  { id: 'audit.signed', area: 'audit', capability: 'Signed, hash-chained, tamper-evident audit', evidence: 'verified' },
  { id: 'ai.governance', area: 'ai-governance', capability: 'Full-attribution AI execution records + replay id', evidence: 'verified' },
  { id: 'compliance.readiness', area: 'compliance', capability: 'Control-framework readiness mapping (no cert claim)', evidence: 'verified' },

  // ── INFRA-PENDING (need external enterprise infrastructure) ──
  { id: 'federation.oidc', area: 'identity', capability: 'Live OIDC against Okta/Azure AD/Auth0/Google Workspace', evidence: 'infra-pending', note: 'needs real IdP metadata + client registration' },
  { id: 'federation.saml', area: 'identity', capability: 'Live SAML 2.0 assertion validation (Ping/ADFS/Okta)', evidence: 'infra-pending', note: 'needs IdP certs + metadata' },
  { id: 'keys.kms', area: 'keys', capability: 'AWS KMS / CloudHSM key provider', evidence: 'infra-pending', note: 'LocalKeyProvider implements the same interface' },
  { id: 'authn.attestation', area: 'authentication', capability: 'WebAuthn hardware attestation (CBOR/COSE)', evidence: 'infra-pending', note: 'needs real authenticators' },
  { id: 'compliance.cert', area: 'compliance', capability: 'SOC 2 / ISO 27001 certification', evidence: 'infra-pending', note: 'requires an external auditor — never self-asserted' },
];

export type StrideCategory = 'spoofing' | 'tampering' | 'repudiation' | 'information-disclosure' | 'denial-of-service' | 'elevation-of-privilege';

export interface Threat {
  id: string;
  category: StrideCategory;
  threat: string;
  mitigation: string;
  status: Evidence;
}

export const THREAT_MODEL: Threat[] = [
  { id: 'T-01', category: 'spoofing', threat: 'Credential theft / weak auth', mitigation: 'MFA (TOTP/passkey), single-use tokens, magic-link expiry', status: 'verified' },
  { id: 'T-02', category: 'tampering', threat: 'Audit log tampering', mitigation: 'Hash-chained + Ed25519-signed audit; verification detects tampering', status: 'verified' },
  { id: 'T-03', category: 'repudiation', threat: 'Denying an AI or admin action', mitigation: 'Full-attribution AI governance + signed audit + replay id', status: 'verified' },
  { id: 'T-04', category: 'information-disclosure', threat: 'Cross-tenant data leakage', mitigation: 'Tenant isolation guard; cross-tenant denied unless delegated+audited', status: 'verified' },
  { id: 'T-05', category: 'information-disclosure', threat: 'Secret exposure at rest', mitigation: 'Envelope encryption (AES-256-GCM); secrets in the vault', status: 'verified' },
  { id: 'T-06', category: 'denial-of-service', threat: 'Request flooding / brute force', mitigation: 'Rate limiting + failed-login metrics + threat hooks', status: 'verified' },
  { id: 'T-07', category: 'elevation-of-privilege', threat: 'Unauthorized privilege escalation', mitigation: 'Least-privilege default-deny; JIT expiry; policy deny-wins', status: 'verified' },
  { id: 'T-08', category: 'tampering', threat: 'Request replay', mitigation: 'HMAC signing + timestamp window + single-use nonce', status: 'verified' },
  { id: 'T-09', category: 'spoofing', threat: 'IdP assertion forgery', mitigation: 'SAML/OIDC signature validation', status: 'infra-pending' },
];

export function readinessSummary(matrix: CapabilityEntry[] = SECURITY_MATRIX): { total: number; verified: number; infraPending: number } {
  return {
    total: matrix.length,
    verified: matrix.filter((e) => e.evidence === 'verified').length,
    infraPending: matrix.filter((e) => e.evidence === 'infra-pending').length,
  };
}

/** Capabilities that are INFRA-PENDING — the invariant guards these are never marked verified. */
export const INFRA_PENDING_IDS = new Set(SECURITY_MATRIX.filter((e) => e.evidence === 'infra-pending').map((e) => e.id));
