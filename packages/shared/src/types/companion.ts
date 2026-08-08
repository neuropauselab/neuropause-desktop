/**
 * Companion (mobile) DTOs — the view-model shapes the desktop Companion
 * Gateway exposes to its own Settings UI over IPC (Mobile M1-03). Pure types;
 * the wire security + framing between phone and desktop lives in the separate
 * `@neuropause/companion-protocol` package. Enterprise view-model payloads the
 * phone consumes (snapshot, dashboards, approvals) are added in later M1
 * increments; this file carries only the local management + status surface.
 */

/** A phone paired to this desktop, as shown in Settings → Companion. */
export interface CompanionDeviceDto {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  model: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
}

/** Live gateway status for the Settings pane. */
export interface CompanionStatusDto {
  /** The user has switched the companion gateway on. */
  enabled: boolean;
  /** The LAN server is actually bound and listening. */
  running: boolean;
  /** LAN host advertised in the pairing QR (null when not running). */
  host: string | null;
  /** LAN port (null when not running). */
  port: number | null;
  /** Count of paired, non-revoked devices. */
  deviceCount: number;
  /** The desktop has a signed-in session (the gateway refuses requests otherwise). */
  signedIn: boolean;
  /** Companion protocol version this build speaks. */
  protocolVersion: number;
}

/** A freshly minted pairing QR (short-lived one-time token embedded). */
export interface CompanionPairingQrDto {
  /** The `npc1.` QR text the phone scans. */
  qr: string;
  host: string;
  port: number;
  /** ISO-8601 expiry of the embedded one-time token. */
  expiresAt: string;
}

/** Renderer-facing broadcast: the gateway's status or device list changed. */
export interface CompanionGatewayEvent {
  kind: 'status' | 'devices';
  enabled: boolean;
  running: boolean;
  deviceCount: number;
  at: string;
}

/* ── Phone dashboard view-models (Mobile M1-04) ──────────────────────────── */

/** One KPI tile for the phone, projected from the desktop's executive snapshot. */
export interface CompanionKpi {
  key: string;
  label: string;
  /** Human-readable value (e.g. "valid", "3 connectors", "82%"). */
  display: string;
  band?: 'healthy' | 'watch' | 'at-risk' | 'critical';
  trend?: 'up' | 'down' | 'flat';
}

/** The phone's top-level dashboard snapshot (executive KPI strip). */
export interface CompanionDashboardSnapshot {
  generatedAt: string;
  kpis: CompanionKpi[];
}

/** One enterprise family the phone can drill into (Finance, CRM, HR, …). */
export interface CompanionFamilySummary {
  group: string;
  moduleCount: number;
  recordCount: number;
}

/* ── Approvals inbox (Mobile M1-05) ──────────────────────────────────────── */

/** A labelled detail shown under an approval item on the phone. */
export interface CompanionApprovalField {
  label: string;
  value: string;
}

/** An action the phone may take on an approval item. */
export interface CompanionApprovalAction {
  /** The module action key to dispatch (e.g. 'approve', 'reject'). */
  action: string;
  /** A record field the reason/comment is written to before acting, if any. */
  reasonField: string | null;
  /** True when the module refuses the action unless a reason is supplied. */
  reasonRequired: boolean;
}

/** One record awaiting a decision, shaped for the phone Approval Center. */
export interface CompanionApprovalItem {
  moduleId: string;
  moduleTitle: string;
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  statusTone: string | null;
  fields: CompanionApprovalField[];
  createdAt: string;
  approve: CompanionApprovalAction | null;
  reject: CompanionApprovalAction | null;
}

/** Result of acting on an approval item from the phone. */
export interface CompanionApprovalActResult {
  ok: boolean;
}

/* ── Timeline / search / notifications feeds (Mobile M1-06) ──────────────── */

/** One chronological entry for the phone Activity Timeline. */
export interface CompanionTimelineEntry {
  id: string;
  at: string;
  title: string;
  summary: string | null;
  category: string;
  kind: string;
  actorLabel: string | null;
}

/** A cursor-paginated page of the phone timeline. */
export interface CompanionTimelinePage {
  entries: CompanionTimelineEntry[];
  nextCursor: string | null;
  total: number;
}

/** One enterprise-search hit for the phone. */
export interface CompanionSearchHit {
  id: string;
  source: string;
  kind: string;
  title: string;
  snippet: string | null;
  timestamp: string | null;
}

/**
 * Phone enterprise-search result. NOTE: this is the desktop's enterprise search
 * (connector/UDM entities, knowledge graph, memory, timeline) — it does NOT
 * index ERP record bodies, so a record is found by title only once it appears
 * on the timeline. The boundary is stated so the phone never implies otherwise.
 */
export interface CompanionSearchResult {
  query: string;
  hits: CompanionSearchHit[];
  total: number;
}

/** One notification for the phone Notification Center. */
export interface CompanionNotification {
  id: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  at: string;
  read: boolean;
}

/** A page of the phone notification inbox. */
export interface CompanionNotificationsPage {
  items: CompanionNotification[];
  unread: number;
  total: number;
}

/* ── Executive briefing (Mobile M1-07) ──────────────────────────────────── */

/** A single item flagged in the briefing as needing a decision. */
export interface CompanionBriefingUrgentItem {
  moduleTitle: string;
  title: string;
}

/**
 * The phone's morning/evening executive brief. COMPOSED from real desktop state
 * (the executive KPI snapshot + the approvals inbox + family totals) — it is a
 * deterministic summary, NOT an LLM narrative.
 */
export interface CompanionBriefing {
  period: 'morning' | 'evening';
  generatedAt: string;
  headline: string;
  kpis: CompanionKpi[];
  pendingApprovals: number;
  urgentApprovals: CompanionBriefingUrgentItem[];
  families: CompanionFamilySummary[];
}
