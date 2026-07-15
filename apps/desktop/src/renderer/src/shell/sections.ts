import type { IconName } from '@renderer/components/ui/Icon';

export type SectionId =
  | 'home'
  | 'organization'
  | 'enterprise'
  | 'opscenter'
  | 'developer'
  | 'ecosystem'
  | 'cloud'
  | 'infrastructure'
  | 'federation'
  | 'store'
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
  | 'welcome';

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: IconName;
  /** Phase the section becomes fully functional; used for honest "preview" framing. */
  phase: number;
  /** 'footer' sections pin to the bottom of the sidebar (macOS convention). */
  placement: 'primary' | 'footer';
}

export const SECTIONS: SectionDef[] = [
  { id: 'home', label: 'Home', icon: 'home', phase: 2, placement: 'primary' },
  { id: 'organization', label: 'Organization', icon: 'user', phase: 10, placement: 'primary' },
  { id: 'enterprise', label: 'Enterprise', icon: 'grid', phase: 7, placement: 'primary' },
  { id: 'opscenter', label: 'Ops Center', icon: 'pulse', phase: 7, placement: 'primary' },
  { id: 'developer', label: 'Developer', icon: 'code', phase: 8, placement: 'primary' },
  { id: 'ecosystem', label: 'Ecosystem', icon: 'globe', phase: 8, placement: 'primary' },
  { id: 'cloud', label: 'Cloud', icon: 'database', phase: 9, placement: 'primary' },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'server', phase: 13, placement: 'primary' },
  { id: 'federation', label: 'Federation', icon: 'layers', phase: 9, placement: 'primary' },
  { id: 'store', label: 'AI Store', icon: 'store', phase: 3, placement: 'primary' },
  { id: 'workspace', label: 'Workspace', icon: 'workspace', phase: 2, placement: 'primary' },
  { id: 'operations', label: 'Operations', icon: 'gauge', phase: 3, placement: 'primary' },
  { id: 'workforce', label: 'AI Workforce', icon: 'cpu', phase: 6, placement: 'primary' },
  { id: 'workforce-center', label: 'Workforce Center', icon: 'checklist', phase: 8, placement: 'primary' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors', phase: 4, placement: 'primary' },
  { id: 'memory', label: 'AI Memory', icon: 'memory', phase: 6, placement: 'primary' },
  { id: 'automations', label: 'Automations', icon: 'automations', phase: 6, placement: 'primary' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', phase: 2, placement: 'primary' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', phase: 6, placement: 'primary' },
  { id: 'sandbox', label: 'Sandbox', icon: 'beaker', phase: 12, placement: 'primary' },
  { id: 'welcome', label: 'Welcome', icon: 'home', phase: 2, placement: 'primary' },
  { id: 'settings', label: 'Settings', icon: 'settings', phase: 2, placement: 'footer' },
];

export const SECTION_BY_ID: Record<SectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionDef>;
