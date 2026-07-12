/**
 * P4.1 Increment 1 — Connector Runtime v2 FSM foundation (pure). Exhaustive tests for the
 * derived state machine: derivation precedence, the rate-limit window, transition guard, labels,
 * and connector-level aggregation. Pure node, injected clock — collected by the desktop gate.
 */
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_STATES,
  aggregateRuntimeState,
  canTransitionRuntime,
  deriveRuntimeState,
  isActiveRuntimeState,
  isFaultRuntimeState,
  runtimeStateLabel,
  runtimeStateSeverity,
  runtimeTransitions,
  type ConnectorRuntimeState,
  type RuntimeStateInput,
} from '@neuropause/shared';

const NOW = Date.parse('2026-07-12T00:00:00.000Z');
function input(over: Partial<RuntimeStateInput> = {}): RuntimeStateInput {
  return { status: 'connected', nowMs: NOW, ...over };
}

describe('deriveRuntimeState — precedence', () => {
  it('disabled flag wins over everything', () => {
    expect(deriveRuntimeState(input({ status: 'error', control: { paused: true, disabled: true } }))).toBe('disabled');
    expect(deriveRuntimeState(input({ transient: 'updating', control: { paused: false, disabled: true } }))).toBe('disabled');
  });

  it('transient override wins over derived-from-status (but not over disabled)', () => {
    expect(deriveRuntimeState(input({ status: 'connected', transient: 'installing' }))).toBe('installing');
    expect(deriveRuntimeState(input({ status: 'connected', transient: 'updating' }))).toBe('updating');
    expect(deriveRuntimeState(input({ status: 'connected', transient: 'removing' }))).toBe('removing');
  });

  it('maps account statuses to their runtime states', () => {
    expect(deriveRuntimeState(input({ status: 'error' }))).toBe('error');
    expect(deriveRuntimeState(input({ status: 'reauth_required' }))).toBe('reauth_required');
    expect(deriveRuntimeState(input({ status: 'connecting' }))).toBe('authenticating');
    expect(deriveRuntimeState(input({ status: 'disconnected' }))).toBe('disconnected');
    expect(deriveRuntimeState(input({ status: 'unavailable' }))).toBe('disconnected');
  });

  it('connected + paused → paused', () => {
    expect(deriveRuntimeState(input({ control: { paused: true, disabled: false } }))).toBe('paused');
  });

  it('connected sync-status projections', () => {
    expect(deriveRuntimeState(input({ syncStatus: 'offline' }))).toBe('offline');
    expect(deriveRuntimeState(input({ syncStatus: 'rate_limited' }))).toBe('rate_limited');
    expect(deriveRuntimeState(input({ syncStatus: 'syncing' }))).toBe('syncing');
  });

  it('rate-limit window: future → rate_limited, past → not', () => {
    const future = new Date(NOW + 60_000).toISOString();
    const past = new Date(NOW - 60_000).toISOString();
    expect(deriveRuntimeState(input({ rateLimitedUntil: future }))).toBe('rate_limited');
    expect(deriveRuntimeState(input({ rateLimitedUntil: past, hasSyncedBefore: true }))).toBe('idle');
    expect(deriveRuntimeState(input({ rateLimitedUntil: 'not-a-date', hasSyncedBefore: true }))).toBe('idle');
  });

  it('retryDepth > 0 → retrying (below rate-limit, above syncing)', () => {
    expect(deriveRuntimeState(input({ retryDepth: 2 }))).toBe('retrying');
    // rate-limit still outranks retry
    expect(deriveRuntimeState(input({ retryDepth: 2, syncStatus: 'rate_limited' }))).toBe('rate_limited');
  });

  it('connected at rest → connected (fresh) vs idle (has synced)', () => {
    expect(deriveRuntimeState(input({ hasSyncedBefore: false }))).toBe('connected');
    expect(deriveRuntimeState(input({ hasSyncedBefore: true }))).toBe('idle');
    expect(deriveRuntimeState(input({ syncStatus: 'success', hasSyncedBefore: true }))).toBe('idle');
  });

  it('is total — every status yields a valid state', () => {
    for (const status of ['disconnected', 'connecting', 'connected', 'reauth_required', 'error', 'unavailable'] as const) {
      const s = deriveRuntimeState(input({ status }));
      expect(RUNTIME_STATES).toContain(s);
    }
  });
});

describe('canTransitionRuntime — guard table', () => {
  it('rejects self-transitions', () => {
    for (const s of RUNTIME_STATES) expect(canTransitionRuntime(s, s)).toBe(false);
  });

  it('accepts representative legal edges', () => {
    expect(canTransitionRuntime('disconnected', 'authenticating')).toBe(true);
    expect(canTransitionRuntime('disconnected', 'connected')).toBe(true); // fresh connect (projection jump)
    expect(canTransitionRuntime('disconnected', 'idle')).toBe(true);
    expect(canTransitionRuntime('authenticating', 'connected')).toBe(true);
    expect(canTransitionRuntime('idle', 'syncing')).toBe(true);
    expect(canTransitionRuntime('syncing', 'idle')).toBe(true);
    expect(canTransitionRuntime('syncing', 'retrying')).toBe(true);
    expect(canTransitionRuntime('retrying', 'syncing')).toBe(true);
    expect(canTransitionRuntime('rate_limited', 'idle')).toBe(true);
    expect(canTransitionRuntime('error', 'authenticating')).toBe(true);
    expect(canTransitionRuntime('removing', 'disconnected')).toBe(true);
    expect(canTransitionRuntime('idle', 'disabled')).toBe(true);
    expect(canTransitionRuntime('disabled', 'disconnected')).toBe(true);
  });

  it('rejects impossible jumps', () => {
    expect(canTransitionRuntime('disconnected', 'syncing')).toBe(false);
    expect(canTransitionRuntime('disabled', 'syncing')).toBe(false);
    expect(canTransitionRuntime('removing', 'syncing')).toBe(false);
    expect(canTransitionRuntime('error', 'syncing')).toBe(false);
  });

  it('every state has a transition entry and every target is a valid state', () => {
    for (const from of RUNTIME_STATES) {
      const targets = runtimeTransitions(from);
      expect(Array.isArray(targets)).toBe(true);
      for (const to of targets) {
        expect(RUNTIME_STATES).toContain(to);
        expect(canTransitionRuntime(from, to)).toBe(true);
      }
    }
  });
});

describe('labels + severity + predicates', () => {
  it('every state has a non-empty label + valid severity', () => {
    const severities = new Set(['off', 'idle', 'active', 'warn', 'error']);
    for (const s of RUNTIME_STATES) {
      expect(runtimeStateLabel(s).length).toBeGreaterThan(0);
      expect(severities.has(runtimeStateSeverity(s))).toBe(true);
    }
  });

  it('active + fault predicates are coherent', () => {
    expect(isActiveRuntimeState('syncing')).toBe(true);
    expect(isActiveRuntimeState('idle')).toBe(false);
    expect(isFaultRuntimeState('error')).toBe(true);
    expect(isFaultRuntimeState('reauth_required')).toBe(true);
    expect(isFaultRuntimeState('offline')).toBe(true);
    expect(isFaultRuntimeState('idle')).toBe(false);
  });

  it('RUNTIME_STATES is complete (15) and unique', () => {
    expect(RUNTIME_STATES).toHaveLength(15);
    expect(new Set(RUNTIME_STATES).size).toBe(15);
  });
});

describe('aggregateRuntimeState — connector rollup', () => {
  it('unconfigured or no accounts → disconnected', () => {
    expect(aggregateRuntimeState([], { configured: false })).toBe('disconnected');
    expect(aggregateRuntimeState([], { configured: true })).toBe('disconnected');
    expect(aggregateRuntimeState(['idle', 'syncing'], { configured: false })).toBe('disconnected');
  });

  it('most significant account state wins', () => {
    expect(aggregateRuntimeState(['idle', 'syncing'], { configured: true })).toBe('syncing');
    expect(aggregateRuntimeState(['idle', 'error'], { configured: true })).toBe('error');
    expect(aggregateRuntimeState(['syncing', 'reauth_required'], { configured: true })).toBe('reauth_required');
    expect(aggregateRuntimeState(['idle', 'idle'], { configured: true })).toBe('idle');
  });

  it('ranks every state (no undefined in the rank map)', () => {
    for (const s of RUNTIME_STATES) {
      const out: ConnectorRuntimeState = aggregateRuntimeState([s], { configured: true });
      expect(RUNTIME_STATES).toContain(out);
    }
  });
});
