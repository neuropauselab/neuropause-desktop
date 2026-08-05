/**
 * Phase 6 Stage 9 — business processes: the registry's declared process names
 * joined to the MINED reality (the existing process-mining assessment). A
 * registry process that mining has not discovered is an honest gap; a mined
 * type the registry has not named is surfaced as unregistered — neither is
 * silently dropped. No mining is re-run here; the assessment is composed. Pure.
 */
import type {
  BusinessProcessReport,
  BusinessProcessRow,
  MinedProcessMetrics,
  OperationsGap,
  OperationsUnavailable,
} from '@neuropause/shared';
import { PROCESS_REGISTRY } from './operationsRegistry';

export type { MinedProcessMetrics } from '@neuropause/shared';

export interface ProcessesInput {
  nowIso: string;
  mined: MinedProcessMetrics[] | null;
  failures: Record<string, string>;
}

export function buildProcessReport(input: ProcessesInput): BusinessProcessReport {
  const gaps: OperationsGap[] = [];
  const unavailable: OperationsUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));
  const minedByType = new Map((input.mined ?? []).map((m) => [m.type, m]));
  const registryTypes = new Set(PROCESS_REGISTRY.map((p) => p.minedType).filter((t): t is string => t !== null));

  const rows: BusinessProcessRow[] = PROCESS_REGISTRY.map((p) => {
    const metrics = p.minedType ? (minedByType.get(p.minedType) ?? null) : null;
    if (p.minedType === null) {
      gaps.push({ kind: 'process', subject: p.id, detail: 'registry names this process but mining has no such type — declared, not fabricated' });
    } else if (!metrics && input.mined !== null) {
      gaps.push({ kind: 'process', subject: p.id, detail: `mining discovered no "${p.minedType}" cases yet` });
    }
    return {
      processId: p.id,
      name: p.name,
      domain: p.domain,
      minedType: p.minedType,
      metrics,
      status: metrics ? ('mined' as const) : ('not-mined' as const),
    };
  });

  // Mined types the registry does not name — surfaced, never dropped.
  for (const m of input.mined ?? []) {
    if (registryTypes.has(m.type)) continue;
    rows.push({
      processId: `unregistered:${m.type}`,
      name: `(unregistered mined process: ${m.type})`,
      domain: 'departments',
      minedType: m.type,
      metrics: m,
      status: 'unregistered',
    });
    gaps.push({ kind: 'process', subject: m.type, detail: 'mining discovered this process type but the registry does not name it' });
  }

  return {
    generatedAt: input.nowIso,
    rows,
    gaps,
    totals: {
      registered: PROCESS_REGISTRY.length,
      mined: rows.filter((r) => r.status === 'mined' || r.status === 'unregistered').length,
      unregistered: rows.filter((r) => r.status === 'unregistered').length,
    },
    unavailable,
  };
}
