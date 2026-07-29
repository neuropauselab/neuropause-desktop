/**
 * EPIC 10 — Compliance Readiness. A control registry, gap analysis, evidence collection, policy mapping,
 * and assessment reports for ISO 27001, SOC 2, GDPR, HIPAA, and the NIST Cybersecurity Framework. For the
 * four frameworks modelled by the security platform, readiness REUSES the security ComplianceService —
 * whose readiness result hard-codes `certified: false`. NIST CSF is represented in this package's own
 * control registry (functions Identify/Protect/Detect/Respond/Recover mapped to platform capabilities).
 *
 * HONESTY BOUNDARY: readiness is NOT certification. No ISO 27001 / SOC 2 / HIPAA / GDPR certification is
 * ever claimed; every readiness and assessment result carries certified:false, and actual certification
 * requires a third-party audit engagement, which stays infrastructure-pending.
 */
import { randomId } from '@neuropause/cloud-core';
import { COMPLIANCE_FRAMEWORKS, REUSED_COMPLIANCE_FRAMEWORKS, type ComplianceFramework } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export type ControlStatus = 'implemented' | 'partial' | 'architecture-ready' | 'not-implemented';

export interface ControlRecord {
  id: string;
  framework: ComplianceFramework;
  name: string;
  status: ControlStatus;
  capability: string;
}
export interface FrameworkReadiness {
  framework: ComplianceFramework;
  total: number;
  implemented: number;
  partial: number;
  architectureReady: number;
  certified: false;
  reusedCompliance: boolean;
  note: string;
}
export interface AssessmentReport {
  framework: ComplianceFramework;
  readiness: FrameworkReadiness;
  gaps: string[];
  certified: false;
  note: string;
}
export interface EvidenceRecord {
  id: string;
  controlId: string;
  reference: string;
}

/** NIST CSF is not modelled by the security ComplianceService — represented here, honestly, as readiness. */
const NIST_CONTROLS: ControlRecord[] = [
  { id: 'NIST-ID.AM', framework: 'NIST-CSF', name: 'Identify — Asset Management', status: 'implemented', capability: 'Identity + resource classification registries' },
  { id: 'NIST-PR.AC', framework: 'NIST-CSF', name: 'Protect — Identity & Access Control', status: 'implemented', capability: 'Zero Trust runtime + reused AuthorizationEngine' },
  { id: 'NIST-PR.DS', framework: 'NIST-CSF', name: 'Protect — Data Security', status: 'implemented', capability: 'Envelope encryption + reused KeyManager rotation' },
  { id: 'NIST-DE.CM', framework: 'NIST-CSF', name: 'Detect — Continuous Monitoring', status: 'partial', capability: 'Runtime security registries; production telemetry pending' },
  { id: 'NIST-RS.RP', framework: 'NIST-CSF', name: 'Respond — Response Planning', status: 'implemented', capability: 'SOC incident queue + response playbooks' },
  { id: 'NIST-RC.RP', framework: 'NIST-CSF', name: 'Recover — Recovery Planning', status: 'implemented', capability: 'DR plans + reused backup-recovery validation' },
];

export class ComplianceReadiness {
  private readonly controls: ControlRecord[] = [...NIST_CONTROLS];
  private readonly evidence = new Map<string, EvidenceRecord>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  frameworks(): readonly ComplianceFramework[] {
    return COMPLIANCE_FRAMEWORKS;
  }

  /** Register an additional control (e.g. extend the NIST mapping). */
  async registerControl(input: { framework: ComplianceFramework; id: string; name: string; status: ControlStatus; capability: string }): Promise<ControlRecord> {
    const control: ControlRecord = { id: input.id, framework: input.framework, name: input.name, status: input.status, capability: input.capability };
    this.controls.push(control);
    await this.gov.record({ actor: this.operator, environment: '_compliance', resource: input.framework, policy: 'control-registry', epic: 'E10', operation: 'register-control', targetId: input.id, evidence: 'live-verified', decision: input.status });
    return control;
  }

  /** Readiness for a framework — NEVER certification. Reuses the security ComplianceService when modelled. */
  readiness(framework: ComplianceFramework): FrameworkReadiness {
    if (framework !== 'NIST-CSF' && this.ctx.security) {
      const mapped = REUSED_COMPLIANCE_FRAMEWORKS[framework];
      const r = this.ctx.security.compliance().readiness(mapped);
      return {
        framework,
        total: r.total,
        implemented: r.implemented,
        partial: r.partial,
        architectureReady: r.architectureReady,
        certified: false,
        reusedCompliance: true,
        note: 'readiness computed by the reused security ComplianceService; certification requires a third-party audit',
      };
    }
    // NIST-CSF (or no security platform) — compute from the local control registry.
    const controls = this.controls.filter((c) => c.framework === framework);
    return {
      framework,
      total: controls.length,
      implemented: controls.filter((c) => c.status === 'implemented').length,
      partial: controls.filter((c) => c.status === 'partial').length,
      architectureReady: controls.filter((c) => c.status === 'architecture-ready').length,
      certified: false,
      reusedCompliance: false,
      note: framework === 'NIST-CSF' ? 'represented from the local NIST CSF control mapping; not an assessment or certification' : 'no security ComplianceService wired in — represented locally',
    };
  }

  /** Gap analysis — controls not yet fully implemented. Reuses the security control list when available. */
  gapAnalysis(framework: ComplianceFramework): string[] {
    if (framework !== 'NIST-CSF' && this.ctx.security) {
      const mapped = REUSED_COMPLIANCE_FRAMEWORKS[framework];
      return this.ctx.security
        .compliance()
        .controls(mapped)
        .filter((c) => c.status !== 'implemented')
        .map((c) => `${c.id}: ${c.status}`);
    }
    return this.controls.filter((c) => c.framework === framework && c.status !== 'implemented').map((c) => `${c.id}: ${c.status}`);
  }

  /** Policy mapping — map a framework's controls to the platform capabilities that satisfy them. */
  policyMapping(framework: ComplianceFramework): Array<{ control: string; capability: string }> {
    if (framework !== 'NIST-CSF' && this.ctx.security) {
      const mapped = REUSED_COMPLIANCE_FRAMEWORKS[framework];
      return this.ctx.security.compliance().controls(mapped).map((c) => ({ control: c.id, capability: c.capability }));
    }
    return this.controls.filter((c) => c.framework === framework).map((c) => ({ control: c.id, capability: c.capability }));
  }

  /** Collect evidence (a REFERENCE) for a control. */
  async collectEvidence(input: { controlId: string; reference: string }): Promise<EvidenceRecord> {
    const rec: EvidenceRecord = { id: randomId('cevi'), controlId: input.controlId, reference: input.reference };
    this.evidence.set(rec.id, rec);
    await this.gov.record({ actor: this.operator, environment: '_compliance', resource: input.controlId, policy: 'evidence-collection', epic: 'E10', operation: 'collect-evidence', targetId: rec.id, evidence: 'live-verified', decision: 'collected' });
    return rec;
  }

  /** Produce an assessment report — readiness + gaps, explicitly NOT a certification. */
  async assessmentReport(framework: ComplianceFramework): Promise<AssessmentReport> {
    const readiness = this.readiness(framework);
    const gaps = this.gapAnalysis(framework);
    await this.gov.record({ actor: this.operator, environment: '_compliance', resource: framework, policy: 'assessment-report', epic: 'E10', operation: 'assessment-report', targetId: framework, evidence: 'business-data-pending', decision: `impl:${readiness.implemented}/${readiness.total}` });
    return { framework, readiness, gaps, certified: false, note: 'readiness assessment only — a third-party audit engagement is required for certification (infrastructure-pending)' };
  }

  controlCount(): number {
    return this.controls.length;
  }
  evidenceCount(): number {
    return this.evidence.size;
  }
}
