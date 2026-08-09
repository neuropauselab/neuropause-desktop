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
  | 'data-center'
  | 'medical-devices'
  | 'ai-home'
  | 'understand'
  | 'holds'
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
  /**
   * Progressive-disclosure tier (Phase 2). `advanced` sections are collapsed behind the
   * sidebar's "Advanced" disclosure so the default pilot sidebar stays focused; `primary`
   * / `secondary` (or unset) render in their normal group. Purely a RENDER concern — the
   * command palette and universal search still expose every non-hidden section, and the
   * SECTIONS array order (and every nav lock over it) is untouched.
   */
  tier?: 'primary' | 'secondary' | 'advanced';
}

export const SECTIONS: SectionDef[] = [
  // Phase 6 Stage 2 — Mission Control: the live landing dashboard. A pure
  // unification surface over EXISTING sections and IPC feeds (additive; every
  // tile loads independently and degrades to an explicit unavailable state).
  { id: 'mission-control', label: 'Mission Control', icon: 'gauge', phase: 23, placement: 'primary', group: 'today', description: 'Organization-wide operations at a glance — your command landing.' },
  { id: 'intent-home', label: "Today's Intent", icon: 'command', phase: 22, placement: 'primary', group: 'today', description: 'Your strategic priorities and the outcomes that matter today.' },
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
  { id: 'hub', label: 'Work Hub', icon: 'checklist', phase: 26, placement: 'primary', group: 'today', description: 'Your personal day — tasks, approvals, briefings, and recent work.' },
  // Private-First experience: the AI workspace home. Positioned AFTER the
  // locked landing quintet (mission-control, intent-home, search, assistant,
  // hub) so every existing nav lock holds; the Personal workspace filter makes
  // it the lead surface for personal installs.
  { id: 'ai-home', label: 'Ask NeuroPause', icon: 'sparkles', phase: 29, placement: 'primary', group: 'today', description: 'What do you want to accomplish? One place to ask, with a truthful account of where the AI ran.' },
  // Understanding + Hold: the two surfaces that keep the product honest. Both
  // sit in `today` beside Ask, because both are about the current conversation
  // between you and the system — what it believes, and what it will not do
  // without you. Appended after `ai-home` so every existing nav lock holds.
  { id: 'understand', label: 'Understand', icon: 'lightbulb', phase: 30, placement: 'primary', group: 'today', description: 'What NeuroPause understands about you, where each belief came from, and how to correct it.' },
  { id: 'holds', label: 'Holds', icon: 'shield', phase: 30, placement: 'primary', group: 'today', description: 'Work NeuroPause understood but would not run without you — and the record of every consequential decision.' },
  // Retired in favor of the canonical intent-native home (`intent-home`). Hidden from nav, still routable.
  { id: 'decision-center', label: 'Decision Center', icon: 'sparkles', phase: 21, placement: 'primary', group: 'today', hidden: true },
  { id: 'home', label: 'Home', icon: 'home', phase: 2, placement: 'primary', group: 'today', hidden: true },
  { id: 'organization', label: 'Organization', icon: 'user', phase: 10, placement: 'primary', group: 'business', description: 'Manage your organization — members, workspaces, and roles.' },
  { id: 'enterprise', label: 'Enterprise', icon: 'grid', phase: 7, placement: 'primary', group: 'business', preview: true, description: 'The executive command center — decisions, org, operations, and governed AI.' },
  // Business Workspace (EBS v1.0): a family-grouped presentation over the existing enterprise modules.
  { id: 'business', label: 'Business', icon: 'layers', phase: 7, placement: 'primary', group: 'business', description: 'Your business modules — finance, sales, CRM, HR, projects, and more.' },
  // Enterprise Administration v1.0 — a reuse-only admin control center over existing services.
  { id: 'administration', label: 'Administration', icon: 'shield', phase: 10, placement: 'primary', group: 'business', description: 'Security, identity, compliance, licensing, and configuration.' },
  // Phase 2 — reuse-only workspaces (Intelligence / Collaboration / Knowledge / Automation).
  { id: 'intelligence', label: 'Intelligence', icon: 'lightbulb', phase: 10, placement: 'primary', group: 'workspace' },
  { id: 'collaboration', label: 'Collaboration', icon: 'checklist', phase: 10, placement: 'primary', group: 'workspace' },
  { id: 'knowledge', label: 'Knowledge', icon: 'doc', phase: 10, placement: 'primary', group: 'workspace', description: 'Search, AI memory, the knowledge graph, and enterprise knowledge in one lens.' },
  { id: 'automation-center', label: 'Automation', icon: 'bolt', phase: 10, placement: 'primary', group: 'workspace' },
  // Phase 3 — the AI Operating Platform: a reuse-only operating layer over existing AI capabilities.
  { id: 'ai-operations', label: 'AI Operations', icon: 'sparkles', phase: 10, placement: 'primary', group: 'ai', description: 'The AI operating loop — plan, reason, orchestrate, decide, govern, and optimize across every AI capability.' },
  // Phase 5 — the Platform Ecosystem control plane (extensibility over existing surfaces).
  { id: 'extensibility', label: 'Extensibility', icon: 'puzzle', phase: 10, placement: 'primary', group: 'platform', description: 'Extensions, developer platform, connectors, and partners — how the platform extends.', tier: 'advanced' },
  { id: 'opscenter', label: 'Operations', icon: 'pulse', phase: 7, placement: 'primary', group: 'ai', description: 'Enterprise operational health, risk, dependencies, incidents, and recommendations.' },
  { id: 'developer', label: 'Developer', icon: 'code', phase: 8, placement: 'primary', group: 'platform', tier: 'advanced', description: 'Build on NeuroPause — APIs, SDKs, keys, and the developer portal.' },
  { id: 'developer-center', label: 'Developer Center', icon: 'puzzle', phase: 12, placement: 'primary', group: 'platform', hidden: true },
  { id: 'industry-center', label: 'Industry Center', icon: 'package', phase: 13, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'Industry solution packs — vertical templates, workflows, and compliance.' },
  { id: 'strategy-center', label: 'Strategy Center', icon: 'sparkles', phase: 14, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'Strategic planning, scenarios, and outcome tracking.' },
  { id: 'twin-center', label: 'Digital Twin Center', icon: 'layers', phase: 15, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'The enterprise digital twin — model, simulate, and analyze the organization.' },
  { id: 'knowledge-center', label: 'Enterprise Knowledge', icon: 'database', phase: 16, placement: 'primary', group: 'platform', preview: true, description: 'Explore the enterprise knowledge fabric — relationships, lineage, evidence, and governance.', tier: 'advanced' },
  { id: 'orchestration-center', label: 'Orchestration', icon: 'command', phase: 17, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'Coordinate cross-system workflows and long-running processes.' },
  { id: 'network-center', label: 'Intelligence Network', icon: 'globe', phase: 18, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'The intelligence network — shareable patterns across the federation.' },
  { id: 'auto-ops-center', label: 'Autonomous Operations', icon: 'command', phase: 19, placement: 'primary', group: 'platform', preview: true, description: 'Closed-loop autonomous operations — plans, coordination, and governance; every action stays approval-gated.', tier: 'advanced' },
  { id: 'commercial-center', label: 'Commercial Center', icon: 'store', phase: 20, placement: 'primary', group: 'platform', preview: true, description: 'Commercial operations — pricing, packaging, billing, and go-to-market.', tier: 'advanced' },
  // Product Operations & Release Management v1.0 — a read-only operations lens over existing services.
  { id: 'product-ops', label: 'Release Ops', icon: 'package', phase: 20, placement: 'primary', group: 'platform', description: 'Shipping the product — releases, build health, quality, deployment, and commercial metrics.', tier: 'advanced' },
  { id: 'ecosystem', label: 'Ecosystem', icon: 'globe', phase: 8, placement: 'primary', group: 'platform', preview: true, description: 'The org-facing storefront for workers, connectors, templates, and partners.', tier: 'advanced' },
  { id: 'cloud', label: 'Cloud', icon: 'database', phase: 9, placement: 'primary', group: 'platform', preview: true, description: 'NeuroPause cloud — tenants, identity federation, sync, and the API gateway.', tier: 'advanced' },
  { id: 'control-plane', label: 'Control Plane', icon: 'gauge', phase: 11, placement: 'primary', group: 'platform', hidden: true },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'server', phase: 13, placement: 'primary', group: 'platform', description: 'Discover and map your external cloud platforms, resources, and topology.', tier: 'advanced' },
  { id: 'federation', label: 'Federation', icon: 'layers', phase: 9, placement: 'primary', group: 'platform', preview: true, tier: 'advanced', description: 'Cross-organization federation — trust, sharing, and exchange.' },
  { id: 'federation-center', label: 'Federation Center', icon: 'globe', phase: 10, placement: 'primary', group: 'platform', hidden: true },
  { id: 'store', label: 'AI Store', icon: 'store', phase: 3, placement: 'primary', group: 'workspace', description: 'Discover, install, and launch AI apps.' },
  { id: 'marketplace', label: 'Enterprise Marketplace', icon: 'store', phase: 9, placement: 'primary', group: 'workspace', preview: true, description: 'Signed, governed packages — workers, connectors, templates, and packs.' },
  { id: 'workspace', label: 'Workspace', icon: 'workspace', phase: 2, placement: 'primary', group: 'workspace' },
  { id: 'operations', label: 'Runtime', icon: 'cpu', phase: 3, placement: 'primary', group: 'platform', description: 'Installed apps, plugins, runtime sessions, downloads, updates, and permissions.', tier: 'advanced' },
  { id: 'workforce', label: 'AI Workforce', icon: 'cpu', phase: 6, placement: 'primary', group: 'ai', description: 'Run and supervise AI workers — approvals, automations, and the executive assistant.' },
  { id: 'workforce-center', label: 'Workforce Admin', icon: 'checklist', phase: 8, placement: 'primary', group: 'ai', description: 'Install, configure, and manage AI workers — health, delegation, and execution history.', tier: 'advanced' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors', phase: 4, placement: 'primary', group: 'workspace' },
  // Phase 6 — the Data Command Center. Placed in `business` because its job is
  // getting the organization's OWN data in, next to the modules that consume it;
  // appended after the existing entries so every positional nav lock holds.
  { id: 'data-center', label: 'Data', icon: 'database', phase: 27, placement: 'primary', group: 'business', description: 'Import, review and trace your business data — every record back to the row it came from.' },
  // Medical Device Manufacturing industry pack. Sits in Business, next to Data,
  // because that is where its records come from — the catalogue and the batch
  // history are usually imported before anyone creates one by hand.
  { id: 'medical-devices', label: 'Medical Devices', icon: 'tag', phase: 28, placement: 'primary', group: 'business', description: 'Device catalogue and batch/lot traceability — forward and backward, from real records.' },
  { id: 'memory', label: 'AI Memory', icon: 'memory', phase: 6, placement: 'primary', group: 'workspace', description: 'Your AI memory — conversations, notes, and everything you have saved.' },
  // `automations` + `analytics` are just AI Workforce tabs, not distinct surfaces — hidden from nav.
  // `notifications` stays visible: it renders an honest "you're all caught up" empty state and is the target
  // of the always-visible toolbar bell, so it needs a real destination (no fabrication, just an empty feed).
  { id: 'automations', label: 'Automations', icon: 'automations', phase: 6, placement: 'primary', group: 'ai', hidden: true },
  { id: 'notifications', label: 'Notifications', icon: 'bell', phase: 2, placement: 'primary', group: 'system' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', phase: 6, placement: 'primary', group: 'ai', hidden: true },
  { id: 'sandbox', label: 'Sandbox', icon: 'beaker', phase: 12, placement: 'primary', group: 'platform', description: 'A safe space to test workflows and validate changes before rollout.', tier: 'advanced' },
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
