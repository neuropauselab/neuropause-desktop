/**
 * Ecosystem Platform composition root (Phase 8). Loads the developer registry,
 * marketplace, gateway, and billing stores; binds the seeded developer/owner to
 * the signed-in account; keeps the developer plan and billing subscription in
 * lock-step; and wires every `ecosystem:*` IPC channel behind the secure bridge.
 *
 * The gateway handler is the real request path: it resolves the API key, checks
 * scope + version + rate + quota via the pure decision engine, meters allowed
 * traffic into the usage ledger, and writes the gateway audit trail. The same
 * engine is what the public SDK and CLI exercise against a live endpoint.
 */
import type {
  ApiKey,
  ApiVersion,
  BillingSummary,
  DeveloperDashboard,
  GatewayAuditEntry,
  GatewayDecision,
  GatewayRequestInput,
  OAuthTokenError,
  Plan,
  PlanTier,
  SdkArtifact,
  Installation,
  InstallSummary,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  EcosystemDeveloperSetPlanRequest,
  EcosystemKeysCreateRequest,
  EcosystemKeysRevokeRequest,
  EcosystemKeysRotateRequest,
  EcosystemOAuthCreateRequest,
  EcosystemOAuthDeleteRequest,
  EcosystemOAuthTokenRequest,
  EcosystemOAuthRevokeTokenRequest,
  EcosystemUsageAnalyticsRequest,
  EcosystemMarketplaceDetailRequest,
  EcosystemMarketplaceEventsRequest,
  EcosystemListingCreateRequest,
  EcosystemVersionCreateRequest,
  EcosystemListingSubmitRequest,
  EcosystemListingReviewRequest,
  EcosystemListingPublishRequest,
  EcosystemListingRollbackRequest,
  EcosystemListingInstallRequest,
  EcosystemListingRateRequest,
  EcosystemGatewayRequestRequest,
  EcosystemGatewayAuditRequest,
  EcosystemGatewayMetricsRequest,
  EcosystemBillingSetPlanRequest,
  EcosystemBillingInvoiceRequest,
  EcosystemBillingAssignSeatRequest,
  EcosystemBillingReleaseSeatRequest,
  EcosystemBillingPurchaseRequest,
  EcosystemInstallRequest,
  EcosystemInstallUpdateRequest,
  EcosystemInstallSetEnabledRequest,
  EcosystemUninstallRequest,
  EcosystemShareWorkerRequest,
  EcosystemPackPublishRequest,
  EcosystemPackImportRequest,
  EcosystemPackRemoveRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { authService } from '../auth/authService';
import { developerStore } from './developer/developerInstance';
import { computeAnalytics } from './developer/analytics';
import { marketplaceStore } from './marketplace/marketplaceInstance';
import { gatewayStore } from './gateway/gatewayInstance';
import { decideGateway, apiVersionInfo, allApiVersions } from './gateway/gateway';
import { loadSigningSecret, signingSecret } from './auth/signingSecretInstance';
import { issueClientCredentialsToken, resolveApiIdentity, toAccessTokenClaims } from './auth/tokenService';
import { verifyJwt } from './auth/jwt';
import { randomUUID } from 'node:crypto';
import { billingStore } from './billing/billingInstance';
import { PLAN_CATALOG, planFor, computeInvoice, billingSummary } from './billing/billing';
import { installsStore } from './exchange/installsInstance';
import { packsStore } from './exchange/packsInstance';
import { partnersStore } from './exchange/partnersInstance';
import { computeEcosystemAnalytics } from './exchange/analytics';
import { workerRegistry } from '../workforce/registry/registryInstance';
import { ORG_ID, OWNER_USER_ID } from '../enterprise/org/seed';
import { orgStore } from '../enterprise/org/orgInstance';
import { developerOwnerIdentity } from './developer/developerStore';

const log = createLogger('ecosystem');

export interface EcosystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
}

export interface EcosystemSubsystem {
  handlers: SecureHandlerDef[];
}

const SDK_VERSION = '0.1.0';

export const SDK_ARTIFACTS: SdkArtifact[] = [
  {
    language: 'typescript',
    name: 'NeuroPause SDK for JavaScript / TypeScript',
    packageName: '@neuropause/sdk',
    version: SDK_VERSION,
    install: 'npm install @neuropause/sdk',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'Transport-agnostic client for the API gateway, with typed resources, webhook signing, and worker/connector/plugin builders.',
    builds: ['AI Workers', 'Connectors', 'Plugins', 'Enterprise Extensions'],
  },
  {
    language: 'cli',
    name: 'NeuroPause CLI',
    packageName: '@neuropause/cli',
    version: SDK_VERSION,
    install: 'npm install -g @neuropause/cli',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'Command-line tool for keys, usage, packaging, and publishing to the marketplace. Built on the TypeScript SDK.',
    builds: ['AI Workers', 'Connectors', 'Plugins', 'Enterprise Extensions'],
  },
  {
    language: 'python',
    name: 'NeuroPause SDK for Python',
    packageName: 'neuropause',
    version: SDK_VERSION,
    install: 'pip install neuropause',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'Published-shape Python client mirroring the gateway contract, with the same resource surface and webhook helpers.',
    builds: ['AI Workers', 'Connectors', 'Enterprise Extensions'],
  },
  {
    language: 'rest',
    name: 'NeuroPause REST API',
    packageName: 'https://api.neuropause.dev',
    version: 'v1',
    install: 'curl https://api.neuropause.dev/v1/...',
    docsPath: 'docs/ecosystem/api-gateway.md',
    description: 'Versioned REST surface fronted by the API gateway (auth, scopes, rate limits, quotas, audit).',
    builds: ['AI Workers', 'Connectors', 'Plugins', 'Enterprise Extensions'],
  },
  {
    language: 'webhooks',
    name: 'NeuroPause Webhooks',
    packageName: '@neuropause/sdk/webhooks',
    version: SDK_VERSION,
    install: 'npm install @neuropause/sdk',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'HMAC-signed event delivery with verification helpers for marketplace, gateway, and workforce events.',
    builds: ['Enterprise Extensions'],
  },
];

/* ── helpers ── */

function ownerName(): string {
  const s = authService.getStatus();
  if (s.state === 'authenticated') return s.session.user.displayName ?? s.session.user.email;
  return 'Organization Owner';
}

function currentPeriod(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}
function periodStartMs(period: string): number {
  return Date.parse(`${period}-01T00:00:00.000Z`);
}

/** Apply a plan tier to both the developer account and the billing subscription. */
function applyPlan(tier: PlanTier): void {
  developerStore.setPlan(developerStore.defaultDeveloper().id, tier);
  billingStore.setPlan(tier);
}

function buildDashboard(): DeveloperDashboard {
  const dev = developerStore.defaultDeveloper();
  const since30 = Date.now() - 30 * 86_400_000;
  const usage = developerStore.usageFor(dev.id, since30);
  const errors = usage.filter((u) => u.status >= 400).length;
  const listings = marketplaceStore.list().filter((l) => l.developerId === dev.id);
  const stats = marketplaceStore.stats();
  return {
    developer: dev,
    apiKeyCount: developerStore.keysFor(dev.id).length,
    oauthAppCount: developerStore.appsFor(dev.id).length,
    listingCount: listings.length,
    publishedCount: listings.filter((l) => l.status === 'published').length,
    pendingReviewCount: stats.pendingReview,
    requests30d: usage.length,
    errorRate30d: usage.length > 0 ? errors / usage.length : 0,
    plan: planFor(dev.planTier),
    marketplaceStats: stats,
  };
}

function buildBillingSummary(): BillingSummary {
  const sub = billingStore.getSubscription();
  const plan = planFor(sub.planTier);
  const dev = developerStore.defaultDeveloper();
  const period = currentPeriod();
  const periodRequests = developerStore.countSince(dev.id, periodStartMs(period));
  return billingSummary(plan, sub, periodRequests, billingStore.listLicenses(), billingStore.listPurchases(), period);
}

/* ── Stage 2: ecosystem exchange helpers ── */

function currentVersionOf(listingId: string): { versionId: string; version: string } | null {
  const detail = marketplaceStore.detail(listingId);
  if (!detail || !detail.listing.currentVersionId) return null;
  const v = detail.versions.find((x) => x.id === detail.listing.currentVersionId);
  return v ? { versionId: v.id, version: v.version } : null;
}

/** Installs for the local org, with "update available" computed against the marketplace. */
function annotateInstalls(): Installation[] {
  return installsStore.forOrg(ORG_ID).map((i) => {
    if (i.status === 'disabled') return i;
    const cur = currentVersionOf(i.listingId);
    if (cur && cur.versionId !== i.installedVersionId) return { ...i, status: 'update_available' as const };
    return { ...i, status: 'installed' as const };
  });
}

function installSummary(): InstallSummary {
  const installs = annotateInstalls();
  const byKind: Record<string, number> = {};
  for (const i of installs) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return {
    totalInstalled: installs.length,
    updatesAvailable: installs.filter((i) => i.status === 'update_available').length,
    byKind,
  };
}

function titleCaseRole(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * The real gateway request path: resolve key → decide → meter → audit.
 * Exported (P3.0) so the Enterprise REST API dispatcher reuses the SAME gateway —
 * no parallel auth/metering/audit.
 */
export function runGateway(input: GatewayRequestInput): GatewayDecision {
  const start = Date.now();
  // P3.0 — resolve EITHER an API key OR an OAuth access token to one identity, then
  // present it to the existing decision engine as an ApiKey-shaped value (unchanged).
  const identity = resolveApiIdentity(input.apiKey, {
    verifyKey: (raw) => developerStore.verifyKey(raw),
    developerOrg: (devId) => developerStore.developer(devId)?.orgId ?? null,
    verifyToken: (raw) => {
      try {
        return toAccessTokenClaims(verifyJwt(raw, signingSecret()));
      } catch {
        return null;
      }
    },
    isTokenRevoked: (jti) => developerStore.isTokenRevoked(jti),
  });
  const key: ApiKey | null = identity
    ? {
        id: identity.credentialId,
        developerId: identity.developerId,
        name: identity.kind,
        prefix: '',
        last4: '',
        scopes: identity.scopes,
        createdAt: '',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      }
    : null;
  const developer = key ? developerStore.developer(key.developerId) : null;
  const plan: Plan = planFor(developer?.planTier ?? 'free');
  const versionInfo = apiVersionInfo(input.version);
  const { rateRemaining, quotaUsed } = gatewayStore.peek(key?.id ?? null, developer?.id ?? null, plan.rateLimit, plan.quota, start);

  const decision = decideGateway(input, {
    key,
    developerId: developer?.id ?? null,
    versionInfo,
    rateLimit: plan.rateLimit,
    quota: plan.quota,
    rateRemaining,
    quotaUsed,
    now: start,
  });

  const latencyMs = Math.max(1, Date.now() - start);
  const at = new Date(start).toISOString();

  if (decision.allowed) {
    gatewayStore.commit(key?.id ?? null, developer?.id ?? null, plan.rateLimit, plan.quota, start);
  }
  if (developer) {
    developerStore.recordUsage({
      developerId: developer.id,
      apiKeyId: key?.id ?? null,
      at,
      method: input.method,
      path: input.path,
      version: input.version,
      status: decision.status,
      latencyMs,
      computeUnits: decision.allowed ? 1 : 0,
    });
  }
  gatewayStore.record({
    at,
    keyId: key?.id ?? null,
    developerId: developer?.id ?? null,
    method: input.method,
    path: input.path,
    version: input.version,
    status: decision.status,
    reason: decision.reason,
    latencyMs,
  });
  return decision;
}

/** Gateway request metrics over a window (P3.0) — reused by the REST API `/metrics` route. */
export function gatewayMetrics(windowDays: number): unknown {
  return gatewayStore.metrics(windowDays, Date.now());
}

/** Recent gateway audit entries, newest first (P3.0) — reused by the observability traces/logs routes. */
export function gatewayAuditEntries(limit: number): GatewayAuditEntry[] {
  return gatewayStore.auditEntries(limit);
}

export async function initEcosystem(deps: EcosystemDeps): Promise<EcosystemSubsystem> {
  await developerStore.load();
  await marketplaceStore.load();
  await gatewayStore.load();
  await billingStore.load();
  await installsStore.load();
  await packsStore.load();
  await partnersStore.load();
  // P3.0 — get-or-create the access-token signing secret so the gateway's sync path can read it.
  await loadSigningSecret();

  // The developer portal's single account mirrors the enterprise *claimed* owner
  // (its documented source of truth), which initEnterprise resolves first via
  // first-claim-wins. Refresh on sign-in so a first login is reflected without a
  // restart; leave the seeded placeholder while the owner is unclaimed. Display
  // metadata only — every ecosystem channel is gated by the enterprise RBAC spine
  // (see ecosystemAuthz), never by this account's identity.
  const mirrorDeveloperOwner = (): void => {
    const identity = developerOwnerIdentity(orgStore.user(OWNER_USER_ID));
    if (identity) developerStore.setOwnerIdentity(identity.name, identity.email);
  };
  mirrorDeveloperOwner();
  authService.on('statusChanged', mirrorDeveloperOwner);

  // Keep the developer plan and billing subscription consistent at boot.
  const dev = developerStore.defaultDeveloper();
  if (billingStore.getSubscription().planTier !== dev.planTier) {
    billingStore.setPlan(dev.planTier);
  }

  // Bridge store changes to the renderer as one ecosystem event.
  const emit = (kind: string): void => deps.broadcast(IpcChannel.EcosystemEventBroadcast, { kind, at: new Date().toISOString() });
  developerStore.on('changed', () => emit('developer'));
  marketplaceStore.on('changed', () => emit('marketplace'));
  gatewayStore.on('changed', () => emit('gateway'));
  billingStore.on('changed', () => emit('billing'));
  installsStore.on('changed', () => emit('installs'));
  packsStore.on('changed', () => emit('exchange'));
  partnersStore.on('changed', () => emit('partners'));

  log.info('Ecosystem platform ready', {
    developer: dev.name,
    plan: dev.planTier,
    listings: marketplaceStore.list().length,
    signingKey: marketplaceStore.signingKeyId(),
    seats: billingStore.getSubscription().seatsUsed,
  });
  log.info('Ecosystem network ready', {
    installs: installsStore.forOrg(ORG_ID).length,
    packs: packsStore.list().length,
    partners: partnersStore.list().length,
  });

  return { handlers: buildHandlers() };
}

function buildHandlers(): SecureHandlerDef[] {
  const devId = (): string => developerStore.defaultDeveloper().id;

  return [
    /* ── Developer portal ── */
    { channel: IpcChannel.EcosystemDeveloperDashboard, schema: EmptyRequest, handler: () => buildDashboard() },
    { channel: IpcChannel.EcosystemDeveloperAccount, schema: EmptyRequest, handler: () => developerStore.defaultDeveloper() },
    {
      channel: IpcChannel.EcosystemDeveloperSetPlan,
      schema: EcosystemDeveloperSetPlanRequest,
      audit: true,
      handler: (p) => {
        applyPlan((p as EcosystemDeveloperSetPlanRequest).planTier);
        return buildDashboard();
      },
    },
    { channel: IpcChannel.EcosystemKeysList, schema: EmptyRequest, handler: () => developerStore.keysFor(devId()) },
    {
      channel: IpcChannel.EcosystemKeysCreate,
      schema: EcosystemKeysCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemKeysCreateRequest;
        return developerStore.createKey(devId(), r.name, r.scopes, r.expiresAt ?? null);
      },
    },
    {
      channel: IpcChannel.EcosystemKeysRevoke,
      schema: EcosystemKeysRevokeRequest,
      audit: true,
      handler: (p) => developerStore.revokeKey((p as EcosystemKeysRevokeRequest).id),
    },
    {
      // P3.0 — rotate a key: returns the new secret once, revokes the old id.
      channel: IpcChannel.EcosystemKeysRotate,
      schema: EcosystemKeysRotateRequest,
      audit: true,
      handler: (p) => {
        const rotated = developerStore.rotateKey((p as EcosystemKeysRotateRequest).id);
        return rotated ?? { error: 'not_found', error_description: 'No such active key.' };
      },
    },
    { channel: IpcChannel.EcosystemOAuthList, schema: EmptyRequest, handler: () => developerStore.appsFor(devId()) },
    {
      channel: IpcChannel.EcosystemOAuthCreate,
      schema: EcosystemOAuthCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemOAuthCreateRequest;
        return developerStore.createApp(devId(), r.name, r.redirectUris, r.scopes, r.grantTypes);
      },
    },
    {
      channel: IpcChannel.EcosystemOAuthDelete,
      schema: EcosystemOAuthDeleteRequest,
      audit: true,
      handler: (p) => ({ deleted: developerStore.deleteApp((p as EcosystemOAuthDeleteRequest).id) }),
    },
    {
      // P3.0 — OAuth 2.1 client-credentials token endpoint. Verifies the client id +
      // secret, then mints a scoped, TTL-bounded HS256 access token (or an RFC 6749 error).
      channel: IpcChannel.EcosystemOAuthToken,
      schema: EcosystemOAuthTokenRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemOAuthTokenRequest;
        const app = developerStore.verifyAppCredentials(r.clientId, r.clientSecret);
        if (!app) {
          return { error: 'invalid_client', error_description: 'Unknown client or invalid secret.' } satisfies OAuthTokenError;
        }
        const orgId = developerStore.developer(app.developerId)?.orgId ?? ORG_ID;
        const result = issueClientCredentialsToken({
          app,
          developerId: app.developerId,
          orgId,
          requestedScope: r.scope ?? null,
          secret: signingSecret(),
          nowMs: Date.now(),
          jti: `tok_${randomUUID()}`,
        });
        return result.ok ? result.response : result.error;
      },
    },
    {
      // P3.0 — revoke an issued access token by jti (covers the max token lifetime).
      channel: IpcChannel.EcosystemOAuthRevokeToken,
      schema: EcosystemOAuthRevokeTokenRequest,
      audit: true,
      handler: (p) => ({
        revoked: developerStore.revokeToken((p as EcosystemOAuthRevokeTokenRequest).jti, Date.now() + 24 * 60 * 60 * 1000),
      }),
    },
    {
      channel: IpcChannel.EcosystemUsageAnalytics,
      schema: EcosystemUsageAnalyticsRequest,
      handler: (p) => {
        const windowDays = (p as EcosystemUsageAnalyticsRequest).windowDays ?? 30;
        const since = Date.now() - windowDays * 86_400_000;
        return computeAnalytics(devId(), developerStore.usageFor(devId(), since), windowDays, Date.now());
      },
    },
    { channel: IpcChannel.EcosystemSdks, schema: EmptyRequest, handler: () => SDK_ARTIFACTS },

    /* ── Marketplace ── */
    { channel: IpcChannel.EcosystemMarketplaceList, schema: EmptyRequest, handler: () => marketplaceStore.list() },
    {
      channel: IpcChannel.EcosystemMarketplaceDetail,
      schema: EcosystemMarketplaceDetailRequest,
      handler: (p) => marketplaceStore.detail((p as EcosystemMarketplaceDetailRequest).id),
    },
    { channel: IpcChannel.EcosystemMarketplaceStats, schema: EmptyRequest, handler: () => marketplaceStore.stats() },
    {
      channel: IpcChannel.EcosystemMarketplaceEvents,
      schema: EcosystemMarketplaceEventsRequest,
      handler: (p) => {
        const r = p as EcosystemMarketplaceEventsRequest;
        return r.listingId ? marketplaceStore.eventsFor(r.listingId, r.limit ?? 50) : marketplaceStore.recentEvents(r.limit ?? 50);
      },
    },
    {
      channel: IpcChannel.EcosystemListingCreate,
      schema: EcosystemListingCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemListingCreateRequest;
        return marketplaceStore.createListing({ kind: r.kind, slug: r.slug, name: r.name, summary: r.summary, category: r.category, pricing: r.pricing, certified: r.certified });
      },
    },
    {
      channel: IpcChannel.EcosystemVersionCreate,
      schema: EcosystemVersionCreateRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemVersionCreateRequest;
        return marketplaceStore.addVersion(r.listingId, r.manifest, r.changelog);
      },
    },
    {
      channel: IpcChannel.EcosystemListingSubmit,
      schema: EcosystemListingSubmitRequest,
      audit: true,
      handler: (p) => marketplaceStore.submit((p as EcosystemListingSubmitRequest).versionId, ownerName()),
    },
    {
      channel: IpcChannel.EcosystemListingReview,
      schema: EcosystemListingReviewRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemListingReviewRequest;
        return marketplaceStore.review(r.versionId, r.decision, ownerName(), r.notes ?? '');
      },
    },
    {
      channel: IpcChannel.EcosystemListingPublish,
      schema: EcosystemListingPublishRequest,
      audit: true,
      handler: (p) => marketplaceStore.publish((p as EcosystemListingPublishRequest).versionId, ownerName()),
    },
    {
      channel: IpcChannel.EcosystemListingRollback,
      schema: EcosystemListingRollbackRequest,
      audit: true,
      handler: (p) => marketplaceStore.rollback((p as EcosystemListingRollbackRequest).listingId, ownerName()),
    },
    {
      channel: IpcChannel.EcosystemListingInstall,
      schema: EcosystemListingInstallRequest,
      handler: (p) => marketplaceStore.install((p as EcosystemListingInstallRequest).listingId),
    },
    {
      channel: IpcChannel.EcosystemListingRate,
      schema: EcosystemListingRateRequest,
      handler: (p) => {
        const r = p as EcosystemListingRateRequest;
        return marketplaceStore.rate(r.listingId, r.stars);
      },
    },

    /* ── API gateway ── */
    { channel: IpcChannel.EcosystemGatewayVersions, schema: EmptyRequest, handler: () => allApiVersions() },
    {
      channel: IpcChannel.EcosystemGatewayRequest,
      schema: EcosystemGatewayRequestRequest,
      handler: (p) => {
        const r = p as EcosystemGatewayRequestRequest;
        return runGateway({ apiKey: r.apiKey ?? null, method: r.method, path: r.path, version: r.version as ApiVersion, scope: r.scope ?? null });
      },
    },
    {
      channel: IpcChannel.EcosystemGatewayAudit,
      schema: EcosystemGatewayAuditRequest,
      handler: (p) => gatewayStore.auditEntries((p as EcosystemGatewayAuditRequest).limit ?? 100),
    },
    {
      channel: IpcChannel.EcosystemGatewayMetrics,
      schema: EcosystemGatewayMetricsRequest,
      handler: (p) => gatewayStore.metrics((p as EcosystemGatewayMetricsRequest).windowDays ?? 7, Date.now()),
    },

    /* ── Billing & licensing ── */
    { channel: IpcChannel.EcosystemBillingSummary, schema: EmptyRequest, handler: () => buildBillingSummary() },
    { channel: IpcChannel.EcosystemBillingPlans, schema: EmptyRequest, handler: () => Object.values(PLAN_CATALOG) },
    {
      channel: IpcChannel.EcosystemBillingSetPlan,
      schema: EcosystemBillingSetPlanRequest,
      audit: true,
      handler: (p) => {
        applyPlan((p as EcosystemBillingSetPlanRequest).planTier);
        return buildBillingSummary();
      },
    },
    {
      channel: IpcChannel.EcosystemBillingInvoice,
      schema: EcosystemBillingInvoiceRequest,
      handler: (p) => {
        const period = (p as EcosystemBillingInvoiceRequest).period ?? currentPeriod();
        const sub = billingStore.getSubscription();
        const plan = planFor(sub.planTier);
        const periodRequests = developerStore.countSince(developerStore.defaultDeveloper().id, periodStartMs(period));
        return computeInvoice(sub.orgId, plan, periodRequests, billingStore.listPurchases(), period);
      },
    },
    { channel: IpcChannel.EcosystemBillingSeats, schema: EmptyRequest, handler: () => billingStore.seatAssignments() },
    {
      channel: IpcChannel.EcosystemBillingAssignSeat,
      schema: EcosystemBillingAssignSeatRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemBillingAssignSeatRequest;
        return billingStore.assignSeat(r.userId, r.userName);
      },
    },
    {
      channel: IpcChannel.EcosystemBillingReleaseSeat,
      schema: EcosystemBillingReleaseSeatRequest,
      audit: true,
      handler: (p) => ({ released: billingStore.releaseSeat((p as EcosystemBillingReleaseSeatRequest).seatId) }),
    },
    { channel: IpcChannel.EcosystemBillingLicenses, schema: EmptyRequest, handler: () => billingStore.listLicenses() },
    {
      channel: IpcChannel.EcosystemBillingPurchase,
      schema: EcosystemBillingPurchaseRequest,
      audit: true,
      handler: (p) => {
        const detail = marketplaceStore.detail((p as EcosystemBillingPurchaseRequest).listingId);
        if (!detail) return { error: 'Listing not found' };
        const plan = planFor(billingStore.getSubscription().planTier);
        const result = billingStore.purchase({
          listingId: detail.listing.id,
          listingName: detail.listing.name,
          versionId: detail.listing.currentVersionId,
          model: detail.listing.pricing.model,
          amount: detail.listing.pricing.amount,
          currency: detail.listing.pricing.currency,
          feePct: plan.marketplaceFeePct,
        });
        marketplaceStore.install(detail.listing.id);
        return result;
      },
    },
    { channel: IpcChannel.EcosystemBillingPurchases, schema: EmptyRequest, handler: () => billingStore.listPurchases() },

    /* ── Enterprise Ecosystem (Stage 2): installs ── */
    { channel: IpcChannel.EcosystemInstallsList, schema: EmptyRequest, handler: () => annotateInstalls() },
    { channel: IpcChannel.EcosystemInstallsSummary, schema: EmptyRequest, handler: () => installSummary() },
    {
      channel: IpcChannel.EcosystemInstall,
      schema: EcosystemInstallRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemInstallRequest;
        const detail = marketplaceStore.detail(r.listingId);
        if (!detail) return { error: 'Listing not found' };
        const cur = currentVersionOf(r.listingId);
        if (!cur) return { error: 'Listing has no published version' };
        marketplaceStore.install(r.listingId);
        return installsStore.install({ orgId: ORG_ID, listingId: detail.listing.id, listingName: detail.listing.name, kind: detail.listing.kind, versionId: cur.versionId, version: cur.version });
      },
    },
    {
      channel: IpcChannel.EcosystemInstallUpdate,
      schema: EcosystemInstallUpdateRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemInstallUpdateRequest;
        const inst = installsStore.forOrg(ORG_ID).find((i) => i.id === r.installationId);
        if (!inst) return { error: 'Installation not found' };
        const cur = currentVersionOf(inst.listingId);
        if (!cur) return { error: 'No published version' };
        return installsStore.install({ orgId: ORG_ID, listingId: inst.listingId, listingName: inst.listingName, kind: inst.kind, versionId: cur.versionId, version: cur.version });
      },
    },
    {
      channel: IpcChannel.EcosystemInstallSetEnabled,
      schema: EcosystemInstallSetEnabledRequest,
      handler: (p) => {
        const r = p as EcosystemInstallSetEnabledRequest;
        return installsStore.setDisabled(r.installationId, !r.enabled);
      },
    },
    {
      channel: IpcChannel.EcosystemUninstall,
      schema: EcosystemUninstallRequest,
      audit: true,
      handler: (p) => ({ uninstalled: installsStore.uninstall((p as EcosystemUninstallRequest).installationId) }),
    },
    {
      channel: IpcChannel.EcosystemShareWorker,
      schema: EcosystemShareWorkerRequest,
      audit: true,
      handler: (p) => {
        const worker = workerRegistry.get((p as EcosystemShareWorkerRequest).workerId);
        if (!worker) return { error: 'Worker not found' };
        const slug = worker.identity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const listing = marketplaceStore.createListing({
          kind: 'ai_worker',
          slug: `${slug}-${Date.now().toString(36)}`,
          name: worker.identity.name,
          summary: worker.goals[0] ?? `Shared AI worker: ${worker.identity.name}`,
          category: titleCaseRole(worker.identity.role),
          pricing: { model: 'free', amount: 0, currency: 'USD' },
        });
        const version = marketplaceStore.addVersion(
          listing.id,
          {
            kind: 'ai_worker',
            name: worker.identity.name,
            version: worker.identity.version || '1.0.0',
            entry: `worker/${slug}.js`,
            permissions: worker.permissions.map((perm) => perm.scope),
            capabilities: worker.skills.map((sk) => sk.id),
            dependencies: ['@neuropause/sdk@^0.1.0'],
            network: [],
            metadata: { publisher: 'NeuroPause', role: worker.identity.role },
          },
          `Shared from workforce: ${worker.identity.name}`,
        );
        if (version) marketplaceStore.submit(version.id, ownerName());
        return marketplaceStore.detail(listing.id);
      },
    },

    /* ── Stage 2: organization exchange ── */
    { channel: IpcChannel.EcosystemPacksList, schema: EmptyRequest, handler: () => packsStore.list() },
    { channel: IpcChannel.EcosystemPacksStats, schema: EmptyRequest, handler: () => packsStore.stats() },
    {
      channel: IpcChannel.EcosystemPackPublish,
      schema: EcosystemPackPublishRequest,
      audit: true,
      handler: (p) => {
        const r = p as EcosystemPackPublishRequest;
        return packsStore.publish({ name: r.name, summary: r.summary, kind: r.kind, items: r.items });
      },
    },
    { channel: IpcChannel.EcosystemPackImport, schema: EcosystemPackImportRequest, handler: (p) => packsStore.importPack((p as EcosystemPackImportRequest).id) },
    { channel: IpcChannel.EcosystemPackRemove, schema: EcosystemPackRemoveRequest, audit: true, handler: (p) => ({ removed: packsStore.remove((p as EcosystemPackRemoveRequest).id) }) },

    /* ── Stage 2: partners ── */
    { channel: IpcChannel.EcosystemPartnersList, schema: EmptyRequest, handler: () => partnersStore.list() },
    { channel: IpcChannel.EcosystemPartnersStats, schema: EmptyRequest, handler: () => partnersStore.stats() },

    /* ── Stage 2: ecosystem analytics ── */
    {
      channel: IpcChannel.EcosystemAnalytics,
      schema: EmptyRequest,
      handler: () => {
        const dev = developerStore.defaultDeveloper();
        const since30 = Date.now() - 30 * 86_400_000;
        const usage = developerStore.usageFor(dev.id, since30);
        const gm = gatewayStore.metrics(30, Date.now());
        return computeEcosystemAnalytics({
          listings: marketplaceStore.list(),
          installs: annotateInstalls(),
          purchases: billingStore.listPurchases(),
          packs: packsStore.list(),
          partners: partnersStore.list(),
          usage: { requests30d: usage.length, computeUnits30d: usage.reduce((n, u) => n + u.computeUnits, 0), p95LatencyMs: gm.p95LatencyMs },
          activeDevelopers: 1,
          localOrgId: ORG_ID,
          now: Date.now(),
        });
      },
    },
  ];
}
