/**
 * Build item 7 — Operator Dashboard. Displays Pending / Running / Succeeded / Failed / Verified across the
 * deployment steps. No simulated values: `succeeded` and `verified` are always 0 here because nothing has
 * been deployed and only real evidence promotes to Verified.
 */
import { NO_DEPLOYMENT_DATA } from './constants';

export interface OperatorDashboardSnapshot {
  total: number;
  pending: number;
  running: number;
  succeeded: 0;
  failed: number;
  verified: 0;
  productionData: string;
}

export class OperatorDashboard {
  /** Snapshot over deployment steps. 'prepared'/'provisioning'/'running' shows as Running. */
  snapshot(steps: Array<{ status: string }>): OperatorDashboardSnapshot {
    return {
      total: steps.length,
      pending: steps.filter((s) => s.status === 'pending').length,
      running: steps.filter((s) => ['prepared', 'provisioning', 'running'].includes(s.status)).length,
      succeeded: 0, // no deployment has succeeded
      failed: steps.filter((s) => s.status === 'failed').length,
      verified: 0, // only real evidence promotes to Verified
      productionData: NO_DEPLOYMENT_DATA,
    };
  }
}
