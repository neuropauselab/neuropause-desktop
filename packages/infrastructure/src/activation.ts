/**
 * EPIC 1 — Infrastructure Activation Runtime. Infrastructure/cluster registry, environment
 * activation, status, and activation history. Activation is HONEST: a registered item starts
 * 'pending' (infrastructure-pending) and is only promoted to 'active' (live-verified) when
 * confirmed with a real proof-of-provisioning signal — it is NEVER fabricated as active on its own.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { InfraGovernance } from './governance';
import { ACTIVATION_STATUS, type ActivationStatus } from './constants';

export interface InfraRecord {
  id: string;
  name: string;
  kind: string;
  environment: string;
  status: ActivationStatus;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
export interface ActivationEvent { at: number; recordId: string; status: ActivationStatus; note: string }

export class InfrastructureActivationRuntime {
  private readonly records = new Map<string, InfraRecord>();
  private readonly history: ActivationEvent[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: InfraGovernance,
  ) {}

  async register(input: { name: string; kind: string; environment: string; metadata?: Record<string, unknown>; org?: string }): Promise<InfraRecord> {
    const now = this.clock.now();
    const rec: InfraRecord = { id: randomId('infra'), name: input.name, kind: input.kind, environment: input.environment, status: 'pending', metadata: input.metadata ?? {}, createdAt: now, updatedAt: now };
    this.records.set(rec.id, rec);
    this.history.push({ at: now, recordId: rec.id, status: 'pending', note: 'registered — infrastructure-pending' });
    await this.governance.record({ operator: 'system', org: input.org ?? '_ops', environment: input.environment, epic: 'E1', operation: `infra.register.${input.kind}`, targetId: rec.id, evidence: 'infrastructure-pending' });
    return rec;
  }

  /** Begin provisioning — status moves to 'provisioning', still infrastructure-pending. */
  async requestActivation(id: string, org?: string): Promise<InfraRecord> {
    const rec = this.require(id);
    rec.status = 'provisioning';
    rec.updatedAt = this.clock.now();
    this.history.push({ at: rec.updatedAt, recordId: id, status: 'provisioning', note: 'provisioning requested — awaiting real infrastructure' });
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: rec.environment, epic: 'E1', operation: 'infra.provision', targetId: id, evidence: 'infrastructure-pending' });
    return rec;
  }

  /**
   * Confirm activation — promotes to 'active' (live-verified) ONLY with a real proof-of-provisioning
   * signal. Without proof it stays pending; nothing is fabricated as active.
   */
  async confirmActivation(id: string, proof: { verified: boolean; evidenceRef: string }, org?: string): Promise<InfraRecord> {
    const rec = this.require(id);
    if (!proof.verified || !proof.evidenceRef) {
      throw new Error('activation requires a verified real-infrastructure proof — refusing to fabricate an active status');
    }
    rec.status = 'active';
    rec.updatedAt = this.clock.now();
    this.history.push({ at: rec.updatedAt, recordId: id, status: 'active', note: `activated with proof ${proof.evidenceRef}` });
    await this.governance.record({ operator: 'system', org: org ?? '_ops', environment: rec.environment, epic: 'E1', operation: 'infra.activate', targetId: id, evidence: 'live-verified', decision: proof.evidenceRef });
    return rec;
  }

  private require(id: string): InfraRecord {
    const r = this.records.get(id);
    if (!r) throw new Error(`no infrastructure record ${id}`);
    return r;
  }

  get(id: string): InfraRecord | undefined { return this.records.get(id); }
  inventory(environment?: string): InfraRecord[] {
    const all = [...this.records.values()];
    return environment ? all.filter((r) => r.environment === environment) : all;
  }
  activationHistory(): ActivationEvent[] { return [...this.history]; }
  activeCount(): number { return [...this.records.values()].filter((r) => r.status === 'active').length; }
  count(): number { return this.records.size; }
  statuses(): readonly ActivationStatus[] { return ACTIVATION_STATUS; }
}
