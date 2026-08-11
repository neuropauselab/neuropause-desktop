/**
 * P10 — Federation Platform composition root.
 *
 * The intelligence / governance / integration LAYER over the existing federation runtime
 * (Phase 9 · Stage 2). It composes the EXISTING federation stores (peers/trust/shares, the
 * signed exchange, cross-org governance) into unified projections — a federation graph, a
 * unified timeline, discovery/search, an org directory, and analytics — behind RBAC-gated IPC,
 * registers the Federation Search source with Enterprise Search, and (in runtimeCore) hardens
 * the previously-unguarded federation runtime handlers with `withFederationAuthz`. No new
 * runtime, store, package format, PKI, graph, search, or governance engine.
 *
 * Reads: `fedStore` (runtime), `exchangeStore` (exchange), `globalGovStore` (governance).
 * Reuses the existing `fed:event` broadcast for renderer liveness — no new broadcast channel.
 */
import { EmptyRequest, FederationSearchRequest, IpcChannel } from '@neuropause/shared';
import type { FederationSearchRequest as TFederationSearchRequest } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { fedStore } from '../federation/runtime/fedInstance';
import { activeTenantScope, onWorkspaceSwitch } from '../enterprise/index';
import { orgStore } from '../enterprise/org/orgInstance';
import { exchangeStore } from '../federation/exchange/exchangeInstance';
import { globalGovStore } from '../federation/governance/globalGovInstance';
import { FederationPlatformService, type FederationReaders } from './federationPlatformService';
import { withFederationAuthz } from './federationAuthz';
import { setFederationSearcher } from './searcherInstance';

const log = createLogger('federation-platform');

export interface FederationPlatformSubsystem {
  handlers: SecureHandlerDef[];
  service: FederationPlatformService;
  dispose: () => void;
}

/**
 * Compose the governance summary the analytics rollup needs from the EXISTING governance engine
 * (globalGovStore) — the same inputs the federation admin overview already uses. No new engine.
 */
function govSummary() {
  const rules = globalGovStore.compliance({
    signedArtifacts: exchangeStore.listArtifacts().every((a) => a.versions.every((v) => v.signature.algorithm === 'ed25519')),
    activePeers: fedStore.peers().filter((p) => p.status === 'active').length,
    attestedPeers: fedStore.peers().filter((p) => p.status === 'active' && fedStore.trustFor(p.id) !== null).length,
    residencyHonored: true,
  });
  return globalGovStore.summary(rules);
}

export function initFederationPlatform(): FederationPlatformSubsystem {
  /**
   * P13C N10 — RESOLVED PER CALL, NOT CAPTURED AT INIT.
   *
   * `home` was read once during boot and `homeOrgId` was `home?.id ?? ORG_ID`.
   * Two problems in one line: the value could not follow a tenant switch,
   * because it was frozen at startup; and when no federation home row existed
   * it named the SEEDED organization, so the platform identified itself as a
   * tenant it had nothing to do with. `homeOrgId` is not decorative —
   * `federationModel` compares it against `artifact.publisherOrg` to decide
   * which PRIVATE artifacts are visible.
   *
   * Both readers are now functions evaluated at read time, preferring the
   * federation home row and otherwise the caller's own resolved tenant. An
   * unresolved tenant yields an empty id, which matches no publisher — so the
   * private-artifact test denies rather than admitting the seed org's.
   */
  const resolveHome = (): { id: string; name: string } | null => {
    const row = fedStore.listOrgs().find((o) => o.role === 'home');
    if (row) return { id: row.id, name: row.name };
    const scope = activeTenantScope();
    if (scope === null) return null;
    const org = orgStore.organization(scope.tenantId);
    return org ? { id: org.id, name: org.name } : { id: scope.tenantId, name: 'NeuroPause' };
  };

  const readers: FederationReaders = {
    homeOrgId: () => resolveHome()?.id ?? '',
    homeOrgName: () => resolveHome()?.name ?? 'NeuroPause',
    orgs: () => fedStore.listOrgs(),
    invitations: () => fedStore.listInvitations(),
    trust: () => fedStore.listTrust(),
    shared: () => fedStore.listShared(),
    artifacts: () => exchangeStore.listArtifacts(),
    policies: () => globalGovStore.listPolicies(),
    approvals: () => globalGovStore.listApprovals(),
    audit: () => globalGovStore.listAudit(),
    summary: () => fedStore.summary(),
    scopes: () => exchangeStore.scopeSummary(),
    govSummary,
  };

  const service = new FederationPlatformService(readers, activeTenantScope);

  // Invalidate the memoized snapshot whenever a backing store changes (renderer liveness is
  // already served by the existing `fed:event` broadcast the federation runtime emits).
  const invalidate = (): void => service.invalidate();
  fedStore.on('changed', invalidate);
  exchangeStore.on('changed', invalidate);
  globalGovStore.on('changed', invalidate);
  /**
   * P13C N10 — DROP THE SNAPSHOT ON A TENANT SWITCH.
   *
   * The service memoises the whole federation state on first read and only
   * invalidated when a BACKING STORE changed. Switching organizations changes
   * none of those stores, so the memo survived the switch and kept serving the
   * previous tenant's home identity — which is what decides private-artifact
   * visibility. This is the same residue seam every other subsystem registers
   * with, rather than a second invalidation mechanism.
   */
  onWorkspaceSwitch(() => invalidate());

  // Register the Federation Search source with the ONE Enterprise Search engine.
  setFederationSearcher({ search: (text, limit) => service.searchHits(text, limit) });

  const rawHandlers: SecureHandlerDef[] = [
    { channel: IpcChannel.FederationGraph, schema: EmptyRequest, handler: () => service.graph() },
    { channel: IpcChannel.FederationTimeline, schema: EmptyRequest, handler: () => service.timeline() },
    { channel: IpcChannel.FederationDirectory, schema: EmptyRequest, handler: () => service.directory() },
    { channel: IpcChannel.FederationAnalytics, schema: EmptyRequest, handler: () => service.analytics() },
    { channel: IpcChannel.FederationOverview, schema: EmptyRequest, handler: () => service.overview() },
    {
      channel: IpcChannel.FederationSearch,
      schema: FederationSearchRequest,
      handler: (p) => {
        const r = p as TFederationSearchRequest;
        return service.search(r.text, r.kinds, r.limit);
      },
    },
  ];
  const handlers = withFederationAuthz(rawHandlers);

  const dispose = (): void => {
    fedStore.off('changed', invalidate);
    exchangeStore.off('changed', invalidate);
    globalGovStore.off('changed', invalidate);
    setFederationSearcher(null);
  };

  log.info('Federation Platform ready', { orgs: readers.orgs().length, artifacts: readers.artifacts().length });
  return { handlers, service, dispose };
}
