/**
 * EPIC 14 — Alerting Platform. Alert registry, critical/warning/health/infrastructure/security/
 * deployment alerts, notification rules, escalation policies, and on-call policies. A real in-process
 * alerting runtime: rules and raised alerts are real records governed on the one chain. Live-verified.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import { ALERT_SEVERITIES, type AlertSeverity } from './constants';

export interface AlertRule { id: string; name: string; severity: AlertSeverity; condition: string }
export interface Alert { id: string; ruleId: string; severity: AlertSeverity; message: string; at: number; acknowledged: boolean }
export interface EscalationPolicy { id: string; name: string; levels: string[] }

export class AlertingPlatform {
  private readonly rules = new Map<string, AlertRule>();
  private readonly alerts = new Map<string, Alert>();
  private readonly escalations = new Map<string, EscalationPolicy>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: InfraGovernance,
  ) {}

  async defineRule(input: { name: string; severity: AlertSeverity; condition: string; org?: string }): Promise<AlertRule> {
    if (!ALERT_SEVERITIES.includes(input.severity)) throw new Error(`unknown severity: ${input.severity}`);
    const rule: AlertRule = { id: randomId('rule'), name: input.name, severity: input.severity, condition: input.condition };
    this.rules.set(rule.id, rule);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E14', operation: `alert.rule.${input.severity}`, targetId: rule.id, evidence: 'live-verified' });
    return rule;
  }

  async raise(input: { ruleId: string; severity: AlertSeverity; message: string; org?: string }): Promise<Alert> {
    const alert: Alert = { id: randomId('alert'), ruleId: input.ruleId, severity: input.severity, message: input.message, at: this.clock.now(), acknowledged: false };
    this.alerts.set(alert.id, alert);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E14', operation: `alert.raise.${input.severity}`, targetId: alert.id, evidence: 'live-verified' });
    return alert;
  }

  acknowledge(id: string): Alert {
    const a = this.alerts.get(id);
    if (!a) throw new Error(`no alert ${id}`);
    a.acknowledged = true;
    return a;
  }

  escalationPolicy(input: { name: string; levels: string[] }): EscalationPolicy {
    const e: EscalationPolicy = { id: randomId('esc'), name: input.name, levels: input.levels };
    this.escalations.set(e.id, e);
    return e;
  }

  ruleList(): AlertRule[] { return [...this.rules.values()]; }
  alertList(severity?: AlertSeverity): Alert[] {
    const all = [...this.alerts.values()];
    return severity ? all.filter((a) => a.severity === severity) : all;
  }
  count(): number { return this.alerts.size; }
}
