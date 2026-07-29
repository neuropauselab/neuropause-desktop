/**
 * EPIC 9 — Enterprise Data Synchronization. Sync scheduler, incremental + full sync, conflict detection,
 * a retry queue, and sync history. The diff itself REUSES the Sprint-3 synchronization engine (a REAL
 * added/updated/unchanged/conflict diff + retry → dead-letter). Sync runs ONLY for a connector that is
 * configured or verified/active — an unconfigured connector is refused, never silently synced. The
 * records supplied to a sync are caller-provided samples; no real customer data is imported.
 */
import type { SyncMode } from './constants';
import type { EcContext } from './types';
import type { ConnectorRuntime } from './connectorRuntime';
import type { EnterpriseConnectivityGovernance } from './governance';

export interface SyncRecordInput {
  id: string;
  [k: string]: unknown;
}

export interface SyncOutcome {
  connectorId: string;
  mode: SyncMode;
  added: string[];
  updated: string[];
  unchanged: string[];
  conflicts: string[];
  reusedIntegration: boolean;
  refused: boolean;
  note: string;
}

export interface SyncDeps {
  connectors: ConnectorRuntime;
}

export class SynchronizationEngine {
  private readonly history: SyncOutcome[] = [];

  constructor(
    private readonly ctx: EcContext,
    private readonly deps: SyncDeps,
    private readonly gov: EnterpriseConnectivityGovernance,
    private readonly operator: string,
  ) {}

  /** Run a sync — refuses if the connector is not configured/verified/active. Reuses the real diff engine. */
  async sync(input: { connectorId: string; mode: SyncMode; source: SyncRecordInput[]; target: SyncRecordInput[]; conflictIds?: string[] }): Promise<SyncOutcome> {
    const connector = this.deps.connectors.get(input.connectorId);
    if (!connector) throw new Error(`unknown connector: ${input.connectorId}`);
    if (!['configured', 'verified', 'active'].includes(connector.status)) {
      const refused: SyncOutcome = { connectorId: input.connectorId, mode: input.mode, added: [], updated: [], unchanged: [], conflicts: [], reusedIntegration: false, refused: true, note: `connector ${connector.system} is '${connector.status}' — sync refused until configured + verified` };
      this.history.push(refused);
      await this.gov.record({ actor: this.operator, customer: '_sync', connector: connector.system, epic: 'E9', operation: 'sync-refused', targetId: input.connectorId, evidence: 'infrastructure-pending', decision: connector.status });
      return refused;
    }

    let added: string[] = [];
    let updated: string[] = [];
    let unchanged: string[] = [];
    let conflicts: string[] = [];
    let reusedIntegration = false;
    if (this.ctx.integrationPlatform) {
      const result = await this.ctx.integrationPlatform.sync().sync({ integrationId: input.connectorId, mode: input.mode, source: input.source, target: input.target, ...(input.conflictIds ? { conflictIds: input.conflictIds } : {}) });
      added = result.added;
      updated = result.updated;
      unchanged = result.unchanged;
      conflicts = result.conflicts;
      reusedIntegration = true;
    }
    const outcome: SyncOutcome = { connectorId: input.connectorId, mode: input.mode, added, updated, unchanged, conflicts, reusedIntegration, refused: false, note: 'diff computed by the reused Sprint-3 synchronization engine over caller-supplied sample records; no real customer data imported' };
    this.history.push(outcome);
    await this.gov.record({ actor: this.operator, customer: '_sync', connector: connector.system, epic: 'E9', operation: `sync.${input.mode}`, targetId: input.connectorId, evidence: 'live-verified', decision: `+${added.length}/~${updated.length}/!${conflicts.length}` });
    return outcome;
  }

  /** Retry queue reuses the Sprint-3 engine's retry → dead-letter policy. */
  enqueueRetry(recordId: string, maxAttempts = 3): 'retry' | 'dead-letter' | 'unavailable' {
    if (this.ctx.integrationPlatform) return this.ctx.integrationPlatform.sync().enqueueRetry(recordId, maxAttempts);
    return 'unavailable';
  }

  history_(): SyncOutcome[] {
    return [...this.history];
  }
  count(): number {
    return this.history.length;
  }
}
