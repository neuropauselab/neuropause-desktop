/**
 * @neuropause/industry — NEMS Wave 9 Industry Solutions Platform. Composes Waves 1-8 (unchanged)
 * into a multi-industry enterprise ecosystem: an Industry SDK, 20 vertical solution packs that
 * reuse the Wave 8 business domains without duplicating core logic, a universal configuration
 * engine, a low-code platform, industry AI copilots (reusing Enterprise AI), a compliance pack
 * library, a connector marketplace, and industry analytics.
 *
 * The SDK, solution packs, configuration engine, low-code builders, copilots, compliance-pack
 * models, and analytics KPI computation are LIVE-VERIFIED in-process; connector-marketplace
 * systems are ADAPTER-VERIFIED until a tenant configures real credentials; real industry data
 * (patients/students/policies/shipments/subscribers/…) is BUSINESS-DATA-PENDING (registries start
 * empty; never fabricated); and FDA/GMP/GLP submissions, regulatory filings, real EHR/PHI,
 * AML/KYC screening, permit issuance, payment settlement, and certification are REGULATED-EXTERNAL
 * and never executed or claimed. Every industry operation is audited on the one chain with a
 * replay id and evidence level.
 */
export * from './constants';
export * from './types';
export * from './evidence';
export * from './governance';
export * from './sdk';
export * from './configuration';
export * from './lowcode';
export * from './copilots';
export * from './compliancePacks';
export * from './connectors';
export * from './analytics';
export * from './industries';
export * from './healthcareIndustries';
export * from './financialIndustries';
export * from './commerceIndustries';
export * from './industrialIndustries';
export * from './publicIndustries';
export * from './platform';
