/**
 * Connector Registry + Manager (NCEA 10.4, Phase 1). Install/enable/disable/
 * uninstall connectors; discovery by capability; health; versioning; dependency
 * resolution (a connector cannot install before its dependencies, and cannot
 * uninstall while depended upon); metadata + policies exposure.
 */
import type { Clock } from '@neuropause/cloud-core';
import type { ConnectorDefinition, ConnectorHealth } from './sdk';

export type ConnectorState = 'enabled' | 'disabled';

export interface ConnectorEntry {
  def: ConnectorDefinition;
  state: ConnectorState;
  installedAt: number;
}

export class ConnectorRegistry {
  private readonly entries = new Map<string, ConnectorEntry>();

  constructor(private readonly clock: Clock) {}

  install(def: ConnectorDefinition): ConnectorEntry {
    if (this.entries.has(def.id)) throw new Error(`connector '${def.id}' already installed`);
    for (const dep of def.dependencies ?? []) {
      if (!this.entries.has(dep)) throw new Error(`connector '${def.id}' requires missing dependency '${dep}'`);
    }
    const entry: ConnectorEntry = { def, state: 'enabled', installedAt: this.clock.now() };
    this.entries.set(def.id, entry);
    return entry;
  }

  uninstall(id: string): void {
    const dependents = this.dependents(id);
    if (dependents.length > 0) {
      throw new Error(`cannot uninstall '${id}' — depended upon by: ${dependents.join(', ')}`);
    }
    this.entries.delete(id);
  }

  enable(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.state = 'enabled';
  }
  disable(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.state = 'disabled';
  }

  get(id: string): ConnectorEntry | undefined {
    return this.entries.get(id);
  }
  list(): ConnectorEntry[] {
    return [...this.entries.values()];
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
  version(id: string): string | undefined {
    return this.entries.get(id)?.def.version;
  }

  /** Discovery — connectors advertising a capability (or all). */
  discover(capability?: string): ConnectorDefinition[] {
    const defs = this.list().map((e) => e.def);
    return capability ? defs.filter((d) => d.capabilities.includes(capability)) : defs;
  }

  /** Who depends on `id`. */
  dependents(id: string): string[] {
    return this.list()
      .filter((e) => (e.def.dependencies ?? []).includes(id))
      .map((e) => e.def.id);
  }

  health(): Array<{ id: string; health: ConnectorHealth }> {
    return this.list().map((e) => ({
      id: e.def.id,
      health: e.state === 'disabled' ? { status: 'down', detail: 'disabled' } : (e.def.health?.() ?? { status: 'ok' }),
    }));
  }
}
