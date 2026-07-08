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
  Job,
  PolicyRule,
  Worker,
  WorkerSummary,
  WorkforceAuditEntry,
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
  refreshAll: () => Promise<void>;
  loadWorker: (id: string) => Promise<Worker | null>;
  runSkill: (workerId: string, skillId: string, input?: Record<string, unknown>) => Promise<Job | null>;
  approve: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  reject: (jobId: string, proposalId: string, note?: string) => Promise<Job | null>;
  runWorkflow: (spec: WorkflowSpec) => Promise<WorkflowRun | null>;
  resumeWorkflow: (runId: string) => Promise<WorkflowRun | null>;
  approveCheckpoint: (runId: string, stepId: string, approved: boolean) => Promise<WorkflowRun | null>;
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
  const detailCache = useRef(new Map<string, Worker>());

  const refreshAll = useCallback(async () => {
    try {
      const [w, j, a, p, intel] = await Promise.all([
        ipc.workforce.workers(),
        ipc.workforce.jobs({ limit: 200 }),
        ipc.workforce.audit({ limit: 200 }),
        ipc.workforce.policies(),
        ipc.workforce.intelligence(),
      ]);
      setWorkers(w);
      setIntelligence(intel);
      setJobs(j.jobs);
      setAudit(a.entries);
      setAuditTotal(a.total);
      setPolicies(p);
      setReady(true);
    } catch (err) {
      log.error('Failed to refresh workforce', err);
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

  const value = useMemo<WorkforceContextValue>(
    () => ({
      ready,
      workers,
      jobs,
      intelligence,
      audit,
      auditTotal,
      policies,
      refreshAll,
      loadWorker,
      runSkill,
      approve,
      reject,
      runWorkflow,
      resumeWorkflow,
      approveCheckpoint,
    }),
    [
      ready,
      workers,
      jobs,
      intelligence,
      audit,
      auditTotal,
      policies,
      refreshAll,
      loadWorker,
      runSkill,
      approve,
      reject,
      runWorkflow,
      resumeWorkflow,
      approveCheckpoint,
    ],
  );

  return <WorkforceContext.Provider value={value}>{children}</WorkforceContext.Provider>;
}

export function useWorkforce(): WorkforceContextValue {
  const ctx = useContext(WorkforceContext);
  if (!ctx) throw new Error('useWorkforce must be used within WorkforceProvider');
  return ctx;
}
