/**
 * P11 — Cloud Control Plane composition root.
 *
 * The global management/orchestration LAYER over the existing cloud subsystems. It composes a
 * snapshot from the EXISTING store singletons (multi-tenant runtime, API platform, cloud sync,
 * identity federation, cross-org federation, disaster recovery — plus gateway metrics, the org
 * runtime, the workforce registry, and billing) into unified fleet / region / tenant / deployment
 * / usage projections, behind RBAC-gated IPC (`cloud:read`). It also hardens the previously
 * ungated cloud runtime handlers via `withCloudAuthz` (applied in runtimeCore). No new runtime,
 * store, or engine — a projection over data the subsystems already own. Reuses the existing
 * `cloud:event` broadcast for renderer liveness (no new broadcast channel).
 */
import { EmptyRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createLogger } from '../../logger';
import { tenancyStore } from '../tenancy/tenancyInstance';
import { apiPlatformStore } from '../apiplatform/apiPlatformInstance';
import { liveSync, onLiveSyncStatus } from '../livesync/liveSyncInstance';
import { federationStore } from '../identity/federationInstance';
import { gatewayStore } from '../../ecosystem/gateway/gatewayInstance';
import { workerRegistry } from '../../workforce/registry/registryInstance';
import { orgStore } from '../../enterprise/org/orgInstance';
import { billingStore } from '../../ecosystem/billing/billingInstance';
import { PLAN_CATALOG } from '../../ecosystem/billing/billing';
import { fedStore } from '../../federation/runtime/fedInstance';
import { drStore } from '../../federation/dr/drInstance';
import { ControlPlaneService } from './controlPlaneService';
import type { ControlPlaneState } from './controlPlaneModel';
import { withCloudAuthz } from './cloudAuthz';

const log = createLogger('control-plane');

export interface ControlPlaneSubsystem {
  handlers: SecureHandlerDef[];
  service: ControlPlaneService;
  dispose: () => void;
}

/** Compose the control-plane snapshot from the EXISTING subsystem stores (no new store). */
function readState(): ControlPlaneState {
  const now = Date.now();
  const requests30d = gatewayStore.metrics(30, now).requests;
  const sub = billingStore.getSubscription();
  const monthlySpend = PLAN_CATALOG[sub.planTier]?.priceMonthly ?? 0;
  return {
    regions: tenancyStore.regions(),
    tenants: tenancyStore.listTenants(),
    isolation: tenancyStore.listIsolation(),
    tenantSummary: tenancyStore.summary(),
    deployments: apiPlatformStore.listDeployments(),
    apiSummary: apiPlatformStore.summary(requests30d),
    liveSync: liveSync.getStatus(),
    identitySummary: federationStore.summary(),
    federationSummary: fedStore.summary(),
    drSummary: drStore.summary(),
    replicas: drStore.listReplicas(),
    organizations: orgStore.listOrganizations().length,
    workers: workerRegistry.summaries().length,
    requests30d,
    syncOps30d: liveSync.getStatus().cursor,
    monthlySpend,
    currency: 'USD',
  };
}

export function initControlPlane(): ControlPlaneSubsystem {
  const service = new ControlPlaneService({ readState });

  // Invalidate the memoized snapshot whenever a backing store changes (renderer liveness is
  // already served by the existing `cloud:event` / `fed:event` broadcasts those subsystems emit).
  const invalidate = (): void => service.invalidate();
  // Subscribe to EVERY store readState() reads, so no live metric (requests, workers, spend,
  // org count) goes stale — the memo invalidates on any backing-store change.
  tenancyStore.on('changed', invalidate);
  apiPlatformStore.on('changed', invalidate);
  const offLiveSync = onLiveSyncStatus(invalidate);
  federationStore.on('changed', invalidate);
  fedStore.on('changed', invalidate);
  drStore.on('changed', invalidate);
  gatewayStore.on('changed', invalidate);
  workerRegistry.on('changed', invalidate);
  orgStore.on('changed', invalidate);
  billingStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.ControlPlaneOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.ControlPlaneFleet, schema: EmptyRequest, handler: () => service.fleet() },
    { channel: IpcChannel.ControlPlaneRegions, schema: EmptyRequest, handler: () => service.regions() },
    { channel: IpcChannel.ControlPlaneTenants, schema: EmptyRequest, handler: () => service.tenants() },
    { channel: IpcChannel.ControlPlaneDeployments, schema: EmptyRequest, handler: () => service.deployments() },
    { channel: IpcChannel.ControlPlaneUsage, schema: EmptyRequest, handler: () => service.usage() },
  ];
  const handlers = withCloudAuthz(rawHandlers);

  const dispose = (): void => {
    tenancyStore.off('changed', invalidate);
    apiPlatformStore.off('changed', invalidate);
    offLiveSync();
    federationStore.off('changed', invalidate);
    fedStore.off('changed', invalidate);
    drStore.off('changed', invalidate);
    gatewayStore.off('changed', invalidate);
    workerRegistry.off('changed', invalidate);
    orgStore.off('changed', invalidate);
    billingStore.off('changed', invalidate);
  };

  log.info('Cloud Control Plane ready', {
    regions: tenancyStore.regions().length,
    tenants: tenancyStore.listTenants().length,
    deployments: apiPlatformStore.listDeployments().length,
  });
  return { handlers, service, dispose };
}
