/**
 * Plugin extension host-calls (P3.0, Increment 6) — pure.
 *
 * Handles the `extension.register` / `extension.unregister` host calls a sandboxed
 * plugin makes: validates the kind, enforces the per-kind permission against what
 * the plugin was granted, sanitizes the declarative spec, stamps the plugin version
 * + time, and writes the registry. Pure (registry + permission check + clock are
 * injected), so the permission-gating logic unit-tests without the plugin host.
 */
import {
  PLUGIN_EXTENSION_KINDS,
  PLUGIN_EXTENSION_PERMISSION,
  type PluginExtension,
  type PluginExtensionKind,
  type PluginExtensionSpec,
  type RuntimePermissionKey,
} from '@neuropause/shared';
import type { PluginExtensionRegistry } from './extensionRegistry';

export interface ExtensionCallContext {
  pluginId: string;
  pluginVersion: string;
  hasPermission: (perm: RuntimePermissionKey) => boolean;
  now: () => string;
}

// Bounds on what a (sandboxed, untrusted) plugin can register — a DoS guard so a
// compromised plugin can't exhaust the main-process heap with huge or unbounded
// registrations (P3.0, Increment 10).
const MAX_ID_LEN = 200;
const MAX_LABEL_LEN = 200;
const MAX_SPEC_KEYS = 64;
const MAX_SPEC_KEY_LEN = 200;
const MAX_SPEC_VALUE_LEN = 2048;
const MAX_EXTENSIONS_PER_PLUGIN = 200;

function sanitizeSpec(v: unknown): PluginExtensionSpec {
  const out: PluginExtensionSpec = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    let n = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (n >= MAX_SPEC_KEYS) break;
      if (k.length > MAX_SPEC_KEY_LEN) continue;
      if (typeof val === 'string') out[k] = val.slice(0, MAX_SPEC_VALUE_LEN);
      else if (typeof val === 'number' || typeof val === 'boolean' || val === null) out[k] = val;
      else continue;
      n += 1;
    }
  }
  return out;
}

/** Apply an `extension.*` host call. Throws on bad kind / missing permission / bad id. */
export function applyExtensionCall(
  registry: PluginExtensionRegistry,
  ctx: ExtensionCallContext,
  method: string,
  args: Record<string, unknown>,
): unknown {
  const kind = String(args.kind ?? '') as PluginExtensionKind;

  if (method === 'extension.register') {
    if (!PLUGIN_EXTENSION_KINDS.includes(kind)) throw new Error(`Unknown extension kind "${args.kind}"`);
    const perm = PLUGIN_EXTENSION_PERMISSION[kind];
    if (!ctx.hasPermission(perm)) throw new Error(`Permission "${perm}" not granted for ${kind} extension`);
    const id = String(args.id ?? '').trim().slice(0, MAX_ID_LEN);
    if (!id) throw new Error('extension id is required');
    // Per-plugin registration cap — replacing an existing (kind,id) is always allowed.
    const existing = registry.byPlugin(ctx.pluginId).some((e) => e.kind === kind && e.id === id);
    if (!existing && registry.byPlugin(ctx.pluginId).length >= MAX_EXTENSIONS_PER_PLUGIN) {
      throw new Error(`extension limit reached for plugin (max ${MAX_EXTENSIONS_PER_PLUGIN})`);
    }
    const ext: PluginExtension = {
      id,
      pluginId: ctx.pluginId,
      pluginVersion: ctx.pluginVersion,
      kind,
      label: String(args.label ?? id).slice(0, MAX_LABEL_LEN),
      spec: sanitizeSpec(args.spec),
      registeredAt: ctx.now(),
    };
    registry.register(ext);
    return { ok: true, id };
  }

  if (method === 'extension.unregister') {
    if (!PLUGIN_EXTENSION_KINDS.includes(kind)) throw new Error(`Unknown extension kind "${args.kind}"`);
    return { ok: registry.unregister(ctx.pluginId, kind, String(args.id ?? '')) };
  }

  throw new Error(`Unknown extension method: ${method}`);
}
