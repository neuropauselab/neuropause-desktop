/**
 * Workspace governance (NCEA 10.5). ONE recorder through which every workspace
 * action — organization change, membership grant, AI-employee assignment, task
 * transition, knowledge edit, collaboration event, impersonation — is recorded
 * on the SINGLE Enterprise Runtime audit chain + event bus (+ timeline). The
 * audit entry is hash-only: no payloads, no secrets. This is the "every action
 * is observable / every AI action is auditable / every workflow is replayable"
 * guarantee, applied to the enterprise operating model. Nothing bypasses it.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';

export type WorkspaceDomain =
  | 'organization'
  | 'workspace'
  | 'project'
  | 'identity'
  | 'workforce'
  | 'task'
  | 'inbox'
  | 'knowledge'
  | 'collaboration';

export type WorkspaceApproval = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface WorkspaceActivityRecord {
  domain: WorkspaceDomain;
  action: string;
  entity: string;
  actor: string;
  org?: string;
  workspace?: string;
  requestId: string;
  at: number;
  approval: WorkspaceApproval;
  ok: boolean;
  cost?: { usd: number };
  detail?: string;
  meta?: Record<string, unknown>;
  /** Principal ids this activity should surface to (assignee, mentions, approver).
   *  Bus-routing only — deliberately NOT part of the hash-only audit payload. */
  notify?: string[];
}

export type WorkspaceGovernanceInput = Omit<WorkspaceActivityRecord, 'at' | 'requestId'>;

/** The workspace activity event published on the shared bus (topic: workspace). */
export const WORKSPACE_ACTIVITY_EVENT = 'workspace.activity';

export class WorkspaceGovernance {
  private readonly records: WorkspaceActivityRecord[] = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  async record(input: WorkspaceGovernanceInput): Promise<WorkspaceActivityRecord> {
    const record: WorkspaceActivityRecord = { ...input, requestId: randomId('wsr'), at: this.clock.now() };
    this.records.push(record);

    this.runtime.audit().append({
      actor: record.actor,
      action: `workspace.${record.domain}.${record.action}.${record.ok ? 'ok' : 'error'}`,
      target: record.entity,
      deviceId: 'workspace-platform',
      at: record.at,
      // Hash-only: the audit chain proves WHAT happened without storing the payload.
      dataHash: sha256Hex(
        JSON.stringify({
          requestId: record.requestId,
          domain: record.domain,
          action: record.action,
          entity: record.entity,
          org: record.org,
          workspace: record.workspace,
          approval: record.approval,
          cost: record.cost,
          meta: record.meta,
        }),
      ),
    });

    await this.runtime.events().publish({
      type: WORKSPACE_ACTIVITY_EVENT,
      topic: 'workspace',
      partitionKey: record.workspace ?? record.org ?? record.actor,
      version: 1,
      payload: {
        domain: record.domain,
        action: record.action,
        entity: record.entity,
        actor: record.actor,
        org: record.org,
        workspace: record.workspace,
        requestId: record.requestId,
        approval: record.approval,
        ok: record.ok,
        cost: record.cost,
        notify: record.notify ?? [],
      },
    });

    return record;
  }

  history(): WorkspaceActivityRecord[] {
    return [...this.records];
  }

  /** Records for a domain — used by the executive dashboard's read-only projections. */
  byDomain(domain: WorkspaceDomain): WorkspaceActivityRecord[] {
    return this.records.filter((r) => r.domain === domain);
  }

  byEntity(entity: string): WorkspaceActivityRecord[] {
    return this.records.filter((r) => r.entity === entity);
  }
}
