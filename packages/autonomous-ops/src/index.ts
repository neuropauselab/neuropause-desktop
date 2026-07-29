/**
 * @neuropause/autonomous-ops — NeuroPause Enterprise Management System, Wave 12: the Enterprise
 * Autonomous Operations Platform. The ONE operations plane that coordinates humans, AI workers,
 * departments, business processes, projects, resources, facilities, and multiple organizations by
 * COMPOSING Waves 1–11 (unchanged) on the existing runtime, audit chain, event bus, and HITL gate.
 *
 * Named packages/autonomous-ops (not packages/operations, which already exists as a base package)
 * to preserve the additive/immutable constraint — Wave 12 reuses that base package's IncidentRegistry
 * rather than duplicating it.
 *
 * HONESTY BOUNDARY (see OPERATIONS_MATRIX):
 *   live-verified          — runtime/mission-control/command-center/digital-twin-model/orchestration/
 *                            planning/scheduler/optimization/continuity/incidents/SLA/workforce-
 *                            orchestration/war-room/SDK/marketplace/governance (in-process).
 *   adapter-verified       — external monitoring/incident/IoT/MES/ERP systems (until configured).
 *   business-data-pending  — live missions, health/alerts, KPIs, twin STATE, capacity, simulations
 *                            (projections), forecasts, SLA compliance, intelligence answers — never fabricated.
 *   regulated-external     — autonomous emergency/financial/production/healthcare/legal/security/
 *                            board/regulatory actions — represented only, never executed.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './adapters';
export * from './runtime';
export * from './missionControl';
export * from './commandCenter';
export * from './digitalTwin';
export * from './orchestration';
export * from './missionPlanning';
export * from './scheduler';
export * from './optimization';
export * from './simulation';
export * from './predictive';
export * from './continuity';
export * from './incidents';
export * from './sla';
export * from './workforceOrchestration';
export * from './warRoom';
export * from './intelligence';
export * from './sdk';
export * from './marketplace';
export * from './evidence';
export * from './platform';
