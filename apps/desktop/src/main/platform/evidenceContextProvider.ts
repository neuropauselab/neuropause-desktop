/**
 * S129 — the non-frozen bridge that lets the live assistant Context Builder consume the S128 governed
 * AI evidence-grounding read WITHOUT a frozen composition-root rewrite. It mirrors the established
 * `platformBusRef` singleton pattern (S120): `buildPlatformCommandHandlers` (which owns the durable
 * command journal + delivered-event sink) sets `evidenceContextProvider.current` to a closure that, for
 * the ACTIVE server-resolved tenant, returns the S128 grounding items (`AiContextItem[]`). The frozen
 * `runtimeCore` change is then a single additive dep (`evidenceContext: resolveEvidenceContext`) — no
 * journal plumbing crosses the frozen surface.
 *
 * DISCIPLINE: read-only; the closure resolves the tenant SERVER-SIDE itself (never trusts a caller
 * tenant), returns bounded, credential-free, provenance-tagged evidence, and fails closed to `[]` on any
 * error or before the provider is bound (cold start). It grants no execution and no store write.
 */
import type { AiContextItem } from '@neuropause/shared';

/** Set once by `buildPlatformCommandHandlers`; a server-tenant-resolving grounding provider. */
export const evidenceContextProvider: {
  current: ((opts: { query?: string; correlationId?: string; limit?: number; relevanceQuery?: string; includePosture?: boolean; includeConnectorIntel?: boolean }) => AiContextItem[]) | null;
} = { current: null };

/**
 * Resolve grounding context for the live assistant. Fails closed: no provider bound (cold start) or any
 * error ⇒ `[]` (honest "no grounding", never a throw into the assistant turn).
 */
export function resolveEvidenceContext(opts: { query?: string; correlationId?: string; limit?: number; relevanceQuery?: string; includePosture?: boolean; includeConnectorIntel?: boolean } = {}): AiContextItem[] {
  try {
    return evidenceContextProvider.current ? evidenceContextProvider.current(opts) : [];
  } catch {
    return [];
  }
}
