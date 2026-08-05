/**
 * NCEA 11.0 — Mission Control: the pure view-model.
 *
 * Mission Control is the UNIFICATION layer, not a new shell. It composes surfaces
 * that already exist — the navigation `SECTIONS` registry and the canonical
 * `CAPABILITY_REGISTRY` — together with the runtime projection snapshots the
 * providers already load (organizations, workspaces, AI workforce, projects,
 * tasks, documents, connectors, activity, automation + governance metrics) into
 * ONE command center: a command palette, a provider-agnostic universal search,
 * and an executive overview.
 *
 * Following the house `*Model.ts` convention (see workforceCenter/workforceCenterModel.ts):
 * every export here is a PURE projection over already-loaded data. Nothing does
 * I/O; no runtime, registry, workflow, or governance logic is re-implemented —
 * Mission Control reads runtime projections and renders them. Read-only by
 * design; the only "actions" it emits are navigations into the existing sections.
 */
import { SECTIONS, type SectionDef, type SectionId } from '../shell/sections';
import {
  CAPABILITY_REGISTRY,
  REAL_STATES,
  type Capability,
  type CapabilityState,
} from '../capability/capabilityRegistry';
import type { Organization, WorkspaceSummary, WorkerSummary } from '@neuropause/shared';

/* ── command-center domains ──────────────────────────────────────────────── */

/** The ten command-center domains Mission Control unifies (spec Phase 1–10). */
export type CommandDomain =
  | 'organizations'
  | 'ai-workforce'
  | 'projects'
  | 'tasks'
  | 'connectors'
  | 'knowledge'
  | 'automation'
  | 'governance'
  | 'timeline'
  | 'executive';

export interface DomainDef {
  id: CommandDomain;
  label: string;
  icon: string;
  /** The EXISTING navigation section this domain routes into — reuse, no new surface. */
  section: SectionId;
}

/** Each domain maps to an existing section; Mission Control adds no new routes. */
export const COMMAND_DOMAINS: DomainDef[] = [
  { id: 'organizations', label: 'Organizations', icon: 'user', section: 'organization' },
  { id: 'ai-workforce', label: 'AI Workforce', icon: 'sparkles', section: 'workforce' },
  { id: 'projects', label: 'Projects', icon: 'layers', section: 'collaboration' },
  { id: 'tasks', label: 'Tasks', icon: 'checklist', section: 'collaboration' },
  { id: 'connectors', label: 'Connectors', icon: 'puzzle', section: 'connectors' },
  { id: 'knowledge', label: 'Knowledge', icon: 'doc', section: 'knowledge' },
  { id: 'automation', label: 'Automation', icon: 'bolt', section: 'automation-center' },
  { id: 'governance', label: 'Governance', icon: 'shield', section: 'administration' },
  { id: 'timeline', label: 'Timeline', icon: 'pulse', section: 'opscenter' },
  { id: 'executive', label: 'Executive Dashboards', icon: 'grid', section: 'enterprise' },
];

/* ── snapshot: what the providers load (runtime projections marshalled to UI) ─ */

export interface ConnectorHealthLite {
  id: string;
  name: string;
  status: 'ok' | 'degraded' | 'down' | 'disabled';
}

export interface ActivityRecord {
  id: string;
  domain: string;
  action: string;
  actor: string;
  workspace?: string;
  at: number;
  ok: boolean;
  audited?: boolean;
}

export interface AutomationMetricsLite {
  workflows: number;
  triggers: number;
  running: number;
  queued: number;
  retrying: number;
  failures24h: number;
}

export interface GovernanceMetricsLite {
  auditValid: boolean;
  /**
   * Phase 6 Stage 2 — true only when the audit chain has actually been verified
   * for this snapshot. When absent/false the UI must make NO validity claim
   * (it shows the record count instead); `auditValid` is only meaningful with
   * `auditChecked === true`. Optional and additive: pre-Stage-2 snapshots omit it.
   */
  auditChecked?: boolean;
  auditRecords: number;
  events: number;
  pendingApprovals: number;
}

export interface ProjectLite {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  openTasks: number;
  blockedTasks: number;
}

export interface TaskLite {
  id: string;
  title: string;
  workspaceId: string;
  status: string;
  assignee?: string;
}

export interface DocumentLite {
  id: string;
  title: string;
  type: string;
  workspaceId?: string;
}

export interface PersonLite {
  id: string;
  name: string;
  title?: string;
}

/** The complete Mission Control input — every field is a runtime projection. */
export interface MissionControlSnapshot {
  organizations: Organization[];
  workspaces: WorkspaceSummary[];
  activeWorkspaceId?: string;
  people: PersonLite[];
  workers: WorkerSummary[];
  projects: ProjectLite[];
  tasks: TaskLite[];
  documents: DocumentLite[];
  connectors: ConnectorHealthLite[];
  activity: ActivityRecord[];
  automation: AutomationMetricsLite;
  governance: GovernanceMetricsLite;
  runtimeHealth: 'healthy' | 'degraded' | 'down';
  costUsd: number;
  pendingApprovals: number;
}

/* ── command index + palette ranking ─────────────────────────────────────── */

export type CommandKind = 'navigate' | 'action';

export interface Command {
  id: string;
  title: string;
  domain?: CommandDomain;
  sectionId?: SectionId;
  keywords: string[];
  kind: CommandKind;
}

/**
 * Build the command index from the EXISTING nav registry + command domains.
 * Hidden sections (Product Integrity guardrails) are excluded, so a retired or
 * placeholder surface never leaks back into the palette.
 */
export function buildCommandIndex(sections: SectionDef[] = SECTIONS, domains: DomainDef[] = COMMAND_DOMAINS): Command[] {
  const commands: Command[] = [];
  for (const domain of domains) {
    commands.push({
      id: `domain:${domain.id}`,
      title: `Open ${domain.label}`,
      domain: domain.id,
      sectionId: domain.section,
      keywords: [domain.label.toLowerCase(), domain.id, domain.section],
      kind: 'navigate',
    });
  }
  for (const section of sections) {
    if (section.hidden) continue;
    commands.push({
      id: `nav:${section.id}`,
      title: `Go to ${section.label}`,
      sectionId: section.id,
      keywords: [section.label.toLowerCase(), section.id],
      kind: 'navigate',
    });
  }
  return commands;
}

/**
 * Fuzzy score: exact > prefix > substring > subsequence; -1 for no match.
 * Pure and deterministic so the palette + search unit-test without a DOM.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - (t.length - q.length);
  const idx = t.indexOf(q);
  if (idx >= 0) return 600 - idx - (t.length - q.length);
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    ti = found + 1;
  }
  return 200 - (ti - q.length);
}

export interface RankedCommand {
  command: Command;
  score: number;
}

export function rankCommands(query: string, commands: Command[] = buildCommandIndex(), limit = 8): RankedCommand[] {
  const q = query.trim();
  if (!q) return commands.slice(0, limit).map((command) => ({ command, score: 0 }));
  const scored: RankedCommand[] = [];
  for (const command of commands) {
    const score = Math.max(fuzzyScore(q, command.title), ...command.keywords.map((k) => fuzzyScore(q, k)));
    if (score > 0) scored.push({ command, score });
  }
  scored.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
  return scored.slice(0, limit);
}

/* ── universal search (provider-agnostic) ────────────────────────────────── */

export type SearchKind =
  | 'organization'
  | 'person'
  | 'ai-employee'
  | 'project'
  | 'task'
  | 'document'
  | 'connector'
  | 'event'
  | 'timeline'
  | 'audit'
  | 'command';

export interface SearchRecord {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  domain?: CommandDomain;
  keywords: string[];
}

const kw = (...parts: Array<string | undefined>): string[] =>
  parts.filter((p): p is string => Boolean(p)).map((p) => p.toLowerCase());

/**
 * Build one flat, provider-agnostic search index across every entity kind the
 * spec lists. Events, timeline, and audit are facets of the SAME governed
 * activity stream — indexed here as distinct kinds so each is searchable without
 * duplicating the underlying record.
 */
export function buildSearchIndex(
  snapshot: MissionControlSnapshot,
  commands: Command[] = buildCommandIndex(),
): SearchRecord[] {
  const records: SearchRecord[] = [];
  for (const o of snapshot.organizations)
    records.push({ id: o.id, kind: 'organization', title: o.name, subtitle: o.slug, domain: 'organizations', keywords: kw(o.name, o.slug, o.description) });
  for (const p of snapshot.people)
    records.push({ id: p.id, kind: 'person', title: p.name, subtitle: p.title, domain: 'organizations', keywords: kw(p.name, p.title) });
  for (const w of snapshot.workers)
    records.push({ id: w.id, kind: 'ai-employee', title: w.name, subtitle: w.role, domain: 'ai-workforce', keywords: kw(w.name, w.role) });
  for (const p of snapshot.projects)
    records.push({ id: p.id, kind: 'project', title: p.name, subtitle: p.status, domain: 'projects', keywords: kw(p.name, p.status) });
  for (const t of snapshot.tasks)
    records.push({ id: t.id, kind: 'task', title: t.title, subtitle: t.status, domain: 'tasks', keywords: kw(t.title, t.status, t.assignee) });
  for (const d of snapshot.documents)
    records.push({ id: d.id, kind: 'document', title: d.title, subtitle: d.type, domain: 'knowledge', keywords: kw(d.title, d.type) });
  for (const c of snapshot.connectors)
    records.push({ id: c.id, kind: 'connector', title: c.name, subtitle: c.status, domain: 'connectors', keywords: kw(c.name, c.id, c.status) });
  for (const a of snapshot.activity) {
    const title = `${a.domain}.${a.action}`;
    records.push({ id: `evt:${a.id}`, kind: 'event', title, subtitle: a.actor, domain: 'timeline', keywords: kw(a.domain, a.action, a.actor) });
    if (a.audited) records.push({ id: `aud:${a.id}`, kind: 'audit', title, subtitle: a.ok ? 'ok' : 'error', domain: 'governance', keywords: kw(a.domain, a.action, 'audit') });
  }
  // one timeline entry per workspace (the workspace's activity projection)
  for (const w of snapshot.workspaces)
    records.push({ id: `tl:${w.id}`, kind: 'timeline', title: `${w.name} timeline`, subtitle: w.orgName, domain: 'timeline', keywords: kw(w.name, 'timeline', 'activity') });
  for (const c of commands)
    records.push({ id: c.id, kind: 'command', title: c.title, domain: c.domain, keywords: c.keywords });
  return records;
}

export interface SearchHit extends SearchRecord {
  score: number;
}

export function searchAll(
  query: string,
  records: SearchRecord[],
  opts: { kind?: SearchKind; limit?: number } = {},
): SearchHit[] {
  const pool = opts.kind ? records.filter((r) => r.kind === opts.kind) : records;
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const record of pool) {
    const score = Math.max(fuzzyScore(q, record.title), record.subtitle ? fuzzyScore(q, record.subtitle) : -1, ...record.keywords.map((k) => fuzzyScore(q, k)));
    if (score > 0) hits.push({ ...record, score });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, opts.limit ?? 20);
}

export function groupSearchByKind(hits: SearchHit[]): Partial<Record<SearchKind, SearchHit[]>> {
  const groups: Partial<Record<SearchKind, SearchHit[]>> = {};
  for (const hit of hits) (groups[hit.kind] ??= []).push(hit);
  return groups;
}

/* ── executive overview (rollup of runtime projections) ──────────────────── */

const HEALTHY = new Set(['healthy', 'ready', 'ok', 'operational', 'online', 'active']);
const DEGRADED = new Set(['degraded', 'warning', 'paused', 'idle', 'starting']);

/** Classify a worker health string without coupling to the exact union literals. */
export function classifyWorkerHealth(state: string): 'healthy' | 'degraded' | 'failing' {
  const s = state.toLowerCase();
  if (HEALTHY.has(s)) return 'healthy';
  if (DEGRADED.has(s)) return 'degraded';
  return 'failing';
}

export interface MissionControlOverview {
  organizations: number;
  workspaces: number;
  activeWorkspace?: string;
  aiEmployees: number;
  workforceHealth: { healthy: number; degraded: number; failing: number };
  openTasks: number;
  blockedTasks: number;
  connectors: { total: number; up: number; down: number };
  automation: AutomationMetricsLite;
  governance: GovernanceMetricsLite;
  pendingApprovals: number;
  costUsd: number;
  runtimeHealth: string;
  activityCount: number;
}

export function missionControlOverview(snapshot: MissionControlSnapshot): MissionControlOverview {
  const workforceHealth = { healthy: 0, degraded: 0, failing: 0 };
  for (const w of snapshot.workers) workforceHealth[classifyWorkerHealth(String(w.healthState))] += 1;
  const activeWorkspace = snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId)?.name;
  return {
    organizations: snapshot.organizations.length,
    workspaces: snapshot.workspaces.length,
    ...(activeWorkspace ? { activeWorkspace } : {}),
    aiEmployees: snapshot.workers.length,
    workforceHealth,
    openTasks: snapshot.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
    blockedTasks: snapshot.tasks.filter((t) => t.status === 'blocked').length,
    connectors: {
      total: snapshot.connectors.length,
      up: snapshot.connectors.filter((c) => c.status === 'ok').length,
      down: snapshot.connectors.filter((c) => c.status === 'down').length,
    },
    automation: snapshot.automation,
    governance: snapshot.governance,
    pendingApprovals: snapshot.pendingApprovals,
    costUsd: snapshot.costUsd,
    runtimeHealth: snapshot.runtimeHealth,
    activityCount: snapshot.activity.length,
  };
}

/* ── workspace switcher ──────────────────────────────────────────────────── */

export interface WorkspaceSwitchEntry {
  id: string;
  name: string;
  orgName: string;
  userCount: number;
  active: boolean;
}

export function workspaceSwitcher(snapshot: MissionControlSnapshot): WorkspaceSwitchEntry[] {
  return snapshot.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    orgName: w.orgName,
    userCount: w.userCount,
    active: w.id === snapshot.activeWorkspaceId,
  }));
}

/* ── activity feed + notifications (unified inbox / activity sidebar) ─────── */

export function activityFeed(
  snapshot: MissionControlSnapshot,
  opts: { workspaceId?: string; limit?: number } = {},
): ActivityRecord[] {
  return snapshot.activity
    .filter((a) => opts.workspaceId === undefined || a.workspace === opts.workspaceId)
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, opts.limit ?? 50);
}

export function unreadActivityCount(snapshot: MissionControlSnapshot, sinceAt: number): number {
  return snapshot.activity.filter((a) => a.at > sinceAt).length;
}

export function groupActivityByDomain(items: ActivityRecord[]): Record<string, ActivityRecord[]> {
  const groups: Record<string, ActivityRecord[]> = {};
  for (const item of items) (groups[item.domain] ??= []).push(item);
  return groups;
}

export type NotificationKind = 'alert' | 'approval' | 'info';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  at: number;
}

/** Notification center: alerts from down connectors + failed activity + approvals. */
export function notifications(snapshot: MissionControlSnapshot): Notification[] {
  const out: Notification[] = [];
  for (const c of snapshot.connectors)
    if (c.status === 'down') out.push({ id: `conn:${c.id}`, kind: 'alert', title: `Connector ${c.name} is down`, at: 0 });
  for (const a of snapshot.activity)
    if (!a.ok) out.push({ id: `fail:${a.id}`, kind: 'alert', title: `Failed: ${a.domain}.${a.action}`, at: a.at });
  if (snapshot.pendingApprovals > 0)
    out.push({ id: 'approvals', kind: 'approval', title: `${snapshot.pendingApprovals} approval(s) pending`, at: 0 });
  return out.sort((a, b) => b.at - a.at);
}

/* ── capability honesty (anti-fabrication surfacing) ─────────────────────── */

export function isRealCapability(capability: Capability): boolean {
  return REAL_STATES.includes(capability.state);
}

export interface CapabilityHonesty {
  total: number;
  real: number;
  byState: Partial<Record<CapabilityState, number>>;
  auditedShare: number;
  testedShare: number;
}

/**
 * Roll up the canonical capability registry into an honest maturity summary.
 * Mission Control surfaces real vs not-yet-real state truthfully — it never
 * presents a needs-backend / needs-ipc capability as production-complete.
 */
export function capabilityHonesty(caps: Capability[] = CAPABILITY_REGISTRY): CapabilityHonesty {
  const byState: Partial<Record<CapabilityState, number>> = {};
  let real = 0;
  let audited = 0;
  let tested = 0;
  for (const c of caps) {
    byState[c.state] = (byState[c.state] ?? 0) + 1;
    if (isRealCapability(c)) {
      real += 1;
      if (c.audited) audited += 1;
      if (c.tested) tested += 1;
    }
  }
  return {
    total: caps.length,
    real,
    byState,
    auditedShare: real ? audited / real : 0,
    testedShare: real ? tested / real : 0,
  };
}

/* ── status bar ──────────────────────────────────────────────────────────── */

export interface StatusBar {
  runtimeHealth: string;
  connectorsUp: number;
  connectorsTotal: number;
  pendingApprovals: number;
  auditValid: boolean;
  failures: number;
}

export function statusBar(snapshot: MissionControlSnapshot): StatusBar {
  return {
    runtimeHealth: snapshot.runtimeHealth,
    connectorsUp: snapshot.connectors.filter((c) => c.status === 'ok').length,
    connectorsTotal: snapshot.connectors.length,
    pendingApprovals: snapshot.pendingApprovals,
    auditValid: snapshot.governance.auditValid,
    failures: snapshot.activity.filter((a) => !a.ok).length,
  };
}
