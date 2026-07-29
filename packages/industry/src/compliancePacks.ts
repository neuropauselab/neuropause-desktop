/**
 * Compliance Packs. Reusable packs for ISO 9001 / ISO 13485 / HIPAA / GDPR / SOC 2 / PCI-DSS /
 * FDA / GMP / GLP. These REPRESENT compliance frameworks only — a pack can be adopted and its
 * readiness tracked, but certification is NEVER claimed (an accredited external auditor is
 * required, which is regulated-external).
 */
import type { IndustryGovernance } from './governance';
import { COMPLIANCE_PACKS, type CompliancePackKey } from './constants';

export interface AdoptedPack {
  tenantId: string;
  pack: CompliancePackKey;
  status: 'adopted';
  certified: false;
  note: string;
}

export class CompliancePackLibrary {
  private readonly adoptedList: AdoptedPack[] = [];

  constructor(private readonly governance: IndustryGovernance) {}

  packs(): readonly CompliancePackKey[] {
    return COMPLIANCE_PACKS;
  }

  async adopt(tenantId: string, pack: CompliancePackKey): Promise<AdoptedPack> {
    if (!COMPLIANCE_PACKS.includes(pack)) throw new Error(`unknown compliance pack: ${pack}`);
    const a: AdoptedPack = { tenantId, pack, status: 'adopted', certified: false, note: `${pack} framework represented — certification is regulated-external (accredited external auditor required)` };
    this.adoptedList.push(a);
    await this.governance.record({ actor: 'system', operation: `compliance.adopt.${pack}`, targetId: tenantId, evidence: 'live-verified', detail: a.note });
    return a;
  }

  /** Certification is never claimed — always regulated-external. */
  certificationStatus(pack: CompliancePackKey): { pack: CompliancePackKey; certified: false; note: string } {
    return { pack, certified: false, note: 'certification requires an accredited external auditor — regulated-external, never claimed' };
  }

  adoptedFor(tenantId: string): AdoptedPack[] {
    return this.adoptedList.filter((a) => a.tenantId === tenantId);
  }
  count(): number {
    return this.adoptedList.length;
  }
}
