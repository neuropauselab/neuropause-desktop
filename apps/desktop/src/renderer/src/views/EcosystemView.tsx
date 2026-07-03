import { EcosystemRoot } from '@renderer/ecosystem/EcosystemView';
import type { EcosystemTab } from '@renderer/ecosystem/lib';

/**
 * The Enterprise Ecosystem (Phase 8 · Stage 2). The org-facing side of the
 * platform: AI Worker / Connector / Enterprise Template marketplaces, the
 * Organization Exchange of packs, the Partner Platform directory, and
 * ecosystem-wide analytics — implemented under `renderer/src/ecosystem`, reading
 * the ecosystem data layer live. This wrapper preserves the export the shell
 * loads and lets a section deep-link to a tab.
 */
export function EcosystemView({ initialTab }: { initialTab?: EcosystemTab } = {}): JSX.Element {
  return <EcosystemRoot initialTab={initialTab} />;
}
