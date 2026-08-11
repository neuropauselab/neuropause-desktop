/**
 * P13 — Industry Solution Platform composition root.
 *
 * The industry-solutions LAYER over the existing platform. It composes a read-only snapshot from
 * the EXISTING store singletons — the worker registry, the connector registry + connected accounts,
 * the enterprise governance rules, the workforce policy defaults, and the marketplace — into a
 * curated solution-pack catalog and readiness projection (suites, KPIs, compliance frameworks,
 * marketplace collections), behind RBAC-gated IPC (`industry:read`). No new store, runtime, worker,
 * connector, or marketplace — a projection over data the platform already owns. Reuses the existing
 * `ecosystem:event` broadcast for renderer liveness.
 */
import { EmptyRequest, IpcChannel } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { DEFAULT_POLICIES } from '../workforce/governance/policyEngine';
import { connectorStore } from '../connectors/connectorStore';
import { connectorService } from '../connectors/connectorService';
import { CONNECTOR_MANIFESTS } from '../connectors/manifests';
import { governanceStore } from '../enterprise/governance/governanceInstance';
import { marketplaceStore } from '../ecosystem/marketplace/marketplaceInstance';
import { IndustryPlatformService } from './industryService';
import type { IndustryPlatformState } from './industryModel';
import { withIndustryAuthz } from './industryAuthz';
import { getCanonicalIndustrySnapshot } from './canonicalIndustryCatalog';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('industry-platform');

export interface IndustryPlatformSubsystem {
  handlers: SecureHandlerDef[];
  service: IndustryPlatformService;
  dispose: () => void;
}

/** Compose the industry snapshot from the EXISTING platform stores (no new store). */
function readState(): IndustryPlatformState {
  const connectorLabels: Record<string, string> = {};
  const supportedConnectorIds: string[] = [];
  for (const m of CONNECTOR_MANIFESTS) {
    connectorLabels[m.id] = m.name;
    supportedConnectorIds.push(m.id);
  }
  // A connector counts as "connected" only when it has an account in the genuinely-connected state —
  // accounts stuck in error / reauth_required / connecting must not inflate deployment activation.
  const connectedConnectorIds = [
    ...new Set(
      connectorStore
        .all()
        .filter((a) => a.status === 'connected')
        .map((a) => a.connectorId),
    ),
  ];

  return {
    workerIds: workerRegistry.summaries().map((w) => w.id),
    supportedConnectorIds,
    connectedConnectorIds,
    connectorLabels,
    complianceRules: governanceStore.rules().map((r) => ({ id: r.id, enabled: r.enabled })),
    policyIds: DEFAULT_POLICIES.map((p) => p.id),
    publishedSlugs: marketplaceStore
      .list()
      .filter((l) => l.status === 'published')
      .map((l) => l.slug),
  };
}

export function initIndustryPlatform(): IndustryPlatformSubsystem {
  const service = new IndustryPlatformService({ scope: activeTenantScope, readState });

  // Invalidate the memoized snapshot whenever a backing store changes (renderer liveness is already
  // served by the existing `ecosystem:event` broadcast the ecosystem subsystem emits).
  const invalidate = (): void => service.invalidate();
  workerRegistry.on('changed', invalidate);
  // The connector *store* is not an emitter; connector connect/disconnect/health changes surface on
  // the connector *service*'s 'event' stream, so hook that for connector-activation liveness.
  connectorService.on('event', invalidate);
  governanceStore.on('changed', invalidate);
  marketplaceStore.on('changed', invalidate);

  const rawHandlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.IndustryOverview,
      schema: EmptyRequest,
      handler: () => service.overview(),
    },
    { channel: IpcChannel.IndustrySuites, schema: EmptyRequest, handler: () => service.suites() },
    { channel: IpcChannel.IndustryKpis, schema: EmptyRequest, handler: () => service.kpis() },
    {
      channel: IpcChannel.IndustryCompliance,
      schema: EmptyRequest,
      handler: () => service.compliance(),
    },
    {
      channel: IpcChannel.IndustryCollections,
      schema: EmptyRequest,
      handler: () => service.collections(),
    },
    {
      channel: IpcChannel.IndustryReadiness,
      schema: EmptyRequest,
      handler: () => service.readiness(),
    },
    // IP-03b convergence — the canonical Wave 9 catalog snapshot (additive; separate from the
    // P13 store-derived projections above). RBAC-gated (industry:read) + audited via withIndustryAuthz.
    {
      channel: IpcChannel.IndustrySnapshot,
      schema: EmptyRequest,
      handler: () => getCanonicalIndustrySnapshot(),
    },
  ];
  const handlers = withIndustryAuthz(rawHandlers);

  const dispose = (): void => {
    workerRegistry.off('changed', invalidate);
    connectorService.off('event', invalidate);
    governanceStore.off('changed', invalidate);
    marketplaceStore.off('changed', invalidate);
  };

  log.info('Industry Solution Platform ready', {
    suites: service.suites().length,
    frameworks: service.compliance().totalFrameworks,
  });
  return { handlers, service, dispose };
}
