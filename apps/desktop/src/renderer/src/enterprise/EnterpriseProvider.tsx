/**
 * The Enterprise data provider. Loads the executive snapshot, org chart,
 * organization graph, governance config + compliance findings, audit trail,
 * workspaces, the live workforce (workers + jobs), recommendations, and
 * connector health — then subscribes to the enterprise, workforce, and platform
 * broadcasts so every surface stays live. It also exposes the governed action
 * surface: approve/reject, delegate to a worker, launch a workflow, edit org
 * structure and roles, toggle governance, and switch workspaces.
 *
 * Read-only, on-demand queries (enterprise search, briefings, graph neighbors)
 * are called by the panels directly through the typed `ipc` client.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  ComplianceFinding,
  ConnectorStats,
  EnterpriseAuditEntry,
  ExecutiveSnapshot,
  GovernanceConfig,
  Job,
  Organization,
  OrgGraph,
  OrgRole,
  OrgUnit,
  OrgUnitKind,
  OrgUser,
  OrgUserStatus,
  Recommendation,
  EnterprisePermission,
  Workspace,
  WorkspaceSummary,
  WorkerSummary,
  WorkflowSpec,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('enterprise');

interface OrgBundle {
  organization: Organization | null;
  units: OrgUnit[];
  roles: OrgRole[];
  users: OrgUser[];
}

interface EnterpriseContextValue {
  ready: boolean;
  /** Set when the initial full load failed, so the view shows an honest unavailable state. */
  error: string | null;
  snapshot: ExecutiveSnapshot | null;
  org: OrgBundle;
  graph: OrgGraph | null;
  governance: GovernanceConfig | null;
  compliance: ComplianceFinding[];
  audit: EnterpriseAuditEntry[];
  workspaces: WorkspaceSummary[];
  activeWorkspace: Workspace | null;
  workers: WorkerSummary[];
  jobs: Job[];
  recommendations: Recommendation[];
  connectorStats: ConnectorStats | null;
  refreshAll: () => Promise<void>;
  // governed actions
  approve: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  reject: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  delegate: (workerId: string, skillId: string, input?: Record<string, unknown>) => Promise<Job | null>;
  runWorkflow: (spec: WorkflowSpec) => Promise<void>;
  // org structure
  createUnit: (input: { kind: OrgUnitKind; name: string; parentId?: string | null; leadUserId?: string | null }) => Promise<void>;
  updateUnit: (input: { id: string; name?: string; parentId?: string | null; leadUserId?: string | null }) => Promise<void>;
  deleteUnit: (id: string) => Promise<void>;
  createUser: (input: { name: string; email?: string | null; title?: string; unitId?: string | null; roleIds?: string[] }) => Promise<void>;
  updateUser: (input: { id: string; name?: string; email?: string | null; title?: string; unitId?: string | null; roleIds?: string[]; status?: OrgUserStatus }) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  createRole: (input: { name: string; description?: string; permissions: EnterprisePermission[] }) => Promise<void>;
  // governance
  setChain: (id: string, enabled: boolean) => Promise<void>;
  setRule: (id: string, enabled: boolean) => Promise<void>;
  // workspaces
  switchWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
}

const EnterpriseContext = createContext<EnterpriseContextValue | null>(null);

const EMPTY_ORG: OrgBundle = { organization: null, units: [], roles: [], users: [] };

export function EnterpriseProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ExecutiveSnapshot | null>(null);
  const [org, setOrg] = useState<OrgBundle>(EMPTY_ORG);
  const [graph, setGraph] = useState<OrgGraph | null>(null);
  const [governance, setGovernance] = useState<GovernanceConfig | null>(null);
  const [compliance, setCompliance] = useState<ComplianceFinding[]>([]);
  const [audit, setAudit] = useState<EnterpriseAuditEntry[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [connectorStats, setConnectorStats] = useState<ConnectorStats | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [snap, bundle, g, gov, comp, aud, ws, active, w, j, recs, cstats] = await Promise.all([
        ipc.enterprise.dashboard(),
        ipc.enterprise.org(),
        ipc.enterprise.graph(),
        ipc.enterprise.governanceConfig(),
        ipc.enterprise.compliance(),
        ipc.enterprise.audit(60),
        ipc.enterprise.workspaces(),
        ipc.enterprise.activeWorkspace(),
        ipc.workforce.workers(),
        ipc.workforce.jobs({ limit: 200 }),
        ipc.recommendations.generate(),
        ipc.connectors.stats(),
      ]);
      setSnapshot(snap);
      setOrg(bundle);
      setGraph(g);
      setGovernance(gov);
      setCompliance(comp);
      setAudit(aud);
      setWorkspaces(ws);
      setActiveWorkspace(active);
      setWorkers(w);
      setJobs(j.jobs);
      setRecommendations(recs.recommendations);
      setConnectorStats(cstats);
      setError(null);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh enterprise', err);
      // Honest failure: surface it so the view stops showing "Connecting…" and
      // never renders confident all-clear zeros over data that failed to load.
      setError(err instanceof Error ? err.message : 'Failed to load enterprise data');
    }
  }, []);

  // Light refresh for the fast-moving slices (after an action / event).
  const refreshLive = useCallback(async () => {
    try {
      const [snap, comp, aud, j, w] = await Promise.all([
        ipc.enterprise.dashboard(),
        ipc.enterprise.compliance(),
        ipc.enterprise.audit(60),
        ipc.workforce.jobs({ limit: 200 }),
        ipc.workforce.workers(),
      ]);
      setSnapshot(snap);
      setCompliance(comp);
      setAudit(aud);
      setJobs(j.jobs);
      setWorkers(w);
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
    const offEnt = ipc.enterprise.onEvent(() => debounced(() => void refreshAll()));
    const offWork = ipc.workforce.onEvent(() => debounced(() => void refreshLive()));
    const offPlatform = ipc.platform.onEvent(() => debounced(() => void refreshLive()));
    return () => {
      if (t) clearTimeout(t);
      offEnt();
      offWork();
      offPlatform();
    };
  }, [refreshAll, refreshLive]);

  const reloadOrg = useCallback((bundle: OrgBundle) => setOrg(bundle), []);

  const approve = useCallback(
    async (jobId: string, proposalId: string, note?: string) => {
      const job = await ipc.workforce.approve(jobId, proposalId, note);
      await refreshLive();
      return job;
    },
    [refreshLive],
  );
  const reject = useCallback(
    async (jobId: string, proposalId: string, note?: string) => {
      const job = await ipc.workforce.reject(jobId, proposalId, note);
      await refreshLive();
      return job;
    },
    [refreshLive],
  );
  const delegate = useCallback(
    async (workerId: string, skillId: string, input?: Record<string, unknown>) => {
      const job = await ipc.workforce.runJob(workerId, skillId, input);
      await refreshLive();
      return job;
    },
    [refreshLive],
  );
  const runWorkflow = useCallback(
    async (spec: WorkflowSpec) => {
      await ipc.workforce.runWorkflow(spec);
      await refreshLive();
    },
    [refreshLive],
  );

  const createUnit: EnterpriseContextValue['createUnit'] = useCallback(async (input) => { reloadOrg(await ipc.enterprise.createUnit(input)); }, [reloadOrg]);
  const updateUnit: EnterpriseContextValue['updateUnit'] = useCallback(async (input) => { reloadOrg(await ipc.enterprise.updateUnit(input)); }, [reloadOrg]);
  const deleteUnit: EnterpriseContextValue['deleteUnit'] = useCallback(async (id) => { reloadOrg(await ipc.enterprise.deleteUnit(id)); }, [reloadOrg]);
  const createUser: EnterpriseContextValue['createUser'] = useCallback(async (input) => { reloadOrg(await ipc.enterprise.createUser(input)); }, [reloadOrg]);
  const updateUser: EnterpriseContextValue['updateUser'] = useCallback(async (input) => { reloadOrg(await ipc.enterprise.updateUser(input)); }, [reloadOrg]);
  const deleteUser: EnterpriseContextValue['deleteUser'] = useCallback(async (id) => { reloadOrg(await ipc.enterprise.deleteUser(id)); }, [reloadOrg]);
  const createRole: EnterpriseContextValue['createRole'] = useCallback(async (input) => { reloadOrg(await ipc.enterprise.createRole(input)); }, [reloadOrg]);

  const setChain = useCallback(async (id: string, enabled: boolean) => {
    const chains = await ipc.enterprise.setChain(id, enabled);
    setGovernance((g) => (g ? { ...g, approvalChains: chains } : g));
    await refreshLive();
  }, [refreshLive]);
  const setRule = useCallback(async (id: string, enabled: boolean) => {
    const rules = await ipc.enterprise.setRule(id, enabled);
    setGovernance((g) => (g ? { ...g, complianceRules: rules } : g));
    await refreshLive();
  }, [refreshLive]);

  const switchWorkspace = useCallback(async (id: string) => {
    await ipc.enterprise.switchWorkspace(id);
    await refreshAll();
  }, [refreshAll]);
  const createWorkspace = useCallback(async (name: string) => {
    setWorkspaces(await ipc.enterprise.createWorkspace(name));
  }, []);

  const value = useMemo<EnterpriseContextValue>(
    () => ({
      ready,
      error,
      snapshot,
      org,
      graph,
      governance,
      compliance,
      audit,
      workspaces,
      activeWorkspace,
      workers,
      jobs,
      recommendations,
      connectorStats,
      refreshAll,
      approve,
      reject,
      delegate,
      runWorkflow,
      createUnit,
      updateUnit,
      deleteUnit,
      createUser,
      updateUser,
      deleteUser,
      createRole,
      setChain,
      setRule,
      switchWorkspace,
      createWorkspace,
    }),
    [
      ready, error, snapshot, org, graph, governance, compliance, audit, workspaces, activeWorkspace,
      workers, jobs, recommendations, connectorStats, refreshAll, approve, reject, delegate,
      runWorkflow, createUnit, updateUnit, deleteUnit, createUser, updateUser, deleteUser,
      createRole, setChain, setRule, switchWorkspace, createWorkspace,
    ],
  );

  return <EnterpriseContext.Provider value={value}>{children}</EnterpriseContext.Provider>;
}

export function useEnterprise(): EnterpriseContextValue {
  const ctx = useContext(EnterpriseContext);
  if (!ctx) throw new Error('useEnterprise must be used within EnterpriseProvider');
  return ctx;
}
