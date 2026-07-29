/**
 * Audit integration (Wave 1, Module 7). Every NEMS mutation appends to the ONE
 * runtime audit chain — hash-only per "audit references, not contents" — carrying
 * user, organization, entity, operation, before/after (hashed), timestamp,
 * session, correlation id, and replay id. There is no second audit log; NEMS
 * reuses `runtime.audit()`.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { MutationContext } from './types';

export interface AuditInput {
  ctx: MutationContext;
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete' | 'login' | 'logout';
  before?: unknown;
  after?: unknown;
}

export interface AuditRef {
  auditId: string;
  replayId: string;
  at: number;
}

export class NemsAudit {
  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {}

  record(input: AuditInput): AuditRef {
    const at = this.clock.now();
    const replayId = randomId('replay');
    const payload = {
      entity: input.entity,
      entityId: input.entityId,
      operation: input.operation,
      tenantId: input.ctx.tenantId,
      actorId: input.ctx.actorId,
      sessionId: input.ctx.sessionId ?? null,
      correlationId: input.ctx.correlationId ?? null,
      replayId,
      before: input.before ?? null,
      after: input.after ?? null,
    };
    const dataHash = sha256Hex(JSON.stringify(payload));
    const entry = this.runtime.audit().append({
      actor: input.ctx.actorId,
      action: `nems.${input.entity}.${input.operation}`,
      target: `${input.ctx.tenantId}:${input.entityId}`,
      deviceId: input.ctx.deviceId ?? 'nems',
      at,
      dataHash,
    });
    return { auditId: (entry as { auditId: string }).auditId, replayId, at };
  }

  /** Verify the whole chain (delegates to the one runtime chain). */
  verify(): { valid: boolean } {
    return { valid: this.runtime.audit().verify().valid };
  }
}
