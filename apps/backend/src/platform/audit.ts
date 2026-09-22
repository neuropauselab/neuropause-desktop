/**
 * Audit provenance bridge (NCEA 10.2B, Principles 7-8).
 *
 * Backend operations CAN record tamper-evident provenance on the shared cloud-core
 * AuditChain — one audit model across the platform, not a backend-specific one.
 *
 * TENSE CORRECTED IN NP-PILOT-FIRST-005, because the present tense was measurably false:
 * `createAuditRecorder` has exactly ONE call site in apps/backend/src and it is
 * platform.test.ts:51. No backend operation calls it, and no pilot code imports it, so no
 * production record has ever been written to this chain. The chain itself is real and its
 * verify() works; what did not exist is a caller. A capability described in the present tense
 * reads as a delivered control, and a reviewer auditing the pilot's evidence would have
 * counted this as one.
 * Only a HASH of the payload is stored ("audit references, not contents"), so no
 * secret or personal content enters the chain.
 */
import { AuditChain, sha256Hex, type AuditEntry, type VerifyResult } from '@neuropause/cloud-core';
import type { AuditRef } from '@neuropause/shared-cloud';

export interface BackendAuditInput {
  actor: string;
  action: string;
  target: string;
  at: number;
  deviceId?: string;
  data?: unknown;
}

export interface AuditRecorder {
  record(input: BackendAuditInput): AuditEntry;
  verify(): VerifyResult;
  refs(): AuditRef[];
}

export function createAuditRecorder(): AuditRecorder {
  const chain = new AuditChain();
  return {
    record(input: BackendAuditInput): AuditEntry {
      return chain.append({
        actor: input.actor,
        action: input.action,
        target: input.target,
        deviceId: input.deviceId ?? 'backend',
        at: input.at,
        dataHash: sha256Hex(JSON.stringify(input.data ?? {})),
      });
    },
    verify: (): VerifyResult => chain.verify(),
    refs: (): AuditRef[] => chain.toRefs(),
  };
}
