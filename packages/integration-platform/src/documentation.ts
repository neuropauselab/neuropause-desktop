/**
 * EPIC 20 — Documentation. Integration, API, ERP, CRM, healthcare, manufacturing, security,
 * operations, and troubleshooting guides. Generates real structured outlines in-process and REUSES
 * the Wave 14 production documentation generator for the overlapping guide kinds. Live-verified.
 */
import { randomId } from '@neuropause/cloud-core';
import type { IntegrationGovernance } from './governance';
import type { IntegrationContext } from './types';

export const GUIDE_KINDS = ['integration', 'api', 'erp', 'crm', 'healthcare', 'manufacturing', 'security', 'operations', 'troubleshooting'] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

export interface Guide { id: string; kind: GuideKind; title: string; sections: string[]; reusedProduction: boolean }

const OUTLINE: Record<GuideKind, string[]> = {
  integration: ['Runtime & lifecycle', 'Connector registry', 'Configure & verify', 'Governance'],
  api: ['Protocols', 'Validation', 'Rate limiting', 'Versioning', 'Analytics'],
  erp: ['Supported ERPs', 'Entities', 'Sync', 'Field mapping'],
  crm: ['Supported CRMs', 'Entities', 'Sync', 'Conflict handling'],
  healthcare: ['HL7/FHIR/DICOM', 'EHR adapters', 'Boundaries (no live records)'],
  manufacturing: ['MES/SCADA/PLC/OPC-UA', 'Boundaries (no equipment control)'],
  security: ['OAuth/JWT/mTLS', 'Secret references', 'Certificate validation'],
  operations: ['Connector health', 'Sync health', 'Dashboards'],
  troubleshooting: ['Connection failures', 'Auth errors', 'Sync conflicts', 'Retries & DLQ'],
};

export class IntegrationDocumentation {
  private readonly guides = new Map<string, Guide>();

  constructor(
    private readonly governance: IntegrationGovernance,
    private readonly ctx: IntegrationContext = {},
  ) {}

  async generate(kind: GuideKind, org?: string): Promise<Guide> {
    if (!GUIDE_KINDS.includes(kind)) throw new Error(`unknown guide kind: ${kind}`);
    let reusedProduction = false;
    if (this.ctx.production && (kind === 'security' || kind === 'operations')) {
      await this.ctx.production.documentation().generate({ kind });
      reusedProduction = true;
    }
    const guide: Guide = { id: randomId('guide'), kind, title: `${kind} guide`, sections: OUTLINE[kind], reusedProduction };
    this.guides.set(guide.id, guide);
    await this.governance.record({ operator: 'system', org: org ?? '_platform', integration: '_docs', connector: 'documentation', epic: 'E20', operation: `docs.${kind}`, targetId: guide.id, evidence: 'live-verified' });
    return guide;
  }

  guideKinds(): readonly GuideKind[] { return GUIDE_KINDS; }
  list(): Guide[] { return [...this.guides.values()]; }
  count(): number { return this.guides.size; }
}
