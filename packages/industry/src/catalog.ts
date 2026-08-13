/**
 * Runtime-free Industry catalog (IP-03).
 *
 * Exposes the STATIC canonical catalog — the built-in vertical solution packs,
 * the capability-evidence matrix, and the readiness rollup — WITHOUT the
 * EnterpriseRuntime-bound platform (`createIndustryPlatform`). This subpath pulls
 * no `@neuropause/runtime` or `@neuropause/business` RUNTIME code (only type-only
 * references, which erase at build), so it is safe to import from the desktop or
 * any consumer that must not bundle the cloud/NEMS stack.
 *
 * Live, per-tenant KPI computation still requires the full platform + a runtime
 * (`createIndustryPlatform(runtime)` from the package root) — that is a separate,
 * heavier import and is intentionally NOT re-exported here.
 */
export { allIndustrySolutions } from './industries';
export { INDUSTRY_MATRIX, industryReadiness } from './evidence';
export { INDUSTRY_VERSION } from './constants';

export type { IndustrySolution } from './types';
export type { CapabilityEvidence, IndustryReadiness } from './evidence';
