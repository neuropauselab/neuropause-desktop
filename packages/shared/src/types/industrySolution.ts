/**
 * Industry Solution Platform (P13) — view-model types.
 *
 * P13 is a curated SOLUTION-PACK CATALOG and readiness PROJECTION layer over the existing
 * platform (AI Workforce, Marketplace, Connectors, Governance). It introduces NO new runtime,
 * store, worker, connector, or marketplace. An "industry suite" is a definition that references
 * REAL platform entities by id (worker ids, connector ids, compliance-rule ids, workforce-policy
 * ids, marketplace slugs) plus catalog metadata (KPIs, compliance frameworks, dashboards,
 * playbooks, reports, automations, knowledge packs, templates). The service resolves each suite
 * against the LIVE deployment — which referenced entities the platform ships (`present`) and which
 * are wired/enabled here (`active`) — to produce an honest readiness signal.
 */
import type { ExecutiveKpi } from './executiveCenter';

/** The twelve industry verticals the platform ships solution packs for. */
export type IndustryId =
  | 'erp'
  | 'healthcare'
  | 'manufacturing'
  | 'finance'
  | 'retail'
  | 'supply-chain'
  | 'education'
  | 'legal'
  | 'government'
  | 'construction'
  | 'energy'
  | 'telecom';

export const INDUSTRY_IDS: readonly IndustryId[] = [
  'erp',
  'healthcare',
  'manufacturing',
  'finance',
  'retail',
  'supply-chain',
  'education',
  'legal',
  'government',
  'construction',
  'energy',
  'telecom',
] as const;

/** Deployment readiness band for a suite (derived from live activation, not authored). */
export type IndustrySuiteStatus = 'ready' | 'partial' | 'planned';

/** The kinds of real platform entity a suite references. */
export type IndustryEntityKind = 'worker' | 'connector' | 'compliance' | 'policy' | 'listing';

/**
 * A resolved reference to a real platform entity. `present` = the platform ships/owns it (catalog
 * integrity); `active` = it is wired/enabled in THIS deployment (connector connected, rule/policy
 * enabled, worker registered). For workers/policies present ⇒ active (platform-shipped defaults).
 */
export interface IndustryEntityRef {
  kind: IndustryEntityKind;
  id: string;
  label: string;
  present: boolean;
  active: boolean;
}

/** A catalog KPI/benchmark spec for an industry (descriptive target, not a live metric). */
export interface IndustryKpiSpec {
  key: string;
  label: string;
  unit: string;
  benchmark: string;
  description: string;
}

/** A named catalog capability item (playbook, automation, knowledge pack, etc.). */
export interface IndustryCapabilityItem {
  name: string;
  detail: string;
}

/** A catalog reference to a regulatory / compliance framework (metadata, not an installed entity). */
export interface IndustryFrameworkRef {
  id: string;
  name: string;
  description: string;
}

/** Per-category readiness breakdown for a suite. */
export interface IndustrySuiteReadiness {
  /** Fraction (0..1) of all referenced real entities the platform ships (present). Near-constant. */
  coverage: number;
  /**
   * Fraction (0..1) of the suite's CONNECTORS that are connected in this deployment. This is the
   * sole per-deployment configuration signal and the single driver of the readiness band — workers,
   * policies, seeded compliance rules and published listings are platform-shipped defaults that
   * belong to `coverage`, not here, so a zero-config install is never reported "ready".
   */
  activation: number;
  workers: { referenced: number; available: number };
  connectors: { referenced: number; supported: number; connected: number };
  compliance: { referenced: number; enabled: number };
  policies: { referenced: number; enabled: number };
}

/** The authored, static definition of an industry solution pack. */
export interface IndustrySuiteDefinition {
  id: IndustryId;
  name: string;
  sector: string;
  summary: string;
  /** Catalog: external systems / standards the pack targets (SAP, FHIR, MES, SCADA, …). */
  systems: string[];
  /** Real platform entity ids (validated against the live registries at resolve time). */
  workerIds: string[];
  connectorIds: string[];
  complianceRuleIds: string[];
  policyIds: string[];
  marketplaceSlugs: string[];
  /** Catalog metadata. */
  frameworks: IndustryFrameworkRef[];
  kpis: IndustryKpiSpec[];
  dashboards: string[];
  automations: IndustryCapabilityItem[];
  playbooks: IndustryCapabilityItem[];
  reports: string[];
  knowledgePacks: IndustryCapabilityItem[];
  templates: string[];
}

/** A fully resolved industry suite (definition + live readiness projection). */
export interface IndustrySuite extends IndustrySuiteDefinition {
  status: IndustrySuiteStatus;
  readiness: IndustrySuiteReadiness;
  workerRefs: IndustryEntityRef[];
  connectorRefs: IndustryEntityRef[];
  complianceRefs: IndustryEntityRef[];
  policyRefs: IndustryEntityRef[];
  listingRefs: IndustryEntityRef[];
  counts: IndustrySuiteCounts;
}

export interface IndustrySuiteCounts {
  workers: number;
  connectors: number;
  compliance: number;
  policies: number;
  frameworks: number;
  kpis: number;
  dashboards: number;
  automations: number;
  playbooks: number;
  reports: number;
  knowledgePacks: number;
  templates: number;
  systems: number;
}

/** Compact suite row for lists/dashboards. */
export interface IndustrySuiteSummary {
  id: IndustryId;
  name: string;
  sector: string;
  status: IndustrySuiteStatus;
  coverage: number;
  activation: number;
  workers: number;
  connectors: number;
  connectorsConnected: number;
  frameworks: number;
}

/** A marketplace-style industry collection: the suite's referenced listings, resolved. */
export interface IndustryCollection {
  id: IndustryId;
  name: string;
  sector: string;
  status: IndustrySuiteStatus;
  entries: IndustryEntityRef[];
  available: number;
  total: number;
}

/**
 * A compliance framework rolled up across the industries that reference it. IMPORTANT: `ruleRefs`,
 * `enabled`, `total`, and `status` describe the platform's GENERIC governance controls (audit-trail,
 * side-effect approval, approval chains, worker-health) that the referencing suites carry — mapped
 * to the framework as supporting controls. They are NOT framework-specific attestations or a
 * certification; `status` is a control-enablement band, not a "compliant" verdict.
 */
export interface IndustryComplianceFramework {
  id: string;
  name: string;
  description: string;
  industries: IndustryId[];
  /** The generic platform governance controls backing this framework (present/enabled resolved). */
  ruleRefs: IndustryEntityRef[];
  enabled: number;
  total: number;
  /** Control-enablement band (how many backing governance controls are enabled) — not an attestation. */
  status: IndustrySuiteStatus;
}

export interface IndustryComplianceReport {
  frameworks: IndustryComplianceFramework[];
  totalFrameworks: number;
  rulesReferenced: number;
  rulesEnabled: number;
}

export interface IndustryReadinessEntry {
  id: IndustryId;
  name: string;
  sector: string;
  status: IndustrySuiteStatus;
  coverage: number;
  activation: number;
}

export interface IndustryReadinessReport {
  entries: IndustryReadinessEntry[];
  ready: number;
  partial: number;
  planned: number;
  averageActivation: number;
}

export interface IndustryPlatformSummary {
  totalSuites: number;
  ready: number;
  partial: number;
  planned: number;
  workersReferenced: number;
  workersAvailable: number;
  connectorsReferenced: number;
  connectorsConnected: number;
  complianceFrameworks: number;
  marketplaceCollections: number;
}

/** The bundled overview the Industry Center reads in a single call. */
export interface IndustryPlatformOverview {
  summary: IndustryPlatformSummary;
  suites: IndustrySuite[];
  collections: IndustryCollection[];
  compliance: IndustryComplianceReport;
  /** Real, live platform KPIs (industry-platform coverage/activation), reusing ExecutiveKpi. */
  kpis: ExecutiveKpi[];
}
