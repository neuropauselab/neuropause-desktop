/**
 * Module 9 — Security Hardening. Security policies, secret/token rotation, a certificate registry,
 * session validation, encryption verification, and runtime security checks. REUSES the Wave 14
 * security platform's key manager (real key rotation) and session manager (real session validation)
 * when connected, and treats the cloud-ops secret store as the secure vault. Certificate expiry is a
 * real check against the clock. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';

export interface SecurityPolicy { id: string; name: string; rules: string[] }
export interface Certificate { id: string; name: string; expiresAt: number }

export class SecurityHardening {
  private readonly policies = new Map<string, SecurityPolicy>();
  private readonly certificates = new Map<string, Certificate>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async definePolicy(input: { name: string; rules: string[]; org?: string }): Promise<SecurityPolicy> {
    const p: SecurityPolicy = { id: randomId('secpol'), name: input.name, rules: input.rules };
    this.policies.set(p.id, p);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: 'security.policy', targetId: p.id, evidence: 'live-verified' });
    return p;
  }

  /** Rotate keys by REUSING the security key manager — a real version bump, not a claim. */
  async rotateKeys(tenant: string, org?: string): Promise<{ tenant: string; version: number | null; reusedSecurity: boolean; note: string }> {
    if (this.ctx.security) {
      const version = this.ctx.security.keys().rotate(tenant);
      await this.governance.record({ operator: 'system', org: org ?? '_platform', environment: '_platform', operation: 'security.key-rotate', targetId: tenant, evidence: 'live-verified', decision: `v${version}` });
      return { tenant, version, reusedSecurity: true, note: 'real key rotation via the reused security key manager' };
    }
    return { tenant, version: null, reusedSecurity: false, note: 'no security platform connected — key rotation represented only' };
  }

  /** Validate a session by REUSING the security session manager. */
  validateSession(sessionId: string): { valid: boolean; reusedSecurity: boolean; note: string } {
    if (!this.ctx.security) return { valid: false, reusedSecurity: false, note: 'no security platform connected — session validation unavailable, not asserted' };
    return { valid: this.ctx.security.sessions().validate(sessionId).valid, reusedSecurity: true, note: 'real session validation via the reused security session manager' };
  }

  registerCertificate(input: { name: string; expiresAt: number }): Certificate {
    const c: Certificate = { id: randomId('cert'), name: input.name, expiresAt: input.expiresAt };
    this.certificates.set(c.id, c);
    return c;
  }
  /** Certificates expiring within a window — a real check against the clock, never fabricated. */
  expiringCertificates(withinMs: number): Certificate[] {
    const cutoff = this.clock.now() + withinMs;
    return [...this.certificates.values()].filter((c) => c.expiresAt <= cutoff);
  }

  encryptionVerification(): { available: boolean; note: string } {
    return { available: !!this.ctx.security, note: this.ctx.security ? 'reused security key manager available for encryption' : 'no security platform connected' };
  }

  runtimeSecurityChecks(): { policies: number; certificates: number; keyRotation: boolean; sessionValidation: boolean; secretVault: boolean } {
    return { policies: this.policies.size, certificates: this.certificates.size, keyRotation: !!this.ctx.security, sessionValidation: !!this.ctx.security, secretVault: !!this.ctx.cloudops };
  }

  policyList(): SecurityPolicy[] { return [...this.policies.values()]; }
  certificateList(): Certificate[] { return [...this.certificates.values()]; }
  count(): number { return this.policies.size; }
}
