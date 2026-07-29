/**
 * Sync engine (NCEA 10.2) — REAL, in-memory.
 *
 * Accepts sync envelopes (validated by syncSchema — secrets rejected), and
 * converges state across a user's devices using version vectors. When two
 * updates are concurrent it resolves last-write-wins by `updatedAt` (deviceId
 * tiebreak) and merges the vectors so future comparisons are causal.
 *
 * Persistence is an in-memory Map behind a small interface; a durable, encrypted
 * store is the production follow-up (STATUS.md). No secret ever enters here —
 * the schema guarantees it.
 */
import type { SyncableStateKind } from '@neuropause/shared-cloud';
import { type Result, ok, err } from '../../lib/result';
import { syncEnvelopeSchema, type SyncEnvelope } from './syncSchema';
import { vvCompare, vvMerge } from './versionVector';

export type SyncRecord = SyncEnvelope;

export interface PushResult {
  accepted: boolean;
  conflictResolved: boolean;
  record: SyncRecord;
  reason?: string;
}

export interface PushError {
  code: 'invalid' | 'secret_rejected';
  message: string;
  issues: string[];
}

export interface SyncStore {
  get(key: string): SyncRecord | undefined;
  set(key: string, record: SyncRecord): void;
  values(): SyncRecord[];
}

export class InMemorySyncStore implements SyncStore {
  private readonly map = new Map<string, SyncRecord>();
  get(key: string): SyncRecord | undefined {
    return this.map.get(key);
  }
  set(key: string, record: SyncRecord): void {
    this.map.set(key, record);
  }
  values(): SyncRecord[] {
    return [...this.map.values()];
  }
}

const keyOf = (kind: SyncableStateKind, entityId: string): string => `${kind}:${entityId}`;

export class SyncEngine {
  constructor(private readonly store: SyncStore = new InMemorySyncStore()) {}

  /** Validate + converge a single envelope. */
  push(input: unknown): Result<PushResult, PushError> {
    const parsed = syncEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message);
      const isSecret = issues.some((m) => m.includes('may not be synchronized'));
      return err({
        code: isSecret ? 'secret_rejected' : 'invalid',
        message: isSecret ? 'sync payload contained a secret-like field' : 'invalid sync envelope',
        issues,
      });
    }
    const incoming = parsed.data;
    const key = keyOf(incoming.kind, incoming.entityId);
    const existing = this.store.get(key);

    if (!existing) {
      this.store.set(key, incoming);
      return ok({ accepted: true, conflictResolved: false, record: incoming });
    }

    const order = vvCompare(incoming.vv, existing.vv);
    if (order === 'dominates') {
      const merged: SyncRecord = { ...incoming, vv: vvMerge(incoming.vv, existing.vv) };
      this.store.set(key, merged);
      return ok({ accepted: true, conflictResolved: false, record: merged });
    }
    if (order === 'equal' || order === 'dominated') {
      return ok({ accepted: false, conflictResolved: false, record: existing, reason: 'stale' });
    }
    // concurrent — resolve LWW by updatedAt, then deviceId; keep a merged vector.
    const winner =
      incoming.updatedAt > existing.updatedAt ||
      (incoming.updatedAt === existing.updatedAt && incoming.deviceId > existing.deviceId)
        ? incoming
        : existing;
    const resolved: SyncRecord = { ...winner, vv: vvMerge(incoming.vv, existing.vv) };
    this.store.set(key, resolved);
    return ok({ accepted: true, conflictResolved: true, record: resolved });
  }

  /** Everything updated at or after `since` (for a device catching up). */
  pull(since: number): SyncRecord[] {
    return this.store.values().filter((r) => r.updatedAt >= since);
  }

  get(kind: SyncableStateKind, entityId: string): SyncRecord | undefined {
    return this.store.get(keyOf(kind, entityId));
  }
}
