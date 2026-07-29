/**
 * Operations → audit bridge (NCEA 15.0). Every operational event (deployment,
 * incident, DR drill, operational-security signal) records to the ONE runtime
 * audit chain — hash-only, per "audit references, not contents". This is the sole
 * append helper the operations modules use; there is no second audit log.
 */
import { sha256Hex, type Clock } from '@neuropause/cloud-core';

/** Structural subset of the runtime AuditChain — `runtime.audit()` satisfies it. */
export interface AuditSink {
  append(input: { actor: string; action: string; target: string; deviceId: string; at: number; dataHash: string }): unknown;
}

export function recordOp(
  sink: AuditSink | undefined,
  clock: Clock,
  input: { action: string; actor?: string; target: string; payload: Record<string, unknown> },
): void {
  sink?.append({
    actor: input.actor ?? 'operations',
    action: input.action,
    target: input.target,
    deviceId: 'operations',
    at: clock.now(),
    dataHash: sha256Hex(JSON.stringify(input.payload)),
  });
}
