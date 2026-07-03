import { CloudRoot } from '@renderer/cloud/CloudView';
import type { CloudTab } from '@renderer/cloud/lib';

/**
 * The Cloud Platform (Phase 9 · Stage 1). The distributed control plane:
 * multi-tenant runtime across regions, identity federation (SAML / OIDC / SCIM /
 * MFA), offline-first cloud synchronization, the API gateway as a cloud service,
 * and enterprise administration — implemented under `renderer/src/cloud`, reading
 * the cloud data layer live. This wrapper preserves the export the shell loads
 * and lets a section deep-link to a tab.
 */
export function CloudView({ initialTab }: { initialTab?: CloudTab } = {}): JSX.Element {
  return <CloudRoot initialTab={initialTab} />;
}
