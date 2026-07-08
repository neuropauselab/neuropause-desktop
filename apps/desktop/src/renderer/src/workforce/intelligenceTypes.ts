/**
 * Renderer-facing shape of the workforce:intelligence IPC payload — mirrors the
 * main-process WorkforceIntelligence aggregation (apps/desktop/src/main/workforce/
 * intelligence). Declaration only: no analytics or state are computed here; every
 * value shown in the UI comes from the existing aggregation over the job store.
 */
export interface WorkerPerf {
  workerId: string;
  workerRole: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  successRate: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  ungroundedRate: number;
  lastActiveAt: string | null;
}
export interface ExecStat {
  key: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  inFlight: number;
  successRate: number;
  avgDurationMs: number | null;
  ungroundedRate: number;
}
export interface WorkforceBottleneck {
  scope: 'worker' | 'skill';
  key: string;
  kind: 'high_failure' | 'backlog' | 'ungrounded';
  reason: string;
  value: number;
  sampleSize: number;
}
export interface WorkforceIntelligence {
  totalJobs: number;
  activeWorkers: number;
  overallSuccessRate: number;
  inFlight: number;
  workers: WorkerPerf[];
  execution: { bySkill: ExecStat[]; byRole: ExecStat[]; totals: ExecStat };
  bottlenecks: WorkforceBottleneck[];
  busiestWorkerId: string | null;
}
