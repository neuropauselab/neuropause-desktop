/**
 * NeuroPause Platform — internal Domain Event log (ERP Session 17, Track B).
 *
 * Append-only, tenant-scoped, immutable events produced by successful commands.
 * An INTERNAL log for the modular monolith — no Kafka, no external broker. A
 * future workflow engine, projection or outbox reads from here; the shape is
 * deliberately transport-agnostic so it can later back an outbox without
 * changing producers.
 *
 * Isolation: events are bucketed by tenant and only ever read back per tenant,
 * so one tenant's stream is never visible to another (the `TenantDedupe`
 * discipline applied to events).
 */
import { createHash } from 'node:crypto';
import type { DomainEvent, DomainEventType } from './domainCommand';

let sequence = 0;

/* ── S109 (H3) — TAMPER-EVIDENCE ───────────────────────────────────────────────
 * Harvested (adapted, not imported) from packages/persistence/src/eventStore.ts's per-row
 * content hash, and STRENGTHENED to a per-tenant HASH CHAIN so the stream detects not only a
 * modified event but also reordering and removal (a per-row hash alone catches neither).
 *
 *   hash_0 = sha256(genesis(tenant) + '\n' + canonical(event_0))
 *   hash_i = sha256(hash_{i-1}   + '\n' + canonical(event_i))
 *
 * The chain is maintained alongside the existing append-only, tenant-bucketed, Object.freeze'd
 * log — NO new store, NO second event spine, NO change to producers or to list/ofType. Verification
 * is READ-ONLY and pure (never mutates historical events) and FAILS CLOSED on any divergence.
 * Tenant isolation: the genesis and every canonical row include the tenantId, and the chain is
 * per-tenant, so a cross-tenant substituted event breaks the chain.
 *
 * Honest bound (same as the source's content hash and the S107 audit's note on auditChain): a
 * hash chain detects tampering of events against a PRESERVED head; an attacker who rewrites the
 * events AND the chain AND the head consistently is out of scope for an in-memory anchor. The head
 * is the anchor a future durable outbox/persistence layer carries to make on-disk tampering
 * detectable.
 */
const EVENT_CHAIN_GENESIS_PREFIX = 'np-domain-event-chain:v1:';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Stable, deterministic JSON: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Deterministic canonical representation of an event (all identity fields; order-independent). */
export function canonicalEvent(event: DomainEvent): string {
  return stableStringify(event);
}

function genesis(tenantId: string): string {
  return sha256Hex(`${EVENT_CHAIN_GENESIS_PREFIX}${tenantId}`);
}

/** Pure: the full hash chain for a tenant's ordered events. */
export function computeEventChain(tenantId: string, events: readonly DomainEvent[]): string[] {
  const chain: string[] = [];
  let prev = genesis(tenantId);
  for (const e of events) {
    prev = sha256Hex(`${prev}\n${canonicalEvent(e)}`);
    chain.push(prev);
  }
  return chain;
}

export interface EventChainVerification {
  ok: boolean;
  length: number;
  head: string | null;
  firstDivergenceIndex?: number;
  reason?: string;
}

/**
 * Pure, READ-ONLY, FAIL-CLOSED verification: recompute the chain from `events` and compare it to
 * `expectedChain`. Detects a modified / reordered / removed / duplicated event, a forged hash, and
 * a cross-tenant substituted event. Never mutates its inputs.
 */
export function verifyEventChain(tenantId: string, events: readonly DomainEvent[], expectedChain: readonly string[]): EventChainVerification {
  try {
    const recomputed = computeEventChain(tenantId, events);
    if (recomputed.length !== expectedChain.length) {
      return { ok: false, length: recomputed.length, head: recomputed[recomputed.length - 1] ?? null, firstDivergenceIndex: Math.min(recomputed.length, expectedChain.length), reason: 'length-mismatch (event removed, added, or duplicated)' };
    }
    for (let i = 0; i < recomputed.length; i += 1) {
      if (recomputed[i] !== expectedChain[i]) {
        return { ok: false, length: recomputed.length, head: recomputed[recomputed.length - 1] ?? null, firstDivergenceIndex: i, reason: 'hash-mismatch (event modified, reordered, or chain forged)' };
      }
    }
    return { ok: true, length: recomputed.length, head: recomputed[recomputed.length - 1] ?? null };
  } catch (e) {
    // Fail closed: any error verifying integrity is treated as NOT verified.
    return { ok: false, length: 0, head: null, reason: `verification error: ${String(e).slice(0, 120)}` };
  }
}

export class DomainEventLog {
  private readonly byTenant = new Map<string, DomainEvent[]>();
  /** S109 (H3): the per-tenant tamper-evidence hash chain, maintained alongside byTenant. */
  private readonly chainByTenant = new Map<string, string[]>();

  /** Append one immutable event. Returns the frozen event (with its minted id). */
  append(input: Omit<DomainEvent, 'eventId'>): DomainEvent {
    const event: DomainEvent = Object.freeze({
      ...input,
      detail: Object.freeze({ ...input.detail }),
      eventId: `evt_${Date.now().toString(36)}_${(sequence += 1)}`,
    });
    // Deny-by-default: an event with no tenant is never logged (the command that
    // produced it already failed the tenant check; this is belt-and-braces).
    if (!input.tenantId) return event;
    const list = this.byTenant.get(input.tenantId) ?? [];
    list.push(event);
    this.byTenant.set(input.tenantId, list);
    // Extend the tamper-evidence chain for this tenant (additive; producers unaffected).
    const chain = this.chainByTenant.get(input.tenantId) ?? [];
    const prev = chain.length > 0 ? chain[chain.length - 1]! : genesis(input.tenantId);
    chain.push(sha256Hex(`${prev}\n${canonicalEvent(event)}`));
    this.chainByTenant.set(input.tenantId, chain);
    return event;
  }

  /** The tamper-evidence hash chain for one tenant (parallel to list()). Never cross-tenant. */
  chain(tenantId: string): readonly string[] {
    return this.chainByTenant.get(tenantId) ?? [];
  }

  /** The current chain head (integrity anchor) for a tenant, or null when the stream is empty. */
  integrityHead(tenantId: string): string | null {
    const chain = this.chainByTenant.get(tenantId);
    return chain && chain.length > 0 ? chain[chain.length - 1]! : null;
  }

  /** READ-ONLY: verify this tenant's live event stream against its maintained chain. Fail-closed. */
  verifyIntegrity(tenantId: string): EventChainVerification {
    return verifyEventChain(tenantId, this.list(tenantId), this.chain(tenantId));
  }

  /** Every event for one tenant, in append order. Never cross-tenant. */
  list(tenantId: string): readonly DomainEvent[] {
    return this.byTenant.get(tenantId) ?? [];
  }

  ofType(tenantId: string, type: DomainEventType): readonly DomainEvent[] {
    return this.list(tenantId).filter((e) => e.type === type);
  }

  /** Test/reset only. */
  clear(): void {
    this.byTenant.clear();
    this.chainByTenant.clear();
  }
}
