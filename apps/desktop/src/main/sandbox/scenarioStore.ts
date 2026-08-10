/**
 * AI Sandbox — Scenario store (S1): the registry, versioning, and metadata for
 * scenarios. A scenario is a named, versioned definition (opaque `spec` — later
 * stages give it meaning); each `createVersion` appends an immutable, checksummed
 * version and never overwrites history (identical specs dedupe to the current head).
 * Keys are unique within a workspace. Electron-free.
 */
import { randomUUID } from 'node:crypto';
import {
  EMPTY_SCENARIO_METADATA,
  checksumSpec,
  type Scenario,
  type ScenarioMetadata,
  type ScenarioSpec,
  type ScenarioVersion,
} from '@neuropause/shared';
import { PersistentStore } from './persistentStore';

interface ScenarioFile {
  scenarios: Scenario[];
  versions: ScenarioVersion[];
}

export interface ScenarioCreateInput {
  workspaceId: string;
  key: string;
  name: string;
  description?: string;
  metadata?: Partial<ScenarioMetadata>;
}

export class SandboxScenarioStore extends PersistentStore<ScenarioFile> {
  private scenarios = new Map<string, Scenario>();
  private versionsByScenario = new Map<string, ScenarioVersion[]>();

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath);
  }

  protected snapshot(): ScenarioFile {
    return { scenarios: [...this.scenarios.values()], versions: [...this.versionsByScenario.values()].flat() };
  }
  protected hydrate(data: Partial<ScenarioFile>): void {
    for (const s of data.scenarios ?? []) if (s?.id) this.scenarios.set(s.id, s);
    for (const v of data.versions ?? []) {
      if (!v?.scenarioId) continue;
      const list = this.versionsByScenario.get(v.scenarioId) ?? [];
      list.push(v);
      this.versionsByScenario.set(v.scenarioId, list);
    }
    for (const list of this.versionsByScenario.values()) list.sort((a, b) => a.version - b.version);
  }

  private mergeMetadata(base: ScenarioMetadata, patch?: Partial<ScenarioMetadata>): ScenarioMetadata {
    return {
      tags: patch?.tags ?? base.tags,
      category: patch?.category !== undefined ? patch.category : base.category,
      owner: patch?.owner !== undefined ? patch.owner : base.owner,
      labels: patch?.labels ?? base.labels,
    };
  }

  create(input: ScenarioCreateInput): Scenario {
    const key = input.key.trim();
    if (this.getByKey(input.workspaceId, key)) {
      throw new Error(`Invalid request: scenario key "${key}" already exists in this workspace`);
    }
    const iso = new Date(this.now()).toISOString();
    const scenario: Scenario = {
      id: `sbs_${randomUUID()}`,
      // P13C N3 — owner from the resolved tenant. Throws when none resolves.
      tenantId: this.requireTenant(),
      workspaceId: input.workspaceId,
      key,
      name: input.name,
      description: input.description ?? '',
      metadata: this.mergeMetadata(EMPTY_SCENARIO_METADATA, input.metadata),
      latestVersion: 0,
      versionCount: 0,
      archived: false,
      createdAt: iso,
      updatedAt: iso,
    };
    this.scenarios.set(scenario.id, scenario);
    this.versionsByScenario.set(scenario.id, []);
    this.changed();
    return scenario;
  }

  /** The scenario, IF it is the caller's. A foreign id reads as absent. */
  get(id: string): Scenario | null {
    const sc = this.scenarios.get(id) ?? null;
    return sc !== null && this.mine(sc) ? sc : null;
  }

  /** Unscoped, for the ENGINE's scheduling only. See workspaceStore. */
  unscopedForEngine(id: string): Scenario | null {
    return this.scenarios.get(id) ?? null;
  }

  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.countOwnership([...this.scenarios.values()]);
  }
  getByKey(workspaceId: string, key: string): Scenario | null {
    return this.onlyMine([...this.scenarios.values()]).find(
      (s) => s.workspaceId === workspaceId && s.key === key,
    ) ?? null;
  }
  /**
   * The caller's scenarios, optionally narrowed to one sandbox workspace.
   *
   * P13C N3 — AN OMITTED `workspaceId` NO LONGER WIDENS. It used to mean "every
   * workspace on the install", so omitting the field was the bypass. It now
   * means "every workspace of MINE", because the tenant filter is applied
   * first and unconditionally — the optional argument narrows within a
   * boundary it can never cross.
   */
  list(opts: { workspaceId?: string; includeArchived?: boolean } = {}): Scenario[] {
    return this.onlyMine([...this.scenarios.values()])
      .filter((s) => (opts.workspaceId ? s.workspaceId === opts.workspaceId : true))
      .filter((s) => (opts.includeArchived ? true : !s.archived))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  count(): number {
    return this.list({ includeArchived: true }).length;
  }

  update(id: string, patch: { name?: string; description?: string; metadata?: Partial<ScenarioMetadata> }): Scenario | null {
    const s = this.get(id); // scoped: a foreign id is not found
    if (!s) return null;
    const next: Scenario = {
      ...s,
      name: patch.name ?? s.name,
      description: patch.description ?? s.description,
      metadata: this.mergeMetadata(s.metadata, patch.metadata),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.scenarios.set(id, next);
    this.changed();
    return next;
  }

  archive(id: string, archived: boolean): Scenario | null {
    const s = this.get(id); // scoped: a foreign id is not found
    if (!s) return null;
    const next = { ...s, archived, updatedAt: new Date(this.now()).toISOString() };
    this.scenarios.set(id, next);
    this.changed();
    return next;
  }

  /** Append a new immutable version; an identical spec dedupes to the current head. */
  createVersion(scenarioId: string, spec: ScenarioSpec, changelog = ''): ScenarioVersion | null {
    const s = this.get(scenarioId); // scoped
    if (!s) return null;
    const list = this.versionsByScenario.get(scenarioId) ?? [];
    const checksum = checksumSpec(spec);
    const head = list[list.length - 1];
    if (head && head.checksum === checksum) return head; // dedupe — no redundant version

    const version: ScenarioVersion = {
      id: `sbv_${randomUUID()}`,
      // Inherits the scenario's owner rather than re-resolving: a version
      // belongs to whatever the scenario belongs to, always.
      tenantId: s.tenantId ?? null,
      scenarioId,
      version: (head?.version ?? 0) + 1,
      spec,
      checksum,
      changelog,
      createdAt: new Date(this.now()).toISOString(),
    };
    list.push(version);
    this.versionsByScenario.set(scenarioId, list);
    this.scenarios.set(scenarioId, { ...s, latestVersion: version.version, versionCount: list.length, updatedAt: version.createdAt });
    this.changed();
    return version;
  }

  /**
   * A scenario's versions — gated on the SCENARIO, not the version rows.
   *
   * `spec` is the scenario's full definition, so this is a content read and the
   * sharpest of the three. Gating on the parent means one check covers all
   * three accessors and cannot disagree with `get`.
   */
  versions(scenarioId: string): ScenarioVersion[] {
    if (this.get(scenarioId) === null) return [];
    return [...(this.versionsByScenario.get(scenarioId) ?? [])];
  }
  getVersion(scenarioId: string, version: number): ScenarioVersion | null {
    if (this.get(scenarioId) === null) return null;
    return (this.versionsByScenario.get(scenarioId) ?? []).find((v) => v.version === version) ?? null;
  }
  latestVersion(scenarioId: string): ScenarioVersion | null {
    if (this.get(scenarioId) === null) return null;
    const list = this.versionsByScenario.get(scenarioId) ?? [];
    return list[list.length - 1] ?? null;
  }

  /** Unscoped, for the ENGINE's scheduling only. */
  latestVersionForEngine(scenarioId: string): ScenarioVersion | null {
    const list = this.versionsByScenario.get(scenarioId) ?? [];
    return list[list.length - 1] ?? null;
  }
  getVersionForEngine(scenarioId: string, version: number): ScenarioVersion | null {
    return (this.versionsByScenario.get(scenarioId) ?? []).find((v) => v.version === version) ?? null;
  }
}
