/**
 * Canonical Industry catalog accessor (IP-03b convergence).
 *
 * Bridges the CANONICAL Wave 9 Industry catalog into the desktop: the 20 vertical
 * solution packs + capability-evidence matrix + readiness, sourced from
 * `@neuropause/industry` via its RUNTIME-FREE `/catalog` subpath and projected by
 * `@neuropause/solution-packs` (`industrySnapshot()`). No cloud/NEMS runtime is
 * pulled into the desktop bundle.
 *
 * This is ADDITIVE to — and deliberately separate from — the existing P13
 * `industryService.ts` (which projects THIS deployment's own live stores into
 * curated suites/readiness). Here the desktop gains the canonical vertical-pack
 * catalog it did not previously surface. Live per-tenant KPI compute (needs
 * `createIndustryPlatform(runtime)`) stays a later, backend-side concern.
 */
import type { IndustryCatalogSnapshot } from '@neuropause/shared';
import { industrySnapshot } from '@neuropause/solution-packs';

/**
 * The projected canonical Wave 9 catalog snapshot for the desktop. The
 * solution-packs projection output structurally matches the shared
 * `IndustryCatalogSnapshot` wire DTO (the IPC contract for `industry:snapshot`).
 */
export function getCanonicalIndustrySnapshot(): IndustryCatalogSnapshot {
  return industrySnapshot();
}
