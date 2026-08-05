/**
 * Phase 6 Stage 2 — Mission Control live feed (the pure assembly layer).
 *
 * This module is the "IPC seam" the Mission Control provider always deferred to
 * the host: it turns the runtime projections the platform ALREADY exposes over
 * IPC (timeline, execute engine, automations, app runtime, connectors, unified
 * knowledge, workspace contexts, NeuroCore system health, enterprise org +
 * executive dashboard, workforce) into `MissionControlSnapshot` slices and
 * dashboard extras.
 *
 * Design rules (Stage 2 constraint — per-tile failure isolation):
 *   1. PURE + React-free. Everything here runs under the node test gate. All
 *      I/O goes through an injected `FeedIo`, so tests drive the mappers and the
 *      source runner with fakes.
 *   2. One SOURCE per tile, run independently. A source that fails, hangs
 *      (timeout) or returns garbage affects ONLY its own tile: `runFeedSource`
 *      resolves to an explicit `unavailable(reason)` — it never throws and never
 *      blocks another source.
 *   3. Defensive mapping. Every payload is treated as `unknown` and validated
 *      field-by-field (the house store idiom); malformed rows are dropped, never
 *      guessed. No mapper fabricates data: absent data maps to absent data, and
 *      the tile state carries the honest reason.
 */
import type { Organization, WorkerSummary, WorkspaceSummary } from '@neuropause/shared';
import type {
  ActivityRecord,
  AutomationMetricsLite,
  ConnectorHealthLite,
  GovernanceMetricsLite,
  MissionControlSnapshot,
} from './missionControlModel';

/* ── tiles ───────────────────────────────────────────────────────────────── */

/** One key per independently-loading dashboard source. */
export type FeedTileKey =
  | 'activity'
  | 'running'
  | 'connectors'
  | 'recentFiles'
  | 'health'
  | 'organization'
  | 'executive';

export const FEED_TILE_KEYS: FeedTileKey[] = [
  'activity',
  'running',
  'connectors',
  'recentFiles',
  'health',
  'organization',
  'executive',
];

export type FeedTileState =
  | { state: 'loading' }
  | { state: 'ready'; at: number; note?: string }
  | { state: 'unavailable'; reason: string };

export type FeedAvailability = Record<FeedTileKey, FeedTileState>;

export function emptyAvailability(): FeedAvailability {
  const out = {} as FeedAvailability;
  for (const key of FEED_TILE_KEYS) out[key] = { state: 'loading' };
  return out;
}

/** Per-source timeout — a hung IPC call must not hold its tile in limbo forever. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 12_000;

/* ── dashboard extras (data that lives beside the model snapshot) ────────── */

export interface RunningWorkItem {
  id: string;
  label: string;
  kind: 'execution' | 'automation' | 'app';
  state: string;
  /** Epoch ms, or null when the source did not carry a parseable start time. */
  startedAt: number | null;
}

export interface RecentFileItem {
  key: string;
  title: string;
  kind: 'tab' | 'file' | 'document' | 'attachment';
  /** Where it came from — a workspace name or a connector id. */
  origin: string;
  /** Epoch ms recency, or null when unknown (sorted last). */
  at: number | null;
  url: string | null;
}

export interface HealthSubsystemView {
  id: string;
  label: string;
  level: 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';
  detail: string | null;
}

/** Sanitized projection of the NeuroCore SystemHealthSnapshot. */
export interface HealthView {
  score: number;
  level: 'healthy' | 'degraded' | 'critical' | 'offline' | 'unknown';
  subsystems: HealthSubsystemView[];
  eventsPerMinute: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
}

export interface MissionControlExtras {
  running: RunningWorkItem[];
  executionStats: { active: number; queued: number; completed: number; failed: number } | null;
  monitor: { running: number; completed: number; failed: number; paused: number } | null;
  recentFiles: RecentFileItem[];
  health: HealthView | null;
  timelineStats: { total: number; byCategory: Record<string, number> } | null;
}

export const EMPTY_EXTRAS: MissionControlExtras = {
  running: [],
  executionStats: null,
  monitor: null,
  recentFiles: [],
  health: null,
  timelineStats: null,
};

/** What one source contributes when it succeeds. */
export interface FeedPatch {
  snapshot?: Partial<MissionControlSnapshot>;
  extras?: Partial<MissionControlExtras>;
}

export interface FeedSourceResult {
  key: FeedTileKey;
  ok: boolean;
  patch: FeedPatch | null;
  reason: string | null;
  /** Partial-success detail (e.g. one of a source's sub-calls failed). */
  note: string | null;
}

/* ── injected I/O (the host binds these to `ipc.*`; tests inject fakes) ──── */

export interface FeedIo {
  timelineQuery(limit: number): Promise<unknown>;
  timelineStats(): Promise<unknown>;
  executeSessions(): Promise<unknown>;
  automationMonitor(): Promise<unknown>;
  automationList(): Promise<unknown>;
  runtimeList(): Promise<unknown>;
  connectorsList(): Promise<unknown>;
  workspaceContextsList(): Promise<unknown>;
  unifiedRecentFiles(limit: number): Promise<unknown>;
  systemHealth(): Promise<unknown>;
  enterpriseOrg(): Promise<unknown>;
  enterpriseWorkspaces(): Promise<unknown>;
  enterpriseDashboard(): Promise<unknown>;
  workforceWorkers(): Promise<unknown>;
}

/* ── defensive parsing helpers ───────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
/** ISO string or epoch number → epoch ms, else null. */
function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Human failure reason from any thrown value — bounded, never empty. */
export function failureReason(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : isRecord(err) && typeof err.message === 'string'
          ? err.message
          : String(err);
  const trimmed = raw.trim();
  const msg = trimmed.length > 0 ? trimmed : 'unknown error';
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}

/** Reject with a labelled timeout error after `ms` — a hung call cannot block its tile. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

type Settled = { ok: true; value: unknown } | { ok: false; reason: string };

async function settle(promise: Promise<unknown>, ms: number, label: string): Promise<Settled> {
  try {
    return { ok: true, value: await withTimeout(promise, ms, label) };
  } catch (err) {
    return { ok: false, reason: `${label}: ${failureReason(err)}` };
  }
}

/* ── mappers (each takes `unknown`, returns validated data or nothing) ───── */

const FAILURE_TYPE_HINTS = ['_failed', '.failed', 'crash', 'error'];

/** Whether a platform-event type/priority denotes a failure. Pure heuristic over real event names. */
export function isFailureEvent(type: string, priority: string): boolean {
  const t = type.toLowerCase();
  return priority === 'critical' || FAILURE_TYPE_HINTS.some((h) => t.includes(h));
}

/** TimelinePage → ActivityRecord[]. Malformed rows are dropped, never guessed. */
export function mapActivity(raw: unknown): ActivityRecord[] {
  if (!isRecord(raw)) return [];
  const out: ActivityRecord[] = [];
  for (const row of asArray(raw.events)) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const type = str(row.type);
    if (!id || !type) continue;
    const actor = isRecord(row.actor) ? str(row.actor.id, '') || str(row.actor.kind, 'system') : 'system';
    out.push({
      id,
      domain: str(row.category, 'platform'),
      action: type,
      actor,
      at: parseTime(row.timestamp) ?? 0,
      ok: !isFailureEvent(type, str(row.priority)),
    });
  }
  return out;
}

/** TimelineStats → compact stats, or null when the payload is not usable. */
export function mapTimelineStats(raw: unknown): { total: number; byCategory: Record<string, number> } | null {
  if (!isRecord(raw) || typeof raw.total !== 'number') return null;
  const byCategory: Record<string, number> = {};
  if (isRecord(raw.byCategory)) {
    for (const [k, v] of Object.entries(raw.byCategory)) {
      if (typeof v === 'number' && Number.isFinite(v)) byCategory[k] = v;
    }
  }
  return { total: num(raw.total), byCategory };
}

/**
 * ConnectorDto[] → ConnectorHealthLite[]. Only `production`-lifecycle connectors
 * are listed (preview connectors have no adapter and are not part of live
 * status). Mapping keeps the honest middle: anything neither clearly up nor
 * clearly down renders as degraded rather than silently green.
 */
export function mapConnectors(raw: unknown): ConnectorHealthLite[] {
  const out: ConnectorHealthLite[] = [];
  for (const row of asArray(raw)) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const name = str(row.name, id);
    if (!id) continue;
    if (str(row.lifecycle) === 'preview') continue;
    const configured = bool(row.configured);
    const accounts = asArray(row.accounts);
    const status = str(row.status);
    const health = str(row.health);
    let lite: ConnectorHealthLite['status'];
    if (!configured || accounts.length === 0 || status === 'unavailable' || status === 'disconnected') {
      lite = 'disabled';
    } else if (health === 'down' || status === 'error') {
      lite = 'down';
    } else if (status === 'connected' && health === 'healthy') {
      lite = 'ok';
    } else {
      lite = 'degraded';
    }
    out.push({ id, name, status: lite });
  }
  return out;
}

/** Sub-payloads for the running-work source (each may be absent when its call failed). */
export interface RunningParts {
  sessions?: unknown;
  monitor?: unknown;
  automationList?: unknown;
  runtime?: unknown;
}

/** Execute sessions + automation monitor/list + app runtime → running work + automation slice. */
export function mapRunning(parts: RunningParts): FeedPatch {
  const items: RunningWorkItem[] = [];
  let executionStats: MissionControlExtras['executionStats'] = null;
  let monitor: MissionControlExtras['monitor'] = null;
  let automation: AutomationMetricsLite | undefined;

  if (isRecord(parts.sessions)) {
    for (const row of asArray(parts.sessions.sessions)) {
      if (!isRecord(row)) continue;
      const id = str(row.id);
      if (!id) continue;
      if (row.completedAt !== null && row.completedAt !== undefined) continue; // terminal
      items.push({
        id: `exec:${id}`,
        label: str(row.label, id),
        kind: 'execution',
        state: str(row.state, 'running'),
        startedAt: parseTime(row.startedAt),
      });
    }
    const stats = parts.sessions.stats;
    if (isRecord(stats)) {
      executionStats = {
        active: num(stats.active),
        queued: num(stats.queued),
        completed: num(stats.completed),
        failed: num(stats.failed),
      };
    }
  }

  if (isRecord(parts.runtime) || Array.isArray(parts.runtime)) {
    for (const row of asArray(parts.runtime)) {
      if (!isRecord(row)) continue;
      const id = str(row.instanceId);
      const status = str(row.status);
      if (!id) continue;
      if (status !== 'running' && status !== 'starting') continue;
      items.push({
        id: `app:${id}`,
        label: str(row.appName, str(row.appSlug, id)),
        kind: 'app',
        state: status,
        startedAt: parseTime(row.startedAt),
      });
    }
  }

  const monitorRaw = isRecord(parts.monitor) ? parts.monitor.monitor : undefined;
  if (isRecord(monitorRaw)) {
    monitor = {
      running: num(monitorRaw.running),
      completed: num(monitorRaw.completed),
      failed: num(monitorRaw.failed),
      paused: num(monitorRaw.paused),
    };
  }
  const listSummary = isRecord(parts.automationList) ? parts.automationList.summary : undefined;
  if (monitor || isRecord(listSummary)) {
    automation = {
      workflows: isRecord(listSummary) ? num(listSummary.total) : 0,
      triggers: isRecord(listSummary) ? num(listSummary.active) : 0,
      running: monitor ? monitor.running : 0,
      queued: 0,
      retrying: 0,
      // Lifetime failed-run count from the live monitor (the store keeps no 24h
      // window); the view labels this "failed runs", never "24h".
      failures24h: monitor ? monitor.failed : 0,
    };
  }

  items.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const patch: FeedPatch = {
    extras: { running: items, executionStats, monitor },
  };
  if (automation) patch.snapshot = { automation };
  return patch;
}

/**
 * Workspace-context tabs + unified file/document entities → one recents list.
 * Dedupes tab entries by app+title, sorts newest-first (unknown recency last).
 */
export function composeRecentFiles(ctxRaw: unknown, unifiedRaw: unknown, cap = 15): RecentFileItem[] {
  const out: RecentFileItem[] = [];
  const seenTabs = new Set<string>();

  if (isRecord(ctxRaw)) {
    for (const ws of asArray(ctxRaw.workspaces)) {
      if (!isRecord(ws)) continue;
      const wsName = str(ws.name, 'Workspace');
      const snap = isRecord(ws.snapshot) ? ws.snapshot : null;
      for (const tab of asArray(snap?.tabs)) {
        if (!isRecord(tab)) continue;
        const title = str(tab.title) || str(tab.appId);
        if (!title) continue;
        const dedupe = `${str(tab.appId)}::${title}`;
        if (seenTabs.has(dedupe)) continue;
        seenTabs.add(dedupe);
        out.push({
          key: `tab:${str(ws.id, wsName)}:${str(tab.id, dedupe)}`,
          title,
          kind: 'tab',
          origin: wsName,
          at: parseTime(tab.openedAt),
          url: null,
        });
      }
    }
  }

  if (isRecord(unifiedRaw)) {
    for (const item of asArray(unifiedRaw.items)) {
      if (!isRecord(item)) continue;
      const id = str(item.id);
      const title = str(item.title);
      if (!id || !title) continue;
      const kindRaw = str(item.kind);
      const kind: RecentFileItem['kind'] =
        kindRaw === 'document' ? 'document' : kindRaw === 'attachment' ? 'attachment' : 'file';
      out.push({
        key: `udm:${id}`,
        title,
        kind,
        origin: str(item.connectorId, 'connector'),
        at: parseTime(item.updatedAt),
        url: typeof item.url === 'string' ? item.url : null,
      });
    }
  }

  out.sort((a, b) => (b.at ?? -1) - (a.at ?? -1));
  return out.slice(0, cap);
}

const HEALTH_LEVELS = new Set(['healthy', 'degraded', 'critical', 'offline', 'unknown']);

function healthLevel(v: unknown): HealthView['level'] {
  const s = str(v);
  return (HEALTH_LEVELS.has(s) ? s : 'unknown') as HealthView['level'];
}

/** SystemHealthSnapshot → sanitized HealthView + the snapshot's coarse runtimeHealth. */
export function mapHealth(raw: unknown): { health: HealthView; runtimeHealth: MissionControlSnapshot['runtimeHealth'] } | null {
  if (!isRecord(raw) || typeof raw.score !== 'number' || typeof raw.level !== 'string') return null;
  const subsystems: HealthSubsystemView[] = [];
  for (const row of asArray(raw.subsystems)) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    if (!id) continue;
    subsystems.push({
      id,
      label: str(row.label, id),
      level: healthLevel(row.level),
      detail: typeof row.detail === 'string' ? row.detail : null,
    });
  }
  const throughput = isRecord(raw.throughput) ? raw.throughput : {};
  const telemetry = isRecord(raw.telemetry) ? raw.telemetry : {};
  const level = healthLevel(raw.level);
  const runtimeHealth: MissionControlSnapshot['runtimeHealth'] =
    level === 'healthy' ? 'healthy' : level === 'critical' || level === 'offline' ? 'down' : 'degraded';
  return {
    health: {
      score: num(raw.score),
      level,
      subsystems,
      eventsPerMinute: num((throughput as Record<string, unknown>).eventsPerMinute),
      memoryUsedMb: num((telemetry as Record<string, unknown>).memoryUsedMb),
      memoryTotalMb: num((telemetry as Record<string, unknown>).memoryTotalMb),
    },
    runtimeHealth,
  };
}

/** enterprise.org() + enterprise.workspaces() → organization/people/workspace slices. */
export function mapOrganization(orgRaw: unknown, wsRaw: unknown): Partial<MissionControlSnapshot> {
  const patch: Partial<MissionControlSnapshot> = {};

  if (isRecord(orgRaw)) {
    const org = orgRaw.organization;
    if (isRecord(org) && str(org.id) && str(org.name)) {
      const organization: Organization = {
        id: str(org.id),
        name: str(org.name),
        slug: str(org.slug),
        description: str(org.description),
        createdAt: str(org.createdAt),
        updatedAt: str(org.updatedAt),
        metadata: isRecord(org.metadata) ? org.metadata : {},
      };
      patch.organizations = [organization];
    }
    const people: MissionControlSnapshot['people'] = [];
    for (const row of asArray(orgRaw.users)) {
      if (!isRecord(row)) continue;
      const id = str(row.id);
      const name = str(row.name);
      if (!id || !name) continue;
      const title = str(row.title);
      people.push(title ? { id, name, title } : { id, name });
    }
    patch.people = people;
  }

  const workspaces: WorkspaceSummary[] = [];
  for (const row of asArray(wsRaw)) {
    if (!isRecord(row)) continue;
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) continue;
    workspaces.push({
      id,
      name,
      organizationId: str(row.organizationId),
      orgName: str(row.orgName),
      userCount: num(row.userCount),
      unitCount: num(row.unitCount),
      active: bool(row.active),
    });
  }
  if (Array.isArray(wsRaw)) {
    patch.workspaces = workspaces;
    const active = workspaces.find((w) => w.active);
    if (active) patch.activeWorkspaceId = active.id;
  }

  return patch;
}

/** enterprise.dashboard() + workforce.workers() → governance/approvals/workforce slices. */
export function mapExecutive(dashRaw: unknown, workersRaw: unknown): Partial<MissionControlSnapshot> {
  const patch: Partial<MissionControlSnapshot> = {};

  if (isRecord(dashRaw)) {
    const approvals = isRecord(dashRaw.approvals) ? dashRaw.approvals : {};
    const operations = isRecord(dashRaw.operations) ? dashRaw.operations : {};
    const activity = isRecord(dashRaw.activity) ? dashRaw.activity : {};
    const pending = num((approvals as Record<string, unknown>).pending);
    const governance: GovernanceMetricsLite = {
      // The audit chain is not verified by this feed; auditChecked=false tells
      // the view to show the record count and make NO validity claim.
      auditValid: true,
      auditChecked: false,
      auditRecords: num((operations as Record<string, unknown>).auditEntries),
      events: num((activity as Record<string, unknown>).recentEvents),
      pendingApprovals: pending,
    };
    patch.governance = governance;
    patch.pendingApprovals = pending;
  }

  if (Array.isArray(workersRaw)) {
    const workers: WorkerSummary[] = [];
    for (const row of asArray(workersRaw)) {
      if (!isRecord(row)) continue;
      const id = str(row.id);
      const name = str(row.name);
      if (!id || !name) continue;
      workers.push({
        id,
        name,
        role: str(row.role, 'worker'),
        version: str(row.version, '0.0.0'),
        lifecycle: str(row.lifecycle, 'unknown'),
        healthState: str(row.healthState, 'unknown'),
        trustScore: num(row.trustScore),
        skillCount: num(row.skillCount),
        builtIn: bool(row.builtIn),
      } as unknown as WorkerSummary);
    }
    patch.workers = workers;
  }

  return patch;
}

/* ── the per-source runner (failure isolation lives here) ────────────────── */

function result(
  key: FeedTileKey,
  ok: boolean,
  patch: FeedPatch | null,
  reason: string | null,
  note: string | null,
): FeedSourceResult {
  return { key, ok, patch, reason, note };
}

/** Combine sub-call failures into a partial-success note, or a total-failure reason. */
function partialNote(failures: string[]): string | null {
  return failures.length > 0 ? `partial — ${failures.join('; ')}` : null;
}

/**
 * Run ONE source to completion. Never throws; never blocks another source.
 * A source with several sub-calls succeeds when at least one sub-call did —
 * the note records what is missing, so the tile can say so.
 */
export async function runFeedSource(
  io: FeedIo,
  key: FeedTileKey,
  timeoutMs: number = DEFAULT_SOURCE_TIMEOUT_MS,
): Promise<FeedSourceResult> {
  try {
    switch (key) {
      case 'activity': {
        const [page, stats] = await Promise.all([
          settle(io.timelineQuery(40), timeoutMs, 'timeline query'),
          settle(io.timelineStats(), timeoutMs, 'timeline stats'),
        ]);
        // The event query is REQUIRED: without it an empty feed would be a lie.
        if (!page.ok) return result(key, false, null, page.reason, null);
        const patch: FeedPatch = { snapshot: { activity: mapActivity(page.value) } };
        const failures: string[] = [];
        if (stats.ok) patch.extras = { timelineStats: mapTimelineStats(stats.value) };
        else failures.push(stats.reason);
        return result(key, true, patch, null, partialNote(failures));
      }

      case 'running': {
        const [sessions, monitor, list, runtime] = await Promise.all([
          settle(io.executeSessions(), timeoutMs, 'execute sessions'),
          settle(io.automationMonitor(), timeoutMs, 'automation monitor'),
          settle(io.automationList(), timeoutMs, 'automation list'),
          settle(io.runtimeList(), timeoutMs, 'app runtime'),
        ]);
        const settled = [sessions, monitor, list, runtime];
        if (settled.every((s) => !s.ok)) {
          return result(key, false, null, (settled.find((s) => !s.ok) as { reason: string }).reason, null);
        }
        const parts: RunningParts = {};
        const failures: string[] = [];
        if (sessions.ok) parts.sessions = sessions.value;
        else failures.push(sessions.reason);
        if (monitor.ok) parts.monitor = monitor.value;
        else failures.push(monitor.reason);
        if (list.ok) parts.automationList = list.value;
        else failures.push(list.reason);
        if (runtime.ok) parts.runtime = runtime.value;
        else failures.push(runtime.reason);
        return result(key, true, mapRunning(parts), null, partialNote(failures));
      }

      case 'connectors': {
        const listed = await settle(io.connectorsList(), timeoutMs, 'connectors');
        if (!listed.ok) return result(key, false, null, listed.reason, null);
        return result(key, true, { snapshot: { connectors: mapConnectors(listed.value) } }, null, null);
      }

      case 'recentFiles': {
        const [ctx, unified] = await Promise.all([
          settle(io.workspaceContextsList(), timeoutMs, 'workspace contexts'),
          settle(io.unifiedRecentFiles(12), timeoutMs, 'unified documents'),
        ]);
        if (!ctx.ok && !unified.ok) return result(key, false, null, ctx.reason, null);
        const failures: string[] = [];
        if (!ctx.ok) failures.push(ctx.reason);
        if (!unified.ok) failures.push(unified.reason);
        const recentFiles = composeRecentFiles(ctx.ok ? ctx.value : null, unified.ok ? unified.value : null);
        return result(key, true, { extras: { recentFiles } }, null, partialNote(failures));
      }

      case 'health': {
        const snap = await settle(io.systemHealth(), timeoutMs, 'system health');
        if (!snap.ok) return result(key, false, null, snap.reason, null);
        const mapped = mapHealth(snap.value);
        if (!mapped) return result(key, false, null, 'system health payload was not recognisable', null);
        return result(
          key,
          true,
          { snapshot: { runtimeHealth: mapped.runtimeHealth }, extras: { health: mapped.health } },
          null,
          null,
        );
      }

      case 'organization': {
        const [org, ws] = await Promise.all([
          settle(io.enterpriseOrg(), timeoutMs, 'enterprise org'),
          settle(io.enterpriseWorkspaces(), timeoutMs, 'enterprise workspaces'),
        ]);
        if (!org.ok && !ws.ok) return result(key, false, null, org.reason, null);
        const failures: string[] = [];
        if (!org.ok) failures.push(org.reason);
        if (!ws.ok) failures.push(ws.reason);
        const patch = mapOrganization(org.ok ? org.value : null, ws.ok ? ws.value : null);
        return result(key, true, { snapshot: patch }, null, partialNote(failures));
      }

      case 'executive': {
        const [dash, workers] = await Promise.all([
          settle(io.enterpriseDashboard(), timeoutMs, 'executive dashboard'),
          settle(io.workforceWorkers(), timeoutMs, 'workforce'),
        ]);
        if (!dash.ok && !workers.ok) return result(key, false, null, dash.reason, null);
        const failures: string[] = [];
        if (!dash.ok) failures.push(dash.reason);
        if (!workers.ok) failures.push(workers.reason);
        const patch = mapExecutive(dash.ok ? dash.value : null, workers.ok ? workers.value : null);
        return result(key, true, { snapshot: patch }, null, partialNote(failures));
      }

      default:
        return result(key, false, null, 'unknown source', null);
    }
  } catch (err) {
    // Defensive backstop: a mapper bug must degrade the tile, not the dashboard.
    return result(key, false, null, failureReason(err), null);
  }
}
