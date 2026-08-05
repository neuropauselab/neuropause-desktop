/**
 * EPIC 11 — Evidence Automation. Assembles evidence PACKAGES — deployment logs, rollout status, image
 * digests, certificate fingerprints, backup verification, and health reports — for the evidence-promotion
 * process. It never promotes a capability: every slot starts `pending`, `promoted` is always false, and
 * the package is handed to the existing Version 1.1 evidence-promotion gate for a human decision. SBOM /
 * provenance evidence REUSES the trust-platform supply-chain module when wired in.
 */
import { randomId } from '@neuropause/cloud-core';
import type { PaContext } from './types';
import type { PlatformAutomationGovernance } from './governance';

export const EVIDENCE_SLOTS = ['deployment-logs', 'rollout-status', 'image-digest', 'certificate-fingerprint', 'backup-verification', 'health-report'] as const;
export type EvidenceSlot = (typeof EVIDENCE_SLOTS)[number];

export interface EvidenceItem {
  slot: EvidenceSlot;
  status: 'pending' | 'collected';
  reference: string | null;
}
export interface EvidencePackage {
  id: string;
  automationId: string;
  items: EvidenceItem[];
  promoted: false;
  note: string;
}

export class EvidenceCollector {
  private readonly packages = new Map<string, EvidencePackage>();

  constructor(
    private readonly ctx: PaContext,
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  slots(): readonly EvidenceSlot[] {
    return EVIDENCE_SLOTS;
  }

  /** Open an evidence package with all slots pending. Nothing is promoted. */
  async openPackage(automationId: string): Promise<EvidencePackage> {
    const pkg: EvidencePackage = {
      id: randomId('evpkg'),
      automationId,
      items: EVIDENCE_SLOTS.map((slot) => ({ slot, status: 'pending', reference: null })),
      promoted: false,
      note: 'evidence package opened; slots pending until real operational evidence is attached — never auto-promoted',
    };
    this.packages.set(pkg.id, pkg);
    await this.gov.record({ operator: this.operator, environment: 'production', target: `evidence:${automationId}`, epic: 'E11', operation: 'open-evidence-package', result: 'opened', evidence: 'business-data-pending' });
    return pkg;
  }

  /** Attach a REFERENCE (never a secret) to a slot. Attaching evidence does not promote anything. */
  async attach(packageId: string, slot: EvidenceSlot, reference: string): Promise<EvidencePackage> {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw new Error(`unknown evidence package: ${packageId}`);
    const item = pkg.items.find((i) => i.slot === slot);
    if (item) {
      item.status = 'collected';
      item.reference = reference;
    }
    await this.gov.record({ operator: this.operator, environment: 'production', target: `evidence:${slot}`, epic: 'E11', operation: 'attach-evidence', result: 'collected', evidence: 'business-data-pending' });
    return pkg;
  }

  /** Supply-chain evidence (SBOM component count) reused from trust-platform when available. */
  sbomEvidence(version: string): { componentCount: number; reusedTrustPlatform: boolean } {
    if (this.ctx.trustPlatform) {
      const sbom = this.ctx.trustPlatform.supplyChain().generateSbom(version);
      return { componentCount: sbom.componentCount, reusedTrustPlatform: true };
    }
    return { componentCount: 0, reusedTrustPlatform: false };
  }

  packageCount(): number {
    return this.packages.size;
  }
}
