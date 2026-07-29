/**
 * Wave 12 constants. Isolated module (no imports).
 */
export const OPS_VERSION = '0.0.0-preview.1';

/** The one honest answer intelligence gives when no real data exists. */
export const NO_OPS_DATA = 'No business data available';

/** Module 1 — mission lifecycle states. */
export const MISSION_STATES = ['planned', 'active', 'on-hold', 'completed', 'aborted'] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Module 12 — incident severity. */
export const SEVERITY_LEVELS = ['sev1', 'sev2', 'sev3', 'sev4', 'sev5'] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

/** Module 4 — enterprise digital-twin node types. */
export const TWIN_NODE_TYPES = ['organization', 'department', 'team', 'facility', 'warehouse', 'factory', 'asset', 'supply-chain', 'customer', 'vendor'] as const;
export type TwinNodeType = (typeof TWIN_NODE_TYPES)[number];

/** Module 9 — simulation kinds (all PROJECTIONS, never real state). */
export const SIMULATION_KINDS = ['what-if', 'capacity', 'resource', 'financial-scenario', 'demand', 'disaster'] as const;
export type SimulationKind = (typeof SIMULATION_KINDS)[number];

/** Module 10 — forecast kinds (evidence-based only). */
export const FORECAST_KINDS = ['capacity', 'resource', 'risk', 'sla', 'maintenance'] as const;
export type ForecastKind = (typeof FORECAST_KINDS)[number];

/** Module 3 — command-center health domains. */
export const HEALTH_DOMAINS = ['business', 'workforce', 'infrastructure', 'financial', 'risk'] as const;
export type HealthDomain = (typeof HEALTH_DOMAINS)[number];

/** Module 7 — scheduler resource kinds. */
export const SCHEDULE_KINDS = ['workforce', 'facility', 'equipment', 'resource', 'capacity', 'priority'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Module 18 — operations marketplace item kinds. */
export const OPS_MARKET_KINDS = ['mission-pack', 'industry-ops-pack', 'dashboard', 'simulation', 'ai-coordinator'] as const;
export type OpsMarketKind = (typeof OPS_MARKET_KINDS)[number];

/** Module 17 — operations SDK module kinds. */
export const OPS_SDK_KINDS = ['operations-module', 'mission-type', 'scheduler', 'simulation', 'dashboard', 'kpi', 'coordinator'] as const;
export type OpsSdkKind = (typeof OPS_SDK_KINDS)[number];

/** Module 20 — external ops system categories (adapter-verified). */
export const OPS_ADAPTER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'External Monitoring System', category: 'monitoring' },
  { system: 'External Incident Platform', category: 'incident' },
  { system: 'IoT Platform', category: 'iot' },
  { system: 'MES Platform', category: 'mes' },
  { system: 'ERP Connector', category: 'erp' },
];

/** Regulated operational actions — represented only, never executed autonomously. */
export const REGULATED_OPS = ['emergency-response', 'financial-operations', 'production-control', 'healthcare-decision', 'legal-escalation', 'security-policy', 'board-decision', 'regulatory-reporting'] as const;
export type RegulatedOp = (typeof REGULATED_OPS)[number];
