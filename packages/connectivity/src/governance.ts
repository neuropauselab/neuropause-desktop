/**
 * Module 13 — Governance. Every sync, lifecycle transition, and credential action
 * flows through here onto the ONE runtime audit chain and the ONE runtime event bus.
 * Each record carries tenant, connector, correlation id, replay id, latency, and
 * result. Payloads are never audited — only a SHA-256 hash — so credentials and data
 * never touch the chain. No connector bypasses this recorder.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { LifecycleState, SyncMode } from './constants';

export interface SyncGovernanceInput {
  tenantId: string;
  connectorId: string;
  mode: SyncMode;
  ok: boolean;
  synced?: number;
  conflicts?: number;
  latencyMs: number;
  correlationId?: string;
  replayId?: string;
  detail?: string;
}

export interface GovernanceRef {
  auditId: string;
  correlationId: string;
  replayId: string;
  at: number;
}

export class ConnectivityGovernance {
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  private tally(type: string): void {
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
  }

  async recordSync(input: SyncGovernanceInput): Promise<GovernanceRef> {
    const at = this.clock.now();
    const correlationId = input.correlationId ?? randomId('corr');
    const replayId = input.replayId ?? randomId('replay');
    const dataHash = sha256Hex(
      JSON.stringify({
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        mode: input.mode,
        ok: input.ok,
        synced: input.synced ?? 0,
        conflicts: input.conflicts ?? 0,
        latencyMs: input.latencyMs,
        correlationId,
        replayId,
      }),
    );
    const entry = this.runtime.audit().append({
      actor: input.tenantId,
      action: `connectivity.sync.${input.connectorId}.${input.ok ? 'ok' : 'error'}`,
      target: `${input.tenantId}:${input.connectorId}`,
      deviceId: 'connectivity',
      at,
      dataHash,
    });
    this.tally('connectivity.sync');
    await this.runtime.events().publish({
      type: 'connectivity.sync',
      topic: 'connectivity',
      partitionKey: input.tenantId,
      version: 1,
      payload: {
        connectorId: input.connectorId,
        mode: input.mode,
        ok: input.ok,
        synced: input.synced ?? 0,
        conflicts: input.conflicts ?? 0,
        latencyMs: input.latencyMs,
        correlationId,
        replayId,
        ...(input.detail ? { detail: input.detail } : {}),
      },
    });
    return { auditId: String(entry.auditId), correlationId, replayId, at };
  }

  async recordLifecycle(tenantId: string, connectorId: string, from: LifecycleState, to: LifecycleState): Promise<void> {
    const at = this.clock.now();
    this.runtime.audit().append({
      actor: tenantId,
      action: `connectivity.lifecycle.${to}`,
      target: `${tenantId}:${connectorId}`,
      deviceId: 'connectivity',
      at,
      dataHash: sha256Hex(JSON.stringify({ from, to })),
    });
    this.tally('connectivity.lifecycle');
    await this.runtime.events().publish({
      type: 'connectivity.lifecycle',
      topic: 'connectivity',
      partitionKey: tenantId,
      version: 1,
      payload: { connectorId, from, to },
    });
  }

  async recordCredential(tenantId: string, connectorId: string, action: string): Promise<void> {
    const at = this.clock.now();
    this.runtime.audit().append({
      actor: tenantId,
      action: `connectivity.credential.${action}`,
      target: `${tenantId}:${connectorId}`,
      deviceId: 'connectivity',
      at,
      dataHash: sha256Hex(JSON.stringify({ action })),
    });
    this.tally('connectivity.credential');
    await this.runtime.events().publish({
      type: 'connectivity.credential',
      topic: 'connectivity',
      partitionKey: tenantId,
      version: 1,
      payload: { connectorId, action },
    });
  }

  count(type?: string): number {
    if (type) return this.counts.get(type) ?? 0;
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }

  /** The one audit chain stays verifiable after all connectivity mutations. */
  verify(): boolean {
    return this.runtime.audit().verify().valid;
  }
}
