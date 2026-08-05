/**
 * Memory (NCEA 10.3, Phase 7). Session memory, bounded short-term memory, and a
 * PROVIDER-AGNOSTIC long-term memory interface. The in-memory long-term store is
 * a stub for tests; a real implementation (e.g. the backend semantic memory)
 * satisfies the same `LongTermMemory` interface without changing callers.
 */
import type { Clock } from '@neuropause/cloud-core';

export interface MemoryEntry {
  key: string;
  value: unknown;
  at: number;
}

export interface LongTermMemory {
  put(scope: string, key: string, value: unknown): Promise<void>;
  get(scope: string, key: string): Promise<unknown>;
  query(scope: string): Promise<MemoryEntry[]>;
}

export class InMemoryLongTermMemory implements LongTermMemory {
  private readonly store = new Map<string, Map<string, MemoryEntry>>();
  constructor(private readonly clock: Clock) {}
  async put(scope: string, key: string, value: unknown): Promise<void> {
    const scoped = this.store.get(scope) ?? new Map<string, MemoryEntry>();
    scoped.set(key, { key, value, at: this.clock.now() });
    this.store.set(scope, scoped);
  }
  async get(scope: string, key: string): Promise<unknown> {
    return this.store.get(scope)?.get(key)?.value;
  }
  async query(scope: string): Promise<MemoryEntry[]> {
    return [...(this.store.get(scope)?.values() ?? [])];
  }
}

export class SessionMemory {
  private readonly map = new Map<string, unknown>();
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
  get(key: string): unknown {
    return this.map.get(key);
  }
  entries(): Array<{ key: string; value: unknown }> {
    return [...this.map.entries()].map(([key, value]) => ({ key, value }));
  }
}

export class ShortTermMemory {
  private readonly items: unknown[] = [];
  constructor(private readonly limit = 20) {}
  add(item: unknown): void {
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();
  }
  recent(): unknown[] {
    return [...this.items];
  }
}

export class MemoryManager {
  private readonly sessions = new Map<string, SessionMemory>();
  readonly shortTerm = new ShortTermMemory();

  constructor(readonly longTerm: LongTermMemory) {}

  session(sessionId: string): SessionMemory {
    const memory = this.sessions.get(sessionId) ?? new SessionMemory();
    this.sessions.set(sessionId, memory);
    return memory;
  }
}
