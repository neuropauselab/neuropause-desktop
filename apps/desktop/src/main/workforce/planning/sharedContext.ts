/**
 * Shared context conflict resolution (V7.0, pure). When multiple agents write to
 * the same org-scoped shared context (goals, plans, intermediate reasoning, task
 * outputs), concurrent writes to the same key must resolve deterministically so
 * every agent converges — the same problem resolveMemorySync solves for memory,
 * scoped to agent collaboration. Pure and side-effect-free: persistence and the
 * actual shared workspace live in the runtime; this decides the winner.
 */

export interface ContextEntry<T = unknown> {
  key: string;
  value: T;
  /** The agent that wrote this value. */
  agentId: string;
  /** Monotonic per-key version; higher is newer. */
  version: number;
  updatedAt: string;
}

/**
 * Resolve two versions of the same context key deterministically: higher version
 * wins; ties break by newer `updatedAt`; further ties by `agentId`. Order-
 * independent — resolve(a, b) and resolve(b, a) pick the same entry.
 */
export function resolveContextEntry<T>(a: ContextEntry<T>, b: ContextEntry<T>): ContextEntry<T> {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return a.agentId >= b.agentId ? a : b;
}

/**
 * Merge an incoming agent's context into the local view, resolving per-key
 * conflicts with resolveContextEntry. Returns a new map; inputs are not mutated.
 * Deterministic and idempotent (merging the same incoming twice is a no-op).
 */
export function mergeSharedContext<T>(
  local: ReadonlyMap<string, ContextEntry<T>>,
  incoming: ReadonlyMap<string, ContextEntry<T>>,
): Map<string, ContextEntry<T>> {
  const merged = new Map(local);
  for (const [key, entry] of incoming) {
    const existing = merged.get(key);
    merged.set(key, existing ? resolveContextEntry(existing, entry) : entry);
  }
  return merged;
}
