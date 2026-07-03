import { WorkforceRoot } from '@renderer/workforce/WorkforceView';
import type { WorkforceTab } from '@renderer/workforce/lib';

/**
 * The AI Workforce experience (Phase 6 · Stage 2). Mission Control, the worker
 * dashboard, the human approval center, the automation studio, analytics, and
 * the executive chat — implemented under `renderer/src/workforce`. This wrapper
 * preserves the export the shell loads and lets a section deep-link to a tab.
 */
export function WorkforceView({ initialTab }: { initialTab?: WorkforceTab } = {}): JSX.Element {
  return <WorkforceRoot initialTab={initialTab} />;
}
