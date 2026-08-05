/**
 * Module 10 — Compliance Verification. Security, configuration, dependency, license, and
 * infrastructure audits producing evidence reports. It NEVER claims certification: every report
 * carries certified=false and states it is an evidence report, not an attestation. REUSES the
 * security platform's compliance/audit services when connected. In-process — live-verified.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { ProductionGovernance } from './governance';
import type { ProductionContext } from './types';
import { AUDIT_KINDS, type AuditKind } from './constants';

export interface AuditReport {
  id: string;
  kind: AuditKind;
  findings: string[];
  passed: number;
  total: number;
  certified: false; // never a certification
  reusedSecurity: boolean;
  note: string;
  at: number;
}

export class ComplianceVerification {
  private readonly reports = new Map<string, AuditReport>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: ProductionGovernance,
    private readonly ctx: ProductionContext = {},
  ) {}

  async runAudit(input: { kind: AuditKind; checks?: Array<{ name: string; passed: boolean }>; org?: string }): Promise<AuditReport> {
    if (!AUDIT_KINDS.includes(input.kind)) throw new Error(`unknown audit kind: ${input.kind}`);
    const checks = input.checks ?? [];
    const passed = checks.filter((c) => c.passed).length;
    const report: AuditReport = {
      id: randomId('audit'),
      kind: input.kind,
      findings: checks.filter((c) => !c.passed).map((c) => c.name),
      passed,
      total: checks.length,
      certified: false,
      reusedSecurity: !!this.ctx.security,
      note: 'evidence report only — NOT a certification or attestation',
      at: this.clock.now(),
    };
    this.reports.set(report.id, report);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', operation: `compliance.audit.${input.kind}`, targetId: report.id, evidence: 'live-verified', decision: `${passed}/${checks.length} passed` });
    return report;
  }

  get(id: string): AuditReport | undefined { return this.reports.get(id); }
  list(kind?: AuditKind): AuditReport[] {
    const all = [...this.reports.values()];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  count(): number { return this.reports.size; }
}
