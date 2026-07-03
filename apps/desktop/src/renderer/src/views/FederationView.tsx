import { FederationRoot } from '@renderer/federation/FederationView';
import type { FederationTab } from '@renderer/federation/lib';

/**
 * The Federation Platform (Phase 9 · Stage 2) — the final architectural layer.
 * Secure cross-organization collaboration: the federation runtime (peers,
 * invitations, trust, shared resources), a signed/versioned organization
 * exchange, enterprise marketplace scopes, global governance with a shared audit
 * trail, enterprise observability, disaster recovery, and federation
 * administration — implemented under `renderer/src/federation`, reading the
 * federation data layer live. This wrapper preserves the export the shell loads
 * and lets a section deep-link to a tab.
 */
export function FederationView({ initialTab }: { initialTab?: FederationTab } = {}): JSX.Element {
  return <FederationRoot initialTab={initialTab} />;
}
