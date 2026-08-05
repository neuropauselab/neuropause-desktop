/**
 * Module 9 — Enterprise Memory. Each worker maintains long-term, session, organization, team, and
 * workspace-context memory. In-process — live-verified; starts empty. Organization/team memory is
 * shared by owner id (org/team), so agents on a team share context.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import { MEMORY_SCOPES, type MemoryScope } from './constants';

export interface MemoryEntry {
  ownerId: string;
  scope: MemoryScope;
  key: string;
  value: unknown;
  at: number;
}

export class AgentMemory {
  private readonly store = new Map<string, MemoryEntry>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
  ) {}

  private k(ownerId: string, scope: MemoryScope, key: string): string {
    return `${scope}::${ownerId}::${key}`;
  }

  async remember(input: { ownerId: string; scope: MemoryScope; key: string; value: unknown }): Promise<MemoryEntry> {
    if (!MEMORY_SCOPES.includes(input.scope)) throw new Error(`unknown memory scope: ${input.scope}`);
    const entry: MemoryEntry = { ownerId: input.ownerId, scope: input.scope, key: input.key, value: input.value, at: this.clock.now() };
    this.store.set(this.k(input.ownerId, input.scope, input.key), entry);
    await this.governance.record({ user: 'system', org: input.ownerId, worker: 'memory', operation: `memory.remember.${input.scope}`, targetId: input.key, evidence: 'live-verified' });
    return entry;
  }

  recall(ownerId: string, scope: MemoryScope, key: string): unknown {
    return this.store.get(this.k(ownerId, scope, key))?.value;
  }
  recallAll(ownerId: string, scope: MemoryScope): MemoryEntry[] {
    return [...this.store.values()].filter((e) => e.ownerId === ownerId && e.scope === scope);
  }
  count(): number {
    return this.store.size;
  }
}
