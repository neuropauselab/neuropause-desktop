/**
 * Domain types for the workspace surface. These describe the *shape* of the
 * data the dashboard renders. In Phase 2 the values come from a local sample
 * source (see sampleData.ts); in later phases the same types are produced by
 * the Activity Intelligence, Connectors, and Memory services over IPC — the
 * components do not change, only the source behind useDashboardData().
 */

export type AppTone =
  | 'accent'
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'teal'
  | 'pink';

export type AppCategory =
  | 'Writing'
  | 'Coding'
  | 'Image'
  | 'Video'
  | 'Voice'
  | 'Automation'
  | 'Business'
  | 'Research'
  | 'Productivity';

/** A product in the AI catalog — drives the store, launcher, and palette. */
export interface CatalogApp {
  id: string;
  name: string;
  developer: string;
  category: AppCategory;
  tagline: string;
  tone: AppTone;
  /** Short label used for the glyph tile (brand logos are intentionally not used). */
  glyph: string;
  connected?: boolean;
}

export interface ConnectedApp {
  appId: string;
  /** ISO-8601 timestamp of last activity. */
  lastUsed: string;
  sessionsToday: number;
}

export type SessionState = 'active' | 'idle';

export interface RunningSession {
  id: string;
  appId: string;
  title: string;
  /** ISO-8601 timestamp the session started. */
  startedAt: string;
  state: SessionState;
}

export type TaskPriority = 'high' | 'medium' | 'low';

export interface PendingTask {
  id: string;
  title: string;
  appId: string;
  priority: TaskPriority;
  /** Human due label, e.g. "Today", "Tomorrow", "Fri". */
  due: string;
}

export type ActivityKind = 'opened' | 'completed' | 'created' | 'connected' | 'summarized';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  appId: string;
  /** ISO-8601 timestamp. */
  at: string;
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  tone: AppTone;
  /** The action label, e.g. "Summarize", "Review", "Connect". */
  action: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  appId?: string;
  at: string;
  read: boolean;
  kind: 'reminder' | 'summary' | 'workflow' | 'system';
}

export interface ProductivitySummary {
  focusMinutesToday: number;
  deepWorkPct: number;
  sessionsToday: number;
  tasksCompletedToday: number;
  /** Trailing 7 days of focus minutes, oldest first; last entry is today. */
  weekly: { label: string; value: number }[];
}

/** The full dashboard payload. */
export interface DashboardData {
  connectedApps: ConnectedApp[];
  runningSessions: RunningSession[];
  productivity: ProductivitySummary;
  tasks: PendingTask[];
  activity: ActivityEvent[];
  recommendations: Recommendation[];
  notifications: AppNotification[];
}
