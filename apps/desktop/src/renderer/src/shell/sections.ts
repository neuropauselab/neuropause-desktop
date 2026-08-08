import type { IconName } from '@renderer/components/ui/Icon';

export type SectionId =
  | 'mission-control'
  | 'search'
  | 'assistant'
  | 'hub'
  | 'home'
  | 'organization'
  | 'enterprise'
  | 'business'
  | 'administration'
  | 'ai-operations'
  | 'extensibility'
  | 'intelligence'
  | 'collaboration'
  | 'knowledge'
  | 'automation-center'
  | 'opscenter'
  | 'developer'
  | 'developer-center'
  | 'industry-center'
  | 'strategy-center'
  | 'twin-center'
  | 'knowledge-center'
  | 'orchestration-center'
  | 'network-center'
  | 'auto-ops-center'
  | 'commercial-center'
  | 'product-ops'
  | 'ecosystem'
  | 'cloud'
  | 'control-plane'
  | 'infrastructure'
  | 'federation'
  | 'federation-center'
  | 'store'
  | 'marketplace'
  | 'workspace'
  | 'operations'
  | 'workforce'
  | 'workforce-center'
  | 'connectors'
  | 'memory'
  | 'automations'
  | 'notifications'
  | 'analytics'
  | 'sandbox'
  | 'settings'
  | 'decision-center'
  | 'intent-home'
  | 'welcome';

/**
 * Phase 7 (Product Experience) — sidebar groups. The flat 40-item list is
 * bucketed into five stable groups rendered in this order. Grouping is a
 * RENDER concern only: the SECTIONS array order below is untouched, so every
 * existing nav lock (positions, hidden/preview membership) holds unchanged.
 */
export const SECTION_GROUPS = ['today', 'business', 'workspace', 'ai', 'platform', 'system'] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number];

/** Human labels for the sidebar group headers. */
export const SECTION_GROUP_LABELS: Record<SectionGroup, string> = {
  today: 'Today',
  business: 'Business',
  workspace: 'Workspace',
  ai: 'AI & Operations',
  platform: 'Platform',
  system: 'System',
};

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: IconName;
  /** Phase the section becomes fully functional; used for honest "preview" framing. */
  phase: number;
  /** 'footer' sections pin to the bottom of the sidebar (macOS convention). */
  placement: 'primary' | 'footer';
  /** Sidebar group (Phase 7). Every visible primary section carries one. */
  group?: SectionGroup;
  /**
   * Hidden from navigation (Product Integrity v1.0). The route still resolves so the surface is reachable
   * programmatically and the change is fully reversible, but it is not shown in the sidebar. Used to retire
   * duplicate/superseded experiences (the redundant "home" screens, the read-only *-center overlays that
   * duplicate their full section, the workforce-tab pseudo-sections) and empty/unfinished surfaces, so the
   * user never meets a duplicate or placeholder screen. The canonical surface for each job stays visible.
   */
  hidden?: boolean;
  /**
   * Marks a not-yet-live Prototype/Vision surface (NRIA §3/§12 "Prototype-Model":
   * real code, in-memory/seeded, no external effect). Rendered with a "Preview"
   * affordance so a user can distinguish it from real production capability.
   * Honest positioning, NOT a hide — the section stays fully visible and usable.
   */
  preview?: boolean;
  /**
   * A short, user-facing description of the section's job (Phase 2 IA). Rendered as
   * the sidebar row tooltip and the command-palette "Go to" subtitle so a user can
   * tell adjacent or similarly-named surfaces apart without learning the internal
   * architecture. Purely presentational — no route, id, or lock depends on it.
   */
  description?: string;
}

export const SECTIONS: SectionDef[] = [
  // Phase 6 Stage 2 — Mission Control: the live landing dashboard. A pure
  // unification surface over EXISTING sections and IPC feeds (additive; every
  // tile loads independently and degrades to an explicit unavailable state).
  { id: 'mission-control', label: 'Mission Control', icon: 'gauge', phase: 23, placement: 'primary', group: 'today' },
  { id: 'intent-home', label: "Today's Intent", icon: 'command', phase: 22, placement: 'primary', group: 'today' },
  // Phase 6 Stage 3 — Universal Search: one query across every existing index
  // (federated engine, app records, semantic memory, business modules). Additive;
  // placed after the two landing surfaces so their nav locks hold unchanged.
  { id: 'search', label: 'Search', icon: 'search', phase: 24, placement: 'primary', group: 'today' },
  // Phase 6 Stage 4 — Workspace Assistant: the conversational interface over the
  // existing engines (AI Engine + Context Builder + ExecuteEngine + workforce
  // approvals). Additive; placed after Search so every prior nav lock holds.
  { id: 'assistant', label: 'Assistant', icon: 'sparkles', phase: 25, placement: 'primary', group: 'today' },
  // Phase 6 Stage 5 — Work Hub: the personal workday surface (Today + My Work +
  // Executive tabs) composed from EXISTING feeds (briefing, tasks, recommendations,
  // approvals, notifications, executive snapshot). Additive; placed after Assistant
  // so every prior nav lock holds. Positioning: Mission Control = organizational
  // operations landing; Today's Intent = strategy outcomes; Work Hub = YOUR day.
  { id: 'hub', label: 'Work Hub', icon: 'checklist', phase: 26, placement: 'primary', group: 'today' },
  // Retired in favor of the canonical intent-native home (`intent-home`). Hidden from nav, still routable.
  { id: 'decision-center', label: 'Decision Center', icon: 'sparkles', phase: 21, placement: 'primary', group: 'today', hidden: true },
  { id: 'home', label: 'Home', icon: 'home', phase: 2, placement: 'primary', group: 'today', hidden: true },
  { id: 'organization', label: 'Organization', icon: 'user', phase: 10, placement: 'primary', group: 'business' },
  { id: 'enterprise', label: 'Enterprise', icon: 'grid', phase: 7, placement: 'primary', group: 'business', preview: true },
  // Business Workspace (EBS v1.0): a family-grouped presentation over the existing enterprise modules.
  { id: 'business', label: 'Business', icon: 'layers', phase: 7, placement: 'primary', group: 'business' },
  // Enterprise Administration v1.0 — a reuse-only admin control center over existing services.
  { id: 'administration', label: 'Administration', icon: 'shield', phase: 10, placement: 'primary', group: 'business' },
  // Phase 2 — reuse-only workspaces (Intelligence / Collaboration / Knowledge / Automation).
  { id: 'intelligence', label: 'Intelligence', icon: 'lightbulb', phase: 10, placement: 'primary', group: 'workspace' },
  { id: 'collaboration', label: 'Collaboration', icon: 'checklist', phase: 10, placement: 'primary', group: 'workspace' },
  { id: 'knowledge', label: 'Knowledge', icon: 'doc', phase: 10, placement: 'primary', group: 'workspace' },
  { id: 'automation-center', label: 'Automation', icon: 'bolt', phase: 10, placement: 'primary', group: 'workspace' },
  // Phase 3 — the AI Operating Platform: a reuse-only operating layer over existing AI capabilities.
  { id: 'ai-operations', label: 'AI Operations', icon: 'sparkles', phase: 10, placement: 'primary', group: 'ai', description: 'The AI operating loop — plan, reason, orchestrate, decide, govern, and optimize across every AI capability.' },
  // Phase 5 — the Platform Ecosystem control plane (extensibility over existing surfaces).
  { id: 'extensibility', label: 'Extensibility', icon: 'puzzle', phase: 10, placement: 'primary', group: 'platform' },
  { id: 'opscenter', label: 'Operations', icon: 'pulse', phase: 7, placement: 'primary', group: 'ai', description: 'Enterprise operational health, risk, dependencies, incidents, and recommendations.' },
  { id: 'developer', label: 'Developer', icon: 'code', phase: 8, placement: 'primary', group: 'platform' },
  { id: 'developer-center', label: 'Developer Center', icon: 'puzzle', phase: 12, placement: 'primary', group: 'platform', hidden: true },
  { id: 'industry-center', label: 'Industry Center', icon: 'package', phase: 13, placement: 'primary', group: 'platform', preview: true },
  { id: 'strategy-center', label: 'Strategy Center', icon: 'sparkles', phase: 14, placement: 'primary', group: 'platform', preview: true },
  { id: 'twin-center', label: 'Digital Twin Center', icon: 'layers', phase: 15, placement: 'primary', group: 'platform', preview: true },
  { id: 'knowledge-center', label: 'Knowledge Fabric', icon: 'database', phase: 16, placement: 'primary', group: 'platform', preview: true },
  { id: 'orchestration-center', label: 'Orchestration', icon: 'command', phase: 17, placement: 'primary', group: 'platform', preview: true },
  { id: 'network-center', label: 'Intelligence Network', icon: 'globe', phase: 18, placement: 'primary', group: 'platform', preview: true },
  { id: 'auto-ops-center', label: 'Autonomous Operations', icon: 'command', phase: 19, placement: 'primary', group: 'platform', preview: true, description: 'Closed-loop autonomous operations — plans, coordination, and governance; every action stays approval-gated.' },
  { id: 'commercial-center', label: 'Platform v2', icon: 'store', phase: 20, placement: 'primary', group: 'platform', preview: true },
  // Product Operations & Release Management v1.0 — a read-only operations lens over existing services.
  { id: 'product-ops', label: 'Release Ops', icon: 'package', phase: 20, placement: 'primary', group: 'platform', description: 'Shipping the product — releases, build health, quality, deployment, and commercial metrics.' },
  { id: 'ecosystem', label: 'Ecosystem', icon: 'globe', phase: 8, placement: 'primary', group: 'platform', preview: true },
  { id: 'cloud', label: 'Cloud', icon: 'database', phase: 9, placement: 'primary', group: 'platform', preview: true },
  { id: 'control-plane', label: 'Control Plane', icon: 'gauge', phase: 11, placement: 'primary', group: 'platform', hidden: true },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'server', phase: 13, placement: 'primary', group: 'platform' },
  { id: 'federation', label: 'Federation', icon: 'layers', phase: 9, placement: 'primary', group: 'platform', preview: true },
  { id: 'federation-center', label: 'Federation Center', icon: 'globe', phase: 10, placement: 'primary', group: 'platform', hidden: true },
  { id: 'store', label: 'AI Store', icon: 'store', phase: 3, placement: 'primary', group: 'workspace' },
  { id: 'marketplace', label: 'Marketplace', icon: 'store', phase: 9, placement: 'primary', group: 'workspace', preview: true },
  { id: 'workspace', label: 'Workspace', icon: 'workspace', phase: 2, placement: 'primary', group: 'workspace' },
  { id: 'operations', label: 'Runtime', icon: 'cpu', phase: 3, placement: 'primary', group: 'platform', description: 'Installed apps, plugins, runtime sessions, downloads, updates, and permissions.' },
  { id: 'workforce', label: 'AI Workforce', icon: 'cpu', phase: 6, placement: 'primary', group: 'ai' },
  { id: 'workforce-center', label: 'Workforce Center', icon: 'checklist', phase: 8, placement: 'primary', group: 'ai' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors', phase: 4, placement: 'primary', group: 'workspace' },
  { id: 'memory', label: 'AI Memory', icon: 'memory', phase: 6, placement: 'primary', group: 'workspace' },
  // `automations` + `analytics` are just AI Workforce tabs, not distinct surfaces — hidden from nav.
  // `notifications` stays visible: it renders an honest "you're all caught up" empty state and is the target
  // of the always-visible toolbar bell, so it needs a real destination (no fabrication, just an empty feed).
  { id: 'automations', label: 'Automations', icon: 'automations', phase: 6, placement: 'primary', group: 'ai', hidden: true },
  { id: 'notifications', label: 'Notifications', icon: 'bell', phase: 2, placement: 'primary', group: 'system' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', phase: 6, placement: 'primary', group: 'ai', hidden: true },
  { id: 'sandbox', label: 'Sandbox', icon: 'beaker', phase: 12, placement: 'primary', group: 'ai' },
  // Phase 7 (Product Experience) — UN-hidden: the onboarding wizard's docstring says "the welcome
  // checklist picks up whatever remains", but a hidden section is excluded from the sidebar AND the
  // command palette, so that hand-off dead-ended. The getting-started checklist is now reachable
  // under System (first-run guidance is a real product surface, not a duplicate).
  { id: 'welcome', label: 'Getting Started', icon: 'home', phase: 2, placement: 'primary', group: 'system' },
  { id: 'settings', label: 'Settings', icon: 'settings', phase: 2, placement: 'footer', group: 'system' },
];

export const SECTION_BY_ID: Record<SectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionDef>;
