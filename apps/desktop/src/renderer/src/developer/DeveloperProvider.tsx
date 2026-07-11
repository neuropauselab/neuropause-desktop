/**
 * The Developer Portal data provider. Loads the developer dashboard, API keys,
 * OAuth applications, usage analytics, SDK catalog, marketplace listings + stats
 * + submission events, API gateway versions/metrics/audit, and the billing
 * summary + plans + seats + licenses + purchases — then subscribes to the single
 * `ecosystem` broadcast so every surface stays live.
 *
 * It also exposes the action surface: rotate the plan, mint/revoke API keys,
 * register/remove OAuth apps, drive the full marketplace publishing pipeline
 * (create → version → submit → review → publish → rollback, plus install/rate),
 * route a request through the gateway, and manage seats, licenses, and purchases.
 * Every side effect is a typed IPC call validated in the main process.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ApiKey,
  ApiKeyWithSecret,
  ApiScope,
  ApiVersionInfo,
  BillingSummary,
  DeveloperAnalytics,
  DeveloperDashboard,
  GatewayAuditEntry,
  GatewayDecision,
  GatewayMetrics,
  License,
  ListingDetail,
  ListingKind,
  ListingManifest,
  ListingPricing,
  ListingVersion,
  MarketplaceListing,
  MarketplacePurchase,
  MarketplaceStats,
  OAuthApplication,
  OAuthApplicationWithSecret,
  OAuthGrantType,
  Plan,
  PlanTier,
  ReviewDecision,
  SdkArtifact,
  SeatAssignment,
  SubmissionEvent,
  // Platform surfaces (P3.0, Increments 1–6)
  ApiRouteInfo,
  EnterpriseApiRequest,
  EnterpriseApiResponse,
  OpenApiDocument,
  Webhook,
  WebhookWithSecret,
  WebhookDelivery,
  WebhookDeliveryStats,
  PlatformEventCategory,
  PluginExtension,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('developer');

interface DeveloperContextValue {
  ready: boolean;
  dashboard: DeveloperDashboard | null;
  keys: ApiKey[];
  oauthApps: OAuthApplication[];
  analytics: DeveloperAnalytics | null;
  sdks: SdkArtifact[];
  listings: MarketplaceListing[];
  marketplaceStats: MarketplaceStats | null;
  events: SubmissionEvent[];
  gatewayVersions: ApiVersionInfo[];
  gatewayMetrics: GatewayMetrics | null;
  gatewayAudit: GatewayAuditEntry[];
  billing: BillingSummary | null;
  plans: Plan[];
  seats: SeatAssignment[];
  licenses: License[];
  purchases: MarketplacePurchase[];
  // platform surfaces (P3.0)
  routes: ApiRouteInfo[];
  openapi: OpenApiDocument | null;
  webhooks: Webhook[];
  webhookStats: WebhookDeliveryStats | null;
  extensions: PluginExtension[];
  refreshAll: () => Promise<void>;
  // developer
  setPlan: (tier: PlanTier) => Promise<void>;
  createKey: (name: string, scopes: ApiScope[], expiresAt?: string | null) => Promise<ApiKeyWithSecret>;
  revokeKey: (id: string) => Promise<void>;
  createOAuthApp: (input: { name: string; redirectUris: string[]; scopes: ApiScope[]; grantTypes: OAuthGrantType[] }) => Promise<OAuthApplicationWithSecret>;
  deleteOAuthApp: (id: string) => Promise<void>;
  // marketplace
  listingDetail: (id: string) => Promise<ListingDetail | null>;
  createListing: (input: { kind: ListingKind; slug: string; name: string; summary: string; category: string; pricing: ListingPricing; certified?: boolean }) => Promise<MarketplaceListing>;
  createVersion: (listingId: string, manifest: ListingManifest, changelog: string) => Promise<ListingVersion | null>;
  submit: (versionId: string) => Promise<ListingVersion | null>;
  review: (versionId: string, decision: ReviewDecision, notes?: string) => Promise<ListingVersion | null>;
  publish: (versionId: string) => Promise<ListingVersion | null>;
  rollback: (listingId: string) => Promise<MarketplaceListing | null>;
  install: (listingId: string) => Promise<void>;
  rate: (listingId: string, stars: number) => Promise<void>;
  // gateway
  runGatewayRequest: (input: { apiKey?: string | null; method: string; path: string; version: 'v1' | 'v2'; scope?: ApiScope | null }) => Promise<GatewayDecision>;
  // billing
  assignSeat: (userId: string, userName: string) => Promise<SeatAssignment | { error: string }>;
  releaseSeat: (seatId: string) => Promise<void>;
  purchase: (listingId: string) => Promise<{ purchase: MarketplacePurchase; license: License } | { error: string }>;
  // platform: Enterprise REST API (executes through the real gateway + audit)
  runApiRequest: (req: EnterpriseApiRequest) => Promise<EnterpriseApiResponse>;
  // platform: Enterprise Webhooks
  createWebhook: (input: { label: string; url: string; categories?: PlatformEventCategory[]; types?: string[] }) => Promise<WebhookWithSecret>;
  setWebhookEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteWebhook: (id: string) => Promise<void>;
  loadDeliveries: (webhookId?: string, limit?: number) => Promise<WebhookDelivery[]>;
  loadDeadLetters: () => Promise<WebhookDelivery[]>;
  replayDelivery: (id: string) => Promise<WebhookDelivery | { error: string }>;
}

const DeveloperContext = createContext<DeveloperContextValue | null>(null);

export function DeveloperProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [dashboard, setDashboard] = useState<DeveloperDashboard | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [oauthApps, setOauthApps] = useState<OAuthApplication[]>([]);
  const [analytics, setAnalytics] = useState<DeveloperAnalytics | null>(null);
  const [sdks, setSdks] = useState<SdkArtifact[]>([]);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [marketplaceStats, setMarketplaceStats] = useState<MarketplaceStats | null>(null);
  const [events, setEvents] = useState<SubmissionEvent[]>([]);
  const [gatewayVersions, setGatewayVersions] = useState<ApiVersionInfo[]>([]);
  const [gatewayMetrics, setGatewayMetrics] = useState<GatewayMetrics | null>(null);
  const [gatewayAudit, setGatewayAudit] = useState<GatewayAuditEntry[]>([]);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [seats, setSeats] = useState<SeatAssignment[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([]);
  const [routes, setRoutes] = useState<ApiRouteInfo[]>([]);
  const [openapi, setOpenapi] = useState<OpenApiDocument | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookStats, setWebhookStats] = useState<WebhookDeliveryStats | null>(null);
  const [extensions, setExtensions] = useState<PluginExtension[]>([]);

  const refreshAll = useCallback(async () => {
    try {
      const [dash, k, apps, an, sd, ls, ms, ev, gv, gm, ga, bill, pl, st, lic, pur] = await Promise.all([
        ipc.ecosystem.dashboard(),
        ipc.ecosystem.keys(),
        ipc.ecosystem.oauthApps(),
        ipc.ecosystem.usage(30),
        ipc.ecosystem.sdks(),
        ipc.ecosystem.listings(),
        ipc.ecosystem.marketplaceStats(),
        ipc.ecosystem.submissionEvents(undefined, 40),
        ipc.ecosystem.gatewayVersions(),
        ipc.ecosystem.gatewayMetrics(7),
        ipc.ecosystem.gatewayAudit(60),
        ipc.ecosystem.billingSummary(),
        ipc.ecosystem.plans(),
        ipc.ecosystem.seats(),
        ipc.ecosystem.licenses(),
        ipc.ecosystem.purchases(),
      ]);
      setDashboard(dash);
      setKeys(k);
      setOauthApps(apps);
      setAnalytics(an);
      setSdks(sd);
      setListings(ls);
      setMarketplaceStats(ms);
      setEvents(ev);
      setGatewayVersions(gv);
      setGatewayMetrics(gm);
      setGatewayAudit(ga);
      setBilling(bill);
      setPlans(pl);
      setSeats(st);
      setLicenses(lic);
      setPurchases(pur);
      // Platform surfaces (P3.0). Loaded in their own batch so a transient failure
      // here never blanks the publishing surfaces above.
      const [rt, oa, wh, ws, ex] = await Promise.all([
        ipc.api.routes(),
        ipc.api.openapi(),
        ipc.webhooks.list(),
        ipc.webhooks.stats(),
        ipc.plugins.extensions(),
      ]);
      setRoutes(rt);
      setOpenapi(oa);
      setWebhooks(wh);
      setWebhookStats(ws);
      setExtensions(ex);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh developer portal', err);
    }
  }, []);

  // Light refresh for the slices that move after an action / event.
  const refreshLive = useCallback(async () => {
    try {
      const [dash, k, apps, ls, ms, ev, gm, ga, bill, st, lic, pur, an] = await Promise.all([
        ipc.ecosystem.dashboard(),
        ipc.ecosystem.keys(),
        ipc.ecosystem.oauthApps(),
        ipc.ecosystem.listings(),
        ipc.ecosystem.marketplaceStats(),
        ipc.ecosystem.submissionEvents(undefined, 40),
        ipc.ecosystem.gatewayMetrics(7),
        ipc.ecosystem.gatewayAudit(60),
        ipc.ecosystem.billingSummary(),
        ipc.ecosystem.seats(),
        ipc.ecosystem.licenses(),
        ipc.ecosystem.purchases(),
        ipc.ecosystem.usage(30),
      ]);
      setDashboard(dash);
      setKeys(k);
      setOauthApps(apps);
      setListings(ls);
      setMarketplaceStats(ms);
      setEvents(ev);
      setGatewayMetrics(gm);
      setGatewayAudit(ga);
      setBilling(bill);
      setSeats(st);
      setLicenses(lic);
      setPurchases(pur);
      setAnalytics(an);
      const [wh, ws, ex] = await Promise.all([
        ipc.webhooks.list(),
        ipc.webhooks.stats(),
        ipc.plugins.extensions(),
      ]);
      setWebhooks(wh);
      setWebhookStats(ws);
      setExtensions(ex);
    } catch (err) {
      log.error('Failed to refresh live slices', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = (fn: () => void): void => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 180);
    };
    const off = ipc.ecosystem.onEvent(() => debounced(() => void refreshLive()));
    // Webhook delivery activity broadcasts its stats — keep the portal live off the
    // same debounce so deliveries/dead-letters update as the dispatcher works.
    const offWebhooks = ipc.webhooks.onEvent((stats) => {
      setWebhookStats(stats);
      debounced(() => void refreshLive());
    });
    return () => {
      if (t) clearTimeout(t);
      off();
      offWebhooks();
    };
  }, [refreshAll, refreshLive]);

  const setPlan = useCallback(async (tier: PlanTier) => { await ipc.ecosystem.setPlan(tier); await refreshLive(); }, [refreshLive]);
  const createKey = useCallback(async (name: string, scopes: ApiScope[], expiresAt?: string | null) => {
    const res = await ipc.ecosystem.createKey(name, scopes, expiresAt ?? null);
    await refreshLive();
    return res;
  }, [refreshLive]);
  const revokeKey = useCallback(async (id: string) => { await ipc.ecosystem.revokeKey(id); await refreshLive(); }, [refreshLive]);
  const createOAuthApp = useCallback(async (input: { name: string; redirectUris: string[]; scopes: ApiScope[]; grantTypes: OAuthGrantType[] }) => {
    const res = await ipc.ecosystem.createOAuthApp(input);
    await refreshLive();
    return res;
  }, [refreshLive]);
  const deleteOAuthApp = useCallback(async (id: string) => { await ipc.ecosystem.deleteOAuthApp(id); await refreshLive(); }, [refreshLive]);

  const listingDetail = useCallback((id: string) => ipc.ecosystem.listing(id), []);
  const createListing = useCallback(async (input: { kind: ListingKind; slug: string; name: string; summary: string; category: string; pricing: ListingPricing; certified?: boolean }) => {
    const res = await ipc.ecosystem.createListing(input);
    await refreshLive();
    return res;
  }, [refreshLive]);
  const createVersion = useCallback(async (listingId: string, manifest: ListingManifest, changelog: string) => {
    const res = await ipc.ecosystem.createVersion(listingId, manifest, changelog);
    await refreshLive();
    return res;
  }, [refreshLive]);
  const submit = useCallback(async (versionId: string) => { const r = await ipc.ecosystem.submit(versionId); await refreshLive(); return r; }, [refreshLive]);
  const review = useCallback(async (versionId: string, decision: ReviewDecision, notes?: string) => { const r = await ipc.ecosystem.review(versionId, decision, notes); await refreshLive(); return r; }, [refreshLive]);
  const publish = useCallback(async (versionId: string) => { const r = await ipc.ecosystem.publish(versionId); await refreshLive(); return r; }, [refreshLive]);
  const rollback = useCallback(async (listingId: string) => { const r = await ipc.ecosystem.rollback(listingId); await refreshLive(); return r; }, [refreshLive]);
  const install = useCallback(async (listingId: string) => { await ipc.ecosystem.install(listingId); await refreshLive(); }, [refreshLive]);
  const rate = useCallback(async (listingId: string, stars: number) => { await ipc.ecosystem.rate(listingId, stars); await refreshLive(); }, [refreshLive]);

  const runGatewayRequest = useCallback(async (input: { apiKey?: string | null; method: string; path: string; version: 'v1' | 'v2'; scope?: ApiScope | null }) => {
    const res = await ipc.ecosystem.gatewayRequest(input);
    await refreshLive();
    return res;
  }, [refreshLive]);

  const assignSeat = useCallback(async (userId: string, userName: string) => { const r = await ipc.ecosystem.assignSeat(userId, userName); await refreshLive(); return r; }, [refreshLive]);
  const releaseSeat = useCallback(async (seatId: string) => { await ipc.ecosystem.releaseSeat(seatId); await refreshLive(); }, [refreshLive]);
  const purchase = useCallback(async (listingId: string) => { const r = await ipc.ecosystem.purchase(listingId); await refreshLive(); return r; }, [refreshLive]);

  // Platform surfaces (P3.0). The API request runs through the real gateway (metering
  // + audit), so refresh the live slices afterward to reflect the new gateway traffic.
  const runApiRequest = useCallback(async (req: EnterpriseApiRequest) => { const r = await ipc.api.request(req); await refreshLive(); return r; }, [refreshLive]);
  const createWebhook = useCallback(async (input: { label: string; url: string; categories?: PlatformEventCategory[]; types?: string[] }) => {
    const res = await ipc.webhooks.create(input);
    await refreshLive();
    return res;
  }, [refreshLive]);
  const setWebhookEnabled = useCallback(async (id: string, enabled: boolean) => { await ipc.webhooks.setEnabled(id, enabled); await refreshLive(); }, [refreshLive]);
  const deleteWebhook = useCallback(async (id: string) => { await ipc.webhooks.remove(id); await refreshLive(); }, [refreshLive]);
  const loadDeliveries = useCallback((webhookId?: string, limit?: number) => ipc.webhooks.deliveries(webhookId, limit), []);
  const loadDeadLetters = useCallback(() => ipc.webhooks.deadLetters(), []);
  const replayDelivery = useCallback(async (id: string) => { const r = await ipc.webhooks.replay(id); await refreshLive(); return r; }, [refreshLive]);

  const value = useMemo<DeveloperContextValue>(
    () => ({
      ready,
      dashboard,
      keys,
      oauthApps,
      analytics,
      sdks,
      listings,
      marketplaceStats,
      events,
      gatewayVersions,
      gatewayMetrics,
      gatewayAudit,
      billing,
      plans,
      seats,
      licenses,
      purchases,
      routes,
      openapi,
      webhooks,
      webhookStats,
      extensions,
      refreshAll,
      setPlan,
      createKey,
      revokeKey,
      createOAuthApp,
      deleteOAuthApp,
      listingDetail,
      createListing,
      createVersion,
      submit,
      review,
      publish,
      rollback,
      install,
      rate,
      runGatewayRequest,
      assignSeat,
      releaseSeat,
      purchase,
      runApiRequest,
      createWebhook,
      setWebhookEnabled,
      deleteWebhook,
      loadDeliveries,
      loadDeadLetters,
      replayDelivery,
    }),
    [
      ready, dashboard, keys, oauthApps, analytics, sdks, listings, marketplaceStats, events,
      gatewayVersions, gatewayMetrics, gatewayAudit, billing, plans, seats, licenses, purchases,
      routes, openapi, webhooks, webhookStats, extensions,
      refreshAll, setPlan, createKey, revokeKey, createOAuthApp, deleteOAuthApp, listingDetail,
      createListing, createVersion, submit, review, publish, rollback, install, rate,
      runGatewayRequest, assignSeat, releaseSeat, purchase,
      runApiRequest, createWebhook, setWebhookEnabled, deleteWebhook, loadDeliveries, loadDeadLetters, replayDelivery,
    ],
  );

  return <DeveloperContext.Provider value={value}>{children}</DeveloperContext.Provider>;
}

export function useDeveloper(): DeveloperContextValue {
  const ctx = useContext(DeveloperContext);
  if (!ctx) throw new Error('useDeveloper must be used within DeveloperProvider');
  return ctx;
}
