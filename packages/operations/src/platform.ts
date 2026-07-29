/**
 * Operations platform composition root (NCEA 15.0, Phase 11). `createOperations
 * Platform(runtime)` assembles the ONE reliability & operations plane onto the
 * existing Enterprise Runtime — its audit chain, event bus, metrics registry,
 * scheduler, and health system. It exposes the operations API surface a host wires
 * onto its runtime facade: operations / health / reliability / incidents / metrics
 * / tracing / performance / deployments / disasterRecovery / capacity. One health
 * truth, one metrics registry, one scheduler, one audit chain — nothing duplicated.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { OPERATIONS_VERSION } from './constants';
import { HealthRegistry } from './health';
import { ReliabilityRegistry } from './reliability';
import { CoordinationPlatform } from './coordination';
import { JobQueue } from './jobs';
import { DisasterRecovery, MemoryBackupTarget, DEFAULT_OBJECTIVES, type BackupTarget, type RecoveryObjectives, type DrEvent } from './dr';
import { Tracer } from './tracing';
import { OperationsObservability } from './observability';
import { PerformanceMonitor } from './performance';
import { DeploymentManager } from './deployment';
import { OperationalSecurity, type ThreatSource, type ThreatSeverity } from './opsSecurity';
import { IncidentRegistry } from './incidents';
import { recordOp } from './opsAudit';
import { OPERATIONS_MATRIX, readinessSummary, type CapabilityEntry } from './matrix';

export interface OperationsPlatformOptions {
  clock?: Clock;
  nodeId?: string;
  /** DR target. Defaults to an in-memory target so disasterRecovery() always exists. */
  backupTarget?: BackupTarget;
  objectives?: RecoveryObjectives;
  /** The Phase-14 security service — its threat stream feeds operational security. */
  security?: ThreatSource;
  incidentThreshold?: ThreatSeverity;
  /** Register the job-queue drain loop on the runtime scheduler. Default true. */
  attachJobDrain?: boolean;
  jobDrainIntervalMs?: number;
}

export interface OperationsOverview {
  version: string;
  health: { status: string; ready: boolean; degradation: string };
  incidents: { total: number; open: number };
  reliabilityPolicies: number;
  jobs: { total: number; dead: number; depth: number };
  deployment: string | undefined;
  lastDrDrill: { recovered: boolean; withinRto: boolean } | undefined;
}

export interface OperationsPlatform {
  version: string;
  operations(): { overview(): OperationsOverview };
  health(): HealthRegistry;
  reliability(): ReliabilityRegistry;
  incidents(): IncidentRegistry;
  metrics(): OperationsObservability;
  tracing(): Tracer;
  performance(): PerformanceMonitor;
  deployments(): DeploymentManager;
  disasterRecovery(): DisasterRecovery;
  capacity(): {
    forecast(params: { currentThroughputPerSec: number; utilization: number; targetUtilization?: number }): ReturnType<PerformanceMonitor['forecastCapacity']>;
    memory(): ReturnType<PerformanceMonitor['memory']>;
  };
  // extras beyond the ten headline APIs
  jobs(): JobQueue;
  coordination(): CoordinationPlatform;
  opsSecurity(): OperationalSecurity;
  observability(): OperationsObservability;
  matrix(): CapabilityEntry[];
  readiness(): ReturnType<typeof readinessSummary>;
}

export function createOperationsPlatform(runtime: EnterpriseRuntime, options: OperationsPlatformOptions = {}): OperationsPlatform {
  const clock = options.clock ?? systemClock;
  const metricsRegistry = runtime.observability().metrics;
  const auditSink = runtime.audit();

  const health = new HealthRegistry(clock, () => runtime.health());
  const reliability = new ReliabilityRegistry(clock, { metrics: metricsRegistry });
  const coordination = new CoordinationPlatform(clock, { ...(options.nodeId !== undefined ? { nodeId: options.nodeId } : {}) });
  const jobs = new JobQueue(clock, {
    metrics: metricsRegistry,
    onEvent: (evt) => recordOp(auditSink, clock, { action: `op.job.${evt.kind}`, target: evt.job.type, payload: { id: evt.job.id, state: evt.job.state, attempts: evt.job.attempts } }),
  });
  const observability = new OperationsObservability(runtime, clock);
  const tracer = new Tracer(clock, { newTraceId: () => runtime.observability().newTraceId(), metrics: metricsRegistry });
  const performance = new PerformanceMonitor(clock, { metrics: metricsRegistry });
  const deployments = new DeploymentManager(clock, {
    audit: auditSink,
    metrics: metricsRegistry,
    healthGate: () => {
      const r = health.aggregate();
      return { ready: r.ready, status: r.status };
    },
  });
  const opsSecurity = new OperationalSecurity(clock, {
    audit: auditSink,
    metrics: metricsRegistry,
    ...(options.security !== undefined ? { security: options.security } : {}),
    ...(options.incidentThreshold !== undefined ? { incidentThreshold: options.incidentThreshold } : {}),
  });
  const incidents = new IncidentRegistry(clock, { audit: auditSink, metrics: metricsRegistry });

  const drTarget = options.backupTarget ?? new MemoryBackupTarget();
  const disasterRecovery = new DisasterRecovery(drTarget, clock, options.objectives ?? DEFAULT_OBJECTIVES, {
    metrics: metricsRegistry,
    onEvent: (evt: DrEvent) => recordOp(auditSink, clock, { action: `op.dr.${evt.kind}`, target: 'disaster-recovery', payload: evt.detail }),
  });

  // Register the job drain loop on the EXISTING scheduler (one scheduler, not a new one).
  if (options.attachJobDrain !== false && !runtime.scheduler().names().includes('ops.jobs.drain')) {
    jobs.attachToScheduler(runtime.scheduler(), options.jobDrainIntervalMs ?? 1000);
  }

  return {
    version: OPERATIONS_VERSION,
    operations: () => ({
      overview: (): OperationsOverview => {
        const h = health.aggregate();
        const inc = incidents.status();
        const js = jobs.stats();
        const dr = disasterRecovery.lastReport();
        return {
          version: OPERATIONS_VERSION,
          health: { status: h.status, ready: h.ready, degradation: h.degradation },
          incidents: { total: inc.total, open: inc.open },
          reliabilityPolicies: 0, // policies are defined by the host; count is informational
          jobs: { total: js.total, dead: js.byState.dead, depth: js.depth },
          deployment: deployments.current(),
          lastDrDrill: dr ? { recovered: dr.recovered, withinRto: dr.withinRto } : undefined,
        };
      },
    }),
    health: () => health,
    reliability: () => reliability,
    incidents: () => incidents,
    metrics: () => observability,
    tracing: () => tracer,
    performance: () => performance,
    deployments: () => deployments,
    disasterRecovery: () => disasterRecovery,
    capacity: () => ({
      forecast: (params) => performance.forecastCapacity(params),
      memory: () => performance.memory(),
    }),
    jobs: () => jobs,
    coordination: () => coordination,
    opsSecurity: () => opsSecurity,
    observability: () => observability,
    matrix: () => OPERATIONS_MATRIX,
    readiness: () => readinessSummary(),
  };
}
