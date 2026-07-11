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

  get(id: string): Scenario | null {
    return this.scenarios.get(id) ?? null;
  }
  getByKey(workspaceId: string, key: string): Scenario | null {
    return [...this.scenarios.values()].find((s) => s.workspaceId === workspaceId && s.key === key) ?? null;
  }
  list(opts: { workspaceId?: string; includeArchived?: boolean } = {}): Scenario[] {
    return [...this.scenarios.values()]
      .filter((s) => (opts.workspaceId ? s.workspaceId === opts.workspaceId : true))
      .filter((s) => (opts.includeArchived ? true : !s.archived))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  count(): number {
    return this.scenarios.size;
  }

  update(id: string, patch: { name?: string; description?: string; metadata?: Partial<ScenarioMetadata> }): Scenario | null {
    const s = this.scenarios.get(id);
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
    const s = this.scenarios.get(id);
    if (!s) return null;
    const next = { ...s, archived, updatedAt: new Date(this.now()).toISOString() };
    this.scenarios.set(id, next);
    this.changed();
    return next;
  }

  /** Append a new immutable version; an identical spec dedupes to the current head. */
  createVersion(scenarioId: string, spec: ScenarioSpec, changelog = ''): ScenarioVersion | null {
    const s = this.scenarios.get(scenarioId);
    if (!s) return null;
    const list = this.versionsByScenario.get(scenarioId) ?? [];
    const checksum = checksumSpec(spec);
    const head = list[list.length - 1];
    if (head && head.checksum === checksum) return head; // dedupe — no redundant version

    const version: ScenarioVersion = {
      id: `sbv_${randomUUID()}`,
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

  versions(scenarioId: string): ScenarioVersion[] {
    return [...(this.versionsByScenario.get(scenarioId) ?? [])];
  }
  getVersion(scenarioId: string, version: number): ScenarioVersion | null {
    return (this.versionsByScenario.get(scenarioId) ?? []).find((v) => v.version === version) ?? null;
  }
  latestVersion(scenarioId: string): ScenarioVersion | null {
    const list = this.versionsByScenario.get(scenarioId) ?? [];
    return list[list.length - 1] ?? null;
  }
}
