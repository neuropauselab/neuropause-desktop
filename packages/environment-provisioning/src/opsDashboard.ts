/**
 * EPIC 11 — Operations Dashboard. Distinguishes Pending / Provisioning / Failed / Verified across the
 * provisioning steps. Only real evidence moves an item to Verified — this control plane provisions
 * nothing, so `verified` is always 0 and no simulated value is shown.
 */
import { NO_PROVISIONING_DATA } from './constants';
import type { ProvisioningStep } from './types';

export interface DashboardSnapshot {
  total: number;
  pending: number;
  provisioning: number;
  failed: number;
  verified: 0;
  productionData: string;
}

export class ProvisioningDashboard {
  /** Snapshot over the latest provisioning steps. `prepared` shows as 'provisioning' (in progress). */
  snapshot(steps: ProvisioningStep[]): DashboardSnapshot {
    return {
      total: steps.length,
      pending: steps.filter((s) => s.status === 'pending').length,
      provisioning: steps.filter((s) => s.status === 'prepared' || s.status === 'provisioning').length,
      failed: steps.filter((s) => s.status === 'failed').length,
      verified: 0, // only real evidence promotes to Verified
      productionData: NO_PROVISIONING_DATA,
    };
  }
}
