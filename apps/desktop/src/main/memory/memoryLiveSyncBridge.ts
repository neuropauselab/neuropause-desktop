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
import { memorySyncOrgOf } from '@neuropause/shared';
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

/**
 * The org a memory state may be enqueued under, or null if it may not be.
 *
 * P13A — the replacement for `identity.organizationId` at the enqueue call.
 * Derived from the memory's OWN owner, and cross-checked against the `orgId`
 * already on the state, because the two are written by different code paths and
 * a disagreement between them means one of the two is wrong. Refusing on
 * disagreement costs a memory that would not have synced anyway and closes the
 * case where only one of the pair was tampered with.
 */
export function outboundSyncOrg(state: MemoryState): string | null {
  const owned = memorySyncOrgOf(state.owner);
  if (owned === null) return null; // unowned, personal, or system — never leaves
  return owned === state.orgId ? owned : null;
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
  /**
   * P13A — the envelope and its payload must agree about the org.
   *
   * `change.orgId` is what the transport routed on; `remote.orgId` is inside
   * the opaque `data` the transport never interprets. A sender that sets one
   * and not the other is describing two different memories, and the mismatch is
   * the cheapest possible signal of a payload built to be routed as one
   * tenant's and stored as another's. Checked HERE, before the store, because
   * the store only ever sees the payload half.
   *
   * The store then performs the real authorization — owner well-formedness,
   * tenant match, workspace match, and existing-memory ownership. This check
   * does not replace it and is not sufficient on its own.
   */
  if (change.orgId !== remote.orgId) return 'ignored';
  const result = memoryStore.applyMerged(remote);
  /**
   * A REFUSED change is `ignored`, and it is checked BEFORE the guard.
   *
   * Both halves matter. Reporting a refusal as `applied` would tell the sync
   * engine's conflict tally that a rejected injection had landed — the outcome
   * would be indistinguishable from success in every count and health signal
   * downstream. And marking it in the loop guard would burn an echo suppression
   * on a version this device never adopted, so a later legitimate change
   * carrying that same version id would be silently dropped instead of pushed.
   */
  if (result.refused) return 'ignored';
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
 * syncable signal changed since last push. The guard suppresses echoes of
 * just-applied fast-forwards. Returns a disposer that removes the listener.
 *
 * P13A — THE HIGHEST-SEVERITY FIX IN THIS PROGRAM LIVES IN `flush`.
 *
 * This loop used to read every synced memory in the store and enqueue each one
 * under `identity.organizationId` — the organization that happened to be active
 * on this device at that moment. Nothing tied a memory to the org it was
 * enqueued under. A user who belonged to two tenants and switched between them
 * uploaded the first tenant's memories into the second tenant's cloud
 * namespace, on a 400 ms debounce, as a background side effect of switching.
 * That is cross-tenant EGRESS: the data left the machine, so no later read-side
 * filter could contain it.
 *
 * Two independent corrections, neither of which relies on the other:
 *
 *   1. `syncedItems()` is now tenant-scoped, so the loop cannot even see
 *      another tenant's memories.
 *   2. Each memory is enqueued under `outboundSyncOrg(state)` — ITS OWN org,
 *      taken from its stamped owner — so even if a foreign memory somehow
 *      reached this loop it would be enqueued correctly or not at all.
 *
 * `runtimeIdentity` is still consulted, but ONLY as a readiness gate: nothing
 * leaves before identity resolves. It no longer decides any memory's
 * destination, which is the whole point.
 */
export function startMemoryEnqueue(deps: MemoryEnqueueDeps): () => void {
  const { memoryStore, liveSync, guard } = deps;
  const debounceMs = deps.debounceMs ?? 400;
  const lastEnqueued = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    // Readiness only. Pre-login memory never leaves; the identity's org is
    // deliberately NOT read below.
    if (!runtimeIdentity.getCurrent()) return;
    for (const item of memoryStore.syncedItems()) {
      const state = toSyncState(item);
      if (!state) continue;
      const destination = outboundSyncOrg(state);
      // No owner, a personal owner, or an owner that disagrees with the state's
      // own org: this memory has no destination it may travel to. Skipped
      // silently — it is not an error for a personal memory to stay put.
      if (destination === null) continue;
      const signal = memorySyncSignal(state);
      // Loop guard: a just-applied fast-forward is recorded, not re-pushed.
      if (guard.consumeEcho(state.head.versionId)) {
        lastEnqueued.set(item.id, signal);
        continue;
      }
      if (lastEnqueued.get(item.id) === signal) continue; // unchanged since last push
      void liveSync.enqueue(destination, memoryStateToSyncChange(state));
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
