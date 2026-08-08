/**
 * Industry catalog DTOs (IP-03b) — the wire contract for the canonical Wave 9
 * Industry catalog snapshot delivered over the `industry:snapshot` IPC channel.
 *
 * These shapes structurally match the projection output of
 * `@neuropause/solution-packs` (`industrySnapshot()`), which composes the
 * runtime-free `@neuropause/industry/catalog`. The projection LOGIC lives in
 * solution-packs; this is only the boundary shape, declared here so the IPC
 * response map (main) and the renderer client share one contract — consistent
 * with every other industry IPC type living in @neuropause/shared.
 */
export interface IndustryCatalogCounts {
  objects: number;
  workflows: number;
  kpis: number;
  compliancePacks: number;
  connectors: number;
  aiSkills: number;
  documentTemplates: number;
}

export interface IndustryCatalogSummary {
  key: string;
  name: string;
  /** Wave-8 core domains the pack reuses (never duplicates). */
  reusesDomains: string[];
  counts: IndustryCatalogCounts;
  approvalWorkflows: number;
}

export interface IndustryCatalogCapabilityItem {
  capability: string;
  area: string;
  /** Honest evidence level (e.g. live-verified / adapter-verified / …). */
  level: string;
  note: string;
}

export interface IndustryCatalogCapabilityGroup {
  area: string;
  items: IndustryCatalogCapabilityItem[];
}

export interface IndustryCatalogReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
  /** live-verified as a whole-number % of total (0 when total is 0). */
  liveVerifiedPct: number;
}

/** The canonical Wave 9 catalog snapshot surfaced to the desktop/mobile. */
export interface IndustryCatalogSnapshot {
  version: string;
  /** Provenance — the static catalog (no live per-tenant data). */
  source: 'catalog';
  industries: IndustryCatalogSummary[];
  capabilities: IndustryCatalogCapabilityGroup[];
  readiness: IndustryCatalogReadiness;
}
