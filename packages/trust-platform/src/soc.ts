/**
 * EPIC 11 — Security Operations Center (SOC). A security dashboard, an incident queue, an alert registry,
 * a threat-intelligence registry, an analyst workspace, and response playbooks. The incident queue
 * REUSES the Operations incident registry (real open/acknowledge/resolve lifecycle). Incidents raised
 * here are platform/exercise incidents — real CUSTOMER incidents and production THREAT INTELLIGENCE are
 * business-data-pending and never fabricated. Alerts and threat indicators registered here are
 * represented inputs, not signals harvested from production traffic.
 */
import { randomId } from '@neuropause/cloud-core';
import { NO_SECURITY_DATA, type SocSeverity } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface SocIncident {
  id: string;
  title: string;
  severity: SocSeverity;
  state: string;
  reusedOperations: boolean;
}
export interface SocAlert {
  id: string;
  name: string;
  severity: SocSeverity;
  detail: string;
}
export interface ThreatIndicator {
  id: string;
  indicator: string;
  type: 'ip' | 'domain' | 'hash' | 'user';
}
export interface Playbook {
  id: string;
  name: string;
  steps: string[];
}
export interface SocDashboard {
  openIncidents: number;
  alerts: number;
  threatIndicators: number;
  playbooks: number;
  reusedOperations: boolean;
  productionThreatIntel: string;
}

export class SecurityOperationsCenter {
  private readonly localIncidents = new Map<string, SocIncident>();
  private readonly alerts = new Map<string, SocAlert>();
  private readonly indicators = new Map<string, ThreatIndicator>();
  private readonly playbooks = new Map<string, Playbook>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  /** Open a security incident — REUSES the Operations incident registry when wired in. */
  async openIncident(input: { title: string; severity: SocSeverity; services?: string[] }): Promise<SocIncident> {
    let id = randomId('socinc');
    let reusedOperations = false;
    if (this.ctx.operations) {
      const inc = this.ctx.operations.incidents().open({ title: input.title, severity: input.severity, ...(input.services ? { services: input.services } : {}) });
      id = inc.id;
      reusedOperations = true;
    }
    const record: SocIncident = { id, title: input.title, severity: input.severity, state: 'open', reusedOperations };
    this.localIncidents.set(id, record);
    await this.gov.record({ actor: this.operator, environment: '_soc', resource: input.title, policy: 'incident-queue', epic: 'E11', operation: 'open-incident', targetId: id, evidence: reusedOperations ? 'live-verified' : 'business-data-pending', decision: input.severity });
    return record;
  }

  /** Acknowledge — REUSES the Operations incident lifecycle when wired in. */
  async acknowledgeIncident(id: string, analyst: string): Promise<SocIncident> {
    const record = this.localIncidents.get(id);
    if (!record) throw new Error(`unknown incident: ${id}`);
    if (this.ctx.operations && record.reusedOperations) {
      const inc = this.ctx.operations.incidents().acknowledge(id, analyst);
      record.state = inc.state;
    } else {
      record.state = 'acknowledged';
    }
    await this.gov.record({ actor: analyst, environment: '_soc', resource: record.title, policy: 'incident-queue', epic: 'E11', operation: 'acknowledge-incident', targetId: id, evidence: 'live-verified', decision: record.state });
    return record;
  }

  /** Resolve — REUSES the Operations incident lifecycle when wired in. */
  async resolveIncident(id: string): Promise<SocIncident> {
    const record = this.localIncidents.get(id);
    if (!record) throw new Error(`unknown incident: ${id}`);
    if (this.ctx.operations && record.reusedOperations) {
      const inc = this.ctx.operations.incidents().resolve(id, {});
      record.state = inc.state;
    } else {
      record.state = 'resolved';
    }
    await this.gov.record({ actor: this.operator, environment: '_soc', resource: record.title, policy: 'incident-queue', epic: 'E11', operation: 'resolve-incident', targetId: id, evidence: 'live-verified', decision: record.state });
    return record;
  }

  async raiseAlert(input: { name: string; severity: SocSeverity; detail: string }): Promise<SocAlert> {
    const alert: SocAlert = { id: randomId('alert'), name: input.name, severity: input.severity, detail: input.detail };
    this.alerts.set(alert.id, alert);
    await this.gov.record({ actor: this.operator, environment: '_soc', resource: input.name, policy: 'alert-registry', epic: 'E11', operation: 'raise-alert', targetId: alert.id, evidence: 'business-data-pending', decision: input.severity });
    return alert;
  }

  async registerThreatIndicator(input: { indicator: string; type: 'ip' | 'domain' | 'hash' | 'user' }): Promise<ThreatIndicator> {
    const ind: ThreatIndicator = { id: randomId('ioc'), indicator: input.indicator, type: input.type };
    this.indicators.set(ind.id, ind);
    await this.gov.record({ actor: this.operator, environment: '_soc', resource: input.type, policy: 'threat-intelligence', epic: 'E11', operation: 'register-indicator', targetId: ind.id, evidence: 'business-data-pending', decision: input.type });
    return ind;
  }

  async addPlaybook(input: { name: string; steps: string[] }): Promise<Playbook> {
    const pb: Playbook = { id: randomId('pb'), name: input.name, steps: input.steps };
    this.playbooks.set(pb.id, pb);
    await this.gov.record({ actor: this.operator, environment: '_soc', resource: input.name, policy: 'response-playbook', epic: 'E11', operation: 'add-playbook', targetId: pb.id, evidence: 'live-verified', decision: `${input.steps.length} steps` });
    return pb;
  }

  incidentQueue(): SocIncident[] {
    return [...this.localIncidents.values()].filter((i) => i.state !== 'resolved' && i.state !== 'closed');
  }

  dashboard(): SocDashboard {
    return {
      openIncidents: this.incidentQueue().length,
      alerts: this.alerts.size,
      threatIndicators: this.indicators.size,
      playbooks: this.playbooks.size,
      reusedOperations: Boolean(this.ctx.operations),
      productionThreatIntel: NO_SECURITY_DATA,
    };
  }
}
