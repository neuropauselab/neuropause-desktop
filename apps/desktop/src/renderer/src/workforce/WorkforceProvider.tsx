/**
 * The AI Workforce data provider. Loads workers, jobs, the governance audit
 * trail, and policies, and subscribes to the live workforce broadcast so every
 * panel stays current as jobs run and proposals are decided. It also exposes the
 * full action surface — run a skill, approve/reject a proposal, run/resume a
 * workflow — each of which refreshes the affected slices.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  DelegationPlan,
  Job,
  PolicyRule,
  Worker,
  WorkerInstallDetail,
  WorkerInstallResult,
  WorkerInstallSummary,
  WorkerPackage,
  WorkerSummary,
  WorkforceAuditEntry,
  WorkforceDelegateRequest,
  WorkflowRun,
  WorkflowSpec,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('workforce');
import type { WorkforceIntelligence } from './intelligenceTypes';

interface WorkforceContextValue {
  ready: boolean;
  workers: WorkerSummary[];
  jobs: Job[];
  intelligence: WorkforceIntelligence | null;
  audit: WorkforceAuditEntry[];
  auditTotal: number;
  policies: PolicyRule[];
  /** P8.6 — installed worker packages (P8.5 install service). */
  installs: WorkerInstallSummary[];
  /**
   * GATE 15 (round 47) — non-null when the last installs read FAILED. The read
   * used to be swallowed into `[]`, so a denied `workforce:installs` rendered
   * as "no installed packages" — an answer, and the wrong one. Partial
   * degradation is kept (a failed installs read must not sink the whole
   * workforce view); the failure is exposed for surfaces to say.
   */
  installsError: string | null;
  refreshAll: () => Promise<void>;
  loadWorker: (id: string) => Promise<Worker | null>;
  runSkill: (workerId: string, skillId: string, input?: Record<string, unknown>) => Promise<Job | null>;
  approve: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  reject: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  runWorkflow: (spec: WorkflowSpec) => Promise<WorkflowRun | null>;
  resumeWorkflow: (runId: string) => Promise<WorkflowRun | null>;
  approveCheckpoint: (runId: string, stepId: string, approved: boolean) => Promise<WorkflowRun | null>;
  // P8.6 — install lifecycle (gated by workforce:manage server-side) + detail + delegation.
  loadInstallDetail: (id: string) => Promise<WorkerInstallDetail | null>;
  installWorker: (pkg: WorkerPackage) => Promise<WorkerInstallResult>;
  updateWorker: (pkg: WorkerPackage) => Promise<WorkerInstallResult>;
  enableWorker: (id: string) => Promise<WorkerInstallResult>;
  disableWorker: (id: string) => Promise<WorkerInstallResult>;
  rollbackWorker: (id: string) => Promise<WorkerInstallResult>;
  uninstallWorker: (id: string) => Promise<WorkerInstallResult>;
  delegate: (goal: WorkforceDelegateRequest) => Promise<DelegationPlan>;
}

const WorkforceContext = createContext<WorkforceContextValue | null>(null);

export function WorkforceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [audit, setAudit] = useState<WorkforceAuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [intelligence, setIntelligence] = useState<WorkforceIntelligence | null>(null);
  const [installs, setInstalls] = useState<WorkerInstallSummary[]>([]);
  const [installsError, setInstallsError] = useState<string | null>(null);
  const detailCache = useRef(new Map<string, Worker>());

  const describeInstallsError = (err: unknown): string =>
    err instanceof Error && err.message ? err.message : 'The installed-packages read failed.';

  const refreshAll = useCallback(async () => {
    try {
      const [w, j, a, p, intel, ins] = await Promise.all([
        ipc.workforce.workers(),
        ipc.workforce.jobs({ limit: 200 }),
        ipc.workforce.audit({ limit: 200 }),
        ipc.workforce.policies(),
        ipc.workforce.intelligence(),
        // Partial degradation is deliberate — a failed installs read must not
        // sink the whole view — but the failure is RECORDED, never silent.
        ipc.workforce.installs().then(
          (ins2) => {
            setInstallsError(null);
            return ins2;
          },
          (err: unknown) => {
            setInstallsError(describeInstallsError(err));
            return [] as WorkerInstallSummary[];
          },
        ),
      ]);
      setWorkers(w);
      setIntelligence(intel);
      setJobs(j.jobs);
      setAudit(a.entries);
      setAuditTotal(a.total);
      setPolicies(p);
      setInstalls(ins);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh workforce', err);
    }
  }, []);

  // After a lifecycle action, refresh the installs + roster (a worker may appear/vanish).
  const refreshInstalls = useCallback(async () => {
    try {
      const [ins, w] = await Promise.all([ipc.workforce.installs(), ipc.workforce.workers()]);
      setInstalls(ins);
      setWorkers(w);
      setInstallsError(null);
    } catch (err) {
      setInstallsError(describeInstallsError(err));
      log.error('Failed to refresh installs', err);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const [j, a] = await Promise.all([ipc.workforce.jobs({ limit: 200 }), ipc.workforce.audit({ limit: 200 })]);
      setJobs(j.jobs);
      setAudit(a.entries);
      setAuditTotal(a.total);
    } catch (err) {
      log.error('Failed to refresh jobs', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = ipc.workforce.onEvent(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void refreshAll(), 150);
    });
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [refreshAll]);

  const loadWorker = useCallback(async (id: string): Promise<Worker | null> => {
    try {
      const w = await ipc.workforce.worker(id);
      if (w) detailCache.current.set(id, w);
      return w;
    } catch (err) {
      log.error('Failed to load worker', err);
      return detailCache.current.get(id) ?? null;
    }
  }, []);

  const runSkill = useCallback(
    async (workerId: string, skillId: string, input?: Record<string, unknown>): Promise<Job | null> => {
      const job = await ipc.workforce.runJob(workerId, skillId, input);
      await refreshJobs();
      return job;
    },
    [refreshJobs],
  );

  const approve = useCallback(
    async (jobId: string, proposalId: string, note?: string): Promise<Job | null> => {
      const job = await ipc.workforce.approve(jobId, proposalId, note);
      await refreshJobs();
      return job;
    },
    [refreshJobs],
  );

  const reject = useCallback(
    async (jobId: string, proposalId: string, note?: string): Promise<Job | null> => {
      const job = await ipc.workforce.reject(jobId, proposalId, note);
      await refreshJobs();
      return job;
    },
    [refreshJobs],
  );

  const runWorkflow = useCallback(
    async (spec: WorkflowSpec): Promise<WorkflowRun | null> => {
      const run = await ipc.workforce.runWorkflow(spec);
      await refreshJobs();
      return run;
    },
    [refreshJobs],
  );

  const resumeWorkflow = useCallback(
    async (runId: string): Promise<WorkflowRun | null> => {
      const run = await ipc.workforce.resumeWorkflow(runId);
      await refreshJobs();
      return run;
    },
    [refreshJobs],
  );

  const approveCheckpoint = useCallback(
    async (runId: string, stepId: string, approved: boolean): Promise<WorkflowRun | null> => {
      const run = await ipc.workforce.approveCheckpoint(runId, stepId, approved);
      await refreshJobs();
      return run;
    },
    [refreshJobs],
  );

  const loadInstallDetail = useCallback(
    (id: string): Promise<WorkerInstallDetail | null> => ipc.workforce.installDetail(id).catch(() => null),
    [],
  );

  // Every lifecycle action is RBAC-gated (workforce:manage) server-side; the UI reports
  // the structured result and refreshes. A rejected (unauthorized) call surfaces as an error.
  const installWorker = useCallback(
    async (pkg: WorkerPackage): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.install(pkg);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const updateWorker = useCallback(
    async (pkg: WorkerPackage): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.updateInstall(pkg);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const enableWorker = useCallback(
    async (id: string): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.enableInstall(id);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const disableWorker = useCallback(
    async (id: string): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.disableInstall(id);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const rollbackWorker = useCallback(
    async (id: string): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.rollbackInstall(id);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const uninstallWorker = useCallback(
    async (id: string): Promise<WorkerInstallResult> => {
      const r = await ipc.workforce.uninstall(id);
      await refreshInstalls();
      return r;
    },
    [refreshInstalls],
  );
  const delegate = useCallback(
    (goal: WorkforceDelegateRequest): Promise<DelegationPlan> => ipc.workforce.delegate(goal),
    [],
  );

  const value = useMemo<WorkforceContextValue>(
    () => ({
      ready,
      workers,
      jobs,
      intelligence,
      audit,
      auditTotal,
      policies,
      installs,
      installsError,
      refreshAll,
      loadWorker,
      runSkill,
      approve,
      reject,
      runWorkflow,
      resumeWorkflow,
      approveCheckpoint,
      loadInstallDetail,
      installWorker,
      updateWorker,
      enableWorker,
      disableWorker,
      rollbackWorker,
      uninstallWorker,
      delegate,
    }),
    [
      ready,
      workers,
      jobs,
      intelligence,
      audit,
      auditTotal,
      policies,
      installs,
      installsError,
      refreshAll,
      loadWorker,
      runSkill,
      approve,
      reject,
      runWorkflow,
      resumeWorkflow,
      approveCheckpoint,
      loadInstallDetail,
      installWorker,
      updateWorker,
      enableWorker,
      disableWorker,
      rollbackWorker,
      uninstallWorker,
      delegate,
    ],
  );

  return <WorkforceContext.Provider value={value}>{children}</WorkforceContext.Provider>;
}

export function useWorkforce(): WorkforceContextValue {
  const ctx = useContext(WorkforceContext);
  if (!ctx) throw new Error('useWorkforce must be used within WorkforceProvider');
  return ctx;
}
