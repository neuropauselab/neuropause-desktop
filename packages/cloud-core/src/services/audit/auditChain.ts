/**
 * Audit Federation (NCEA 10.2) — REAL, deterministic.
 *
 * A hash-linked audit log (Principles 7 & 8: observable + verifiable). Each
 * entry's `auditId` is DERIVED from its content plus the previous id, so:
 *   - ids are deterministic and content-addressed (not random);
 *   - tampering with any field changes the recomputed id -> verification fails;
 *   - the chain links across devices (each entry carries its deviceId), giving
 *     distributed provenance without moving the audited DATA (only a dataHash
 *     travels — "audit references, not contents").
 */
import type { AuditId, AuditRef } from '@neuropause/shared-cloud';
import { contentId } from '../../lib/ids';

export interface AuditInput {
  actor: string;
  action: string;
  target: string;
  deviceId: string;
  at: number;
  /** hash of the audited payload; the payload itself stays at its source. */
  dataHash: string;
}

export interface AuditEntry extends AuditInput {
  auditId: AuditId;
  prevId: AuditId | null;
}

export function deriveAuditId(prevId: AuditId | null, input: AuditInput): AuditId {
  return contentId(
    'aud',
    prevId ?? 'ROOT',
    input.actor,
    input.action,
    input.target,
    input.deviceId,
    input.at,
    input.dataHash,
  ) as AuditId;
}

export interface VerifyResult {
  valid: boolean;
  brokenAt: number | null;
  reason?: string;
}

/** Recompute every id and check linkage; detects tampering and broken links. */
export function verifyChain(entries: AuditEntry[]): VerifyResult {
  let prev: AuditId | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevId !== prev) return { valid: false, brokenAt: i, reason: 'broken link' };
    const expected = deriveAuditId(prev, e);
    if (expected !== e.auditId) return { valid: false, brokenAt: i, reason: 'hash mismatch (tampered)' };
    prev = e.auditId;
  }
  return { valid: true, brokenAt: null };
}

export class AuditChain {
  private readonly entries: AuditEntry[] = [];
  private head: AuditId | null = null;

  append(input: AuditInput): AuditEntry {
    const auditId = deriveAuditId(this.head, input);
    const entry: AuditEntry = { ...input, auditId, prevId: this.head };
    this.entries.push(entry);
    this.head = auditId;
    return entry;
  }

  list(): AuditEntry[] {
    return [...this.entries];
  }

  verify(): VerifyResult {
    return verifyChain(this.entries);
  }

  /** Lineage of ids from root to head — the distributed provenance. */
  provenance(): AuditId[] {
    return this.entries.map((e) => e.auditId);
  }

  toRefs(): AuditRef[] {
    return this.entries.map((e) => ({ auditId: e.auditId, prevId: e.prevId, hash: e.dataHash }));
  }
}
