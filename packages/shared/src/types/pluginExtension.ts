/**
 * Plugin SDK v2 — extension contributions (P3.0, Increment 6).
 *
 * A plugin (running sandboxed in its own process) can register declarative
 * extensions that plug into the platform's EXISTING registries — ERP modules,
 * executive KPIs, timeline/graph/memory/search/context providers, and automation
 * triggers/actions. Registration is permission-gated (each kind maps to a runtime
 * permission the plugin must hold), versioned (every extension carries the plugin's
 * version), and hot-reloadable (a plugin's extensions are cleared when it stops and
 * re-registered when it restarts). Types-only.
 */
import type { RuntimePermissionKey } from './runtime';

export type PluginExtensionKind =
  | 'erp_module'
  | 'executive_kpi'
  | 'timeline_provider'
  | 'graph_node'
  | 'graph_relationship'
  | 'memory_projector'
  | 'automation_trigger'
  | 'automation_action'
  | 'search_provider'
  | 'context_provider';

export const PLUGIN_EXTENSION_KINDS: readonly PluginExtensionKind[] = [
  'erp_module',
  'executive_kpi',
  'timeline_provider',
  'graph_node',
  'graph_relationship',
  'memory_projector',
  'automation_trigger',
  'automation_action',
  'search_provider',
  'context_provider',
];

/** The runtime permission a plugin must hold to register each extension kind. */
export const PLUGIN_EXTENSION_PERMISSION: Record<PluginExtensionKind, RuntimePermissionKey> = {
  erp_module: 'background',
  executive_kpi: 'background',
  timeline_provider: 'background',
  graph_node: 'background',
  graph_relationship: 'background',
  memory_projector: 'background',
  automation_trigger: 'automation',
  automation_action: 'automation',
  search_provider: 'background',
  context_provider: 'background',
};

/** A flat, declarative spec — interpreted by the consuming subsystem. */
export type PluginExtensionSpec = Record<string, string | number | boolean | null>;

export interface PluginExtension {
  /** Stable id within a (plugin, kind); re-registering the same id replaces it. */
  id: string;
  pluginId: string;
  /** The plugin's manifest version at registration time. */
  pluginVersion: string;
  kind: PluginExtensionKind;
  label: string;
  spec: PluginExtensionSpec;
  registeredAt: string;
}

export interface PluginExtensionCounts {
  total: number;
  byKind: Record<string, number>;
  byPlugin: Record<string, number>;
}
