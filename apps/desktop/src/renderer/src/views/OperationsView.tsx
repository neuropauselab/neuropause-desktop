import { OperationsRoot } from '@renderer/operations/OperationsView';

/**
 * The Operations command center (Phase 3 · Part B). Real-time monitoring of the
 * runtime, registry, package service, and plugin host — implemented under
 * `renderer/src/operations`. This wrapper preserves the export the shell loads.
 */
export function OperationsView(): JSX.Element {
  return <OperationsRoot />;
}
