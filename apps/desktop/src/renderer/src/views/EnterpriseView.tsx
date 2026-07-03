import { EnterpriseRoot } from '@renderer/enterprise/EnterpriseView';
import type { EnterpriseTab } from '@renderer/enterprise/lib';

/**
 * The Enterprise experience (Phase 7 · Stage 2). The Executive Command Center,
 * Decision Center, Organization Explorer, Business Operations dashboard,
 * Enterprise Search, the Executive Workspace, Executive Briefings, and
 * Enterprise Customization — implemented under `renderer/src/enterprise`, all
 * reading the Stage 1 Enterprise OS data layer live. This wrapper preserves the
 * export the shell loads and lets a section deep-link to a tab.
 */
export function EnterpriseView({ initialTab }: { initialTab?: EnterpriseTab } = {}): JSX.Element {
  return <EnterpriseRoot initialTab={initialTab} />;
}
