/**
 * usePerformance — subscribe to the live runtime performance snapshot without re-rendering the shell.
 * Backed by `perfStore` via `useSyncExternalStore`, so only the components that call this hook (the
 * developer Performance overlay and the Diagnostics "Runtime performance" section) update each tick.
 */
import { useSyncExternalStore } from 'react';
import type { PerfSnapshot } from '@neuropause/shared';
import { perfStore } from '@renderer/lib/perf/perfStore';

export function usePerformance(): PerfSnapshot {
  return useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot, perfStore.getSnapshot);
}
