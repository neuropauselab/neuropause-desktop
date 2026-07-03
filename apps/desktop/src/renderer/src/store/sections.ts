/**
 * Marketplace rail definitions. Each rail is fed either by a backend section
 * key (GET /store/sections/:key) or by a search query, both reached over the
 * secure IPC bridge. Rails are lazy-loaded as they scroll into view, and any
 * rail that returns no apps is hidden so the home never shows an empty shelf.
 */
import type { StoreSearchParams } from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { AppTone } from '@renderer/data/types';

export interface RailDef {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  tone: AppTone;
  source: { kind: 'section'; key: string } | { kind: 'search'; params: StoreSearchParams };
}

export const RAILS: RailDef[] = [
  {
    id: 'recommended',
    title: 'Recommended for you',
    subtitle: 'Picked from what you use and explore',
    icon: 'sparkles',
    tone: 'accent',
    source: { kind: 'section', key: 'trending' },
  },
  {
    id: 'trending',
    title: 'Trending',
    subtitle: 'What the community is adopting now',
    icon: 'activity',
    tone: 'orange',
    source: { kind: 'section', key: 'trending' },
  },
  {
    id: 'new',
    title: 'New releases',
    subtitle: 'Fresh on the store',
    icon: 'bolt',
    tone: 'blue',
    source: { kind: 'section', key: 'new' },
  },
  {
    id: 'staff_picks',
    title: 'Staff picks',
    subtitle: 'Hand-selected by the NeuroPause team',
    icon: 'heart',
    tone: 'pink',
    source: { kind: 'section', key: 'staff_picks' },
  },
  {
    id: 'mcp',
    title: 'MCP servers',
    subtitle: 'Model Context Protocol tools',
    icon: 'connectors',
    tone: 'teal',
    source: { kind: 'search', params: { type: 'mcp_server', sort: 'installs' } },
  },
  {
    id: 'agents',
    title: 'AI agents',
    subtitle: 'Autonomous assistants that get work done',
    icon: 'sparkles',
    tone: 'purple',
    source: { kind: 'search', params: { type: 'ai_agent', sort: 'installs' } },
  },
  {
    id: 'automation',
    title: 'Automation',
    subtitle: 'Chain steps into workflows',
    icon: 'automations',
    tone: 'orange',
    source: { kind: 'search', params: { category: 'automation', sort: 'installs' } },
  },
  {
    id: 'local',
    title: 'Local AI',
    subtitle: 'Runs on your machine',
    icon: 'cpu',
    tone: 'green',
    source: { kind: 'search', params: { category: 'productivity', type: 'native', sort: 'installs' } },
  },
  {
    id: 'open_source',
    title: 'Open source',
    subtitle: 'Inspect, fork, and self-host',
    icon: 'code',
    tone: 'green',
    source: { kind: 'section', key: 'open_source' },
  },
  {
    id: 'enterprise',
    title: 'Enterprise ready',
    subtitle: 'Built for teams and compliance',
    icon: 'shield',
    tone: 'blue',
    source: { kind: 'section', key: 'enterprise' },
  },
  {
    id: 'verified',
    title: 'Verified developers',
    subtitle: 'From identity-verified publishers',
    icon: 'verified',
    tone: 'accent',
    source: { kind: 'section', key: 'verified' },
  },
];
