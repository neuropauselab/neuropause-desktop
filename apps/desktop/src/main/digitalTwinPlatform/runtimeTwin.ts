/**
 * Phase 6 Stage 13 — the runtime & execution twin (G-1).
 *
 * P15's nine domains cover the enterprise; none of them covers the runtime the
 * enterprise actually runs on. This module projects the Execute Engine and the
 * Runtime Supervisor as a twin surface — the gap the composition layer exists
 * to close.
 *
 * It composes and never recomputes: `ExecutionStats` and `SupervisorStatus` are
 * carried through VERBATIM from their owning systems. The only derived values
 * are per-kind counts and row projections, which neither engine exposes. Stage
 * 13 registers no executor, starts no supervisor, and cancels nothing — this
 * module has no way to mutate either system. Pure; reads injected.
 */
import type {
  EtwinExecutionKindRow,
  EtwinRuntimeTwin,
  EtwinSessionRow,
  EtwinSupervisorRow,
  EtwinUnavailable,
  ExecutionSession,
  ExecutionStats,
  RecoveryRecord,
  SupervisedSubsystem,
  SupervisorStatus,
} from '@neuropause/shared';
import { SURFACE_REGISTRY } from './twinRegistry';

export const RUNTIME_TWIN_DISCLOSURE =
  'The runtime twin is a live projection, not a recording. The Execute Engine’s session history and the Runtime Supervisor’s recovery records are in-memory and reset with the process, so this view shows the current process only and no runtime series is trendable. Statistics and supervisor status are composed verbatim from their owning systems; Stage 13 computes no execution metric of its own and can neither start, cancel, nor re-policy anything.';

/** How many sessions each row list carries. Bounded so the view stays a view. */
const ROW_LIMIT = 12;

export interface RuntimeTwinInput {
  nowIso: string;
  /** The Execute Engine slice, or null when the engine could not be read. */
  execution: {
    registeredKinds: string[];
    active: ExecutionSession[];
    history: ExecutionSession[];
    stats: ExecutionStats;
  } | null;
  /** The Runtime Supervisor slice, or null when the supervisor could not be read. */
  supervisor: {
    status: SupervisorStatus;
    history: RecoveryRecord[];
  } | null;
  failures: Record<string, string>;
}

function toRow(s: ExecutionSession): EtwinSessionRow {
  return {
    id: s.id,
    kind: s.kind,
    label: s.label,
    state: s.state,
    startedAt: s.startedAt,
    durationMs: s.durationMs,
  };
}

/**
 * Per-kind counts across the registered kinds AND any kind observed on a
 * session. A session whose kind is no longer registered is still real, so it is
 * counted rather than silently dropped.
 */
function kindRows(
  registered: readonly string[],
  active: readonly ExecutionSession[],
  history: readonly ExecutionSession[],
): EtwinExecutionKindRow[] {
  const kinds = new Set<string>(registered);
  for (const s of active) kinds.add(s.kind);
  for (const s of history) kinds.add(s.kind);
  return [...kinds]
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => ({
      kind,
      active: active.filter((s) => s.kind === kind).length,
      historical: history.filter((s) => s.kind === kind).length,
      failed: history.filter((s) => s.kind === kind && s.state === 'failed').length,
    }));
}

function supervisorRows(
  status: SupervisorStatus,
  history: readonly RecoveryRecord[],
): EtwinSupervisorRow[] {
  const subsystems = Object.keys(status.policies) as SupervisedSubsystem[];
  return subsystems
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((subsystem) => {
      const records = history.filter((r) => r.subsystem === subsystem);
      // The supervisor orders its history append-only, so the last matching
      // record is the most recent one. No timestamp arithmetic is invented.
      const last = records.length > 0 ? records[records.length - 1] : null;
      return {
        subsystem,
        policy: status.policies[subsystem],
        recovering: status.recovering.includes(subsystem),
        recoveries: records.length,
        failures: records.filter((r) => !r.ok).length,
        lastAt: last === null ? null : last.startedAt,
      };
    });
}

export function buildRuntimeTwin(input: RuntimeTwinInput): EtwinRuntimeTwin {
  const unavailable: EtwinUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  const exec = input.execution;
  const sup = input.supervisor;

  // Only the runtime and execution surfaces — the field's own contract. The
  // enterprise/manufacturing twins and the observation surfaces belong to the
  // other views and are deliberately not restated here.
  const surfaces = SURFACE_REGISTRY.filter(
    (s) => s.kind === 'runtime-surface' || s.kind === 'execution-surface',
  ).map((s) => ({ ...s }));

  return {
    generatedAt: input.nowIso,
    execution:
      exec === null
        ? {
            available: false,
            registeredKinds: [],
            activeCount: 0,
            historyCount: 0,
            kinds: [],
            active: [],
            recent: [],
            stats: null,
          }
        : {
            available: true,
            registeredKinds: exec.registeredKinds.slice().sort((a, b) => a.localeCompare(b)),
            activeCount: exec.active.length,
            historyCount: exec.history.length,
            kinds: kindRows(exec.registeredKinds, exec.active, exec.history),
            active: exec.active.slice(0, ROW_LIMIT).map(toRow),
            // The engine appends to history, so the tail is the newest slice.
            recent: exec.history.slice(-ROW_LIMIT).reverse().map(toRow),
            stats: exec.stats,
          },
    supervisor:
      sup === null
        ? { available: false, status: null, rows: [], historyCount: 0 }
        : {
            available: true,
            status: sup.status,
            rows: supervisorRows(sup.status, sup.history),
            historyCount: sup.history.length,
          },
    surfaces,
    disclosure: RUNTIME_TWIN_DISCLOSURE,
    unavailable,
  };
}
