/**
 * The AI Sandbox workspace data provider (P4 Validation Experience).
 *
 * Loads the S1 core rollup (dashboard, scenarios, execution history, queue, workspaces) and the
 * S6 continuous-validation projections (summary, dashboard, latest run detail) in one bulk pass,
 * then subscribes to the single `sandbox:event` broadcast so every panel stays live. It exposes
 * the workspace's action surface — run a validation pipeline, open a run's detail, open an
 * execution's artifacts/result/report, (re)generate a report, and toggle a schedule — each a
 * typed IPC call validated + audited in the main process. No new engine/store: it is a read/command
 * seam over AI Sandbox v1.0. UI-only state (active workspace, search text, executive mode) lives here too.
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
  Artifact,
  Execution,
  ExecutionQueueState,
  ExecutionTimelineEntry,
  PipelineKind,
  RunResult,
  SandboxDashboard,
  SandboxReport,
  SandboxWorkspace,
  Scenario,
  ValidationDashboard,
  ValidationRunDetail,
  ValidationSummary,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';

const log = createLogger('sandbox');

export interface ExecutionDetail {
  execution: Execution;
  timeline: ExecutionTimelineEntry[];
  result: RunResult | null;
  report: SandboxReport | null;
  artifacts: Artifact[];
}

interface SandboxContextValue {
  ready: boolean;
  error: string | null;
  // S1 core
  dashboard: SandboxDashboard | null;
  scenarios: Scenario[];
  history: Execution[];
  historyTotal: number;
  queue: ExecutionQueueState | null;
  workspaces: SandboxWorkspace[];
  workspaceId: string | null;
  // S6 validation
  summary: ValidationSummary | null;
  validation: ValidationDashboard | null;
  runDetail: ValidationRunDetail | null;
  selectedRunId: string | null;
  // execution drill-down
  execDetail: ExecutionDetail | null;
  selectedExecutionId: string | null;
  // in-flight run
  runningPipeline: PipelineKind | null;
  // UI-only
  searchQuery: string;
  executiveMode: boolean;
  // derived
  isValidationRunPersisted: (runId: string) => boolean;
  // actions
  refreshAll: () => Promise<void>;
  setWorkspaceId: (id: string) => void;
  setSearchQuery: (q: string) => void;
  setExecutiveMode: (on: boolean) => void;
  runValidation: (pipeline: PipelineKind) => Promise<void>;
  loadRunDetail: (runId: string) => Promise<void>;
  clearRunDetail: () => void;
  selectExecution: (id: string) => Promise<void>;
  clearExecution: () => void;
  generateReport: (executionId: string) => Promise<void>;
  cancelExecution: (id: string) => Promise<void>;
  setSchedule: (id: string, enabled: boolean) => Promise<void>;
}

const SandboxContext = createContext<SandboxContextValue | null>(null);

async function resolveRunDetail(runId: string): Promise<ValidationRunDetail | null> {
  const res = await ipc.sandbox.validationRunGet(runId);
  if (res && typeof res === 'object' && 'error' in res) return null;
  return res as ValidationRunDetail;
}

export function SandboxProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SandboxDashboard | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [history, setHistory] = useState<Execution[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [queue, setQueue] = useState<ExecutionQueueState | null>(null);
  const [workspaces, setWorkspaces] = useState<SandboxWorkspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [validation, setValidation] = useState<ValidationDashboard | null>(null);
  const [runDetail, setRunDetail] = useState<ValidationRunDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [execDetail, setExecDetail] = useState<ExecutionDetail | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [runningPipeline, setRunningPipeline] = useState<PipelineKind | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [executiveMode, setExecutiveMode] = useState(false);

  // Live refs so the once-subscribed broadcast handler always sees current selections.
  const workspaceRef = useRef<string | null>(workspaceId);
  workspaceRef.current = workspaceId;
  const selectedRunRef = useRef<string | null>(selectedRunId);
  selectedRunRef.current = selectedRunId;

  const refreshAll = useCallback(async () => {
    try {
      const [dash, sum, val, wss] = await Promise.all([
        ipc.sandbox.dashboard(workspaceRef.current ?? undefined),
        ipc.sandbox.validationSummary(),
        ipc.sandbox.validationDashboard(),
        ipc.sandbox.workspaces(),
      ]);
      setDashboard(dash);
      setSummary(sum);
      setValidation(val);
      setWorkspaces(wss);
      const wsId = workspaceRef.current ?? wss[0]?.id ?? null;
      if (workspaceRef.current === null && wsId) setWorkspaceIdState(wsId);

      const [scn, hist, q] = await Promise.all([
        ipc.sandbox.scenarios(wsId ?? undefined),
        ipc.sandbox.executionHistory({ workspaceId: wsId ?? undefined, limit: 50 }),
        ipc.sandbox.queueState(wsId ?? undefined),
      ]);
      setScenarios(scn);
      setHistory(hist.executions);
      setHistoryTotal(hist.total);
      setQueue(q);

      // Default the run drill-down to the most recent run when nothing is pinned.
      const targetRun = selectedRunRef.current ?? sum.recent[0]?.runId ?? null;
      if (targetRun) {
        const detail = await resolveRunDetail(targetRun);
        setRunDetail(detail);
        setSelectedRunId(targetRun);
      }
      setReady(true);
      setError(null);
    } catch (err) {
      log.error('Failed to refresh sandbox', err);
      setError('Could not load the Sandbox. The workspace will retry.');
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const wsId = workspaceRef.current ?? undefined;
      const [dash, val, hist, q] = await Promise.all([
        ipc.sandbox.dashboard(wsId),
        ipc.sandbox.validationDashboard(),
        ipc.sandbox.executionHistory({ workspaceId: wsId, limit: 50 }),
        ipc.sandbox.queueState(wsId),
      ]);
      setDashboard(dash);
      setValidation(val);
      setHistory(hist.executions);
      setHistoryTotal(hist.total);
      setQueue(q);
      // Keep the summary fresh too (pipeline catalog + recent + latest certification).
      const sum = await ipc.sandbox.validationSummary();
      setSummary(sum);
      if (selectedRunRef.current) {
        const detail = await resolveRunDetail(selectedRunRef.current);
        if (detail) setRunDetail(detail);
      }
    } catch (err) {
      log.error('Failed to refresh sandbox live slices', err);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = (fn: () => void): void => {
      if (t) clearTimeout(t);
      t = setTimeout(fn, 180);
    };
    const off = ipc.sandbox.onEvent(() => debounced(() => void refreshLive()));
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [refreshAll, refreshLive]);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    workspaceRef.current = id;
    void refreshAll();
  }, [refreshAll]);

  const runValidation = useCallback(async (pipeline: PipelineKind) => {
    setRunningPipeline(pipeline);
    try {
      const detail = await ipc.sandbox.validationRun(pipeline);
      setRunDetail(detail);
      setSelectedRunId(detail.run.id);
      selectedRunRef.current = detail.run.id;
      await refreshLive();
    } catch (err) {
      log.error('Validation run failed', err);
      setError('The validation run could not be started.');
    } finally {
      setRunningPipeline(null);
    }
  }, [refreshLive]);

  const loadRunDetail = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    selectedRunRef.current = runId;
    const detail = await resolveRunDetail(runId);
    setRunDetail(detail);
  }, []);

  const clearRunDetail = useCallback(() => {
    setSelectedRunId(null);
    selectedRunRef.current = null;
    setRunDetail(null);
  }, []);

  const selectExecution = useCallback(async (id: string) => {
    setSelectedExecutionId(id);
    try {
      const [execution, timeline, result, report, artifacts] = await Promise.all([
        ipc.sandbox.execution(id),
        ipc.sandbox.timeline(id, 200),
        ipc.sandbox.result(id),
        ipc.sandbox.report(id),
        ipc.sandbox.artifacts(id),
      ]);
      if (!execution) {
        setExecDetail(null);
        return;
      }
      setExecDetail({ execution, timeline, result, report, artifacts });
    } catch (err) {
      log.error('Failed to load execution detail', err);
      setExecDetail(null);
    }
  }, []);

  const clearExecution = useCallback(() => {
    setSelectedExecutionId(null);
    setExecDetail(null);
  }, []);

  const generateReport = useCallback(async (executionId: string) => {
    try {
      await ipc.sandbox.generateReport(executionId);
      await selectExecution(executionId);
      await refreshLive();
    } catch (err) {
      log.error('Failed to generate report', err);
    }
  }, [selectExecution, refreshLive]);

  const cancelExecution = useCallback(async (id: string) => {
    try {
      await ipc.sandbox.cancel(id);
      await refreshLive();
    } catch (err) {
      log.error('Failed to cancel execution', err);
    }
  }, [refreshLive]);

  const setSchedule = useCallback(async (id: string, enabled: boolean) => {
    try {
      await ipc.sandbox.setSchedule(id, enabled);
      await refreshLive();
    } catch (err) {
      log.error('Failed to toggle schedule', err);
    }
  }, [refreshLive]);

  const isValidationRunPersisted = useCallback(
    (runId: string) => (summary?.recent ?? []).some((r) => r.runId === runId),
    [summary],
  );

  const value = useMemo<SandboxContextValue>(
    () => ({
      ready,
      error,
      dashboard,
      scenarios,
      history,
      historyTotal,
      queue,
      workspaces,
      workspaceId,
      summary,
      validation,
      runDetail,
      selectedRunId,
      execDetail,
      selectedExecutionId,
      runningPipeline,
      searchQuery,
      executiveMode,
      isValidationRunPersisted,
      refreshAll,
      setWorkspaceId,
      setSearchQuery,
      setExecutiveMode,
      runValidation,
      loadRunDetail,
      clearRunDetail,
      selectExecution,
      clearExecution,
      generateReport,
      cancelExecution,
      setSchedule,
    }),
    [
      ready, error, dashboard, scenarios, history, historyTotal, queue, workspaces, workspaceId,
      summary, validation, runDetail, selectedRunId, execDetail, selectedExecutionId, runningPipeline,
      searchQuery, executiveMode, isValidationRunPersisted, refreshAll, setWorkspaceId, runValidation,
      loadRunDetail, clearRunDetail, selectExecution, clearExecution, generateReport, cancelExecution, setSchedule,
    ],
  );

  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

export function useSandbox(): SandboxContextValue {
  const ctx = useContext(SandboxContext);
  if (!ctx) throw new Error('useSandbox must be used within SandboxProvider');
  return ctx;
}
