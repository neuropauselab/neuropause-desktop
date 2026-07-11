/**
 * P2.5 — Enterprise Work Intelligence executive KPIs (pure derivers).
 *
 * Two new executive-strip metrics, each a pure function of an EXISTING subsystem's
 * output — no new intelligence, no fabricated numbers:
 *   - Automation Success: the confirmed automation success rate, from the live
 *     automation monitor rollup (completed vs failed runs).
 *   - Knowledge Graph: the size + connectivity of the ONE unified knowledge graph
 *     (now spanning collaboration AND ERP business entities, per the P2.5 unify),
 *     from the graph store's counts.
 *
 * Pure: the inputs are passed in, so these unit-test without the runtime. They are
 * wired to the real monitor + graph counts in the Executive Center subsystem.
 */
import type { ExecutiveKpi } from '@neuropause/shared';

/** The automation monitor rollup this deriver reads (matches getAutomationMonitor()). */
export interface AutomationMonitorLike {
  completed: number;
  failed: number;
  paused: number;
  running: number;
}

/** The unified-graph counts this deriver reads (matches graphStore.counts()). */
export interface GraphCountsLike {
  nodes: number;
  edges: number;
}

/** Confirmed automation success rate → one executive KPI. Pure. */
export function automationSuccessKpi(m: AutomationMonitorLike): ExecutiveKpi {
  const total = m.completed + m.failed;
  const rate = total === 0 ? null : Math.round((m.completed / total) * 100);
  const band: ExecutiveKpi['band'] =
    rate === null ? 'healthy' : rate >= 90 ? 'healthy' : rate >= 75 ? 'watch' : rate >= 50 ? 'at-risk' : 'critical';
  return {
    key: 'automation-success',
    label: 'Automation Success',
    value: rate,
    display: total === 0 ? 'no runs yet' : `${rate}% (${m.completed}/${total})`,
    band,
    deepLink: 'enterprise/organization',
  };
}

/** Unified knowledge-graph size + connectivity → one executive KPI. Pure. */
export function knowledgeGraphKpi(counts: GraphCountsLike): ExecutiveKpi {
  const { nodes, edges } = counts;
  // Average connections per entity — a simple connectivity signal (10× rounded to 1 dp).
  const density = nodes === 0 ? 0 : Math.round((edges / nodes) * 10) / 10;
  const band: ExecutiveKpi['band'] = nodes === 0 ? 'watch' : density >= 1 ? 'healthy' : 'watch';
  return {
    key: 'knowledge-graph',
    label: 'Knowledge Graph',
    value: null,
    display: `${nodes} entities · ${edges} links`,
    band,
    deepLink: 'enterprise/organization',
  };
}
