/**
 * Build item 6 — Evidence. Builds the deployment evidence package (terraform output, rollout logs, pod
 * status, certificates, database health, monitoring, backups). It REUSES the 1C evidence-promotion engine
 * to open the underlying records. Every item starts pending; nothing is auto-promoted — promotion is a
 * human decision on real evidence.
 */
import { EVIDENCE_ITEMS, type EvidenceItem } from './constants';
import type { OdContext } from './types';
import type { OperatorDeploymentGovernance } from './governance';

export interface DeploymentEvidencePackage {
  items: Array<{ item: EvidenceItem; status: 'pending' | 'collected'; reference: string | null }>;
  promoted: false;
  reusedEnvironmentProvisioning: boolean;
}

export class EvidencePackageBuilder {
  constructor(
    private readonly ctx: OdContext,
    private readonly gov: OperatorDeploymentGovernance,
    private readonly operator: string,
  ) {}

  items(): readonly EvidenceItem[] {
    return EVIDENCE_ITEMS;
  }

  async build(): Promise<DeploymentEvidencePackage> {
    let reused = false;
    if (this.ctx.environmentProvisioning) {
      await this.ctx.environmentProvisioning.evidencePromotion().openAll();
      reused = true;
    }
    const items = EVIDENCE_ITEMS.map((item) => ({ item, status: 'pending' as const, reference: null }));
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'evidence', operation: 'build-evidence-package', result: 'pending', evidence: 'business-data-pending' });
    return { items, promoted: false, reusedEnvironmentProvisioning: reused };
  }
}
