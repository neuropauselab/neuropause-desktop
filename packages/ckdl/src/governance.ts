/**
 * CKDL governance (NCEA 11.1). ONE recorder through which every knowledge-layer
 * mutation — entity registration, relationship, decision, evidence, objective,
 * trust assessment — is written to the SINGLE Enterprise Runtime audit chain +
 * event bus (+ timeline). The audit entry is hash-only: no payloads. This is what
 * makes "every decision replayable / every recommendation has provenance"
 * enforceable rather than aspirational. Nothing in the layer bypasses it.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';

export type CkdlDomain = 'knowledge' | 'relationship' | 'decision' | 'evidence' | 'objective' | 'trust';

export interface CkdlActivityRecord {
  domain: CkdlDomain;
  action: string;
  entity: string;
  actor: string;
  requestId: string;
  at: number;
  ok: boolean;
  /** Ids of the evidence backing this activity — provenance, never faked. */
  evidenceIds?: string[];
  detail?: string;
  meta?: Record<string, unknown>;
}

export type CkdlGovernanceInput = Omit<CkdlActivityRecord, 'at' | 'requestId'>;

export const CKDL_ACTIVITY_EVENT = 'ckdl.activity';

export class KnowledgeGovernance {
  private readonly records: CkdlActivityRecord[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(input: CkdlGovernanceInput): Promise<CkdlActivityRecord> {
    const record: CkdlActivityRecord = { ...input, requestId: randomId('ckr'), at: this.clock.now() };
    this.records.push(record);

    this.runtime.audit().append({
      actor: record.actor,
      action: `ckdl.${record.domain}.${record.action}.${record.ok ? 'ok' : 'error'}`,
      target: record.entity,
      deviceId: 'ckdl',
      at: record.at,
      dataHash: sha256Hex(
        JSON.stringify({
          requestId: record.requestId,
          domain: record.domain,
          action: record.action,
          entity: record.entity,
          evidenceIds: record.evidenceIds ?? [],
          meta: record.meta,
        }),
      ),
    });

    await this.runtime.events().publish({
      type: CKDL_ACTIVITY_EVENT,
      topic: 'ckdl',
      partitionKey: record.entity,
      version: 1,
      payload: {
        domain: record.domain,
        action: record.action,
        entity: record.entity,
        actor: record.actor,
        requestId: record.requestId,
        ok: record.ok,
        evidenceIds: record.evidenceIds ?? [],
      },
    });

    return record;
  }

  history(): CkdlActivityRecord[] {
    return [...this.records];
  }

  byDomain(domain: CkdlDomain): CkdlActivityRecord[] {
    return this.records.filter((r) => r.domain === domain);
  }

  byEntity(entity: string): CkdlActivityRecord[] {
    return this.records.filter((r) => r.entity === entity);
  }
}
