import type { IconName } from '@renderer/components/ui/Icon';

export type SectionId =
  | 'home'
  | 'organization'
  | 'enterprise'
  | 'business'
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

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: IconName;
  /** Phase the section becomes fully functional; used for honest "preview" framing. */
  phase: number;
  /** 'footer' sections pin to the bottom of the sidebar (macOS convention). */
  placement: 'primary' | 'footer';
  /**
   * Hidden from navigation (Product Integrity v1.0). The route still resolves so the surface is reachable
   * programmatically and the change is fully reversible, but it is not shown in the sidebar. Used to retire
   * duplicate/superseded experiences (the redundant "home" screens, the read-only *-center overlays that
   * duplicate their full section, the workforce-tab pseudo-sections) and empty/unfinished surfaces, so the
   * user never meets a duplicate or placeholder screen. The canonical surface for each job stays visible.
   */
  hidden?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: 'intent-home', label: "Today's Intent", icon: 'command', phase: 22, placement: 'primary' },
  // Retired in favor of the canonical intent-native home (`intent-home`). Hidden from nav, still routable.
  { id: 'decision-center', label: 'Decision Center', icon: 'sparkles', phase: 21, placement: 'primary', hidden: true },
  { id: 'home', label: 'Home', icon: 'home', phase: 2, placement: 'primary', hidden: true },
  { id: 'organization', label: 'Organization', icon: 'user', phase: 10, placement: 'primary' },
  { id: 'enterprise', label: 'Enterprise', icon: 'grid', phase: 7, placement: 'primary' },
  // Business Workspace (EBS v1.0): a family-grouped presentation over the existing enterprise modules.
  { id: 'business', label: 'Business', icon: 'layers', phase: 7, placement: 'primary' },
  { id: 'opscenter', label: 'Ops Center', icon: 'pulse', phase: 7, placement: 'primary' },
  { id: 'developer', label: 'Developer', icon: 'code', phase: 8, placement: 'primary' },
  { id: 'developer-center', label: 'Developer Center', icon: 'puzzle', phase: 12, placement: 'primary', hidden: true },
  { id: 'industry-center', label: 'Industry Center', icon: 'package', phase: 13, placement: 'primary' },
  { id: 'strategy-center', label: 'Strategy Center', icon: 'sparkles', phase: 14, placement: 'primary' },
  { id: 'twin-center', label: 'Digital Twin Center', icon: 'layers', phase: 15, placement: 'primary' },
  { id: 'knowledge-center', label: 'Knowledge Fabric', icon: 'database', phase: 16, placement: 'primary' },
  { id: 'orchestration-center', label: 'Orchestration', icon: 'command', phase: 17, placement: 'primary' },
  { id: 'network-center', label: 'Intelligence Network', icon: 'globe', phase: 18, placement: 'primary' },
  { id: 'auto-ops-center', label: 'Autonomous Operations', icon: 'command', phase: 19, placement: 'primary' },
  { id: 'commercial-center', label: 'Platform v2', icon: 'store', phase: 20, placement: 'primary' },
  // Product Operations & Release Management v1.0 — a read-only operations lens over existing services.
  { id: 'product-ops', label: 'Product Ops', icon: 'gauge', phase: 20, placement: 'primary' },
  { id: 'ecosystem', label: 'Ecosystem', icon: 'globe', phase: 8, placement: 'primary' },
  { id: 'cloud', label: 'Cloud', icon: 'database', phase: 9, placement: 'primary' },
  { id: 'control-plane', label: 'Control Plane', icon: 'gauge', phase: 11, placement: 'primary', hidden: true },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'server', phase: 13, placement: 'primary' },
  { id: 'federation', label: 'Federation', icon: 'layers', phase: 9, placement: 'primary' },
  { id: 'federation-center', label: 'Federation Center', icon: 'globe', phase: 10, placement: 'primary', hidden: true },
  { id: 'store', label: 'AI Store', icon: 'store', phase: 3, placement: 'primary' },
  { id: 'marketplace', label: 'Marketplace', icon: 'store', phase: 9, placement: 'primary' },
  { id: 'workspace', label: 'Workspace', icon: 'workspace', phase: 2, placement: 'primary' },
  { id: 'operations', label: 'Operations', icon: 'gauge', phase: 3, placement: 'primary' },
  { id: 'workforce', label: 'AI Workforce', icon: 'cpu', phase: 6, placement: 'primary' },
  { id: 'workforce-center', label: 'Workforce Center', icon: 'checklist', phase: 8, placement: 'primary' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors', phase: 4, placement: 'primary' },
  { id: 'memory', label: 'AI Memory', icon: 'memory', phase: 6, placement: 'primary' },
  // `automations` + `analytics` are just AI Workforce tabs, not distinct surfaces — hidden from nav.
  // `notifications` stays visible: it renders an honest "you're all caught up" empty state and is the target
  // of the always-visible toolbar bell, so it needs a real destination (no fabrication, just an empty feed).
  { id: 'automations', label: 'Automations', icon: 'automations', phase: 6, placement: 'primary', hidden: true },
  { id: 'notifications', label: 'Notifications', icon: 'bell', phase: 2, placement: 'primary' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', phase: 6, placement: 'primary', hidden: true },
  { id: 'sandbox', label: 'Sandbox', icon: 'beaker', phase: 12, placement: 'primary' },
  { id: 'welcome', label: 'Welcome', icon: 'home', phase: 2, placement: 'primary', hidden: true },
  { id: 'settings', label: 'Settings', icon: 'settings', phase: 2, placement: 'footer' },
];

export const SECTION_BY_ID: Record<SectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionDef>;
