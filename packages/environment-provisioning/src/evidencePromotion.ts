/**
 * EPIC 10 — Evidence Promotion. Opens an evidence record per provisioning area (Terraform apply, cluster
 * provisioning, database provisioning, deployment, TLS, monitoring, acceptance tests). Each record carries
 * timestamp, operator, command, result, artifact, and an audit id. Records start `pending` and are NEVER
 * auto-promoted — promotion is a human decision through the existing Version 1.1 evidence gate.
 */
import { EVIDENCE_AREAS, type EvidenceArea } from './constants';
import type { EnvironmentProvisioningGovernance } from './governance';

export interface EvidenceRecord {
  area: EvidenceArea;
  operator: string;
  command: string;
  result: 'pending' | 'collected';
  artifact: string | null;
  auditId: string | null;
  timestamp: number | null;
  promoted: false;
}

export class EvidencePromotion {
  private readonly records = new Map<EvidenceArea, EvidenceRecord>();

  constructor(
    private readonly gov: EnvironmentProvisioningGovernance,
    private readonly operator: string,
  ) {}

  areas(): readonly EvidenceArea[] {
    return EVIDENCE_AREAS;
  }

  /** Open the full evidence set — every area pending, nothing promoted. */
  async openAll(): Promise<EvidenceRecord[]> {
    for (const area of EVIDENCE_AREAS) {
      this.records.set(area, { area, operator: this.operator, command: '', result: 'pending', artifact: null, auditId: null, timestamp: null, promoted: false });
    }
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'evidence', epic: 'E10', operation: 'open-evidence', result: 'opened', evidence: 'business-data-pending' });
    return [...this.records.values()];
  }

  /** Attach a real evidence reference to an area (references only — never a secret). Never promotes. */
  async collect(area: EvidenceArea, input: { operator: string; command: string; artifact: string }): Promise<EvidenceRecord> {
    const ref = await this.gov.record({ operator: input.operator, environment: 'production', target: `evidence:${area}`, epic: 'E10', operation: 'collect-evidence', result: 'collected', evidence: 'business-data-pending' });
    const record: EvidenceRecord = { area, operator: input.operator, command: input.command, result: 'collected', artifact: input.artifact, auditId: ref.auditId, timestamp: ref.at, promoted: false };
    this.records.set(area, record);
    return record;
  }

  records_(): EvidenceRecord[] {
    return [...this.records.values()];
  }
  collectedCount(): number {
    return [...this.records.values()].filter((r) => r.result === 'collected').length;
  }
}
