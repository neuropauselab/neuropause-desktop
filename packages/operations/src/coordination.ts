/**
 * Service Coordination (NCEA 15.0, Phase 3). Service discovery, deterministic
 * dependency ordering (topological, cycle-detecting), and the coordination
 * INTERFACES a distributed deployment needs — leader election, distributed locks,
 * heartbeats, and cluster membership. The in-memory implementations here are real
 * and VERIFIED for a single node; they define the exact contract a production
 * backend (etcd / Consul / ZooKeeper / Kubernetes) implements. No multi-node
 * clustering is claimed — real distributed coordination is INFRA-PENDING.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';

// ── service discovery ──
export interface ServiceEndpoint {
  name: string;
  address?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export class ServiceDiscovery {
  private readonly services = new Map<string, ServiceEndpoint>();
  register(ep: ServiceEndpoint): void {
    this.services.set(ep.name, ep);
  }
  deregister(name: string): void {
    this.services.delete(name);
  }
  resolve(name: string): ServiceEndpoint | undefined {
    return this.services.get(name);
  }
  list(): ServiceEndpoint[] {
    return [...this.services.values()];
  }
  byTag(tag: string): ServiceEndpoint[] {
    return this.list().filter((s) => s.tags?.includes(tag));
  }
}

// ── dependency ordering ──
export interface OrderedNode {
  name: string;
  dependsOn?: string[];
}
export class DependencyCycleError extends Error {
  constructor(at: string) {
    super(`dependency cycle detected at '${at}'`);
    this.name = 'DependencyCycleError';
  }
}
/** Dependencies-first topological order (a node appears after everything it depends on). */
export function orderByDependencies(nodes: OrderedNode[]): string[] {
  const deps = new Map(nodes.map((n) => [n.name, n.dependsOn ?? []]));
  const result: string[] = [];
  const done = new Set<string>();
  const stack = new Set<string>();
  const visit = (name: string): void => {
    if (done.has(name)) return;
    if (stack.has(name)) throw new DependencyCycleError(name);
    stack.add(name);
    for (const d of deps.get(name) ?? []) if (deps.has(d)) visit(d);
    stack.delete(name);
    done.add(name);
    result.push(name);
  };
  for (const n of nodes) visit(n.name);
  return result;
}

// ── leader election (interface + single-node lease) ──
export interface LeaderElection {
  campaign(candidateId: string): Promise<boolean>;
  isLeader(candidateId: string): boolean;
  leader(): string | undefined;
  renew(candidateId: string): boolean;
  resign(candidateId: string): void;
}

export class InMemoryLeaderElection implements LeaderElection {
  private current: string | undefined;
  private leaseExpiry = 0;
  constructor(
    private readonly clock: Clock = systemClock,
    private readonly leaseMs = 10_000,
  ) {}
  async campaign(candidateId: string): Promise<boolean> {
    const now = this.clock.now();
    if (this.current === undefined || now >= this.leaseExpiry || this.current === candidateId) {
      this.current = candidateId;
      this.leaseExpiry = now + this.leaseMs;
      return true;
    }
    return false;
  }
  isLeader(candidateId: string): boolean {
    return this.current === candidateId && this.clock.now() < this.leaseExpiry;
  }
  leader(): string | undefined {
    return this.current !== undefined && this.clock.now() < this.leaseExpiry ? this.current : undefined;
  }
  renew(candidateId: string): boolean {
    if (this.isLeader(candidateId)) {
      this.leaseExpiry = this.clock.now() + this.leaseMs;
      return true;
    }
    return false;
  }
  resign(candidateId: string): void {
    if (this.current === candidateId) {
      this.current = undefined;
      this.leaseExpiry = 0;
    }
  }
}

// ── distributed lock (interface + single-process TTL lock) ──
export interface LockHolder {
  owner: string;
  expiresAt: number;
}
export interface DistributedLock {
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): boolean;
  held(key: string): LockHolder | undefined;
}

export class InMemoryLock implements DistributedLock {
  private readonly locks = new Map<string, LockHolder>();
  constructor(private readonly clock: Clock = systemClock) {}
  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = this.clock.now();
    const cur = this.locks.get(key);
    if (!cur || now >= cur.expiresAt || cur.owner === owner) {
      this.locks.set(key, { owner, expiresAt: now + ttlMs });
      return true;
    }
    return false;
  }
  release(key: string, owner: string): boolean {
    const cur = this.locks.get(key);
    if (cur && cur.owner === owner) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }
  held(key: string): LockHolder | undefined {
    const cur = this.locks.get(key);
    return cur && this.clock.now() < cur.expiresAt ? { ...cur } : undefined;
  }
}

// ── heartbeat framework ──
export class HeartbeatMonitor {
  private readonly beats = new Map<string, number>();
  constructor(
    private readonly clock: Clock = systemClock,
    private readonly ttlMs = 15_000,
  ) {}
  register(id: string): void {
    this.beats.set(id, this.clock.now());
  }
  beat(id: string): void {
    this.beats.set(id, this.clock.now());
  }
  remove(id: string): void {
    this.beats.delete(id);
  }
  alive(id: string): boolean {
    const t = this.beats.get(id);
    return t !== undefined && this.clock.now() - t < this.ttlMs;
  }
  expired(): string[] {
    const now = this.clock.now();
    return [...this.beats.entries()].filter(([, t]) => now - t >= this.ttlMs).map(([id]) => id);
  }
  live(): string[] {
    const now = this.clock.now();
    return [...this.beats.entries()].filter(([, t]) => now - t < this.ttlMs).map(([id]) => id);
  }
}

// ── cluster membership abstraction ──
export type MemberState = 'joining' | 'alive' | 'suspect' | 'left';
export interface ClusterMember {
  id: string;
  address?: string;
  state: MemberState;
}
export interface ClusterMembership {
  self(): ClusterMember;
  join(member: ClusterMember): void;
  leave(id: string): void;
  members(): ClusterMember[];
}

/** Single-node membership backed by heartbeats. Real gossip / failure detection is INFRA-PENDING. */
export class InMemoryClusterMembership implements ClusterMembership {
  private readonly roster = new Map<string, ClusterMember>();
  constructor(
    private readonly selfId: string,
    private readonly heartbeat: HeartbeatMonitor = new HeartbeatMonitor(),
  ) {
    this.roster.set(selfId, { id: selfId, state: 'alive' });
    this.heartbeat.register(selfId);
  }
  self(): ClusterMember {
    return this.roster.get(this.selfId)!;
  }
  join(member: ClusterMember): void {
    this.roster.set(member.id, { ...member, state: 'alive' });
    this.heartbeat.beat(member.id);
  }
  leave(id: string): void {
    const m = this.roster.get(id);
    if (m) m.state = 'left';
    this.heartbeat.remove(id);
  }
  members(): ClusterMember[] {
    return [...this.roster.values()].map((m) => (m.state === 'left' ? m : { ...m, state: this.heartbeat.alive(m.id) ? 'alive' : 'suspect' }));
  }
}

/** Aggregate coordinator — one place discovery, ordering, election, locks, heartbeat, and membership live. */
export class CoordinationPlatform {
  readonly discovery = new ServiceDiscovery();
  readonly leaderElection: LeaderElection;
  readonly lock: DistributedLock;
  readonly heartbeat: HeartbeatMonitor;
  readonly membership: ClusterMembership;

  constructor(clock: Clock = systemClock, options: { nodeId?: string; leaseMs?: number; heartbeatTtlMs?: number } = {}) {
    const nodeId = options.nodeId ?? 'node-local';
    this.leaderElection = new InMemoryLeaderElection(clock, options.leaseMs);
    this.lock = new InMemoryLock(clock);
    this.heartbeat = new HeartbeatMonitor(clock, options.heartbeatTtlMs);
    this.membership = new InMemoryClusterMembership(nodeId, this.heartbeat);
  }

  /** Startup order for a set of services with declared dependencies. */
  startupOrder(nodes: OrderedNode[]): string[] {
    return orderByDependencies(nodes);
  }
  /** Shutdown is the reverse of startup — dependents stop before their dependencies. */
  shutdownOrder(nodes: OrderedNode[]): string[] {
    return orderByDependencies(nodes).reverse();
  }
}
