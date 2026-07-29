/**
 * Plugin runtime (NCEA 10.2C, Phase 10). Runtime INFRASTRUCTURE only — dynamic
 * registration, capability discovery, and version-compatibility checks for AI
 * providers, connectors, enterprise modules, and future marketplace packages.
 * No marketplace functionality is implemented here.
 */
export interface PluginContext {
  register(capability: string, impl: unknown): void;
}

export interface PluginDefinition {
  name: string;
  /** semver-ish, e.g. "1.2.3". */
  version: string;
  capabilities: string[];
  /** Minimum runtime version this plugin requires. */
  requires?: { runtime: string };
  register(ctx: PluginContext): void;
}

export interface RegisteredCapability {
  plugin: string;
  capability: string;
  impl: unknown;
}

function parseVersion(v: string): number[] {
  return v.replace(/[^0-9.].*$/, '').split('.').map((n) => Number(n) || 0);
}

/** True when `have` >= `min` by numeric version comparison. */
export function satisfiesMinVersion(have: string, min: string): boolean {
  const a = parseVersion(have);
  const b = parseVersion(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

export class PluginRuntime {
  private readonly plugins = new Map<string, PluginDefinition>();
  private readonly capabilities: RegisteredCapability[] = [];

  constructor(private readonly runtimeVersion: string) {}

  register(def: PluginDefinition): void {
    if (this.plugins.has(def.name)) throw new Error(`plugin '${def.name}' already registered`);
    if (def.requires && !satisfiesMinVersion(this.runtimeVersion, def.requires.runtime)) {
      throw new Error(
        `plugin '${def.name}' requires runtime >= ${def.requires.runtime} (have ${this.runtimeVersion})`,
      );
    }
    def.register({
      register: (capability, impl) => {
        this.capabilities.push({ plugin: def.name, capability, impl });
      },
    });
    this.plugins.set(def.name, def);
  }

  /** Capability discovery — all impls registered for a capability. */
  discover(capability: string): RegisteredCapability[] {
    return this.capabilities.filter((c) => c.capability === capability);
  }

  list(): PluginDefinition[] {
    return [...this.plugins.values()];
  }
}
