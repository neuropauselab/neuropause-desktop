/**
 * Renderer-facing shape of the `workforce:intelligence` IPC payload.
 *
 * A7 — this module used to *declare* the shape: a hand-maintained mirror of the
 * main-process aggregation, field-for-field identical but with nothing checking that
 * it stayed so. The contract is now declared once in @neuropause/shared, which both
 * the producer and this consumer import, so drift is a compile error rather than a
 * silent divergence discovered at runtime.
 *
 * The four names below are re-exported under the names the renderer has always used
 * (`WorkerPerf` and `ExecStat` are the renderer's spellings of the producer's
 * `WorkerPerformance` and `ExecutionStat`; `WorkforceBottleneck` happens to match
 * the shared spelling exactly) so that every existing import of this module keeps
 * resolving unchanged. Declaration only: no analytics or state are computed here;
 * every value shown in the UI comes from the existing aggregation over the job
 * store.
 */
import type {
  ExecutionStat,
  WorkerPerformance,
  WorkforceBottleneck,
  WorkforceIntelligence,
} from '@neuropause/shared';

export type WorkerPerf = WorkerPerformance;
export type ExecStat = ExecutionStat;
export type { WorkforceBottleneck, WorkforceIntelligence };
