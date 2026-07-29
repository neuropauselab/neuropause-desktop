/**
 * Incident Management (NCEA 15.0, Phase 10). An incident registry with a per-
 * incident timeline, severity classification, root-cause tracking, recovery
 * tracking, escalation policies, runbook references, status reporting, and
 * generated postmortem templates. Every state change and timeline entry records to
 * the ONE runtime audit chain — incident management integrates with the audit
 * chain, it does not keep a private ledger. MTTR is computed from real timestamps.
 */
import { randomId, systemClock, type Clock } from '@neuropause/cloud-core';
import { recordOp, type AuditSink } from './opsAudit';

export type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4' | 'sev5';
export type IncidentState = 'open' | 'acknowledged' | 'mitigated' | 'resolved' | 'closed';

export interface TimelineEntry {
  at: number;
  kind: string;
  note: string;
  actor?: string;
}
export interface RecoveryStep {
  label: string;
  done: boolean;
  at?: number;
}
export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  state: IncidentState;
  services: string[];
  openedAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  closedAt?: number;
  rootCause?: string;
  runbook?: string;
  timeline: TimelineEntry[];
  recovery: RecoveryStep[];
}

export interface EscalationPolicy {
  severity: Severity;
  contacts: string[];
  withinMs: number;
}

export interface IncidentOptions {
  audit?: AuditSink;
  metrics?: { inc(name: string, by?: number): void };
  onEvent?: (evt: { kind: string; incident: Incident }) => void;
}

export interface OpenInput {
  title: string;
  severity: Severity;
  services?: string[];
  runbook?: string;
}

export class IncidentRegistry {
  private readonly incidents = new Map<string, Incident>();
  private readonly escalation = new Map<Severity, EscalationPolicy>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly options: IncidentOptions = {},
  ) {}

  private record(action: string, inc: Incident): void {
    recordOp(this.options.audit, this.clock, { action: `op.incident.${action}`, target: inc.id, payload: { id: inc.id, severity: inc.severity, state: inc.state, title: inc.title } });
    this.options.metrics?.inc(`ops.incident.${action}`);
    this.options.onEvent?.({ kind: action, incident: { ...inc } });
  }
  private require(id: string): Incident {
    const inc = this.incidents.get(id);
    if (!inc) throw new Error(`incident '${id}' not found`);
    return inc;
  }

  open(input: OpenInput): Incident {
    const now = this.clock.now();
    const inc: Incident = {
      id: randomId('inc'),
      title: input.title,
      severity: input.severity,
      state: 'open',
      services: input.services ?? [],
      openedAt: now,
      ...(input.runbook !== undefined ? { runbook: input.runbook } : {}),
      timeline: [{ at: now, kind: 'opened', note: input.title }],
      recovery: [],
    };
    this.incidents.set(inc.id, inc);
    this.record('open', inc);
    return inc;
  }

  get(id: string): Incident | undefined {
    const inc = this.incidents.get(id);
    return inc ? { ...inc, timeline: [...inc.timeline], recovery: [...inc.recovery] } : undefined;
  }
  list(filter: { state?: IncidentState; severity?: Severity } = {}): Incident[] {
    return [...this.incidents.values()].filter((i) => (filter.state === undefined || i.state === filter.state) && (filter.severity === undefined || i.severity === filter.severity));
  }

  addTimeline(id: string, kind: string, note: string, actor?: string): void {
    const inc = this.require(id);
    inc.timeline.push({ at: this.clock.now(), kind, note, ...(actor !== undefined ? { actor } : {}) });
    this.record('update', inc);
  }

  acknowledge(id: string, actor: string): Incident {
    const inc = this.require(id);
    inc.state = 'acknowledged';
    inc.acknowledgedAt = this.clock.now();
    inc.timeline.push({ at: inc.acknowledgedAt, kind: 'acknowledged', note: `acknowledged by ${actor}`, actor });
    this.record('acknowledge', inc);
    return inc;
  }
  setRootCause(id: string, cause: string): Incident {
    const inc = this.require(id);
    inc.rootCause = cause;
    inc.timeline.push({ at: this.clock.now(), kind: 'root-cause', note: cause });
    this.record('root_cause', inc);
    return inc;
  }
  mitigate(id: string, note = 'mitigated'): Incident {
    const inc = this.require(id);
    inc.state = 'mitigated';
    inc.timeline.push({ at: this.clock.now(), kind: 'mitigated', note });
    this.record('mitigate', inc);
    return inc;
  }
  resolve(id: string, opts: { rootCause?: string } = {}): Incident {
    const inc = this.require(id);
    if (opts.rootCause !== undefined) inc.rootCause = opts.rootCause;
    inc.state = 'resolved';
    inc.resolvedAt = this.clock.now();
    inc.timeline.push({ at: inc.resolvedAt, kind: 'resolved', note: inc.rootCause ?? 'resolved' });
    this.record('resolve', inc);
    return inc;
  }
  close(id: string): Incident {
    const inc = this.require(id);
    inc.state = 'closed';
    inc.closedAt = this.clock.now();
    inc.timeline.push({ at: inc.closedAt, kind: 'closed', note: 'closed' });
    this.record('close', inc);
    return inc;
  }

  // ── recovery tracking ──
  trackRecovery(id: string, steps: string[]): Incident {
    const inc = this.require(id);
    inc.recovery = steps.map((label) => ({ label, done: false }));
    this.record('recovery_plan', inc);
    return inc;
  }
  completeRecoveryStep(id: string, label: string): Incident {
    const inc = this.require(id);
    const step = inc.recovery.find((s) => s.label === label);
    if (step) {
      step.done = true;
      step.at = this.clock.now();
    }
    this.record('recovery_step', inc);
    return inc;
  }
  recoveryComplete(id: string): boolean {
    const inc = this.require(id);
    return inc.recovery.length > 0 && inc.recovery.every((s) => s.done);
  }

  // ── escalation ──
  setEscalation(policy: EscalationPolicy): void {
    this.escalation.set(policy.severity, policy);
  }
  escalationFor(severity: Severity): EscalationPolicy | undefined {
    return this.escalation.get(severity);
  }

  /** Mean time to resolution across resolved/closed incidents. */
  mttrMs(): number | null {
    const resolved = [...this.incidents.values()].filter((i) => i.resolvedAt !== undefined);
    if (resolved.length === 0) return null;
    const total = resolved.reduce((sum, i) => sum + (i.resolvedAt! - i.openedAt), 0);
    return total / resolved.length;
  }

  status(): { total: number; open: number; bySeverity: Record<Severity, number>; mttrMs: number | null } {
    const bySeverity: Record<Severity, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0, sev5: 0 };
    let open = 0;
    for (const i of this.incidents.values()) {
      bySeverity[i.severity] += 1;
      if (i.state !== 'resolved' && i.state !== 'closed') open += 1;
    }
    return { total: this.incidents.size, open, bySeverity, mttrMs: this.mttrMs() };
  }

  /** Generate a postmortem template pre-filled from the incident record. */
  postmortemTemplate(id: string): string {
    const inc = this.require(id);
    const dur = inc.resolvedAt !== undefined ? `${inc.resolvedAt - inc.openedAt} ms` : 'ongoing';
    const timeline = inc.timeline.map((t) => `- ${t.at} — ${t.kind}: ${t.note}`).join('\n');
    return [
      `# Postmortem — ${inc.title}`,
      ``,
      `- Incident: ${inc.id}`,
      `- Severity: ${inc.severity}`,
      `- Services: ${inc.services.join(', ') || 'n/a'}`,
      `- Duration: ${dur}`,
      `- Runbook: ${inc.runbook ?? 'n/a'}`,
      ``,
      `## Summary`,
      `_What happened._`,
      ``,
      `## Impact`,
      `_Who/what was affected._`,
      ``,
      `## Timeline`,
      timeline,
      ``,
      `## Root Cause`,
      inc.rootCause ?? '_To be determined._',
      ``,
      `## Resolution`,
      `_How it was fixed._`,
      ``,
      `## Action Items`,
      `- [ ] Preventive follow-up`,
    ].join('\n');
  }
}
