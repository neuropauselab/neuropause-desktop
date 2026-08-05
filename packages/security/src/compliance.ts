/**
 * Compliance Platform (NCEA 14.0, Phase 8). READINESS only — this maps platform
 * capabilities to control frameworks (SOC 2, ISO 27001, GDPR, HIPAA, PCI DSS) with
 * an honest status per control, plus data retention, legal hold, audit export, and
 * evidence collection. It does NOT claim certification: certification requires an
 * external auditor. Every control status reflects what the platform actually
 * provides (audit chain, encryption, RBAC, tenant isolation, …) — architecture-
 * ready where the capability exists but external attestation does not.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { SecurityAudit, SecurityEvent } from './audit';

export type Framework = 'SOC2' | 'ISO27001' | 'GDPR' | 'HIPAA' | 'PCI-DSS';
export type ControlStatus = 'implemented' | 'architecture-ready' | 'partial' | 'not-started';

export interface ComplianceControl {
  id: string;
  framework: Framework;
  name: string;
  status: ControlStatus;
  capability: string;
  note?: string;
}

export const COMPLIANCE_CONTROLS: ComplianceControl[] = [
  { id: 'SOC2-CC6.1', framework: 'SOC2', name: 'Logical access — authentication', status: 'implemented', capability: 'AuthenticationService (MFA/TOTP/tokens/passkeys)' },
  { id: 'SOC2-CC6.3', framework: 'SOC2', name: 'Least-privilege authorization', status: 'implemented', capability: 'AuthorizationEngine (RBAC+ABAC, deny-by-default)' },
  { id: 'SOC2-CC7.2', framework: 'SOC2', name: 'Audit logging + monitoring', status: 'implemented', capability: 'Signed, hash-chained SecurityAudit' },
  { id: 'SOC2-CC6.7', framework: 'SOC2', name: 'Encryption of sensitive data', status: 'implemented', capability: 'Envelope encryption (AES-256-GCM)' },
  { id: 'ISO27001-A.9', framework: 'ISO27001', name: 'Access control', status: 'implemented', capability: 'Identity + Authorization + Policy engine' },
  { id: 'ISO27001-A.10', framework: 'ISO27001', name: 'Cryptography / key management', status: 'implemented', capability: 'KeyManager: rotation, versioning, revocation' },
  { id: 'ISO27001-A.12.4', framework: 'ISO27001', name: 'Logging and monitoring', status: 'implemented', capability: 'Tamper-evident audit + verification' },
  { id: 'GDPR-Art25', framework: 'GDPR', name: 'Data protection by design', status: 'implemented', capability: 'Tenant isolation + policy engine' },
  { id: 'GDPR-Art30', framework: 'GDPR', name: 'Records of processing', status: 'implemented', capability: 'Audit export + evidence collection' },
  { id: 'GDPR-Art17', framework: 'GDPR', name: 'Erasure / retention', status: 'partial', capability: 'Retention policies + legal hold', note: 'physical erasure is a deployment/persistence concern' },
  { id: 'HIPAA-164.312', framework: 'HIPAA', name: 'Technical safeguards', status: 'architecture-ready', capability: 'Encryption + access control + audit', note: 'BAA + deployment controls required' },
  { id: 'PCI-DSS-3', framework: 'PCI-DSS', name: 'Protect stored data', status: 'architecture-ready', capability: 'Envelope encryption + key rotation', note: 'CDE scoping + network controls required' },
  { id: 'PCI-DSS-10', framework: 'PCI-DSS', name: 'Track + monitor access', status: 'implemented', capability: 'Signed audit chain' },
];

export interface RetentionPolicy {
  kind: string;
  retentionDays: number;
  legalHold: boolean;
}

export class ComplianceService {
  private readonly holds = new Set<string>();
  private readonly retention = new Map<string, RetentionPolicy>();

  constructor(
    private readonly audit: SecurityAudit,
    private readonly clock: Clock,
  ) {}

  controls(framework?: Framework): ComplianceControl[] {
    return framework ? COMPLIANCE_CONTROLS.filter((c) => c.framework === framework) : COMPLIANCE_CONTROLS;
  }

  /** Readiness per framework — NEVER a certification claim. */
  readiness(framework: Framework): { framework: Framework; total: number; implemented: number; architectureReady: number; partial: number; certified: false } {
    const list = this.controls(framework);
    return {
      framework,
      total: list.length,
      implemented: list.filter((c) => c.status === 'implemented').length,
      architectureReady: list.filter((c) => c.status === 'architecture-ready').length,
      partial: list.filter((c) => c.status === 'partial').length,
      certified: false, // certification requires an external auditor — never asserted
    };
  }

  async setRetention(kind: string, retentionDays: number): Promise<RetentionPolicy> {
    const policy: RetentionPolicy = { kind, retentionDays, legalHold: false };
    this.retention.set(kind, policy);
    await this.audit.record({ category: 'compliance', action: 'retention.set', actor: 'system', target: kind, meta: { retentionDays } });
    return policy;
  }

  async setLegalHold(tenant: string, on: boolean, actor = 'system'): Promise<void> {
    if (on) this.holds.add(tenant);
    else this.holds.delete(tenant);
    await this.audit.record({ category: 'compliance', action: on ? 'legalhold.set' : 'legalhold.release', actor, tenant, target: tenant });
  }
  underLegalHold(tenant: string): boolean {
    return this.holds.has(tenant);
  }

  /** Export audit evidence for a tenant/framework (verified + signed). */
  async auditExport(tenant?: string): Promise<{ at: number; events: SecurityEvent[]; verified: boolean }> {
    const exported = this.audit.export(tenant ? { tenant } : {});
    await this.audit.record({ category: 'compliance', action: 'audit.export', actor: 'system', ...(tenant ? { tenant } : {}), meta: { count: exported.count } });
    return { at: this.clock.now(), events: exported.events, verified: exported.verified.valid };
  }
}
