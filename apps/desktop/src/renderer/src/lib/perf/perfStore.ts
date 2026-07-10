/**
 * perfStore — a minimal external store holding the latest aggregated PerfSnapshot. The PerfSampler
 * publishes a fresh snapshot each sampling tick; React consumers read it via `useSyncExternalStore`
 * (see usePerformance) so ONLY the components that actually display metrics (the dev overlay and the
 * Diagnostics section) re-render on change — never the whole shell. `getSnapshot` returns a stable
 * reference between publishes, satisfying useSyncExternalStore's identity requirement.
 */
import { emptyPerfSnapshot, type PerfSnapshot } from '@neuropause/shared';

let current: PerfSnapshot = emptyPerfSnapshot();
const listeners = new Set<() => void>();

export const perfStore = {
  publish(snapshot: PerfSnapshot): void {
    current = snapshot;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): PerfSnapshot {
    return current;
  },
};
