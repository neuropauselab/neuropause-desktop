/**
 * P7 — the Enterprise Intelligence composition. ONE pure entry point that builds the unified Enterprise Graph
 * from the existing domain models and runs every P7 engine (dependency, change-impact, risk, health, drift,
 * capacity, root-cause/incident, recommendation) into a single `EnterpriseIntelligenceReport` + a KPI strip.
 *
 * This is the "Enterprise Brain" read model: deterministic, IO-free, composed entirely from models the platform
 * already produces (Resource Graph, ERP Relationship Graph, Timeline events, discovered attributes). The backend
 * provider calls this and exposes the result read-only over the secure IPC bridge + a diagnostics probe + the
 * Executive Center KPI strip — reusing every existing runtime.
 */
import type { ExecutiveKpi } from '../types/executiveCenter';
import type { RelationshipGraphModel } from '../types/enterpriseRelationship';
import type { ResourceGraphModel } from '../infra/resourceGraph';
import {
  analyzeDependencies,
  buildEnterpriseGraph,
  type DependencyReport,
  type EnterpriseEdge,
  type EnterpriseGraphModel,
  type EnterpriseNode,
} from './enterpriseGraph';
import { computeEnterpriseHealth, computeEnterpriseRisk, healthKpis, riskKpis, type EnterpriseHealthReport, type EnterpriseRiskReport } from './enterpriseHealth';
import { computeEnterpriseDrift, driftKpis, type DomainDriftInput, type EnterpriseDriftReport } from './enterpriseDrift';
import { capacityKpis, computeEnterpriseCapacity, type CapacityReport } from './enterpriseCapacity';
import { correlateIncidents, incidentKpis, type CorrelationEvent, type IncidentReport } from './enterpriseRootCause';
import { buildEnterpriseRecommendations, type IntelRecommendation } from './enterpriseRecommendation';

export interface EnterpriseIntelligenceInput {
  resource?: ResourceGraphModel | null;
  relationship?: RelationshipGraphModel | null;
  extraNodes?: EnterpriseNode[];
  extraEdges?: EnterpriseEdge[];
  events?: CorrelationEvent[];
  drift?: DomainDriftInput[];
  previousResourceCount?: number | null;
  complianceSignal?: number | null;
  incidentWindowMs?: number;
}

export interface EnterpriseGraphSummary {
  nodes: number;
  edges: number;
  byDomain: Record<string, number>;
  crossDomainEdges: number;
  truncated: boolean;
}

export interface EnterpriseIntelligenceReport {
  graph: EnterpriseGraphSummary;
  health: EnterpriseHealthReport;
  risk: EnterpriseRiskReport;
  dependencies: DependencyReport;
  drift: EnterpriseDriftReport;
  capacity: CapacityReport;
  incidents: IncidentReport;
  recommendations: IntelRecommendation[];
  kpis: ExecutiveKpi[];
  generatedAt: string;
}

function summarize(model: EnterpriseGraphModel): EnterpriseGraphSummary {
  return { nodes: model.nodes.length, edges: model.edges.length, byDomain: model.byDomain, crossDomainEdges: model.crossDomainEdges, truncated: model.truncated };
}

/** Build the unified Enterprise Graph and run every P7 engine into one report. Pure + deterministic. */
export function composeEnterpriseIntelligence(input: EnterpriseIntelligenceInput, nowMs: number): EnterpriseIntelligenceReport {
  const model = buildEnterpriseGraph({ resource: input.resource, relationship: input.relationship, extraNodes: input.extraNodes, extraEdges: input.extraEdges }, nowMs);
  const dependencies = analyzeDependencies(model, nowMs);
  const drift = computeEnterpriseDrift(input.drift ?? [], nowMs);
  const risk = computeEnterpriseRisk({ model, dependencies, driftSeverity: drift.severity }, nowMs);
  const health = computeEnterpriseHealth({ model, risk, dependencies, complianceSignal: input.complianceSignal }, nowMs);
  const capacity = computeEnterpriseCapacity({ resources: input.resource?.resources ?? [], previousResourceCount: input.previousResourceCount }, nowMs);
  const incidents = correlateIncidents({ events: input.events ?? [], model, windowMs: input.incidentWindowMs }, nowMs);
  const recommendations = buildEnterpriseRecommendations({ health, risk, dependencies, drift, capacity, incidents }, nowMs);

  const kpis: ExecutiveKpi[] = [
    ...healthKpis(health),
    ...riskKpis(risk).slice(0, 1),
    ...driftKpis(drift),
    ...capacityKpis(capacity),
    ...incidentKpis(incidents),
  ];

  return {
    graph: summarize(model),
    health,
    risk,
    dependencies,
    drift,
    capacity,
    incidents,
    recommendations,
    kpis,
    generatedAt: new Date(nowMs).toISOString(),
  };
}
