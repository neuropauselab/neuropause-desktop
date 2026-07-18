import type { IconName } from '@renderer/components/ui/Icon';

export type SectionId =
  | 'home'
  | 'store'
  | 'workspace'
  | 'connectors'
  | 'memory'
  | 'automations'
  | 'notifications'
  | 'analytics'
  | 'settings';

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
  { id: 'store', label: 'AI Store', icon: 'store', phase: 3, placement: 'primary' },
  { id: 'workspace', label: 'Workspace', icon: 'workspace', phase: 2, placement: 'primary' },
  { id: 'connectors', label: 'Connectors', icon: 'connectors', phase: 4, placement: 'primary' },
  { id: 'memory', label: 'AI Memory', icon: 'memory', phase: 6, placement: 'primary' },
  { id: 'automations', label: 'Automations', icon: 'automations', phase: 6, placement: 'primary' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', phase: 2, placement: 'primary' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', phase: 6, placement: 'primary' },
  { id: 'settings', label: 'Settings', icon: 'settings', phase: 2, placement: 'footer' },
];

export const SECTION_BY_ID: Record<SectionId, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, SectionDef>;
