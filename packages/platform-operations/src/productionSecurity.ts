/**
 * EPIC 13 — Production Security. Vault integration, secret rotation, certificate lifecycle, runtime
 * policy enforcement, and container verification. Vault integration + secret rotation REUSE the Sprint-2
 * infrastructure secrets platform and the security key manager (a real key-version bump); the
 * certificate lifecycle REUSES the infrastructure certificate platform (a cert is not 'issued' until a
 * real issuance). Secrets are handled as references, never values.
 */
import type { PlatformOpsContext } from './types';
import type { PlatformOpsGovernance } from './governance';

export interface VaultIntegration {
  backend: string;
  integrated: boolean;
  reusedInfrastructure: boolean;
}

export class ProductionSecurity {
  constructor(
    private readonly ctx: PlatformOpsContext,
    private readonly gov: PlatformOpsGovernance,
    private readonly operator: string,
  ) {}

  /** Integrate a secrets backend (HashiCorp Vault) via the reused infrastructure secrets platform. */
  async integrateVault(): Promise<VaultIntegration> {
    let integrated = false;
    let reusedInfrastructure = false;
    if (this.ctx.infrastructure) {
      await this.ctx.infrastructure.secrets().integrate('hashicorp-vault');
      integrated = true;
      reusedInfrastructure = true;
    }
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_security', version: '_platform', epic: 'E13', operation: 'integrate-vault', targetId: 'hashicorp-vault', evidence: 'adapter-verified', decision: integrated ? 'integrated' : 'represented' });
    return { backend: 'hashicorp-vault', integrated, reusedInfrastructure };
  }

  /** Secret rotation reuses the security key manager — a REAL key-version bump. */
  async rotateSecret(tenant: string): Promise<{ tenant: string; version: number | null; reusedSecurity: boolean }> {
    let version: number | null = null;
    let reusedSecurity = false;
    if (this.ctx.security) {
      version = this.ctx.security.keys().rotate(tenant); // returns the new key version
      reusedSecurity = true;
    }
    await this.gov.record({ operator: this.operator, environment: 'production', deployment: '_none', cluster: '_security', version: '_platform', epic: 'E13', operation: 'rotate-secret', targetId: tenant, evidence: 'live-verified', decision: `version ${version ?? 'n/a'}` });
    return { tenant, version, reusedSecurity };
  }

  /** Certificate lifecycle reuses the infrastructure certificate platform; issued only on real issuance. */
  certificateLifecycle(): { issued: number; reusedInfrastructure: boolean; note: string } {
    if (this.ctx.infrastructure) {
      return { issued: this.ctx.infrastructure.certificates().issuedCount(), reusedInfrastructure: true, note: 'certificates are not issued until a real issuance occurs' };
    }
    return { issued: 0, reusedInfrastructure: false, note: 'infrastructure not wired in' };
  }

  /** Runtime policy + container verification are represented — a real admission controller is infra-pending. */
  runtimePolicy(): { policies: string[]; enforced: false } {
    return { policies: ['no-privileged-containers', 'read-only-root-fs', 'drop-all-capabilities', 'signed-images-only'], enforced: false };
  }
  containerVerification(): { verified: false; note: string } {
    return { verified: false, note: 'container image signature verification requires a real admission controller (infrastructure-pending)' };
  }
}
