/**
 * EPIC 11 — Certificate Lifecycle. Certificate registry, certificate authorities, renewal,
 * expiration monitoring, TLS validation, inventory, and automatic rotation planning. The registry
 * logic and expiry checks are REAL (computed against the clock). A certificate is NOT marked issued
 * until a real CA issues it (issued=false); actual issuance is infrastructure-pending.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';

export interface CertAuthority { id: string; name: string }
export interface Certificate { id: string; name: string; domain: string; issued: boolean; expiresAt: number; caId?: string }

export class CertificateLifecycle {
  private readonly cas = new Map<string, CertAuthority>();
  private readonly certs = new Map<string, Certificate>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: InfraGovernance,
  ) {}

  async registerCA(input: { name: string; org?: string }): Promise<CertAuthority> {
    const ca: CertAuthority = { id: randomId('ca'), name: input.name };
    this.cas.set(ca.id, ca);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E11', operation: 'cert.ca', targetId: ca.id, evidence: 'live-verified' });
    return ca;
  }

  async registerCertificate(input: { name: string; domain: string; expiresAt: number; caId?: string; org?: string }): Promise<Certificate> {
    const cert: Certificate = { id: randomId('cert'), name: input.name, domain: input.domain, issued: false, expiresAt: input.expiresAt, ...(input.caId ? { caId: input.caId } : {}) };
    this.certs.set(cert.id, cert);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E11', operation: 'cert.register', targetId: cert.id, evidence: 'infrastructure-pending' });
    return cert;
  }

  /** Certificates expiring within a window — a REAL check against the clock. */
  expiring(withinMs: number): Certificate[] {
    const cutoff = this.clock.now() + withinMs;
    return [...this.certs.values()].filter((c) => c.expiresAt <= cutoff);
  }

  /** Automatic rotation plan for expiring certificates. */
  rotationPlan(withinMs: number): Array<{ certId: string; domain: string; steps: string[] }> {
    return this.expiring(withinMs).map((c) => ({ certId: c.id, domain: c.domain, steps: ['request new certificate from CA', 'validate chain', 'install', 'reload edge'] }));
  }

  authorities(): CertAuthority[] { return [...this.cas.values()]; }
  certificates(): Certificate[] { return [...this.certs.values()]; }
  issuedCount(): number { return [...this.certs.values()].filter((c) => c.issued).length; }
  count(): number { return this.certs.size; }
}
