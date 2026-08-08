/**
 * Industry snapshot (IP-03) — the composed, desktop/mobile-ready view of the
 * canonical Industry catalog.
 *
 * Pulls the RUNTIME-FREE catalog from `@neuropause/industry/catalog` (a value
 * import — no cloud/runtime code) and runs it through the IP-02 projections, so
 * a consumer (desktop main, Enterprise API, mobile) gets ONE plain-typed DTO
 * with no dependency on the heavy platform/runtime. Live per-tenant KPI values
 * (which need `createIndustryPlatform(runtime)`) are a later, heavier path.
 */
import {
  INDUSTRY_MATRIX,
  INDUSTRY_VERSION,
  allIndustrySolutions,
  industryReadiness,
} from '@neuropause/industry/catalog';
import {
  groupCapabilitiesByArea,
  projectIndustries,
  readinessView,
  type IndustryAreaGroup,
  type IndustryReadinessView,
  type IndustrySummary,
} from './industryProjection';

export interface IndustrySnapshot {
  version: string;
  /** Provenance of the snapshot — the static catalog (no live per-tenant data). */
  source: 'catalog';
  industries: IndustrySummary[];
  capabilities: IndustryAreaGroup[];
  readiness: IndustryReadinessView;
}

/** Compose the canonical static catalog into the desktop/mobile snapshot DTO. */
export function industrySnapshot(): IndustrySnapshot {
  return {
    version: INDUSTRY_VERSION,
    source: 'catalog',
    industries: projectIndustries(allIndustrySolutions()),
    capabilities: groupCapabilitiesByArea(INDUSTRY_MATRIX),
    readiness: readinessView(industryReadiness()),
  };
}
