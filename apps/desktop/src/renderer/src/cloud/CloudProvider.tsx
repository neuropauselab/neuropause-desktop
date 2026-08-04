/**
 * The Cloud Platform data provider. Loads the multi-tenant runtime (regions,
 * tenants, projects, teams, workers, storage isolation), identity federation
 * (SSO connections, SCIM, MFA), the real live-sync engine's status + per-entity
 * detail, the API platform (deployments, policies, webhooks, public APIs), and
 * the admin overview — then subscribes to the cloud broadcast to stay live.
 *
 * Every side effect is a typed IPC call validated in the main process.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AdminOverview,
  ApiDeployment,
  ApiPlatformSummary,
  CloudProject,
  CloudRateLimitPolicy,
  CloudRegion,
  CloudTeam,
  CloudTenant,
  FederationResult,
  IdentitySummary,
  LiveSyncDetail,
  MfaMethod,
  MfaPolicy,
  PublicApi,
  ScimConfig,
  SsoConnection,
  SsoProtocol,
  SsoStatus,
  StorageIsolation,
  TenantStatus,
  TenantSummary,
  TenantTier,
  TenantWorker,
  WebhookEndpoint,
  WebhookStatus,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('cloud');

interface CloudContextValue {
  ready: boolean;
  // tenancy
  regions: CloudRegion[];
  tenants: CloudTenant[];
  tenantSummary: TenantSummary | null;
  projects: CloudProject[];
  teams: CloudTeam[];
  workers: TenantWorker[];
  isolation: StorageIsolation[];
  // identity
  ssoConnections: SsoConnection[];
  identitySummary: IdentitySummary | null;
  scim: ScimConfig | null;
  mfa: MfaPolicy | null;
  /** The live-sync engine's real state: status, per-entity queue/mirror counts,
   *  and the resolved-conflict log. Null until the first load completes. */
  liveSync: LiveSyncDetail | null;
  // api platform
  deployments: ApiDeployment[];
  apiSummary: ApiPlatformSummary | null;
  policies: CloudRateLimitPolicy[];
  webhooks: WebhookEndpoint[];
  publicApis: PublicApi[];
  // admin
  admin: AdminOverview | null;

  refreshAll: () => Promise<void>;
  // tenancy actions
  createTenant: (input: { name: string; regionId: CloudRegion['id']; tier: TenantTier }) => Promise<void>;
  setTenantStatus: (tenantId: string, status: TenantStatus) => Promise<void>;
  createProject: (input: { tenantId: string; name: string; description?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createTeam: (input: { tenantId: string; name: string }) => Promise<void>;
  // identity actions
  createSso: (input: { name: string; protocol: SsoProtocol; issuer: string; entityId?: string; ssoUrl: string; clientId?: string; domains: string[] }) => Promise<void>;
  updateSso: (input: { id: string; status?: SsoStatus; enforced?: boolean }) => Promise<void>;
  deleteSso: (id: string) => Promise<void>;
  testSso: (id: string) => Promise<FederationResult>;
  setScim: (enabled: boolean) => Promise<void>;
  scimSync: () => Promise<void>;
  setMfa: (input: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }) => Promise<void>;
  // sync actions (the real engine)
  syncNow: () => Promise<void>;
  setSyncOnline: (online: boolean) => Promise<void>;
  // api platform actions
  setPolicyEnabled: (id: string, enabled: boolean) => Promise<void>;
  createWebhook: (input: { url: string; events: string[] }) => Promise<void>;
  setWebhookStatus: (id: string, status: WebhookStatus) => Promise<void>;
  deleteWebhook: (id: string) => Promise<void>;
  testWebhook: (id: string) => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [regions, setRegions] = useState<CloudRegion[]>([]);
  const [tenants, setTenants] = useState<CloudTenant[]>([]);
  const [tenantSummary, setTenantSummary] = useState<TenantSummary | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [teams, setTeams] = useState<CloudTeam[]>([]);
  const [workers, setWorkers] = useState<TenantWorker[]>([]);
  const [isolation, setIsolation] = useState<StorageIsolation[]>([]);
  const [ssoConnections, setSsoConnections] = useState<SsoConnection[]>([]);
  const [identitySummary, setIdentitySummary] = useState<IdentitySummary | null>(null);
  const [scim, setScimState] = useState<ScimConfig | null>(null);
  const [mfa, setMfaState] = useState<MfaPolicy | null>(null);
  const [liveSync, setLiveSync] = useState<LiveSyncDetail | null>(null);
  const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
  const [apiSummary, setApiSummary] = useState<ApiPlatformSummary | null>(null);
  const [policies, setPolicies] = useState<CloudRateLimitPolicy[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [publicApis, setPublicApis] = useState<PublicApi[]>([]);
  const [admin, setAdmin] = useState<AdminOverview | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [rg, tn, ts, pj, tm, wk, iso, sso, idn, sc, mf, sync, dep, asum, pol, wh, api, adm] = await Promise.all([
        ipc.cloud.regions(),
        ipc.cloud.tenants(),
        ipc.cloud.tenantSummary(),
        ipc.cloud.projects(),
        ipc.cloud.teams(),
        ipc.cloud.tenantWorkers(),
        ipc.cloud.storageIsolation(),
        ipc.cloud.ssoConnections(),
        ipc.cloud.identitySummary(),
        ipc.cloud.scim(),
        ipc.cloud.mfa(),
        ipc.cloud.liveSyncDetail(),
        ipc.cloud.deployments(),
        ipc.cloud.apiSummary(),
        ipc.cloud.ratePolicies(),
        ipc.cloud.webhooks(),
        ipc.cloud.publicApis(),
        ipc.cloud.adminOverview(),
      ]);
      setRegions(rg);
      setTenants(tn);
      setTenantSummary(ts);
      setProjects(pj);
      setTeams(tm);
      setWorkers(wk);
      setIsolation(iso);
      setSsoConnections(sso);
      setIdentitySummary(idn);
      setScimState(sc);
      setMfaState(mf);
      setLiveSync(sync);
      setDeployments(dep);
      setApiSummary(asum);
      setPolicies(pol);
      setWebhooks(wh);
      setPublicApis(api);
      setAdmin(adm);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh cloud', err);
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const [tn, ts, sso, idn, sc, mf, sync, dep, asum, pol, wh, adm] = await Promise.all([
        ipc.cloud.tenants(),
        ipc.cloud.tenantSummary(),
        ipc.cloud.ssoConnections(),
        ipc.cloud.identitySummary(),
        ipc.cloud.scim(),
        ipc.cloud.mfa(),
        ipc.cloud.liveSyncDetail(),
        ipc.cloud.deployments(),
        ipc.cloud.apiSummary(),
        ipc.cloud.ratePolicies(),
        ipc.cloud.webhooks(),
        ipc.cloud.adminOverview(),
      ]);
      setTenants(tn);
      setTenantSummary(ts);
      setSsoConnections(sso);
      setIdentitySummary(idn);
      setScimState(sc);
      setMfaState(mf);
      setLiveSync(sync);
      setDeployments(dep);
      setApiSummary(asum);
      setPolicies(pol);
      setWebhooks(wh);
      setAdmin(adm);
    } catch (err) {
      log.error('Failed to refresh cloud live slices', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = (fn: () => void): void => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 180);
    };
    const off = ipc.cloud.onEvent(() => debounced(() => void refreshLive()));
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [refreshAll, refreshLive]);

  const refreshProjectsTeams = useCallback(async () => {
    const [pj, tm] = await Promise.all([ipc.cloud.projects(), ipc.cloud.teams()]);
    setProjects(pj);
    setTeams(tm);
  }, []);

  const createTenant = useCallback(async (input: { name: string; regionId: CloudRegion['id']; tier: TenantTier }) => { await ipc.cloud.createTenant(input); await refreshLive(); }, [refreshLive]);
  const setTenantStatus = useCallback(async (tenantId: string, status: TenantStatus) => { await ipc.cloud.setTenantStatus(tenantId, status); await refreshLive(); }, [refreshLive]);
  const createProject = useCallback(async (input: { tenantId: string; name: string; description?: string }) => { await ipc.cloud.createProject(input); await refreshProjectsTeams(); await refreshLive(); }, [refreshProjectsTeams, refreshLive]);
  const deleteProject = useCallback(async (id: string) => { await ipc.cloud.deleteProject(id); await refreshProjectsTeams(); await refreshLive(); }, [refreshProjectsTeams, refreshLive]);
  const createTeam = useCallback(async (input: { tenantId: string; name: string }) => { await ipc.cloud.createTeam(input); await refreshProjectsTeams(); await refreshLive(); }, [refreshProjectsTeams, refreshLive]);

  const createSso = useCallback(async (input: { name: string; protocol: SsoProtocol; issuer: string; entityId?: string; ssoUrl: string; clientId?: string; domains: string[] }) => { await ipc.cloud.createSso(input); await refreshLive(); }, [refreshLive]);
  const updateSso = useCallback(async (input: { id: string; status?: SsoStatus; enforced?: boolean }) => { await ipc.cloud.updateSso(input); await refreshLive(); }, [refreshLive]);
  const deleteSso = useCallback(async (id: string) => { await ipc.cloud.deleteSso(id); await refreshLive(); }, [refreshLive]);
  const testSso = useCallback(async (id: string) => ipc.cloud.testSso(id), []);
  const setScim = useCallback(async (enabled: boolean) => { await ipc.cloud.setScim(enabled); await refreshLive(); }, [refreshLive]);
  const scimSync = useCallback(async () => { await ipc.cloud.scimSync(); await refreshLive(); }, [refreshLive]);
  const setMfa = useCallback(async (input: { required?: boolean; methods?: MfaMethod[]; graceDays?: number }) => { await ipc.cloud.setMfa(input); await refreshLive(); }, [refreshLive]);

  // The real engine: a cycle now, and pause/resume. Both broadcast a cloud 'sync'
  // event from main, but we refresh the detail directly so the panel updates without
  // waiting on the debounce.
  const refreshSync = useCallback(async () => {
    setLiveSync(await ipc.cloud.liveSyncDetail());
  }, []);
  const syncNow = useCallback(async () => { await ipc.cloud.liveSyncNow(); await refreshSync(); }, [refreshSync]);
  const setSyncOnline = useCallback(async (online: boolean) => { await ipc.cloud.liveSyncSetOnline(online); await refreshSync(); }, [refreshSync]);

  const setPolicyEnabled = useCallback(async (id: string, enabled: boolean) => { await ipc.cloud.setPolicyEnabled(id, enabled); await refreshLive(); }, [refreshLive]);
  const createWebhook = useCallback(async (input: { url: string; events: string[] }) => { await ipc.cloud.createWebhook(input); await refreshLive(); }, [refreshLive]);
  const setWebhookStatus = useCallback(async (id: string, status: WebhookStatus) => { await ipc.cloud.setWebhookStatus(id, status); await refreshLive(); }, [refreshLive]);
  const deleteWebhook = useCallback(async (id: string) => { await ipc.cloud.deleteWebhook(id); await refreshLive(); }, [refreshLive]);
  const testWebhook = useCallback(async (id: string) => { await ipc.cloud.testWebhook(id); await refreshLive(); }, [refreshLive]);

  const value = useMemo<CloudContextValue>(
    () => ({
      ready,
      regions, tenants, tenantSummary, projects, teams, workers, isolation,
      ssoConnections, identitySummary, scim, mfa,
      liveSync,
      deployments, apiSummary, policies, webhooks, publicApis,
      admin,
      refreshAll,
      createTenant, setTenantStatus, createProject, deleteProject, createTeam,
      createSso, updateSso, deleteSso, testSso, setScim, scimSync, setMfa,
      syncNow, setSyncOnline,
      setPolicyEnabled, createWebhook, setWebhookStatus, deleteWebhook, testWebhook,
    }),
    [
      ready, regions, tenants, tenantSummary, projects, teams, workers, isolation,
      ssoConnections, identitySummary, scim, mfa, liveSync,
      deployments, apiSummary, policies, webhooks, publicApis, admin,
      refreshAll, createTenant, setTenantStatus, createProject, deleteProject, createTeam,
      createSso, updateSso, deleteSso, testSso, setScim, scimSync, setMfa,
      syncNow, setSyncOnline,
      setPolicyEnabled, createWebhook, setWebhookStatus, deleteWebhook, testWebhook,
    ],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudContextValue {
  const ctx = useContext(CloudContext);
  if (!ctx) throw new Error('useCloud must be used within CloudProvider');
  return ctx;
}
