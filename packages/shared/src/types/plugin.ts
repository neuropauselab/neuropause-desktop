/**
 * Plugin Runtime SDK — shared contracts. A plugin is a versioned, signed bundle
 * that extends NeuroPause itself (unlike a catalog app, which the user merely
 * launches). Code plugins run isolated in their own process behind a
 * permission-gated host API; UI plugins contribute surfaces to the workspace.
 */
import type { HealthStatus, RuntimePermissionKey, RuntimeStatus } from './runtime';

/** How a plugin executes. UI plugins contribute surfaces; the rest run code. */
export type PluginKind = 'background' | 'automation' | 'ai_agent' | 'mcp_server' | 'ui';

/** Workspace surfaces a plugin can contribute to. */
export type PluginSurfaceKind = 'sidebar' | 'toolbar' | 'panel' | 'widget';

export interface PluginContribution {
  id: string;
  surface: PluginSurfaceKind;
  title: string;
  icon: string | null;
  /** Entry (html/url) for the contributed surface. Mounted by the host UI. */
  entry: string | null;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  /** Host compatibility range, e.g. ">=0.1.0 <1.0.0" or "^0.3.0". */
  engine: { neuropause: string };
  kind: PluginKind;
  /** Entry module for code plugins (relative to the plugin root). */
  main: string | null;
  contributions: PluginContribution[];
  permissions: RuntimePermissionKey[];
}

export type PluginState = 'installed' | 'enabled' | 'disabled' | 'error';

export interface PluginDto {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  kind: PluginKind;
  state: PluginState;
  health: HealthStatus;
  runtimeStatus: RuntimeStatus;
  permissions: RuntimePermissionKey[];
  grantedPermissions: RuntimePermissionKey[];
  contributions: PluginContribution[];
  engineRange: string;
  /** Whether the manifest engine range is satisfied by the current host. */
  compatible: boolean;
  lastError: string | null;
  source: string;
  installedAt: string;
  updatedAt: string;
}

export type PluginEventType = 'lifecycle' | 'log' | 'crash' | 'host';

export interface PluginHostEvent {
  pluginId: string;
  type: PluginEventType;
  status: RuntimeStatus | null;
  health: HealthStatus | null;
  message: string | null;
  at: string;
}

export interface PluginInstallResult {
  ok: boolean;
  plugin: PluginDto | null;
  message: string | null;
  incompatible: boolean;
  missingPermissions: RuntimePermissionKey[];
}
