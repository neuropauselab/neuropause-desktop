/**
 * P12 — Developer Platform composition root.
 *
 * The developer-experience LAYER over the existing ecosystem developer stack. It composes a
 * snapshot from the EXISTING store singletons (the developer registry, the marketplace, the
 * gateway, billing, and the public-API registry) into unified developer-console / SDK-registry /
 * API-explorer / template-registry / publishing / analytics projections, behind RBAC-gated IPC
 * (`developer:read`). It also hardens the previously-ungated ecosystem handlers via
 * `withEcosystemAuthz` (applied in runtimeCore). No new SDK, runtime, API server, or marketplace —
 * a projection over data the ecosystem stores already own. Reuses the existing `ecosystem:event`
 * broadcast for renderer liveness.
 */
import { EmptyRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createLogger } from '../../logger';
import { developerStore } from '../developer/developerInstance';
import { marketplaceStore } from '../marketplace/marketplaceInstance';
import { gatewayStore } from '../gateway/gatewayInstance';
import { billingStore } from '../billing/billingInstance';
import { planFor } from '../billing/billing';
import { apiPlatformStore } from '../../cloud/apiplatform/apiPlatformInstance';
import { SDK_ARTIFACTS } from '../index';
import { DeveloperPlatformService } from './developerPlatformService';
import type { DeveloperPlatformState } from './developerPlatformModel';
import { withEcosystemAuthz } from './ecosystemAuthz';

const log = createLogger('developer-platform');

export interface DeveloperPlatformSubsystem {
  handlers: SecureHandlerDef[];
  service: DeveloperPlatformService;
  dispose: () => void;
}

/** Compose the developer-platform snapshot from the EXISTING ecosystem stores (no new store). */
function readState(): DeveloperPlatformState {
  const now = Date.now();
  const dev = developerStore.defaultDeveloper();
  const since30 = now - 30 * 86_400_000;
  const usage = developerStore.usageFor(dev.id, since30);
  const errors = usage.filter((u) => u.status >= 400).length;
  const listings = marketplaceStore.list().filter((l) => l.developerId === dev.id);
  const stats = marketplaceStore.stats();

  const allVersions = marketplaceStore.allVersions();
  const versionsByListing: Record<string, number> = {};
  const versionById = new Map<string, string>();
  for (const v of allVersions) {
    versionsByListing[v.listingId] = (versionsByListing[v.listingId] ?? 0) + 1;
    versionById.set(v.id, v.version);
  }
  // O(V + L): resolve each listing's current version through a single id→version map built above,
  // instead of a per-listing `allVersions.find(...)` scan (which was O(L·V)).
  const currentVersionByListing: Record<string, string> = {};
  for (const l of listings) {
    if (!l.currentVersionId) continue;
    const cv = versionById.get(l.currentVersionId);
    if (cv) currentVersionByListing[l.id] = cv;
  }

  const plan = planFor(dev.planTier);
  const period = new Date(now).toISOString().slice(0, 7);
  const periodStart = Date.parse(`${period}-01T00:00:00.000Z`);
  const quotaUsed = developerStore.countSince(dev.id, periodStart);
  const publicApis = apiPlatformStore.listPublicApis();

  return {
    developerId: dev.id,
    developerName: dev.name,
    organization: dev.organization,
    planTier: dev.planTier,
    apiKeys: developerStore.keysFor(dev.id).length,
    oauthApps: developerStore.appsFor(dev.id).length,
    listings,
    versionsByListing,
    currentVersionByListing,
    pendingReview: stats.pendingReview,
    quotaLimit: plan.quota.limit,
    quotaUsed,
    requests30d: usage.length,
    errors30d: errors,
    gateway: gatewayStore.metrics(30, now),
    // Bound the analytics sample so the projection stays finite regardless of ledger size.
    usageSample: usage.slice(-2000).map((u) => ({ at: u.at, path: u.path, status: u.status })),
    publicApis,
    apiVersions: [...new Set(publicApis.map((a) => a.version))],
    sdkArtifacts: SDK_ARTIFACTS,
  };
}

export function initDeveloperPlatform(): DeveloperPlatformSubsystem {
  const service = new DeveloperPlatformService({ readState });

  // Invalidate the memoized snapshot whenever a backing store changes (renderer liveness is
  // already served by the existing `ecosystem:event` broadcast the ecosystem subsystem emits).
  const invalidate = (): void => service.invalidate();
  developerStore.on('changed', invalidate);
  marketplaceStore.on('changed', invalidate);
  gatewayStore.on('changed', invalidate);
  billingStore.on('changed', invalidate);
  apiPlatformStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.DevPlatformOverview, schema: EmptyRequest, handler: () => service.overview() },
    { channel: IpcChannel.DevPlatformConsole, schema: EmptyRequest, handler: () => service.console() },
    { channel: IpcChannel.DevPlatformSdks, schema: EmptyRequest, handler: () => service.sdks() },
    { channel: IpcChannel.DevPlatformApis, schema: EmptyRequest, handler: () => service.apis() },
    { channel: IpcChannel.DevPlatformTemplates, schema: EmptyRequest, handler: () => service.templates() },
    { channel: IpcChannel.DevPlatformPublishing, schema: EmptyRequest, handler: () => service.publishing() },
    { channel: IpcChannel.DevPlatformAnalytics, schema: EmptyRequest, handler: () => service.analytics() },
  ];
  const handlers = withEcosystemAuthz(rawHandlers);

  const dispose = (): void => {
    developerStore.off('changed', invalidate);
    marketplaceStore.off('changed', invalidate);
    gatewayStore.off('changed', invalidate);
    billingStore.off('changed', invalidate);
    apiPlatformStore.off('changed', invalidate);
  };

  log.info('Developer Platform ready', { listings: marketplaceStore.list().length, publicApis: apiPlatformStore.listPublicApis().length });
  return { handlers, service, dispose };
}
