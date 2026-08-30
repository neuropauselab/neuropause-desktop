/**
 * The backend-reachability seam, with no dependencies — the tenantRecoveryHub's
 * sibling, for the connectivity transition.
 *
 * P13C GATE 2. `RuntimeTelemetrySampler.probeBackend()` is the single source of
 * truth for whether the backend `/health` endpoint is reachable; it knows the
 * exact moment reachability transitions (recovering|disconnected) → connected.
 * The auth service needs that edge to re-attempt a cloud restore for a user who
 * launched offline and degraded to device-local mode — but the telemetry
 * sampler must not import the auth service, and the auth service must not poll.
 * This hub carries the edge across, the same way tenantRecoveryHub carries the
 * tenant refused→resolved edge to the AI engine.
 *
 * Same contract as the recovery/switch hubs: no state, only callbacks; the
 * telemetry sampler is the only announcer; a throwing listener must not stop the
 * rest.
 */

type ReachableListener = () => void;

const listeners: ReachableListener[] = [];

/** Register a callback fired when the backend transitions unreachable → reachable. */
export function onBackendReachable(fn: ReachableListener): void {
  listeners.push(fn);
}

/** Announce a reachability recovery. Called by the telemetry sampler ONLY. */
export function announceBackendReachable(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Best-effort, as with the sibling hubs: one listener failing to react is
      // not a reason to withhold the edge from the others.
    }
  }
}
