import { DeveloperRoot } from '@renderer/developer/DeveloperView';
import type { DeveloperTab } from '@renderer/developer/lib';

/**
 * The Developer Portal (Phase 8 · Stage 1). The developer dashboard, API keys &
 * OAuth applications, the publishing marketplace (with security scanning, Ed25519
 * signing, review/approval, publishing, and rollback), the API gateway, SDKs &
 * documentation, and billing & licensing — implemented under
 * `renderer/src/developer`, reading the ecosystem platform data layer live. This
 * wrapper preserves the export the shell loads and lets a section deep-link to a tab.
 */
export function DeveloperView({ initialTab }: { initialTab?: DeveloperTab } = {}): JSX.Element {
  return <DeveloperRoot initialTab={initialTab} />;
}
