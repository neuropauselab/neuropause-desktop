/**
 * Memory Synchronization Core (V6.6.1) — the deterministic, append-only conflict
 * engine for shared AI Memory. PURE: no I/O, no DB, no networking, no embeddings.
 * It decides how a local and a remote view of one memory reconcile, and it NEVER
 * discards a user edit — every version is preserved in history.
 *
 * This mirrors the shapes and deterministic-tiebreak idea of `sync.ts`'s
 * `resolveSync`, but with the opposite conflict policy. `resolveSync` is
 * last-write-wins: on a true conflict it keeps one record and drops the other —
 * fine for small settings, catastrophic for memory (silent data loss). Here,
 * concurrent edits are BOTH kept: a deterministic head is chosen for the "current"
 * view, but the other edit remains in history and recoverable.
 *
 * Model: a memory is a chain of immutable `MemoryVersion`s linked by
 * `parentVersion` (with a `previousHash`/`contentHash` chain for integrity). A
 * `MemoryState` is a head version plus its history. Reconciliation is git-like:
 *   - same head            → identical (idempotent no-op)
 *   - one head descends     → fast-forward to the newer head (no conflict)
 *     from the other
 *   - neither descends      → concurrent conflict: keep both, deterministic head
 *   - delete vs edit        → keep the edit as head (data preserved), tombstone
 *     (concurrent)            retained in history and recoverable
 *   - both deleted          → converge on a tombstone
 *
 * The engine is deterministic (order-independent: resolve(A,B) and resolve(B,A)
 * yield the same head + history) and idempotent (re-resolving a merged state is a
 * no-op), which is what makes safe cloud integration possible later (V6.6.2).
 */

/** One immutable edit of a memory. Versions form a parent-linked, hash-chained log. */
export interface MemoryVersion {
  versionId: string;
  memoryId: string;
  orgId: string;
  /** Wall-clock time of this edit (ISO-8601). */
  timestamp: string;
  deviceId: string;
  userId: string;
  /** The version this edit was based on; null for the first version. */
  parentVersion: string | null;
  /** The parent version's contentHash (chain link); null for the first version. */
  previousHash: string | null;
  /** Hash of THIS version's content (text + metadata). */
  contentHash: string;
  text: string;
  metadata: Record<string, unknown> | null;
  /** Tombstone. A delete is a version, never a physical removal. */
  deleted: boolean;
}

/** A local or remote view of one memory: the current head plus its history. */
export interface MemoryState {
  memoryId: string;
  orgId: string;
  head: MemoryVersion;
  /** Prior versions. May or may not include `head`; the engine treats the union. */
  history: MemoryVersion[];
}

export type MemoryMergeType =
  'identical' | 'fast_forward' | 'concurrent' | 'delete_vs_edit' | 'both_deleted';

export type MemorySyncAction =
  | { type: 'apply_head'; versionId: string }
  | { type: 'append_history'; versionIds: string[] }
  | { type: 'push'; versionId: string }
  | { type: 'record_conflict'; versionIds: string[] };

export interface MemorySyncResult {
  memoryId: string;
  /** The resolved current head (the "current" view). Always one of the inputs. */
  winner: MemoryVersion;
  /** The full append-only log: every input version, deduped, deterministically ordered. */
  history: MemoryVersion[];
  /** True when edits genuinely diverged (concurrent edit, or delete vs edit). */
  conflict: boolean;
  mergeType: MemoryMergeType;
  /** Version ids new to the local side whose content must be (re)embedded locally. */
  requiredEmbeddings: string[];
  /** Side-effect-free description of what the caller should persist/push (V6.6.2). */
  syncActions: MemorySyncAction[];
}

// ── Content hashing (deterministic fingerprint; not a cryptographic guarantee) ──

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/** Deterministic content fingerprint of a memory's text + metadata (two-seed FNV-1a). */
export function hashMemoryContent(text: string, metadata: Record<string, unknown> | null): string {
  const s = canonical({ text, metadata: metadata ?? null });
  let h1 = 0x811c9dc5;
  let h2 = (0x811c9dc5 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

/**
 * Verify a history's integrity: every version's contentHash matches its content,
 * and every version's previousHash matches its parent's contentHash (where the
 * parent is present). A hash mismatch — tampering or corruption — returns false.
 * Missing parents are treated as unknown (not a failure), since history can be
 * partial before a full sync.
 */
export function verifyHistoryIntegrity(history: readonly MemoryVersion[]): boolean {
  const byId = new Map(history.map((v) => [v.versionId, v]));
  for (const v of history) {
    if (v.contentHash !== hashMemoryContent(v.text, v.metadata)) return false;
    if (v.parentVersion) {
      const parent = byId.get(v.parentVersion);
      if (parent && v.previousHash !== parent.contentHash) return false;
    }
  }
  return true;
}

// ── Versioning primitive ──

/**
 * Produce the next version of a memory from its current head (or null for the
 * first version) plus an edit. Pure and deterministic: it chains `parentVersion`
 * and `previousHash` to the parent and computes this version's `contentHash`, so
 * every write extends the append-only chain correctly. This is the primitive the
 * store's write paths (remember/update/forget) call to "version an edit" — it does
 * NOT persist, merge, or decide anything; it just builds a well-formed version.
 */
export function nextMemoryVersion(
  parent: MemoryVersion | null,
  change: {
    versionId: string;
    memoryId: string;
    orgId: string;
    timestamp: string;
    deviceId: string;
    userId: string;
    text: string;
    metadata: Record<string, unknown> | null;
    deleted?: boolean;
  },
): MemoryVersion {
  return {
    versionId: change.versionId,
    memoryId: change.memoryId,
    orgId: change.orgId,
    timestamp: change.timestamp,
    deviceId: change.deviceId,
    userId: change.userId,
    parentVersion: parent?.versionId ?? null,
    previousHash: parent?.contentHash ?? null,
    contentHash: hashMemoryContent(change.text, change.metadata),
    text: change.text,
    metadata: change.metadata,
    deleted: change.deleted ?? false,
  };
}

// ── Reconciliation ──

function allVersions(state: MemoryState): MemoryVersion[] {
  return [...state.history, state.head];
}

/** Union of all versions from both states, deduped by versionId. */
function versionMap(a: MemoryState, b: MemoryState): Map<string, MemoryVersion> {
  const map = new Map<string, MemoryVersion>();
  for (const v of [...allVersions(a), ...allVersions(b)]) {
    if (!map.has(v.versionId)) map.set(v.versionId, v);
  }
  return map;
}

/** The set of ancestor versionIds of `versionId`, walking parentVersion links. */
function ancestorsOf(versionId: string, map: Map<string, MemoryVersion>): Set<string> {
  const seen = new Set<string>();
  let cur = map.get(versionId)?.parentVersion ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    cur = map.get(cur)?.parentVersion ?? null;
  }
  return seen;
}

/** Deterministic head choice for genuine conflicts (mirrors sync.ts deterministicWinner). */
function deterministicHead(a: MemoryVersion, b: MemoryVersion): MemoryVersion {
  // Newer timestamp wins; exact ties converge by comparing serialized content, then
  // versionId — so every device selects the same head regardless of argument order.
  if (a.timestamp !== b.timestamp) return a.timestamp > b.timestamp ? a : b;
  const ca = canonical({ text: a.text, metadata: a.metadata, deleted: a.deleted });
  const cb = canonical({ text: b.text, metadata: b.metadata, deleted: b.deleted });
  if (ca !== cb) return ca > cb ? a : b;
  return a.versionId >= b.versionId ? a : b;
}

/** Full deduped history, ordered deterministically (timestamp, then versionId). */
function orderedHistory(map: Map<string, MemoryVersion>): MemoryVersion[] {
  return [...map.values()].sort((x, y) =>
    x.timestamp !== y.timestamp
      ? x.timestamp < y.timestamp
        ? -1
        : 1
      : x.versionId < y.versionId
        ? -1
        : x.versionId > y.versionId
          ? 1
          : 0,
  );
}

/**
 * Reconcile a local and a remote view of ONE memory. Pure and deterministic.
 * Never discards an edit: the losing side of any conflict is retained in history.
 */
export function resolveMemorySync(
  localMemory: MemoryState,
  remoteMemory: MemoryState,
): MemorySyncResult {
  const memoryId = localMemory.memoryId;
  const map = versionMap(localMemory, remoteMemory);
  const history = orderedHistory(map);
  const localIds = new Set(allVersions(localMemory).map((v) => v.versionId));

  const lh = localMemory.head;
  const rh = remoteMemory.head;

  let winner: MemoryVersion;
  let mergeType: MemoryMergeType;
  let conflict: boolean;

  if (lh.versionId === rh.versionId) {
    winner = lh;
    mergeType = 'identical';
    conflict = false;
  } else {
    const remoteAnc = ancestorsOf(rh.versionId, map);
    const localAnc = ancestorsOf(lh.versionId, map);
    if (remoteAnc.has(lh.versionId)) {
      // Remote descends from local → remote is strictly ahead. Fast-forward.
      winner = rh;
      mergeType = 'fast_forward';
      conflict = false;
    } else if (localAnc.has(rh.versionId)) {
      // Local descends from remote → local is strictly ahead. Fast-forward (local).
      winner = lh;
      mergeType = 'fast_forward';
      conflict = false;
    } else {
      // Divergent: both edited from a shared (or unknown) ancestor. Keep BOTH.
      if (lh.deleted && rh.deleted) {
        winner = deterministicHead(lh, rh);
        mergeType = 'both_deleted';
        conflict = false; // both sides agree the memory is deleted
      } else if (lh.deleted !== rh.deleted) {
        // Delete vs edit: prefer the EDIT as head so no content is lost; the
        // tombstone stays in history and can be re-applied/reviewed.
        winner = lh.deleted ? rh : lh;
        mergeType = 'delete_vs_edit';
        conflict = true;
      } else {
        winner = deterministicHead(lh, rh);
        mergeType = 'concurrent';
        conflict = true;
      }
    }
  }

  // Local must (re)embed the winning content only if it's new to this device.
  const requiredEmbeddings =
    winner.versionId !== lh.versionId && !localIds.has(winner.versionId) ? [winner.versionId] : [];

  const syncActions: MemorySyncAction[] = [];
  if (winner.versionId !== lh.versionId) {
    syncActions.push({ type: 'apply_head', versionId: winner.versionId });
  }
  const newToLocal = history.filter((v) => !localIds.has(v.versionId)).map((v) => v.versionId);
  if (newToLocal.length > 0) {
    syncActions.push({ type: 'append_history', versionIds: newToLocal });
  }
  // If the local head is the winner but remote hadn't seen it, tell the caller to push.
  if (
    winner.versionId === lh.versionId &&
    lh.versionId !== rh.versionId &&
    mergeType !== 'identical'
  ) {
    syncActions.push({ type: 'push', versionId: lh.versionId });
  }
  if (conflict) {
    syncActions.push({ type: 'record_conflict', versionIds: [lh.versionId, rh.versionId] });
  }

  return { memoryId, winner, history, conflict, mergeType, requiredEmbeddings, syncActions };
}
