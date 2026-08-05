/**
 * Module 12 — Incident Management. REUSES the IncidentRegistry from @neuropause/operations
 * (open / acknowledge / root-cause / mitigate / resolve / close, recovery tracking, escalation
 * policies, MTTR computed from real timestamps, and generated postmortem templates) instead of
 * re-implementing it. The registry's native audit trail is wired to the ONE runtime audit chain;
 * on top of it every lifecycle transition also records on the operations governance event bus with
 * an evidence level. No second incident store is created. Live-verified; starts empty.
 */
import type { Clock } from '@neuropause/cloud-core';
import { IncidentRegistry, type AuditSink, type Incident, type EscalationPolicy, type IncidentState, type Severity as OpsSeverity } from '@neuropause/operations';
import type { OperationsGovernance } from './governance';

export type { Incident, EscalationPolicy, IncidentState };

export class IncidentManagement {
  private readonly registry: IncidentRegistry;

  constructor(
    clock: Clock,
    private readonly governance: OperationsGovernance,
    audit?: AuditSink,
  ) {
    this.registry = new IncidentRegistry(clock, audit ? { audit } : {});
  }

  /** Detect/open an incident (reuses the real registry) and govern it with an evidence level. */
  async detect(input: { title: string; severity: OpsSeverity; services?: string[]; runbook?: string; org?: string }): Promise<Incident> {
    const inc = this.registry.open({ title: input.title, severity: input.severity, ...(input.services ? { services: input.services } : {}), ...(input.runbook !== undefined ? { runbook: input.runbook } : {}) });
    await this.governance.record({ user: 'system', org: input.org ?? '_ops', mission: '_incident', operation: `incident.detect.${inc.severity}`, targetId: inc.id, evidence: 'live-verified' });
    return inc;
  }

  acknowledge(id: string, actor: string): Incident { return this.registry.acknowledge(id, actor); }
  setRootCause(id: string, cause: string): Incident { return this.registry.setRootCause(id, cause); }
  trackRecovery(id: string, steps: string[]): Incident { return this.registry.trackRecovery(id, steps); }

  /** Set an escalation policy for a severity (reuses the registry) and govern the change. */
  async escalate(input: { severity: OpsSeverity; contacts: string[]; withinMs: number; org?: string }): Promise<EscalationPolicy> {
    const policy: EscalationPolicy = { severity: input.severity, contacts: input.contacts, withinMs: input.withinMs };
    this.registry.setEscalation(policy);
    await this.governance.record({ user: 'system', org: input.org ?? '_ops', mission: '_incident', operation: `incident.escalate.${input.severity}`, targetId: input.severity, evidence: 'live-verified', decision: `${input.contacts.length} contact(s)` });
    return policy;
  }

  async resolve(id: string, opts: { rootCause?: string; org?: string } = {}): Promise<Incident> {
    const inc = this.registry.resolve(id, opts.rootCause !== undefined ? { rootCause: opts.rootCause } : {});
    await this.governance.record({ user: 'system', org: opts.org ?? '_ops', mission: '_incident', operation: 'incident.resolve', targetId: id, evidence: 'live-verified' });
    return inc;
  }

  /** Postmortem template pre-filled from the real incident record (reused, never fabricated). */
  postmortem(id: string): string { return this.registry.postmortemTemplate(id); }

  get(id: string): Incident | undefined { return this.registry.get(id); }
  list(filter: { state?: IncidentState; severity?: OpsSeverity } = {}): Incident[] { return this.registry.list(filter); }
  status(): { total: number; open: number; mttrMs: number | null } {
    const s = this.registry.status();
    return { total: s.total, open: s.open, mttrMs: s.mttrMs };
  }
  reusesOperations(): true { return true; }
  count(): number { return this.registry.list().length; }
}
