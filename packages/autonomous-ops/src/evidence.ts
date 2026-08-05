/**
 * Wave 12 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — operations runtime + mission registry, mission control, command-center
 *                            dashboards, the digital-twin MODEL, orchestration, mission planning
 *                            (reuses Wave 11), scheduler (real conflict detection), resource
 *                            optimization (real computation), business continuity (reuses Wave 7 DR),
 *                            incident management (reuses @neuropause/operations), the SLA platform,
 *                            AI workforce orchestration (reuses Wave 11), the executive war room,
 *                            the operations SDK, the operations marketplace, and governance — all
 *                            executed in-process on the one runtime/audit chain.
 *   adapter-verified       — external monitoring / incident / IoT / MES / ERP systems, until configured
 *   business-data-pending  — live missions, operational health/alerts, command-center KPIs, digital-
 *                            twin operational STATE, capacity/utilization, simulation scenarios
 *                            (projections), predictive forecasts, SLA compliance, and enterprise-
 *                            intelligence answers; all start empty/null and are NEVER fabricated
 *   regulated-external     — autonomous emergency response, financial operations, production control,
 *                            healthcare decisions, legal escalation, security-policy changes, board
 *                            decisions, and regulatory reporting; represented only, never executed
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified, and
 * that every regulated operation appears exactly once as regulated-external.
 */
import type { EvidenceLevel } from './types';
import { REGULATED_OPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const OPERATIONS_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — executed in-process, through the one runtime and governance ──
  { capability: 'Operations Runtime + Mission Registry', module: 'M1', level: 'live-verified', note: 'Missions/operations/context governed on the one audit chain; starts empty.' },
  { capability: 'Mission Control', module: 'M2', level: 'live-verified', note: 'Overview/live-ops/alerts/timeline composed from real runtime state — no status fabricated.' },
  { capability: 'Enterprise Command Center', module: 'M3', level: 'live-verified', note: 'Dashboards compose real Wave 8/11/7 data; empty domains read "No business data available".' },
  { capability: 'Enterprise Digital Twin (model)', module: 'M4', level: 'live-verified', note: 'The twin model/graph is real; the node STATE it reflects is real or pending, never invented.' },
  { capability: 'Orchestration Engine', module: 'M5', level: 'live-verified', note: 'Cross-team/company/department coordination of reused AI workers and human teams.' },
  { capability: 'Mission Planning Engine', module: 'M6', level: 'live-verified', note: 'Goal → task tree/critical path/milestones; REUSES the Wave 11 planner when present.' },
  { capability: 'Operations Scheduler', module: 'M7', level: 'live-verified', note: 'Workforce/facility/equipment/resource scheduling with real overlap conflict rejection.' },
  { capability: 'Resource Optimization', module: 'M8', level: 'live-verified', note: 'Utilization/balancing computed from real or supplied data; null (not invented) with none.' },
  { capability: 'Business Continuity', module: 'M11', level: 'live-verified', note: 'Continuity/DR plans, escalation trees, playbooks; REUSES the Wave 7 cloud-ops DR runtime.' },
  { capability: 'Incident Management', module: 'M12', level: 'live-verified', note: 'REUSES @neuropause/operations IncidentRegistry (detect/root-cause/resolve/postmortem, MTTR).' },
  { capability: 'SLA Platform', module: 'M13', level: 'live-verified', note: 'Define SLAs + record real measurements; compliance computed from measurements only.' },
  { capability: 'AI Workforce Orchestration', module: 'M14', level: 'live-verified', note: 'Assigns REAL Wave 11 AI agents to missions; reuses the AI org chart — 0 when none connected.' },
  { capability: 'Executive War Room', module: 'M15', level: 'live-verified', note: 'Crisis sessions + decision log; decisions recorded/governed, never autonomously executed.' },
  { capability: 'Operations SDK', module: 'M17', level: 'live-verified', note: 'Register modules/mission-types/schedulers/etc.; each must reuse ≥1 capability or is rejected.' },
  { capability: 'Operations Marketplace', module: 'M18', level: 'live-verified', note: 'Publish/install mission-packs/dashboards/coordinators; listings not executed until installed.' },
  { capability: 'Operations Governance', module: 'M19', level: 'live-verified', note: 'Every action records user/org/mission/evidence/approval/replay id on the one chain.' },
  // ── Adapter-verified — external operations systems, until configured ──
  { capability: 'External Monitoring System', module: 'M20', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; never executed here.' },
  { capability: 'External Incident Platform', module: 'M20', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; never executed here.' },
  { capability: 'IoT Platform', module: 'M20', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; never executed here.' },
  { capability: 'MES Platform', module: 'M20', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; never executed here.' },
  { capability: 'ERP Connector', module: 'M20', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; never executed here.' },
  // ── Business-data-pending — real content/state; starts empty or null; never fabricated ──
  { capability: 'Live missions', module: 'M1', level: 'business-data-pending', note: 'Empty until real missions are created.' },
  { capability: 'Operational health & critical alerts', module: 'M2', level: 'business-data-pending', note: '"No business data available" until real operations exist.' },
  { capability: 'Command-center KPIs', module: 'M3', level: 'business-data-pending', note: 'Each panel reads real data or "No business data available".' },
  { capability: 'Digital-twin operational state', module: 'M4', level: 'business-data-pending', note: 'Node counts are 0 until real business data exists — not invented.' },
  { capability: 'Capacity & utilization metrics', module: 'M8', level: 'business-data-pending', note: 'Utilization is null until real capacity data is supplied.' },
  { capability: 'Simulation scenarios (projections)', module: 'M9', level: 'business-data-pending', note: 'The arithmetic is real; every result is a PROJECTION, never real operational state.' },
  { capability: 'Predictive forecasts', module: 'M10', level: 'business-data-pending', note: 'No history → no forecast (null); trend extrapolated from real history only.' },
  { capability: 'SLA compliance', module: 'M13', level: 'business-data-pending', note: 'Compliance is null until real measurements are recorded.' },
  { capability: 'Enterprise-intelligence answers', module: 'M16', level: 'business-data-pending', note: 'Grounded copilot returns "No business data available" until real objects exist.' },
  // ── Regulated-external — represented only, never executed autonomously ──
  { capability: 'Autonomous emergency response', module: 'M15/M20', level: 'regulated-external', note: 'Represented only. Requires human authority; never executed autonomously.' },
  { capability: 'Autonomous financial operations', module: 'M3/M15', level: 'regulated-external', note: 'Represented only. Requires governed finance rails + human; never executed autonomously.' },
  { capability: 'Autonomous production control', module: 'M20', level: 'regulated-external', note: 'Represented only. Requires MES/operator authority; never executed autonomously.' },
  { capability: 'Autonomous healthcare decisions', module: 'M16', level: 'regulated-external', note: 'Represented only. Requires clinician oversight; never made autonomously.' },
  { capability: 'Autonomous legal escalation', module: 'M15', level: 'regulated-external', note: 'Represented only. Requires human legal review; never made autonomously.' },
  { capability: 'Autonomous security-policy changes', module: 'M19', level: 'regulated-external', note: 'Represented only. No self-modification or policy bypass; never executed.' },
  { capability: 'Autonomous board decisions', module: 'M15', level: 'regulated-external', note: 'Represented only. Requires the board/human; never made autonomously.' },
  { capability: 'Autonomous regulatory reporting', module: 'M19', level: 'regulated-external', note: 'Represented only. Requires a government portal + human; never filed autonomously.' },
];

export interface OperationsReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function operationsReadiness(matrix: CapabilityEvidence[] = OPERATIONS_MATRIX): OperationsReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}

/** The regulated operations this platform represents but never executes autonomously. */
export const REGULATED_OPERATIONS = REGULATED_OPS;
