/**
 * Phase 6 Stage 6 (D-1) — the signal projection.
 *
 * Maps the operational signals the platform already records (workforce jobs,
 * executions, automation runs, connector health, conversations, inbox items,
 * projects/tasks from the UDM) into the EXISTING P7 engine shapes —
 * `EnterpriseNode` / `EnterpriseEdge` / `CorrelationEvent` — so the unified
 * graph, correlation engine, and root-cause engine reason over them without a
 * second engine existing anywhere.
 *
 * Honesty rules:
 *   - evidence ids are preserved verbatim (job/run/session/entity ids),
 *   - each source is isolated: a failing read yields an explicit unavailable
 *     entry and contributes nothing — never a fabricated hole,
 *   - aggregates become nodes (connector / rule / worker / workflow / project /
 *     approval queue); individual records become correlation EVENTS pointing at
 *     those nodes, so the graph stays small and the evidence stays per-record.
 *
 * Pure + deterministic + IO-free.
 */
import type {
  AutomationRule,
  AutomationRunRecord,
  ConnectorDto,
  CorrelationEvent,
  EnterpriseEdge,
  EnterpriseNode,
  EventSeverity,
  ExecutionSession,
  InsightUnavailable,
  Job,
  SignalRuntimeStatus,
  UnifiedEntity,
} from '@neuropause/shared';
import { signalStatus } from './signalRegistry';

/* ── Raw reads (each null = that source was unavailable) ──────────────────── */

export interface ProjectionInput {
  nowMs: number;
  entities: UnifiedEntity[] | null;
  jobs: Job[] | null;
  executions: ExecutionSession[] | null;
  automationRuns: AutomationRunRecord[] | null;
  automationRules: Pick<AutomationRule, 'id' | 'name' | 'status' | 'trigger' | 'actions'>[] | null;
  connectors: ConnectorDto[] | null;
  conversations: { id: string; title: string; updatedAt: string; waitingSteps: number }[] | null;
  inbox: { id: string; sourceKey: string; at: string; read: boolean }[] | null;
  workers: { id: string; name: string; role: string }[] | null;
  /** Reasons per failed source (system → reason), for the unavailable list. */
  failures: Record<string, string>;
}

export interface ProjectionOutput {
  extraNodes: EnterpriseNode[];
  extraEdges: EnterpriseEdge[];
  events: CorrelationEvent[];
  signals: SignalRuntimeStatus[];
  unavailable: InsightUnavailable[];
}

/* ── Node builders (ids namespaced `ops:` so resolveNodeId finds them) ────── */

const nodeIds = {
  connector: (id: string): string => `ops:connector:${id}`,
  rule: (id: string): string => `ops:automation:${id}`,
  worker: (id: string): string => `ops:worker:${id}`,
  workflow: (id: string): string => `ops:workflow:${id}`,
  project: (id: string): string => `ops:project:${id}`,
  approvals: (workerId: string): string => `ops:approvals:${workerId}`,
  executions: 'ops:execute-engine',
  assistant: 'ops:assistant',
};
export { nodeIds as opsNodeIds };

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function healthStateFor(score: number | null): EnterpriseNode['healthState'] {
  if (score == null) return 'unknown';
  if (score >= 70) return 'healthy';
  if (score >= 35) return 'degraded';
  return 'critical';
}

function mkNode(
  id: string,
  domain: EnterpriseNode['domain'],
  kind: string,
  label: string,
  health: number | null,
  source: EnterpriseNode['source'],
  weight: number,
  meta: Record<string, string | number | boolean | null>,
  status: string | null = null,
): EnterpriseNode {
  return {
    id,
    domain,
    kind,
    label,
    health,
    risk: health == null ? null : clamp100(100 - health),
    healthState: healthStateFor(health),
    status,
    weight: Math.max(1, Math.round(weight)),
    source,
    meta,
  };
}

function mkEdge(
  from: string,
  to: string,
  relation: string,
  category: EnterpriseEdge['category'],
  weight = 1,
): EnterpriseEdge {
  return { id: `${from}|${relation}|${to}`, from, to, relation, category, risk: null, weight };
}

function mkEvent(
  id: string,
  type: string,
  tsMs: number,
  severity: EventSeverity,
  resourceId: string | null,
  correlationId: string | null,
  source: string,
  label: string,
): CorrelationEvent {
  return { id, type, ts: tsMs, severity, resourceId, correlationId, source, label };
}

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const latestIso = (isos: (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  for (const x of isos) if (x && (!best || x > best)) best = x;
  return best;
};

/* ── The projection ───────────────────────────────────────────────────────── */

const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PROJECTED_EVENTS = 2000;

/** Project the operational signals into P7 engine inputs. Pure. */
export function projectSignals(input: ProjectionInput): ProjectionOutput {
  const nodes = new Map<string, EnterpriseNode>();
  const edges = new Map<string, EnterpriseEdge>();
  const events: CorrelationEvent[] = [];
  const unavailable: InsightUnavailable[] = [];
  const signals: SignalRuntimeStatus[] = [];
  const { nowMs } = input;
  const windowStart = nowMs - EVENT_WINDOW_MS;

  const addNode = (n: EnterpriseNode): void => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (e: EnterpriseEdge): void => {
    if (!edges.has(e.id) && e.from !== e.to) edges.set(e.id, e);
  };
  const mark = (
    id: string,
    read: { available: boolean; itemCount: number | null; latestAt: string | null; note: string | null },
  ): void => {
    signals.push(signalStatus(id, read, nowMs));
    if (!read.available && read.note) unavailable.push({ system: id, reason: read.note });
  };

  /* ── #7 connectors → nodes (per configured connector with accounts) ────── */
  if (input.connectors) {
    const active = input.connectors.filter((c) => c.configured && c.accounts.length > 0);
    for (const c of active) {
      const health =
        c.health === 'healthy' ? 90 : c.health === 'degraded' ? 50 : c.health === 'down' ? 15 : null;
      addNode(
        mkNode(
          nodeIds.connector(c.id),
          'operations',
          'connector',
          `${c.name} connector`,
          health,
          'external',
          1 + c.accounts.length,
          { connectorId: c.id, accounts: c.accounts.length, status: c.status },
          c.status,
        ),
      );
      for (const a of c.accounts) {
        if (a.health === 'down' || a.error) {
          const ts = parseMs(a.lastSyncAt) ?? nowMs;
          events.push(
            mkEvent(
              `connector:${c.id}:${a.id}`,
              a.error ? 'connector.error' : 'connector.offline',
              ts,
              a.health === 'down' ? 'critical' : 'warning',
              nodeIds.connector(c.id),
              null,
              'insight-projection',
              `${c.name} account ${a.label}: ${a.error ?? `health ${a.health}`}`,
            ),
          );
        }
      }
    }
    mark('connector-health', {
      available: true,
      itemCount: active.length,
      latestAt: latestIso(active.map((c) => c.lastSyncAt)),
      note: null,
    });
  } else {
    mark('connector-health', { available: false, itemCount: null, latestAt: null, note: input.failures['connector-health'] ?? 'read failed' });
  }

  /* ── #1 work entities → project nodes + task-backlog edges ─────────────── */
  if (input.entities) {
    const projects = input.entities.filter((e) => e.kind === 'project' && e.syncState === 'active');
    const tasks = input.entities.filter((e) => e.kind === 'task' && e.syncState === 'active');
    const tasksByContainer = new Map<string, UnifiedEntity[]>();
    for (const t of tasks) {
      const key = t.containerId ?? t.parentId ?? '∅';
      (tasksByContainer.get(key) ?? tasksByContainer.set(key, []).get(key)!).push(t);
    }
    for (const p of projects.slice(0, 500)) {
      const own = tasksByContainer.get(p.id) ?? [];
      const open = own.filter((t) => (t.status ?? '').toLowerCase() !== 'completed' && (t.status ?? '').toLowerCase() !== 'done');
      const overdue = open.filter((t) => {
        const due = parseMs(t.endTimestamp ?? t.timestamp);
        return due != null && due < nowMs;
      });
      // Project health from its own backlog: overdue share degrades it.
      const health = own.length === 0 ? null : clamp100(95 - (open.length ? (overdue.length / open.length) * 70 : 0));
      addNode(
        mkNode(
          nodeIds.project(p.id),
          'business',
          'project',
          p.title,
          health,
          'collaboration',
          1 + own.length,
          { entityId: p.id, connectorId: p.connectorId, tasks: own.length, openTasks: open.length, overdueTasks: overdue.length },
        ),
      );
      // The project USES the connector it syncs from (cross-domain fabric).
      if (input.connectors?.some((c) => c.id === p.connectorId)) {
        addEdge(mkEdge(nodeIds.project(p.id), nodeIds.connector(p.connectorId), 'synced_via', 'uses'));
      }
      for (const t of overdue.slice(0, 5)) {
        events.push(
          mkEvent(`entity:${t.id}`, 'task.overdue', parseMs(t.endTimestamp ?? t.timestamp) ?? nowMs, 'warning', nodeIds.project(p.id), null, 'insight-projection', `Overdue: ${t.title}`),
        );
      }
    }
    mark('work-entities', {
      available: true,
      itemCount: input.entities.length,
      latestAt: latestIso(input.entities.slice(0, 2000).map((e) => e.updatedAt)),
      note: null,
    });
  } else {
    mark('work-entities', { available: false, itemCount: null, latestAt: null, note: input.failures['work-entities'] ?? 'read failed' });
  }

  /* ── workers (registry) → worker nodes ─────────────────────────────────── */
  if (input.workers) {
    for (const w of input.workers) {
      addNode(mkNode(nodeIds.worker(w.id), 'automation', 'ai-worker', `${w.name} (${w.role})`, null, 'business', 2, { workerId: w.id, role: w.role }));
    }
  }

  /* ── #3 jobs + approvals → queue nodes + job events ────────────────────── */
  if (input.jobs) {
    const awaiting = input.jobs.filter((j) => j.status === 'awaiting_approval');
    const byWorker = new Map<string, Job[]>();
    for (const j of awaiting) (byWorker.get(j.workerId) ?? byWorker.set(j.workerId, []).get(j.workerId)!).push(j);
    for (const [workerId, queue] of byWorker) {
      const oldestMs = Math.min(...queue.map((j) => parseMs(j.createdAt) ?? nowMs));
      const ageDays = Math.max(0, (nowMs - oldestMs) / 86_400_000);
      const health = clamp100(90 - queue.length * 8 - ageDays * 10);
      const qid = nodeIds.approvals(workerId);
      addNode(
        mkNode(qid, 'automation', 'approval-queue', `Approval queue · ${workerId}`, health, 'business', 1 + queue.length, {
          workerId,
          pending: queue.length,
          oldestJobId: queue.reduce((a, b) => ((parseMs(a.createdAt) ?? 0) <= (parseMs(b.createdAt) ?? 0) ? a : b)).id,
        }),
      );
      addEdge(mkEdge(qid, nodeIds.worker(workerId), 'gates', 'depends_on'));
      if (input.workers && !input.workers.some((w) => w.id === workerId)) {
        addNode(mkNode(nodeIds.worker(workerId), 'automation', 'ai-worker', workerId, null, 'business', 2, { workerId }));
      }
    }
    for (const j of input.jobs) {
      const ts = parseMs(j.finishedAt ?? j.startedAt ?? j.createdAt);
      if (ts == null || ts < windowStart) continue;
      if (j.status === 'failed') {
        events.push(mkEvent(`job:${j.id}`, 'worker.job_failed', ts, 'critical', nodeIds.worker(j.workerId), j.correlationId ?? j.id, 'insight-projection', `Job failed: ${j.skillId} — ${j.error ?? 'unknown error'}`));
      } else if (j.status === 'awaiting_approval') {
        events.push(mkEvent(`job:${j.id}`, 'worker.job_awaiting_approval', ts, 'warning', nodeIds.approvals(j.workerId), j.correlationId ?? j.id, 'insight-projection', `Awaiting approval: ${j.skillId}`));
      }
      // Job evidence attaches to worker/queue nodes via resourceId — no per-job node.
    }
    mark('workforce-jobs', {
      available: true,
      itemCount: input.jobs.length,
      latestAt: latestIso(input.jobs.map((j) => j.finishedAt ?? j.startedAt ?? j.createdAt)),
      note: null,
    });
  } else {
    mark('workforce-jobs', { available: false, itemCount: null, latestAt: null, note: input.failures['workforce-jobs'] ?? 'read failed' });
  }

  /* ── #4 executions → engine node + failure events ──────────────────────── */
  if (input.executions) {
    const recent = input.executions.filter((s) => (parseMs(s.startedAt) ?? 0) >= windowStart);
    const failed = recent.filter((s) => s.state === 'failed');
    const health = recent.length === 0 ? null : clamp100(95 - (failed.length / recent.length) * 80);
    // The engine node exists only when there is execution history to stand on.
    if (input.executions.length > 0) {
      addNode(mkNode(nodeIds.executions, 'automation', 'execution-engine', 'Execute Engine', health, 'business', 3, { recent: recent.length, failed: failed.length }));
    }
    for (const s of failed.slice(0, 100)) {
      events.push(mkEvent(`exec:${s.id}`, 'execution.failed', parseMs(s.completedAt ?? s.startedAt) ?? nowMs, 'warning', nodeIds.executions, s.correlationId ?? null, 'insight-projection', `Execution failed: ${s.label} — ${s.error ?? 'unknown error'}`));
    }
    mark('executions', { available: true, itemCount: input.executions.length, latestAt: latestIso(input.executions.map((s) => s.startedAt)), note: null });
  } else {
    mark('executions', { available: false, itemCount: null, latestAt: null, note: input.failures['executions'] ?? 'read failed' });
  }

  /* ── #6 automation runs + rules → rule nodes + run events + edges ──────── */
  if (input.automationRuns && input.automationRules) {
    const runsByRule = new Map<string, AutomationRunRecord[]>();
    for (const r of input.automationRuns) (runsByRule.get(r.ruleId) ?? runsByRule.set(r.ruleId, []).get(r.ruleId)!).push(r);
    for (const rule of input.automationRules) {
      const runs = runsByRule.get(rule.id) ?? [];
      const failed = runs.filter((r) => !r.ok);
      const health = runs.length === 0 ? null : clamp100(95 - (failed.length / runs.length) * 85);
      const rid = nodeIds.rule(rule.id);
      addNode(mkNode(rid, 'automation', 'automation-rule', rule.name, health, 'business', 1 + runs.length, { ruleId: rule.id, runs: runs.length, failed: failed.length, status: rule.status }, rule.status));
      // The rule USES the connectors its trigger + actions bind (the chain fabric:
      // connector failure → automation failure becomes a computed graph path).
      const boundConnectors = new Set<string>();
      if (rule.trigger.connectorId) boundConnectors.add(rule.trigger.connectorId);
      for (const a of rule.actions) if (a.connectorId) boundConnectors.add(a.connectorId);
      for (const cid of boundConnectors) {
        if (nodes.has(nodeIds.connector(cid))) addEdge(mkEdge(rid, nodeIds.connector(cid), 'automates_via', 'uses'));
      }
    }
    for (const run of input.automationRuns) {
      const ts = parseMs(run.completedAt) ?? nowMs;
      if (ts < windowStart || run.ok) continue;
      events.push(mkEvent(`autorun:${run.id}`, 'automation.failed', ts, 'warning', nodeIds.rule(run.ruleId), null, 'insight-projection', `Automation failed: ${run.ruleName} — ${run.error ?? 'unknown error'}`));
    }
    mark('automation-runs', { available: true, itemCount: input.automationRuns.length, latestAt: latestIso(input.automationRuns.map((r) => r.completedAt)), note: null });
  } else {
    mark('automation-runs', { available: false, itemCount: null, latestAt: null, note: input.failures['automation-runs'] ?? 'read failed' });
  }

  /* ── #8 conversations → assistant node (waiting steps = follow-up load) ── */
  if (input.conversations) {
    const waiting = input.conversations.reduce((s, c) => s + (c.waitingSteps > 0 ? 1 : 0), 0);
    const health = input.conversations.length === 0 ? null : clamp100(95 - waiting * 10);
    if (input.conversations.length > 0) {
      addNode(mkNode(nodeIds.assistant, 'knowledge', 'assistant', 'Workspace Assistant', health, 'collaboration', 2, { conversations: input.conversations.length, waitingConversations: waiting }));
    }
    mark('assistant-conversations', { available: true, itemCount: input.conversations.length, latestAt: latestIso(input.conversations.map((c) => c.updatedAt)), note: null });
  } else {
    mark('assistant-conversations', { available: false, itemCount: null, latestAt: null, note: input.failures['assistant-conversations'] ?? 'read failed' });
  }

  /* ── #12 inbox → freshness signal only (no node; it is a delivery surface) ── */
  if (input.inbox) {
    mark('notification-inbox', { available: true, itemCount: input.inbox.length, latestAt: latestIso(input.inbox.map((n) => n.at)), note: null });
  } else {
    mark('notification-inbox', { available: false, itemCount: null, latestAt: null, note: input.failures['notification-inbox'] ?? 'read failed' });
  }

  const capped = events
    .filter((e) => Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_PROJECTED_EVENTS);

  return {
    extraNodes: [...nodes.values()],
    extraEdges: [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to)),
    events: capped,
    signals,
    unavailable,
  };
}
