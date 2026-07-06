/**
 * Memory ⇄ LiveSync bridge (V6.6.4) — the glue between the local MemoryStore and
 * the existing LiveSync transport, kept OUTSIDE MemoryStore so the store stays a
 * pure persistence layer. This file holds the PURE pieces (serialization + the loop
 * guard); the event wiring (the 'changed' listener, the entityAppliers dispatch)
 * lives in liveSyncInstance where memoryStore + liveSync are both in scope.
 *
 * Serialization carries the full MemorySyncState as the sync record's opaque `data`
 * — the backend never interprets it; each device reconstructs and merges via
 * resolveMemorySync. `version` is the history length: monotonic per memory, so the
 * transport's version compare advances correctly on every append.
 *
 * The loop guard is the subtle part. LiveSync's transport is one-row-per-entity with
 * last-write-wins on push, but memory's merge is append-only and preserves both
 * sides. Convergence of a genuine concurrent edit therefore requires a SECOND round:
 * the device that pulls the "losing" side merges it and must RE-ENQUEUE the merged
 * result (higher version) for the other device to fast-forward to. So the guard must
 * suppress the echo of a pure fast-forward/identical apply (no need to push back
 * what we just received) while ALLOWING a conflict-merge result to re-enqueue — or
 * concurrent edits silently fail to converge across devices. That convergence-by-
 * re-push is exactly what only the two-device test can prove.
 */
import type { MemoryState, MemorySyncResult, MergeOutcome, SyncChange } from '@neuropause/shared';
import type { MemoryStore } from './memoryStore';
import { toSyncState } from './memorySyncAdapter';
import { runtimeIdentity } from '../runtimeIdentity';

/** Serialize a memory's sync state into a LiveSync change (opaque payload). */
export function memoryStateToSyncChange(state: MemoryState): SyncChange {
  return {
    entityType: 'memory',
    entityId: state.memoryId,
    orgId: state.orgId,
    version: state.history.length,
    updatedAt: state.head.timestamp,
    deleted: state.head.deleted,
    data: state,
  };
}

/** Deserialize a pulled LiveSync change back into a memory state; null if not a
 *  well-formed memory payload. */
export function syncChangeToMemoryState(change: SyncChange): MemoryState | null {
  if (change.entityType !== 'memory' || !change.data) return null;
  const state = change.data as MemoryState;
  if (
    typeof state.memoryId !== 'string' ||
    typeof state.orgId !== 'string' ||
    !state.head ||
    typeof state.head.versionId !== 'string' ||
    !Array.isArray(state.history)
  ) {
    return null;
  }
  return state;
}

/** A stable per-memory signal that changes whenever the syncable state changes —
 *  head version OR history length. Used for dirty-detection so an unchanged memory
 *  is never re-enqueued (and a history-only growth on a conflict merge still is). */
export function memorySyncSignal(state: MemoryState): string {
  return `${state.head.versionId}:${state.history.length}`;
}

/**
 * Loop guard. After applying a remote result the bridge calls `noteApplied`; before
 * enqueuing, the outgoing listener calls `consumeEcho` on the item's head version.
 *
 * Only pure fast-forward/identical applies are marked (their echo is pointless). A
 * conflict merge is deliberately NOT marked, so the merged result re-enqueues and
 * the peer converges. `consumeEcho` is one-shot: it clears the mark so a later
 * genuine local edit to the same head still enqueues.
 */
export interface MemorySyncGuard {
  noteApplied(result: MemorySyncResult): void;
  consumeEcho(versionId: string): boolean;
  /** For tests/diagnostics: how many marks are outstanding. */
  size(): number;
}

export function createMemorySyncGuard(): MemorySyncGuard {
  const applied = new Set<string>();
  return {
    noteApplied(result: MemorySyncResult): void {
      if (result.mergeType === 'fast_forward' || result.mergeType === 'identical') {
        applied.add(result.winner.versionId);
      }
    },
    consumeEcho(versionId: string): boolean {
      if (applied.has(versionId)) {
        applied.delete(versionId);
        return true;
      }
      return false;
    },
    size(): number {
      return applied.size;
    },
  };
}

// ── Wiring (composed in liveSyncInstance; deps injected to avoid import cycles) ──

/**
 * Incoming: apply a pulled memory change into the local store via the tested
 * resolveMemorySync (never the LWW mirror). Marks fast-forward/identical results in
 * the guard so the outgoing listener won't echo them; a conflict merge is left
 * unmarked so it re-enqueues and the peer converges. Returns a MergeOutcome for the
 * sync engine's conflict tally. Embeddings: applyMerged already re-indexes the
 * retriever via mutated(); result.requiredEmbeddings is where a Qdrant re-embed job
 * would be enqueued (that pipeline swap is a later increment).
 */
export async function applyMemoryChange(
  memoryStore: MemoryStore,
  guard: MemorySyncGuard,
  change: SyncChange,
): Promise<MergeOutcome> {
  const remote = syncChangeToMemoryState(change);
  if (!remote) return 'ignored';
  const result = memoryStore.applyMerged(remote);
  guard.noteApplied(result);
  return result.conflict ? 'conflict' : 'applied';
}

export interface MemoryEnqueueDeps {
  memoryStore: MemoryStore;
  liveSync: { enqueue: (orgId: string, change: SyncChange) => Promise<void> };
  guard: MemorySyncGuard;
  debounceMs?: number;
}

/**
 * Outgoing: on memoryStore 'changed' (debounced), enqueue org-scoped memories whose
 * syncable signal changed since last push. Org id comes from runtimeIdentity — if
 * identity isn't ready, nothing is enqueued (personal/pre-login memory never
 * leaves). The guard suppresses echoes of just-applied fast-forwards. Returns a
 * disposer that removes the listener.
 */
export function startMemoryEnqueue(deps: MemoryEnqueueDeps): () => void {
  const { memoryStore, liveSync, guard } = deps;
  const debounceMs = deps.debounceMs ?? 400;
  const lastEnqueued = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    const identity = runtimeIdentity.getCurrent();
    if (!identity) return;
    for (const item of memoryStore.syncedItems()) {
      const state = toSyncState(item);
      if (!state) continue;
      const signal = memorySyncSignal(state);
      // Loop guard: a just-applied fast-forward is recorded, not re-pushed.
      if (guard.consumeEcho(state.head.versionId)) {
        lastEnqueued.set(item.id, signal);
        continue;
      }
      if (lastEnqueued.get(item.id) === signal) continue; // unchanged since last push
      void liveSync.enqueue(identity.organizationId, memoryStateToSyncChange(state));
      lastEnqueued.set(item.id, signal);
    }
  };

  const onChanged = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  memoryStore.on('changed', onChanged);
  return (): void => {
    memoryStore.off('changed', onChanged);
    if (timer) clearTimeout(timer);
  };
}
