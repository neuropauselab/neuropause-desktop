/**
 * RuntimeIdentityContext (V6.6.3) — the single source of truth for who and where
 * the runtime is acting as: organizationId, userId, deviceId. Populated after
 * successful authentication + device registration, updated on organization switch,
 * cleared on logout.
 *
 * It holds ONLY identifiers — never access tokens, refresh tokens, API keys, or any
 * secret (those live in the keychain / authService). Readers get immutable frozen
 * snapshots; updates are event-driven (zero polling, O(1) reads). MemoryStore and
 * LiveSync stay authentication-unaware — they can depend on this context without
 * coupling to auth, which is what lets the V6.6.4 memory-sync bridge source its
 * org/device/user from one place with no further architectural change.
 *
 * This module owns identity state; it does NOT own auth. Lifecycle code (login,
 * logout, org switch, device registration) calls `set`/`clear`; everyone else only
 * reads and subscribes.
 */
import { EventEmitter } from 'node:events';

export interface RuntimeIdentity {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}

export type RuntimeIdentityEvent = 'ready' | 'changed' | 'cleared';
export type RuntimeIdentityListener = (identity: RuntimeIdentity | null) => void;

function sameIdentity(a: RuntimeIdentity, b: RuntimeIdentity): boolean {
  return (
    a.organizationId === b.organizationId && a.userId === b.userId && a.deviceId === b.deviceId
  );
}

export class RuntimeIdentityContext {
  private current: RuntimeIdentity | null = null;
  private readonly emitter = new EventEmitter();
  private readonly listeners = new Set<RuntimeIdentityListener>();

  /** The current identity snapshot (frozen), or null when unauthenticated. O(1). */
  getCurrent(): RuntimeIdentity | null {
    return this.current;
  }

  /** True once organization + user + device are all known. */
  isReady(): boolean {
    return this.current !== null;
  }

  /**
   * Publish identity after login / device registration / org switch. No-ops when
   * the values are identical to the current snapshot (duplicate suppression). Emits
   * 'ready' on the first set from empty, 'changed' when values differ from a prior
   * snapshot. Readers always receive a frozen, immutable object.
   */
  set(next: { organizationId: string; userId: string; deviceId: string }): void {
    const snapshot: RuntimeIdentity = Object.freeze({
      organizationId: next.organizationId,
      userId: next.userId,
      deviceId: next.deviceId,
    });
    const prev = this.current;
    if (prev && sameIdentity(prev, snapshot)) return; // unchanged — suppress
    this.current = snapshot;
    this.emitter.emit(prev ? 'changed' : 'ready', snapshot);
    this.notify(snapshot);
  }

  /** Clear identity on logout. No-ops if already cleared. Emits 'cleared' once. */
  clear(): void {
    if (!this.current) return;
    this.current = null;
    this.emitter.emit('cleared', null);
    this.notify(null);
  }

  /**
   * Subscribe to identity changes; the listener fires on ready/changed/cleared with
   * the new snapshot (or null on clear). Returns an unsubscribe function.
   */
  subscribe(listener: RuntimeIdentityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Low-level event access — 'ready' | 'changed' | 'cleared'. */
  on(event: RuntimeIdentityEvent, handler: (identity: RuntimeIdentity | null) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: RuntimeIdentityEvent, handler: (identity: RuntimeIdentity | null) => void): void {
    this.emitter.off(event, handler);
  }

  private notify(identity: RuntimeIdentity | null): void {
    for (const listener of this.listeners) listener(identity);
  }
}

/** Process-wide singleton — mirrors the other runtime-state singletons. */
export const runtimeIdentity = new RuntimeIdentityContext();
