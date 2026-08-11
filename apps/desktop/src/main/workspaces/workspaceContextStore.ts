/**
 * Phase 6 Stage 1 — Workspace Contexts (the desktop's local, multi-workspace
 * foundation).
 *
 * A workspace context is a named, persistent working environment: which
 * section was open, which Workspace tabs were open, and which of them was
 * active. The store owns the full list of contexts plus the active one, and is
 * the single durable home for session recovery ("close the app, continue
 * exactly where you left off" — now per workspace).
 *
 * House persistence idiom (windowState/memoryStore): an Electron-free class
 * with the file path injected, JSON under the app's userData directory,
 * debounced writes with a synchronous flush for shutdown. Everything read from
 * disk or IPC is sanitized field-by-field — a corrupt file or payload can only
 * ever degrade to defaults, never throw into the caller.
 *
 * NOTE: this is deliberately distinct from `@neuropause/workspace` (the CLOUD
 * organization workspaces domain). These are local user contexts on-device.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'workspace-contexts',
  scope: 'USER',
  persistence: 'file',
  authority: 'USER',
  classification: 'USER_PREFERENCE',
  /** P13C ROUND 10. The only removals are inside ONE owner's own record: MAX_TABS/MAX_NAME truncation, and remove() on the caller's own context. MAX_WORKSPACES THROWS rather than evicting - a limit that refuses a write can destroy nothing, which is the shape a cap should have. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'INSPECTED FOR THE INSTALL-WIDE-CAP CLASS AND CLEAN. `MAX_WORKSPACES` (30) is enforced by ' +
    'THROWING in `create`, not by evicting — a limit that refuses a write can destroy nothing, which ' +
    'is the shape a cap should have. `MAX_TABS` (200) and `MAX_NAME` (60) truncate INSIDE one ' +
    "context's own record, so they cannot reach another context's. `remove(id)` deletes exactly the " +
    'named context and re-bootstraps a fresh Default rather than leaving zero. There is no ' +
    'oldest-first eviction anywhere in this file.',
  reason:
    'WHY USER: a workspace context is where the person left the shell — which section was open, ' +
    'which tabs, which one was active — and it follows them across organizations, exactly as ' +
    '`enterprise-personalization` does. WHAT DATA: a context name and accent colour the person ' +
    'typed, a template id from a four-value enum, two timestamps, and per-tab `{id, appId, title}` ' +
    'where the title is a UI section or installed-app name from the renderer tab model ("Installed ' +
    'Apps", "Connector Center"), never a record. No customer content, no counts of customer ' +
    'activity. THE SEAM, STATED HONESTLY: as with `experience-profile`, the boundary is the ' +
    "operating-system account's userData directory rather than an in-app identity resolver, so two " +
    'people sharing one macOS account share these contexts. `isBound` is omitted rather than ' +
    'pointed at a resolver that does not exist. NOTE: deliberately distinct from ' +
    '`@neuropause/workspace`, the cloud organization-workspace domain — these are local shell ' +
    'contexts on one device and confer no access to anything.',
});

/** One open Workspace tab inside a context (mirrors the renderer tab model). */
export interface ContextTab {
  id: string;
  appId: string;
  title: string;
  openedAt: number;
}

/** The durable shell slice a context remembers between launches. */
export interface ShellSnapshot {
  activeSection: string;
  tabs: ContextTab[];
  activeTabId: string | null;
}

export type WorkspaceTemplateId = 'blank' | 'operations' | 'enterprise' | 'research';

export interface WorkspaceContextRecord {
  id: string;
  name: string;
  /** Small accent used by the switcher UI; a CSS color string. */
  color: string;
  template: WorkspaceTemplateId;
  createdAt: number;
  lastOpenedAt: number;
  snapshot: ShellSnapshot;
}

/** What the renderer needs to boot: the list, the active id, its snapshot. */
export interface WorkspaceContextState {
  workspaces: WorkspaceContextRecord[];
  activeId: string;
  activeSnapshot: ShellSnapshot;
}

interface PersistedFile {
  version: 1;
  activeId: string;
  workspaces: WorkspaceContextRecord[];
}

export const DEFAULT_SECTION = 'intent-home';
export const MAX_WORKSPACES = 30;
export const MAX_TABS = 200;
const MAX_NAME = 60;

const TEMPLATE_SECTIONS: Record<WorkspaceTemplateId, string> = {
  blank: DEFAULT_SECTION,
  operations: 'operations',
  enterprise: 'enterprise',
  research: 'knowledge',
};

export const TEMPLATE_IDS = Object.keys(TEMPLATE_SECTIONS) as WorkspaceTemplateId[];

const DEFAULT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

function sanitizeTabs(raw: unknown): ContextTab[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .filter((t) => typeof t.id === 'string' && typeof t.appId === 'string')
    .slice(0, MAX_TABS)
    .map((t) => ({
      id: t.id as string,
      appId: t.appId as string,
      title: typeof t.title === 'string' && t.title.length > 0 ? (t.title as string) : 'Untitled',
      openedAt: typeof t.openedAt === 'number' && Number.isFinite(t.openedAt) ? (t.openedAt as number) : 0,
    }));
}

/** Field-by-field defensive snapshot sanitize (never throws; always usable). */
export function sanitizeSnapshot(raw: unknown): ShellSnapshot {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const tabs = sanitizeTabs(obj.tabs);
  const activeSection =
    typeof obj.activeSection === 'string' && obj.activeSection.trim().length > 0
      ? obj.activeSection.trim().slice(0, 100)
      : DEFAULT_SECTION;
  const activeTabId =
    typeof obj.activeTabId === 'string' && tabs.some((t) => t.id === obj.activeTabId)
      ? (obj.activeTabId as string)
      : (tabs[tabs.length - 1]?.id ?? null);
  return { activeSection, tabs, activeTabId };
}

function emptySnapshot(section: string = DEFAULT_SECTION): ShellSnapshot {
  return { activeSection: section, tabs: [], activeTabId: null };
}

export class WorkspaceContextStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private data: PersistedFile;
  private seq = 0;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(filePath: string, now: () => number = () => Date.now()) {
    this.filePath = filePath;
    this.now = now;
    this.data = this.load();
  }

  // ---------- persistence ----------

  private load(): PersistedFile {
    try {
      if (existsSync(this.filePath)) {
        // Parse as unknown all the way down — the file is untrusted input and
        // every field is validated individually (never trusted by cast alone).
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
        const rawList: unknown[] = Array.isArray(raw.workspaces) ? (raw.workspaces as unknown[]) : [];
        const workspaces = rawList
          .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
          .filter((w) => typeof w.id === 'string' && (w.id as string).length > 0)
          .slice(0, MAX_WORKSPACES)
          .map((w) => this.sanitizeRecord(w));
        if (workspaces.length > 0) {
          const activeId =
            typeof raw.activeId === 'string' && workspaces.some((w) => w.id === raw.activeId)
              ? (raw.activeId as string)
              : workspaces[0].id;
          return { version: 1, activeId, workspaces };
        }
      }
    } catch {
      // Corrupt file: fall through to the empty state; bootstrap() recreates.
    }
    return { version: 1, activeId: '', workspaces: [] };
  }

  private sanitizeRecord(w: Record<string, unknown>): WorkspaceContextRecord {
    const template = TEMPLATE_IDS.includes(w.template as WorkspaceTemplateId)
      ? (w.template as WorkspaceTemplateId)
      : 'blank';
    return {
      id: w.id as string,
      name:
        typeof w.name === 'string' && w.name.trim().length > 0
          ? w.name.trim().slice(0, MAX_NAME)
          : 'Untitled workspace',
      color: typeof w.color === 'string' && w.color.length <= 32 ? (w.color as string) : DEFAULT_COLORS[0],
      template,
      createdAt: typeof w.createdAt === 'number' ? (w.createdAt as number) : 0,
      lastOpenedAt: typeof w.lastOpenedAt === 'number' ? (w.lastOpenedAt as number) : 0,
      snapshot: sanitizeSnapshot(w.snapshot),
    };
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 300);
  }

  /** Synchronous write (called debounced, and directly on app shutdown). */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = join(dirname(this.filePath), `.workspace-contexts.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch {
      // A failed write must never take the app down; next change retries.
    }
  }

  // ---------- identity ----------

  private makeId(): string {
    return `wsc_${this.now().toString(36)}_${(this.seq++).toString(36)}`;
  }

  private uniqueName(base: string): string {
    const trimmed = base.trim().slice(0, MAX_NAME) || 'Untitled workspace';
    const names = new Set(this.data.workspaces.map((w) => w.name));
    if (!names.has(trimmed)) return trimmed;
    for (let i = 2; i < 100; i++) {
      const candidate = `${trimmed} (${i})`.slice(0, MAX_NAME);
      if (!names.has(candidate)) return candidate;
    }
    return `${trimmed} ${this.now().toString(36)}`.slice(0, MAX_NAME);
  }

  // ---------- queries ----------

  private record(id: string): WorkspaceContextRecord | undefined {
    return this.data.workspaces.find((w) => w.id === id);
  }

  /** Recents-ordered list (active first, then most recently opened). */
  getState(): WorkspaceContextState {
    const active = this.record(this.data.activeId) ?? this.data.workspaces[0];
    const workspaces = [...this.data.workspaces].sort((a, b) => {
      if (a.id === active?.id) return -1;
      if (b.id === active?.id) return 1;
      return b.lastOpenedAt - a.lastOpenedAt;
    });
    return {
      workspaces,
      activeId: active?.id ?? '',
      activeSnapshot: active ? active.snapshot : emptySnapshot(),
    };
  }

  // ---------- commands ----------

  /**
   * First-boot guarantee: ensure at least one workspace exists and an active id
   * is set. When the store file is brand new and the renderer supplies its
   * legacy single-context state (the pre-Stage-1 localStorage prefs), that
   * state becomes the "Default" workspace — the user keeps their session.
   */
  bootstrap(legacySnapshot?: unknown): WorkspaceContextState {
    if (this.data.workspaces.length === 0) {
      const now = this.now();
      const snapshot =
        legacySnapshot !== undefined && legacySnapshot !== null
          ? sanitizeSnapshot(legacySnapshot)
          : emptySnapshot();
      const record: WorkspaceContextRecord = {
        id: this.makeId(),
        name: 'Default',
        color: DEFAULT_COLORS[0],
        template: 'blank',
        createdAt: now,
        lastOpenedAt: now,
        snapshot,
      };
      this.data.workspaces.push(record);
      this.data.activeId = record.id;
      this.scheduleWrite();
    } else if (!this.record(this.data.activeId)) {
      this.data.activeId = this.data.workspaces[0].id;
      this.scheduleWrite();
    }
    return this.getState();
  }

  create(name: string, template: WorkspaceTemplateId, color?: string): WorkspaceContextState {
    if (this.data.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Workspace limit reached (${MAX_WORKSPACES})`);
    }
    const tpl = TEMPLATE_IDS.includes(template) ? template : 'blank';
    const now = this.now();
    const record: WorkspaceContextRecord = {
      id: this.makeId(),
      name: this.uniqueName(name),
      color:
        typeof color === 'string' && color.length > 0 && color.length <= 32
          ? color
          : DEFAULT_COLORS[this.data.workspaces.length % DEFAULT_COLORS.length],
      template: tpl,
      createdAt: now,
      lastOpenedAt: now,
      snapshot: emptySnapshot(TEMPLATE_SECTIONS[tpl]),
    };
    this.data.workspaces.push(record);
    this.data.activeId = record.id;
    this.scheduleWrite();
    return this.getState();
  }

  rename(id: string, name: string): WorkspaceContextState {
    const rec = this.record(id);
    if (rec) {
      const next = name.trim().slice(0, MAX_NAME);
      if (next.length > 0 && next !== rec.name) {
        rec.name = this.data.workspaces.some((w) => w.id !== id && w.name === next)
          ? this.uniqueName(next)
          : next;
        this.scheduleWrite();
      }
    }
    return this.getState();
  }

  /** Deleting the last workspace resets it to a fresh Default (never zero). */
  remove(id: string): WorkspaceContextState {
    const idx = this.data.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return this.getState();
    this.data.workspaces.splice(idx, 1);
    if (this.data.workspaces.length === 0) {
      return this.bootstrap();
    }
    if (this.data.activeId === id) {
      const next = [...this.data.workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
      this.data.activeId = next.id;
      next.lastOpenedAt = this.now();
    }
    this.scheduleWrite();
    return this.getState();
  }

  switch(id: string): WorkspaceContextState {
    const rec = this.record(id);
    if (rec) {
      this.data.activeId = id;
      rec.lastOpenedAt = this.now();
      this.scheduleWrite();
    }
    return this.getState();
  }

  /** Persist the shell snapshot for one workspace (usually the active one). */
  updateSnapshot(id: string, snapshot: unknown): WorkspaceContextState {
    const rec = this.record(id);
    if (rec) {
      rec.snapshot = sanitizeSnapshot(snapshot);
      this.scheduleWrite();
    }
    return this.getState();
  }
}
