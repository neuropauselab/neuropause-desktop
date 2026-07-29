/**
 * Wave 12 composition root. `createAutonomousOpsPlatform(runtime, …)` assembles the enterprise
 * autonomous-operations layer on the EXISTING platform: it reuses the one runtime audit chain +
 * event bus (operations governance), the Wave 4 HITL gate (regulated-operation gating), the
 * @neuropause/operations IncidentRegistry (incident management), and — when provided — the Wave 8
 * business, Wave 10 workplace, Wave 11 workforce, and Wave 7 cloud-ops platforms (real operational
 * data, AI workers, and disaster recovery), plus the Wave 5 execution platform (reused connector
 * count). No subsystem is duplicated. Exposes the operations API surface, the evidence matrix, and
 * readiness. Autonomous emergency/financial/production/healthcare/legal/security/board/regulatory
 * actions are represented only — never executed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { HumanInTheLoopGate, type OperationClass } from '@neuropause/automation';
import type { ExecutionPlatform } from '@neuropause/execution';
import { OPS_VERSION, REGULATED_OPS, type RegulatedOp } from './constants';
import { OPERATIONS_MATRIX, operationsReadiness, type CapabilityEvidence, type OperationsReadiness } from './evidence';
import type { OpsContext, BusinessPlatform, WorkplacePlatform, WorkforcePlatform, CloudOpsPlatform } from './types';
import { OperationsGovernance } from './governance';
import { OpsAdapterRegistry } from './adapters';
import { OperationsRuntime } from './runtime';
import { MissionControl } from './missionControl';
import { CommandCenter } from './commandCenter';
import { DigitalTwin } from './digitalTwin';
import { OrchestrationEngine } from './orchestration';
import { MissionPlanningEngine } from './missionPlanning';
import { OperationsScheduler } from './scheduler';
import { ResourceOptimization } from './optimization';
import { SimulationEngine } from './simulation';
import { PredictiveOperations } from './predictive';
import { BusinessContinuity } from './continuity';
import { IncidentManagement } from './incidents';
import { SLAPlatform } from './sla';
import { WorkforceOrchestration } from './workforceOrchestration';
import { WarRoom } from './warRoom';
import { EnterpriseIntelligence } from './intelligence';
import { OperationsSDK } from './sdk';
import { OperationsMarketplace } from './marketplace';

export interface AutonomousOpsPlatformOptions {
  clock?: Clock;
  business?: BusinessPlatform;
  workplace?: WorkplacePlatform;
  workforce?: WorkforcePlatform;
  cloudops?: CloudOpsPlatform;
  execution?: ExecutionPlatform;
}

export interface AutonomousOpsPlatform {
  version: string;
  // operations API surface (M1–M20)
  runtime(): OperationsRuntime;
  missionControl(): MissionControl;
  commandCenter(): CommandCenter;
  digitalTwin(): DigitalTwin;
  orchestration(): OrchestrationEngine;
  planning(): MissionPlanningEngine;
  scheduler(): OperationsScheduler;
  optimization(): ResourceOptimization;
  simulation(): SimulationEngine;
  predictive(): PredictiveOperations;
  continuity(): BusinessContinuity;
  incidents(): IncidentManagement;
  sla(): SLAPlatform;
  workforceOrchestration(): WorkforceOrchestration;
  warRoom(): WarRoom;
  intelligence(): EnterpriseIntelligence;
  sdk(): OperationsSDK;
  marketplace(): OperationsMarketplace;
  adapters(): OpsAdapterRegistry;
  governance(): OperationsGovernance;
  // reuse + honesty accessors
  hitl(): HumanInTheLoopGate;
  classifyOperation(operation: string): OperationClass;
  regulatedOperations(): readonly RegulatedOp[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): OperationsReadiness;
}

export function createAutonomousOpsPlatform(runtime: EnterpriseRuntime, options: AutonomousOpsPlatformOptions = {}): AutonomousOpsPlatform {
  const clock = options.clock ?? systemClock;
  const ctx: OpsContext = {
    ...(options.business ? { business: options.business } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.cloudops ? { cloudops: options.cloudops } : {}),
  };

  const governance = new OperationsGovernance(runtime, clock);
  const hitl = new HumanInTheLoopGate();

  const adapters = new OpsAdapterRegistry(governance);
  const opsRuntime = new OperationsRuntime(clock, governance);
  const missionControl = new MissionControl(clock, governance, opsRuntime);
  const commandCenter = new CommandCenter(ctx);
  const digitalTwin = new DigitalTwin(governance, ctx);
  const orchestration = new OrchestrationEngine(clock, governance);
  const planning = new MissionPlanningEngine(clock, governance, ctx);
  const scheduler = new OperationsScheduler(clock, governance);
  const optimization = new ResourceOptimization(ctx);
  const simulation = new SimulationEngine(clock, governance);
  const predictive = new PredictiveOperations(governance);
  const continuity = new BusinessContinuity(clock, governance, ctx);
  // incident management REUSES the @neuropause/operations registry, wired to the ONE audit chain
  const incidents = new IncidentManagement(clock, governance, runtime.audit());
  const sla = new SLAPlatform(clock, governance);
  const workforceOrchestration = new WorkforceOrchestration(clock, governance, ctx);
  const warRoom = new WarRoom(clock, governance);
  const intelligence = new EnterpriseIntelligence(ctx);
  const sdk = new OperationsSDK(clock, governance);
  const marketplace = new OperationsMarketplace(clock, governance);

  return {
    version: OPS_VERSION,
    runtime: () => opsRuntime,
    missionControl: () => missionControl,
    commandCenter: () => commandCenter,
    digitalTwin: () => digitalTwin,
    orchestration: () => orchestration,
    planning: () => planning,
    scheduler: () => scheduler,
    optimization: () => optimization,
    simulation: () => simulation,
    predictive: () => predictive,
    continuity: () => continuity,
    incidents: () => incidents,
    sla: () => sla,
    workforceOrchestration: () => workforceOrchestration,
    warRoom: () => warRoom,
    intelligence: () => intelligence,
    sdk: () => sdk,
    marketplace: () => marketplace,
    adapters: () => adapters,
    governance: () => governance,
    hitl: () => hitl,
    classifyOperation: (operation: string) => hitl.classify(operation),
    regulatedOperations: () => REGULATED_OPS,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => OPERATIONS_MATRIX,
    readiness: () => operationsReadiness(),
  };
}
