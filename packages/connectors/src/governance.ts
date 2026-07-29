/**
 * Connector governance (NCEA 10.4, Phase 8). One recorder through which EVERY
 * connector execution is recorded on the SINGLE enterprise runtime bus + audit
 * chain (+ timeline). The audit entry is hash-only — no credentials or payloads.
 * Records the required fields: connector, operation, provider, actor, org,
 * workspace, request id, trace id, time, cost, retry count, approval.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';

export type ConnectorApproval = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface ConnectorExecutionRecord {
  connectorId: string;
  operation: string;
  provider: string;
  actor: string;
  org?: string;
  workspace?: string;
  requestId: string;
  traceId: string;
  durationMs: number;
  cost?: { usd: number };
  retryCount: number;
  approval: ConnectorApproval;
  ok: boolean;
  at: number;
  detail?: string;
}

export type ConnectorGovernanceInput = Omit<ConnectorExecutionRecord, 'at' | 'requestId'>;

export class ConnectorGovernance {
  private readonly records: ConnectorExecutionRecord[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(input: ConnectorGovernanceInput): Promise<ConnectorExecutionRecord> {
    const record: ConnectorExecutionRecord = { ...input, requestId: randomId('req'), at: this.clock.now() };
    this.records.push(record);

    this.runtime.audit().append({
      actor: record.actor,
      action: `connector.${record.operation}.${record.ok ? 'ok' : 'error'}`,
      target: record.connectorId,
      deviceId: 'connector-runtime',
      at: record.at,
      dataHash: sha256Hex(
        JSON.stringify({
          requestId: record.requestId,
          traceId: record.traceId,
          retryCount: record.retryCount,
          approval: record.approval,
          cost: record.cost,
        }),
      ),
    });

    await this.runtime.events().publish({
      type: 'connector.execution',
      topic: 'connectors',
      partitionKey: record.actor,
      version: 1,
      payload: {
        connectorId: record.connectorId,
        operation: record.operation,
        provider: record.provider,
        org: record.org,
        workspace: record.workspace,
        requestId: record.requestId,
        traceId: record.traceId,
        durationMs: record.durationMs,
        cost: record.cost,
        retryCount: record.retryCount,
        approval: record.approval,
        ok: record.ok,
      },
    });

    return record;
  }

  history(): ConnectorExecutionRecord[] {
    return [...this.records];
  }
}
