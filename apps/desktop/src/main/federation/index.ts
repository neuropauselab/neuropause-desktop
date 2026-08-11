/**
 * Federation Platform composition root (Phase 9 · Stage 2) — the final
 * architectural layer. Loads the federation runtime (peers, invitations, trust,
 * shared resources), the organization exchange (signed/versioned artifacts), the
 * enterprise marketplace (visibility scopes), global governance (cross-org
 * policies + shared audit + delegated approvals), enterprise observability,
 * disaster recovery, and federation administration; wires their IPC handlers
 * behind the secure bridge; and emits a single `fed:event` broadcast on any
 * change so the renderer stays live.
 *
 * Reads across subsystems for the rollups: the workforce registry, the connector
 * service, cloud sync + the API platform + the API gateway, the knowledge graph,
 * and cloud tenancy.
 */
import {
  IpcChannel,
  EmptyRequest,
  FedInviteOrgRequest,
  FedRespondInviteRequest,
  FedSetTrustRequest,
  FedShareResourceRequest,
  FedRevokeShareRequest,
  FedPublishArtifactRequest,
  FedPublishVersionRequest,
  FedRateArtifactRequest,
  FedSetVerificationRequest,
  FedRollbackArtifactRequest,
  FedInstallArtifactRequest,
  FedVerifyVersionRequest,
  FedSetScopeRequest,
  FedAddPolicyRequest,
  FedSetPolicyEnabledRequest,
  FedResolveApprovalRequest,
  FedRecordActionRequest,
  FedCreateBackupRequest,
  FedRunValidationRequest,
  type ScalabilityBenchmark,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { createLogger } from '../logger';
import { demoSeedsEnabled } from '../demoSeed';
import { fedStore } from './runtime/fedInstance';
import { exchangeStore } from './exchange/exchangeInstance';
import { globalGovStore } from './governance/globalGovInstance';
import { observabilityStore } from './observability/observabilityInstance';
import { drStore } from './dr/drInstance';
import { buildObservability, type ObsInput } from './observability/observability';
import { buildFedAdmin } from './admin/fedAdmin';
import { buildScalabilityReport, type ScalabilityInput } from './scalability/scalability';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { connectorService } from '../connectors/connectorService';
import { liveSync } from '../cloud/livesync/liveSyncInstance';
import { apiPlatformStore } from '../cloud/apiplatform/apiPlatformInstance';
import { tenancyStore, CLOUD_REGIONS } from '../cloud/tenancy/tenancyInstance';
import { gatewayStore } from '../ecosystem/gateway/gatewayInstance';
import { graphStore } from '../graph/graphInstance';
import { activeTenantScope } from '../enterprise/index';

const log = createLogger('federation');

export interface FederationDeps {
  broadcast: IpcBroadcaster;
}

export interface FederationSubsystem {
  handlers: SecureHandlerDef[];
}

/** Representative engine benchmarks (measured over 5000 entities, 20ms budget). */
const BENCHMARKS: ScalabilityBenchmark[] = [
  { label: 'graph.project', valueMs: 8.67, budgetMs: 20 },
  { label: 'search.query', valueMs: 2.62, budgetMs: 20 },
  { label: 'memory.recall', valueMs: 1.8, budgetMs: 20 },
  { label: 'briefing.generate', valueMs: 4.34, budgetMs: 20 },
];

function complianceInputs() {
  const fedSummary = fedStore.summary();
  const arts = exchangeStore.listArtifacts();
  const activePeers = fedStore.peers().filter((p) => p.status === 'active');
  const attested = activePeers.filter((p) => fedStore.trustFor(p.id) !== null).length;
  return {
    signedArtifacts: arts.every((a) => a.versions.every((v) => v.signature.algorithm === 'ed25519')),
    activePeers: activePeers.length,
    attestedPeers: attested,
    residencyHonored: true,
    fedSummary,
  };
}

function buildObsInput(): ObsInput {
  const summaries = workerRegistry.summaries();
  const connectors = connectorService.stats();
  const sync = liveSync.getDetail();
  const requests30d = gatewayStore.metrics(30, Date.now()).requests;
  const api = apiPlatformStore.summary(requests30d);
  const fedSummary = fedStore.summary();
  return {
    orgs: fedStore.listOrgs().length,
    activePeers: fedSummary.activePeers,
    workers: summaries.length,
    workersDegraded: summaries.filter((w) => w.healthState === 'degraded' || w.healthState === 'unhealthy').length,
    connectorsTotal: connectors.total,
    connectorsHealthy: connectors.healthy,
    connectorsDegraded: connectors.degraded,
    connectorsDown: connectors.down,
    syncRecords: sync.entities.reduce((total, e) => total + e.synced, 0),
    syncPending: sync.status.pendingCount,
    syncState: sync.status.state,
    apiReplicas: api.replicas,
    apiHealthy: api.healthy,
    apiUptimePct: api.uptimePct,
    fedPeers: fedSummary.peers,
    fedTrusted: fedSummary.trustedPeers,
    security: observabilityStore.securityEvents(),
    usage: observabilityStore.usageSeries(),
  };
}

function buildScalabilityInput(): ScalabilityInput {
  return {
    tenants: tenancyStore.summary().tenants,
    orgs: fedStore.listOrgs().length,
    graphNodes: graphStore.counts().nodes,
    concurrentWorkers: workerRegistry.summaries().length,
    regions: CLOUD_REGIONS.length,
    // BENCHMARKS are hardcoded "measured" numbers, not values sampled on this install, so a production build
    // reports no benchmarks (empty list) rather than presenting fabricated figures as measured. They remain
    // available for local demos behind the demo-seed flag.
    benchmarks: demoSeedsEnabled() ? BENCHMARKS : [],
    now: Date.now(),
  };
}

function compliance() {
  const ci = complianceInputs();
  return globalGovStore.compliance({
    signedArtifacts: ci.signedArtifacts,
    activePeers: ci.activePeers,
    attestedPeers: ci.attestedPeers,
    residencyHonored: ci.residencyHonored,
  });
}

function adminOverview() {
  const rules = compliance();
  return buildFedAdmin({
    orgs: fedStore.listOrgs(),
    fedSummary: fedStore.summary(),
    govSummary: globalGovStore.summary(rules),
    drSummary: drStore.summary(),
    openSecurityEvents: observabilityStore.securityEvents().filter((e) => e.severity !== 'info').length,
  });
}

export async function initFederation(deps: FederationDeps): Promise<FederationSubsystem> {
  /**
   * P13C ROUND 4 — S-10. BIND BEFORE LOAD.
   *
   * `load()` seeds on a fresh install, and seeding writes rows that must carry
   * their parties. Binding first means those rows are stamped rather than
   * written unowned and then invisible to everyone.
   *
   * The exchange also needs to know whether the caller trusts a publisher, to
   * resolve `partner` scope. That answer lives in the runtime store, so it is
   * injected as a predicate rather than imported — the two halves of this
   * subsystem would otherwise be circular.
   */
  fedStore.bindScope(activeTenantScope);
  globalGovStore
    .bindScope(activeTenantScope)
    .bindPeerResolver((peerOrg) => fedStore.trustFor(peerOrg) !== null)
    /**
     * P13C ROUND 4 — the ACTOR NAME follows the actor.
     *
     * `actorOrg` was already the caller, but `actorOrgName`, `fromOrgName` and
     * `resolver` were all the literal 'NeuroPause' the store was constructed
     * with. So both parties to an approval read "resolved by NeuroPause" when
     * the other one resolved it — not a disclosure, but an integrity failure on
     * the one record this subsystem exists to produce.
     */
    .bindActorNameResolver(() => fedStore.homeOrg()?.name ?? 'Unknown organization');
  exchangeStore
    .bindScope(activeTenantScope)
    .bindTrustResolver((publisherOrg) => {
      const trust = fedStore.trustFor(publisherOrg);
      return trust !== null && trust.trustLevel !== 'none';
    })
    .bindRegionResolver(() => fedStore.homeOrg()?.regionId ?? null);

  await fedStore.load();
  await exchangeStore.load();
  await globalGovStore.load();
  await observabilityStore.load();
  await drStore.load();

  const emit = (kind: string): void => deps.broadcast(IpcChannel.FedEventBroadcast, { kind, at: new Date().toISOString() });
  fedStore.on('changed', () => emit('runtime'));
  exchangeStore.on('changed', () => emit('exchange'));
  globalGovStore.on('changed', () => emit('governance'));
  observabilityStore.on('changed', () => emit('observability'));
  drStore.on('changed', () => emit('dr'));

  const fedSummary = fedStore.summary();
  log.info('Federation runtime ready', {
    orgs: fedSummary.orgs,
    peers: fedSummary.peers,
    activePeers: fedSummary.activePeers,
    trustedPeers: fedSummary.trustedPeers,
  });
  log.info('Federation services ready', {
    artifacts: exchangeStore.listArtifacts().length,
    signingKey: exchangeStore.signingKeyId(),
    policies: globalGovStore.listPolicies().length,
    backups: drStore.listBackups().length,
    replicas: drStore.listReplicas().length,
  });

  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  return [
    /* ── Federation runtime ── */
    { channel: IpcChannel.FedOrgs, schema: EmptyRequest, handler: () => fedStore.listOrgs() },
    { channel: IpcChannel.FedSummary, schema: EmptyRequest, handler: () => fedStore.summary() },
    { channel: IpcChannel.FedInvitations, schema: EmptyRequest, handler: () => fedStore.listInvitations() },
    { channel: IpcChannel.FedTrust, schema: EmptyRequest, handler: () => fedStore.listTrust() },
    { channel: IpcChannel.FedShared, schema: EmptyRequest, handler: () => fedStore.listShared() },
    {
      channel: IpcChannel.FedInviteOrg,
      schema: FedInviteOrgRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedInviteOrgRequest;
        return fedStore.inviteOrg({ name: r.name, trustLevel: r.trustLevel, message: r.message });
      },
    },
    {
      channel: IpcChannel.FedRespondInvite,
      schema: FedRespondInviteRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedRespondInviteRequest;
        return fedStore.respondInvitation(r.id, r.accept) ?? { error: 'Invitation not found.' };
      },
    },
    {
      channel: IpcChannel.FedSetTrust,
      schema: FedSetTrustRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedSetTrustRequest;
        const patch: { trustLevel?: typeof r.trustLevel; delegatedApproval?: boolean; canShareWorkers?: boolean; canShareData?: boolean } = {};
        if (r.trustLevel !== undefined) patch.trustLevel = r.trustLevel;
        if (r.delegatedApproval !== undefined) patch.delegatedApproval = r.delegatedApproval;
        if (r.canShareWorkers !== undefined) patch.canShareWorkers = r.canShareWorkers;
        if (r.canShareData !== undefined) patch.canShareData = r.canShareData;
        return fedStore.setTrust(r.peerOrg, patch) ?? { error: 'Trust relationship not found.' };
      },
    },
    {
      channel: IpcChannel.FedShareResource,
      schema: FedShareResourceRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedShareResourceRequest;
        return fedStore.shareResource({ kind: r.kind, name: r.name, peerOrg: r.peerOrg, access: r.access });
      },
    },
    {
      channel: IpcChannel.FedRevokeShare,
      schema: FedRevokeShareRequest,
      audit: true,
      handler: (p) => ({ ok: fedStore.revokeShare((p as FedRevokeShareRequest).id) }),
    },

    /* ── Organization exchange ── */
    { channel: IpcChannel.FedArtifacts, schema: EmptyRequest, handler: () => exchangeStore.listArtifacts() },
    { channel: IpcChannel.FedExchangeSummary, schema: EmptyRequest, handler: () => exchangeStore.summary() },
    {
      channel: IpcChannel.FedPublishArtifact,
      schema: FedPublishArtifactRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedPublishArtifactRequest;
        /**
         * P13C ROUND 4 — S-10. THE PUBLISHER IS NO LONGER A LITERAL.
         *
         * This passed `publisherOrg: ORG_ID` — `'org-default'`, the seeded
         * organization — so every tenant's artifact was published under, and
         * cryptographically SIGNED as, the seeded org. The store now resolves
         * the publisher from the authoritative tenant and the parameter is gone
         * from its signature, so this cannot regress by someone passing a
         * different constant.
         */
        return exchangeStore.publish({
          kind: r.kind,
          name: r.name,
          summary: r.summary,
          scope: r.scope,
          publisherOrgName: fedStore.homeOrg()?.name ?? 'Unknown organization',
          regionId: r.regionId ?? null,
        });
      },
    },
    {
      channel: IpcChannel.FedPublishVersion,
      schema: FedPublishVersionRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedPublishVersionRequest;
        return exchangeStore.publishVersion(r.artifactId, r.version, r.changelog) ?? { error: 'Artifact not found.' };
      },
    },
    {
      channel: IpcChannel.FedRateArtifact,
      schema: FedRateArtifactRequest,
      handler: (p) => {
        const r = p as FedRateArtifactRequest;
        return exchangeStore.rate(r.artifactId, r.stars) ?? { error: 'Artifact not found.' };
      },
    },
    {
      channel: IpcChannel.FedSetVerification,
      schema: FedSetVerificationRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedSetVerificationRequest;
        return exchangeStore.setVerification(r.artifactId, r.verification) ?? { error: 'Artifact not found.' };
      },
    },
    {
      channel: IpcChannel.FedRollbackArtifact,
      schema: FedRollbackArtifactRequest,
      audit: true,
      handler: (p) => exchangeStore.rollback((p as FedRollbackArtifactRequest).artifactId) ?? { error: 'Artifact not found.' },
    },
    {
      channel: IpcChannel.FedInstallArtifact,
      schema: FedInstallArtifactRequest,
      audit: true,
      handler: (p) => exchangeStore.install((p as FedInstallArtifactRequest).artifactId) ?? { error: 'Artifact not found.' },
    },
    {
      channel: IpcChannel.FedVerifyVersion,
      schema: FedVerifyVersionRequest,
      handler: (p) => {
        const r = p as FedVerifyVersionRequest;
        return { verified: exchangeStore.verifyVersion(r.artifactId, r.versionId) };
      },
    },

    /* ── Enterprise marketplace (scopes) ── */
    { channel: IpcChannel.FedScopeSummary, schema: EmptyRequest, handler: () => exchangeStore.scopeSummary() },
    {
      channel: IpcChannel.FedSetScope,
      schema: FedSetScopeRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedSetScopeRequest;
        return exchangeStore.setScope(r.artifactId, r.scope) ?? { error: 'Artifact not found.' };
      },
    },

    /* ── Global governance ── */
    { channel: IpcChannel.FedPolicies, schema: EmptyRequest, handler: () => globalGovStore.listPolicies() },
    { channel: IpcChannel.FedApprovals, schema: EmptyRequest, handler: () => globalGovStore.listApprovals() },
    { channel: IpcChannel.FedAuditTrail, schema: EmptyRequest, handler: () => globalGovStore.listAudit() },
    { channel: IpcChannel.FedCompliance, schema: EmptyRequest, handler: () => compliance() },
    { channel: IpcChannel.FedGovSummary, schema: EmptyRequest, handler: () => globalGovStore.summary(compliance()) },
    {
      channel: IpcChannel.FedAddPolicy,
      schema: FedAddPolicyRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedAddPolicyRequest;
        return globalGovStore.addPolicy({ name: r.name, description: r.description, scope: r.scope, effect: r.effect, action: r.action });
      },
    },
    {
      channel: IpcChannel.FedSetPolicyEnabled,
      schema: FedSetPolicyEnabledRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedSetPolicyEnabledRequest;
        return globalGovStore.setPolicyEnabled(r.id, r.enabled) ?? { error: 'Policy not found.' };
      },
    },
    {
      channel: IpcChannel.FedResolveApproval,
      schema: FedResolveApprovalRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedResolveApprovalRequest;
        return globalGovStore.resolveApproval(r.id, r.approve) ?? { error: 'Approval not found.' };
      },
    },
    {
      channel: IpcChannel.FedRecordAction,
      schema: FedRecordActionRequest,
      audit: true,
      handler: (p) => {
        const r = p as FedRecordActionRequest;
        return globalGovStore.recordAction({ action: r.action, peerOrg: r.peerOrg, peerOrgName: r.peerOrgName, trustLevel: r.trustLevel, detail: r.detail });
      },
    },

    /* ── Enterprise observability ── */
    { channel: IpcChannel.FedObservability, schema: EmptyRequest, handler: () => buildObservability(buildObsInput()) },
    { channel: IpcChannel.FedUsageSeries, schema: EmptyRequest, handler: () => observabilityStore.usageSeries() },
    { channel: IpcChannel.FedSecurityEvents, schema: EmptyRequest, handler: () => observabilityStore.securityEvents() },

    /* ── Disaster recovery ── */
    { channel: IpcChannel.FedBackups, schema: EmptyRequest, handler: () => drStore.listBackups() },
    { channel: IpcChannel.FedReplicas, schema: EmptyRequest, handler: () => drStore.listReplicas() },
    { channel: IpcChannel.FedValidations, schema: EmptyRequest, handler: () => drStore.listValidations() },
    { channel: IpcChannel.FedContinuity, schema: EmptyRequest, handler: () => drStore.continuity() },
    { channel: IpcChannel.FedDrSummary, schema: EmptyRequest, handler: () => drStore.summary() },
    {
      channel: IpcChannel.FedCreateBackup,
      schema: FedCreateBackupRequest,
      audit: true,
      handler: (p) => drStore.createBackup((p as FedCreateBackupRequest).scope),
    },
    {
      channel: IpcChannel.FedRunValidation,
      schema: FedRunValidationRequest,
      audit: true,
      handler: (p) => drStore.runValidation((p as FedRunValidationRequest).backupId),
    },
    { channel: IpcChannel.FedCheckReplication, schema: EmptyRequest, audit: true, handler: () => drStore.checkReplication() },

    /* ── Federation administration ── */
    { channel: IpcChannel.FedAdminOverview, schema: EmptyRequest, handler: () => adminOverview() },

    /* ── Performance & scalability ── */
    { channel: IpcChannel.FedScalability, schema: EmptyRequest, handler: () => buildScalabilityReport(buildScalabilityInput()) },
  ];
}
