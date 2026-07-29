/**
 * EPIC 12 — Operations Dashboard. Reports automation status, pending/executed(prepared)/failed tasks,
 * verification status, and rollback status from the engine's real in-process run history. It shows NO
 * simulated production metrics: `verified` is always 0 here because real verification happens out-of-band
 * through the evidence-promotion process, and this control plane applies nothing.
 */
import { NO_AUTOMATION_DATA } from './constants';
import type { InfrastructureAutomationEngine } from './engine';

export interface DashboardDeps {
  engine: InfrastructureAutomationEngine;
}

export interface DashboardSnapshot {
  automations: number;
  previewed: number;
  prepared: number;
  approvalRequired: number;
  failed: number;
  rollbacksPlanned: number;
  verified: 0;
  productionMetrics: string;
}

export class OperationsDashboard {
  constructor(private readonly deps: DashboardDeps) {}

  snapshot(): DashboardSnapshot {
    const runs = this.deps.engine.history();
    return {
      automations: this.deps.engine.automationCount(),
      previewed: runs.filter((r) => r.status === 'previewed').length,
      prepared: runs.filter((r) => r.status === 'prepared').length,
      approvalRequired: runs.filter((r) => r.result === 'approval-required').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      rollbacksPlanned: runs.filter((r) => r.status === 'rolled-back').length,
      verified: 0, // real verification is out-of-band via the evidence-promotion process
      productionMetrics: NO_AUTOMATION_DATA,
    };
  }
}
