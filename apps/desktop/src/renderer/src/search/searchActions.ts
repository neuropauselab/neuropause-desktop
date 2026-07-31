/**
 * Phase 6 Stage 3 — search result actions (pure registry + resolver).
 *
 * Every result type maps to concrete actions that resolve into EXISTING shell
 * verbs and IPC calls — the `interactionRouter` resolution style. Nothing here
 * performs I/O; the host executes the returned resolution.
 */
import type { SectionId } from '../shell/sections';
import type { UnifiedSearchItem } from './searchModel';

export type SearchActionId =
  | 'open'
  | 'pin'
  | 'copy-title'
  | 'open-connector'
  | 'open-timeline'
  | 'open-memory'
  | 'switch-workspace'
  | 'launch-app';

export interface SearchActionDescriptor {
  id: SearchActionId;
  label: string;
  icon: string;
}

export type SearchActionResolution =
  | { kind: 'section'; section: SectionId }
  | { kind: 'enterprise-tab'; tab: string; query?: string }
  | { kind: 'connectors-tab'; tab: string }
  | { kind: 'open-app'; appId: string; title: string }
  | { kind: 'switch-workspace'; workspaceId: string }
  | { kind: 'copy'; text: string }
  | { kind: 'pin' }
  | { kind: 'none' };

const OPEN: SearchActionDescriptor = { id: 'open', label: 'Open', icon: 'arrow-right' };
const PIN: SearchActionDescriptor = { id: 'pin', label: 'Pin', icon: 'pin' };
const COPY: SearchActionDescriptor = { id: 'copy-title', label: 'Copy title', icon: 'clipboard' };

/** The action set for a result — primary first. */
export function actionsFor(item: UnifiedSearchItem): SearchActionDescriptor[] {
  const extras: SearchActionDescriptor[] = [];
  if (item.connectorId) extras.push({ id: 'open-connector', label: 'Open connector', icon: 'connectors' });
  if (item.type === 'entity' || item.type === 'timeline') extras.push({ id: 'open-timeline', label: 'View in timeline', icon: 'clock' });
  if (item.type === 'memory') extras.push({ id: 'open-memory', label: 'Open AI Memory', icon: 'memory' });
  return [OPEN, ...extras, PIN, COPY];
}

/** Resolve an action to an executable plan over existing shell verbs. */
export function resolveAction(item: UnifiedSearchItem, actionId: SearchActionId): SearchActionResolution {
  switch (actionId) {
    case 'copy-title':
      return { kind: 'copy', text: item.title };
    case 'pin':
      return { kind: 'pin' };
    case 'open-connector':
      return { kind: 'connectors-tab', tab: 'connections' };
    case 'open-timeline':
      return { kind: 'section', section: 'opscenter' };
    case 'open-memory':
      return { kind: 'section', section: 'memory' };
    case 'switch-workspace':
    case 'launch-app':
    case 'open':
      break;
  }

  // Primary "Open" per type — always a real destination that exists today.
  switch (item.type) {
    case 'section':
      return { kind: 'section', section: item.id as SectionId };
    case 'app':
      return { kind: 'open-app', appId: item.id, title: item.title };
    case 'workspace':
      return { kind: 'switch-workspace', workspaceId: item.id };
    case 'connector':
      return { kind: 'connectors-tab', tab: 'connections' };
    case 'decision':
      return { kind: 'enterprise-tab', tab: 'decision' };
    case 'workflow':
      return { kind: 'section', section: 'automation-center' };
    case 'execution':
      return { kind: 'section', section: 'operations' };
    case 'person':
      return { kind: 'section', section: 'organization' };
    case 'memory':
      return { kind: 'section', section: 'memory' };
    case 'timeline':
      return { kind: 'section', section: 'opscenter' };
    case 'graph':
      return { kind: 'enterprise-tab', tab: 'relationship', query: item.title };
    case 'business':
      return { kind: 'section', section: 'business' };
    case 'entity':
      return { kind: 'enterprise-tab', tab: 'search', query: item.title };
    default:
      return { kind: 'none' };
  }
}
